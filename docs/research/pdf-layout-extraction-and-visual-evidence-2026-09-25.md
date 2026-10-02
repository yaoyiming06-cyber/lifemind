# PDF 版面提取与视觉证据调研

日期：2026-09-25
范围：只读调查 LifeMind 当前 PDF 提取链路、Obsidian 图片附件能力，以及 PDF 文字/版面关系与视觉模型的可行处理方式。本次未修改应用代码。

## 结论

- 可以把 PDF 内的图片资源，或 PDF 页面/困难区域的渲染图，作为附件写入 Obsidian Vault，再用 `![[附件路径]]` 嵌入笔记。LifeMind 当前批次写入只处理 Markdown 文本，还没有把二进制附件纳入预览、冲突检查、备份和回滚。
- PDF 内容适合按“可直接抽取”和“困难/待核验”两大类展示。第二类应区分可由 OCR/视觉恢复的内容与暂时无法可靠判读的内容；不能承诺任意 PDF 都能无损提取全部文字。
- PDF 有文本层不代表文本完整、阅读顺序正确或公式结构正确。可靠性同时取决于字符映射、页面布局和实际绘制内容；缺失字符映射、扫描图、轮廓字、手写、公式等需要视觉证据补充。
- 公式和语义关系并非原则上不能由大模型审理，也不意味着必须先训练自己的 Transformer。首先要保证模型看到整页上下文、原图/局部图、文字候选、坐标和置信度；提取阶段若已丢失上下标、关联说明或跨区关系，后续模型无法稳定复原。
- “把识别词语变成 token，再用坐标算注意力”方向有用，但坐标字段本身不会让普通文本 LLM 获得空间注意力。较稳妥的第一版是保留有稳定 ID 的文字行/片段及其页码、框坐标、来源、候选和置信度，并将同页证据整体交给模型分块；几何邻接只作为提示或辅助关系，不预先切成彼此隔离的层。

## 图片进入 Obsidian

Obsidian 将附件作为 Vault 中的普通文件，并支持在笔记中嵌入附件。可写入原 PDF 中可导出的图片对象；对于矢量绘制、复杂公式或无法单独导出的内容，可以渲染整页或裁剪区域作为视觉证据。二者应区分：原始图片对象更干净但不包含周边解释；页面/区域渲染保留上下文，但会栅格化并可能增加文件体积。

建议附件有稳定、可追溯的相对路径，例如 `附件/PDF来源/<源文件名>/第02页.png` 或 `.../区域-03.png`，笔记通过 `![[附件/PDF来源/.../第02页.png]]` 引用。写附件应进入同一批次事务：写入计划列出附件、路径冲突可见、覆盖前备份、撤销时恢复/删除对应文件。不要只生成 Markdown 引用而不复制附件，否则很容易得到断链。

## PDF 内容分类

| 类别 | 判定 | 处理 |
|---|---|---|
| 可直接抽取 | PDF 中有文本绘制内容，字符映射合理，抽取字符与页面位置/顺序检查没有明显异常 | 保留原文、页码和文本片段坐标；规范化文本另存，不覆盖原始证据 |
| 困难但可尝试恢复 | 扫描页、嵌入图片文字、异常字体映射、手写、小字号、公式/表格/多栏或阅读顺序不确定 | OCR/视觉模型生成候选；保留候选置信度、所在区域和原页/裁剪图；低置信处标“不确定” |
| 暂不可归类/无法可靠确认 | 当前 OCR 和文本层互相冲突、符号关系不可判、图像过糊或模型没有足够证据 | 保留页面/区域证据和坐标，停止自动补猜；在审理结果中显式留待人工确认 |

这满足用户提出的“易提取 vs 困难文字”两类入口；第三行是困难类内部的状态，而不是假装 OCR 一定能解决它。质量评估不能只数提取字符，还应检查异常字符、字符覆盖、行/列空间顺序、文本层与 OCR 差异，并对公式或关系不确定区域做页面回看。

## 分块和跨区域关系

箭头检测不必成为分块前提。编号、标题、缩进、空间接近、重复术语、括号说明等都可能是用户的组织标记；模型应该看到统一的页面证据后，再判断哪些内容属于一个语义块，以及块之间是什么关系。

建议的证据对象至少包含：`id`、`page`、`text`、`bbox`（归一化 x/y/宽/高）、`source`（PDF 文本层/OCR/人工）、候选文字及置信度、可选的原图区域引用。坐标统一到同一页面坐标系。把文本行/片段作为对象通常比把每个字符强行切成 token 更稳，除非某类任务确实需要字符级定位。

第一阶段由模型基于完整页面图像和统一证据清单输出分块及关系，关系端点引用证据 ID；几何近邻、重叠、同基线/同列等可作为辅助提示。不要先把“文本层、OCR、公式、图片”分成不能互相通信的上下文。模型结论应能回指证据区域；低置信时保留不确定，而不是生成确定知识。

坐标作为普通 JSON/文本属性能让模型看到“这里有位置数据”，但不会自动变成模型内部的空间注意力。LayoutLM 系列把文本、图像和布局联合建模，并通过专门架构/预训练学习空间关系；这支持联合保留空间与文字证据的方向，但不是仅追加坐标就能得到同等能力的证明。因此建议先用现有视觉模型 + 全页证据结构 + 回归集验证，再按实测误差判断是否要引入/训练文档布局模型。

## 公式与关系模型选择

公式处理应以原图区域为底证据：PDF 文本层可用时保留原字符；可恢复时产生 LaTeX/纯文本候选；无法确认时同时留图并标记不确定。OCR 的字符串置信度不等于公式结构正确，也不能证明括号范围、上下标或等式关系正确。

视觉大模型可在输入了页面图像的前提下分析公式、表格和版面关系；这是能力可行性，不是对本项目准确率的保证。DeepSeek 官方在 2026-09-10 发布信息称 `deepseek-flash` 已路由到 DeepSeek-V4.1-Flash 并支持原生多模态视觉。DeepSeek Vision API 文档展示了 Chat Completions 的多模态内容块格式（文本块与 `image_url` 块等）。这说明可接收视觉输入的通用模型不等同于“自己训练 Transformer”。具体的图像理解、结构化工具调用组合仍需用项目样本做端到端验证。

## LifeMind 当前实现核对

- [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) 的 `extract_pdf_content` 先取 PDFKit 文本层；文本层为空或命中特定异常字符/术语启发式条件时才运行 macOS Vision OCR。因此当前策略可能遇到“文本非空但公式、阅读顺序或页面结构已坏”的漏检。
- PDFKit 文本层脚本目前只序列化每页的 `page.string`，Rust 侧结构也是 `{ page, text }`；文本层片段自己的坐标没有保留。OCR 虽然有框坐标和置信度，但目前同样没有以结构化证据传进审理请求。
- OCR 结果内部包含 `x/y/width/height/confidence`；但 `build_pdf_extracted_content` 最终把 OCR 结果整理成文本块，坐标和置信度没有作为结构化字段传到审理模型。`group_ocr_page_blocks` 主要按纵向间距聚类，也不代表语义分块。
- 当前 PDF Vision OCR 渲染整页并提取文本候选，不等于已经专门识别数学公式或区域间语义关系。独立图片入口仍提示暂不支持。
- 当前模型请求构造把请求 JSON 序列化为普通 `String` 放进用户消息；还没有使用 DeepSeek 文档中的多模态消息内容块。因此官方模型支持视觉，不表示当前 LifeMind 审理已把 PDF 页面图像发送给模型。
- 当前 Vault 写入事务接收 Markdown 内容并使用文件写入；没有二进制附件 payload。新增图片附件需要扩展批次写入/冲突检查/备份与撤销，而非只在 Markdown 内写嵌入语法。

此前测试 PDF 的独立检查记录（约 1703 个文本层字符、Vision OCR 多数候选置信度约 0.30、存在 PDF 内嵌图片对象）来自先前样本调查；这属于单份样本实测，不能外推为通用指标。

## 来源

- Adobe, *PDF Reference / ISO 32000-1:2008*: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
- W3C, *PDF3: Ensuring correct reading order in PDF documents*: https://www.w3.org/TR/WCAG20-TECHS/PDF.html#PDF3
- Mozilla PDF.js API, `TextItem`（包含字符串、变换矩阵、宽高、字体名、行尾信息等）: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
- Apple Vision, `VNRecognizedTextObservation`（识别文字与所在位置）: https://developer.apple.com/documentation/vision/vnrecognizedtextobservation
- Apple Vision, `VNRecognizeTextRequest`（识别级别、语言、纠错与自定义词等参数）: https://developer.apple.com/documentation/vision/vnrecognizetextrequest
- Obsidian Help, *Attachments*: https://help.obsidian.md/attachments
- Obsidian Help, *Embed files*: https://help.obsidian.md/Linking+notes+and+files/Embed+files
- DeepSeek API, *Vision*: https://api-docs.deepseek.com/guides/vision
- DeepSeek API 更新日志, *DeepSeek-V4.1-Flash 发布*（2026-09-10）: https://api-docs.deepseek.com/zh-cn/updates
- Huang et al., *LayoutLMv2: Multi-modal Pre-training for Visually-Rich Document Understanding* (2020): https://arxiv.org/abs/2012.14740
- Huang et al., *LayoutLMv3: Pre-training for Document AI with Unified Text and Image Masking* (2022): https://arxiv.org/abs/2204.08387
- Kim et al., *OCR-free Document Understanding Transformer* (Donut, 2021): https://arxiv.org/abs/2111.15664
- Blecher et al., *Nougat: Neural Optical Understanding for Academic Documents* (2023): https://arxiv.org/abs/2308.13418
