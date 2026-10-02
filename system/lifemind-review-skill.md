# lifemind 知识库审理 Skill 协议

本文件记录 lifemind 知识库审理 Skill 的稳定边界。外部模型只能返回本协议 JSON，由 lifemind 本地校验、编译、预览、确认、写入和回滚。

## 协议版本

- 当前协议：`lifemind.review.v2`
- 兼容协议：`lifemind.review.v1`

## Skill 职责

- 审理用户上传的学习材料。
- 纠正明确错误。
- 按技术栈、目录分支和颗粒度输出结构分析计划。
- 建立知识关系。
- 标记不确定内容。

v2 不允许模型直接输出最终笔记 Markdown。模型输出 `stackDecisions`、`sections` 和带证据的 `relations`，由本地编译器生成 `GeneratedNote` 和 Obsidian Markdown。`placement` 只用于选择已经存在的 Vault 根节点/目录节点；本批次新笔记之间的层级只使用 `parentId` 表达。

## 调用链路

```text
上传内容
-> createReviewAnalysisRequest
-> ReviewSkillRunner
-> local fallback 或 Tauri 后端 run_review_skill_model
-> parseReviewAnalysisPlan / validateReviewAnalysisPlan
-> 本地分析计划编译器
-> Obsidian 预览
-> 用户确认
-> 真实 Vault 写入事务
```

外部模型请求通过 Tauri 后端命令发起，前端不直接用浏览器 `fetch` 访问模型服务。模型 API Key 由用户在桌面设置页填写，并保存到系统钥匙串。Tauri 会把 API 返回的 `usage` 一并传回前端，LifeMind 在审理页显示本次请求次数、总 token 和估算费用；若旧后端未返回 usage，界面会明确显示不可用。

## 已支持模型接口格式

- DeepSeek Flash + Strict Tool Call（Chat Completions 兼容请求，使用 `tools`、`thinking: { type: "disabled" }` 和 `strict: true`；当前结构化审理关闭 thinking，以保持工具调用和输出长度稳定）
- 严格工具调用统一请求 `https://api.deepseek.com/beta/chat/completions`；用户填写的 base URL 由 LifeMind 自动规范化。

## 已内置模型

- DeepSeek `deepseek-flash`（旧版模型设置会迁移到该名称）

PDF 文本层会在本地计算困难文字占比：不超过 20% 正常审理，20%～30% 允许审理但提示风险，30%～50% 只允许部分审理，超过 50% 停止生成确定知识；关键公式、标题、定义和关系中的无法确认文字始终需要人工复核。

PDF 页面会独立渲染为视觉证据并发送给支持视觉输入的模型。页面图像是手写内容、版面和数学公式的主要依据；低质量 PDF 文本层会从模型正文和逐行证据中移除。正式审理链路不运行 OCR；OCR 代码只保留在开发测试诊断中。

当前版本暂不暴露其他外部模型供应商。模型不可用时，是否启用本地 fallback 由用户在设置页决定。

## 成本控制

- draft-pass、final-pass 和单轮审理默认使用 `max_tokens=10000`，防止 thinking 或结构化输出异常增长。
- 两轮正式审理仍保留最终复审质量；draft-pass 和 final-pass 都关闭 thinking，避免把输出预算消耗在不可见推理上，并让严格工具调用保持稳定。
- Vault 索引先由本地相关性筛选，最多向模型发送 12 篇相关旧笔记和 40 条关系；全库扫描结果不会原样塞进每次请求。
- 审理请求的稳定字段排在 pass-specific 字段前面，使两轮请求尽可能复用 DeepSeek 的前缀缓存。
- 协议校验失败最多只追加一次修复请求，不允许无限重试。
- 费用按 API 返回的 `prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、`completion_tokens` 和 `reasoning_tokens` 统计；`reasoning_tokens` 已包含在 completion tokens 内，不重复计费。

## 禁止事项

- 不直接写入 Obsidian Vault。
- 不执行文件操作。
- 不绕过用户确认页。
- 不把不确定内容当作确定知识写入。

## v2 输出结构

```json
{
  "protocolVersion": "lifemind.review.v2",
  "stackDecisions": [
    {
      "sourceId": "src-1",
      "name": "技术栈",
      "confidence": "高",
      "evidence": ["用户技术栈提示"]
    }
  ],
  "sections": [
    {
      "id": "src-1-topic",
      "sourceId": "src-1",
      "title": "知识段标题",
      "role": "基本概念",
      "grain": "中颗粒度",
      "placement": {
        "mode": "new-root",
        "parentNodeId": null,
        "branchName": "基本概念",
        "targetNodeId": null
      },
      "parentId": null,
      "status": "新建笔记",
      "body": "序列满足以下递推关系：{{formula:src-1-formula-1}}",
      "formulas": [
        {
          "id": "src-1-formula-1",
          "latex": "x[n] = x[n-1] + u[n]",
          "display": "block",
          "sourcePage": 1,
          "evidenceId": null,
          "anchor": "{{formula:src-1-formula-1}}",
          "confidence": "高"
        }
      ],
      "imagePlacements": [
        {
          "assetId": "pdf-image-src-1-page-1-1",
          "sourcePage": 1,
          "placement": "after-section",
          "anchor": null,
          "caption": "序列计算示意图",
          "alt": "PDF 内嵌的序列计算示意图",
          "confidence": "高"
        }
      ],
      "evidence": ["原文对应段落"]
    }
  ],
  "relations": [
    {
      "type": "前置知识",
      "source": "src-1-topic",
      "target": "既有笔记标题",
      "evidence": "该知识建立在既有笔记之上",
      "confidence": "中"
    }
  ],
  "corrections": [
    {
      "sourceId": "src-1",
      "original": "原文错误点",
      "fixed": "修正后表述",
      "reason": "修正理由"
    }
  ],
  "uncertain": []
}
```

含页面证据的 PDF 还必须返回顶层 `pageCoverage`，每个输入页恰好一项：

```json
{
  "sourceId": "src-1",
  "page": 1,
  "status": "covered",
  "sectionIds": ["src-1-topic"],
  "evidenceIds": [],
  "summary": "第 1 页已按页面图像审理。"
}
```

公式正文使用 `{{formula:<id>}}` 锚点，由本地编译为 LaTeX 数学块。整页渲染图只作为模型审理上下文，不写入笔记或 Vault；笔记图片只能由 `imagePlacements` 引用本轮实际发送的 PDF 内嵌图片，并由本地编译到 `附件/PDF图片/`。PDF 笔记会按主题首次出现的页序放入带序号的二级目录，保证技术栈根目录下不直接堆放批次笔记。

`sections[].placement` 的 `parentNodeId` 只能引用 `vaultIndex` 中已经存在的根节点或目录节点，不能填写本批次 `sections[].id`。当当前技术栈在 Vault 中还没有对应根节点或目录时，使用 `new-root` 并把新笔记之间的关系写在 `parentId`。`sections[].path` 仅作为旧版本兼容字段，必须是技术栈根目录下的安全相对目录数组，不能包含绝对路径或 `..`。`parentId` 只能引用本次 `sections[].id`。用户填写的 `stackHint` 是根目录约束，模型不得改成其他技术栈。

## v1 兼容结构

本地核心仍保留旧结构适配能力，便于读取历史测试数据；当前 DeepSeek 外部请求不会发送或接受 v1 普通文本响应：

```json
{
  "protocolVersion": "lifemind.review.v1",
  "corrections": [],
  "notes": [
    {
      "sourceId": "src-1",
      "title": "笔记标题",
      "grain": "中颗粒度",
      "path": "技术栈 / 分支 / 子分支",
      "status": "新建笔记",
      "markdown": "# 笔记标题\n\n可直接写入 Obsidian 的 Markdown"
    }
  ],
  "relations": [],
  "uncertain": []
}
```

## 本地校验

lifemind 会在生成审理批次前检查：

- v2 协议版本必须匹配；v1 只允许进入本地兼容适配器，不能绕过严格工具调用。
- 每个上传来源必须有一个技术栈判断。
- 已填写技术栈时，模型根目录必须与用户填写值一致。
- v2 分段 id 不能重复，parentId 必须存在且不能指向自己。
- v2 目录必须是安全的相对目录段。
- v2 关系必须包含证据和置信度，不能连接同一个节点。
- sourceId 必须来自本次上传内容。
- 笔记 id 不能重复。
- grain 只能是大颗粒度、中颗粒度、小颗粒度。
- status 只能是新建笔记、合并到旧笔记。
- relation type 只能是依赖、包含、并列、递进、对比、应用于、容易混淆、前置知识。
- path 不能是绝对路径，也不能包含 `..`。
- 完全空的 corrections / relations 占位对象会被忽略；半截纠错或半截关系仍会被判定为无效。

通过校验后，lifemind 才会生成 Obsidian 预览和确认页。
