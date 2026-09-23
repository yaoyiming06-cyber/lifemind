# LifeMind 审理稳定性与 Vault 索引实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稳定 DeepSeek 结构化审理，减少代码丢失、层级识别错误和短文本过度拆分，并为大规模 Vault 建立可增量更新的本地索引。

**Architecture:** 保留现有 `lifemind.review.v2`、本地校验、预览确认和 Tauri 事务写入边界。第一阶段统一使用 DeepSeek 非 thinking 严格工具调用；第二阶段在模型请求前增加本地结构信号，并在模型输出后增加原文覆盖和短文本拆分保护；第三阶段把 Vault 扫描结果持久化到 `.lifemind/index/notes.jsonl`，模型只接收相关摘要和少量全文。

**Tech Stack:** TypeScript、Vitest、Rust/Tauri、DeepSeek Chat Completions、Obsidian Markdown。

---

## 范围与不变项

本次变更包含：

- DeepSeek 请求参数和工具调用提取逻辑统一。
- 审理诊断日志补充请求、响应、校验和回退信息。
- 识别中文编号、阿拉伯编号、Markdown 标题和显式知识分区。
- 原文代码块保留检查。
- 短文本默认合并为一篇笔记，长文本才允许主题文件夹。
- Vault 笔记索引摘要持久化并按文件变化增量更新。

本次不改变：

- `lifemind.review.v2` 的核心字段名称。
- 用户确认后才写入 Vault 的事务流程。
- 已有批次回滚机制。
- 已确认笔记的正文内容。
- 不允许模型直接执行文件操作的安全边界。

## 推荐参数

- 审计请求：`thinking.disabled`
- 审计请求：`tool_choice` 强制 `submit_review_plan`
- 工具 schema：继续使用 `strict: true`
- 温度：`0`
- draft、repair、final 三种请求使用同一工具调用策略。
- 默认短文本阈值：有效文本 `<= 1800` 字时不创建主题文件夹。
- `1800-5000` 字时只按明确一级结构拆分，不自动创建整合文件夹。
- `> 5000` 字且存在两个以上独立主题时才允许创建整合文件夹。
- 阈值以去除重复内容、Markdown 元信息和重复代码后的有效文本长度计算。

---

### Task 1: 固定 DeepSeek 非 thinking 严格工具调用

**Files:**
- Modify: `src/lib/lifemind-review-runner.ts`
- Modify: `src-tauri/src/lib.rs`
- Test: `src/lib/lifemind-review-runner.test.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [ ] **Step 1: 写失败测试，锁定三种请求模式的请求体。**

测试要求：

```ts
expect(body.thinking).toEqual({ type: "disabled" });
expect(body.tool_choice).toEqual({
  type: "function",
  function: { name: "submit_review_plan" },
});
expect(body.tools[0].function.strict).toBe(true);
```

分别覆盖 `draft-pass`、`repair-pass`、`final-pass`，确保三者都不能退回自动工具选择。

- [ ] **Step 2: 运行聚焦测试确认当前实现失败。**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --configLoader runner --pool=threads --maxWorkers=1 --no-file-parallelism src/lib/lifemind-review-runner.test.ts -t "disabled|tool_choice" --reporter=verbose
```

Expected: 当前 `deepseek-v4-pro` thinking 分支不满足 `tool_choice` 断言。

- [ ] **Step 3: 修改前端请求构造。**

在 `callExternalReviewSkill()` 中删除基于模型名的 thinking 分支。审理 Skill 请求固定发送：

```ts
thinking: { type: "disabled" },
tool_choice: {
  type: "function",
  function: { name: deepSeekReviewTool.function.name },
},
```

保留 `temperature: 0`，保留 `/beta/chat/completions` 端点。

- [ ] **Step 4: 修改桌面端 Rust 请求构造。**

在 `build_chat_completion_request_with_max_output_tokens()` 中：

- `thinking` 固定为 `{ "type": "disabled" }`。
- `reasoning_effort` 不发送。
- 当存在工具时始终发送命名 `tool_choice`。
- 不再根据 `deepseek-v4` 判断是否省略工具选择。

保留响应中的 `tool_calls` 提取和普通 `message.content` 拒绝逻辑。

- [ ] **Step 5: 运行请求构造和 Rust 单元测试。**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --configLoader runner --pool=threads --maxWorkers=1 --no-file-parallelism src/lib/lifemind-review-runner.test.ts -t "tool call|thinking|tool_choice" --reporter=verbose
cargo test --manifest-path src-tauri/Cargo.toml build_chat_completion_request -- --nocapture
```

Expected: 所有审理阶段都发送非 thinking 强制工具调用。

---

### Task 2: 补充可定位问题的审计诊断日志

**Files:**
- Modify: `src/lib/lifemind-review-runner.ts`
- Modify: `src-tauri/src/lib.rs`
- Test: `src/lib/lifemind-review-runner.test.ts`
- Test: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写日志字段测试。**

日志事件至少包含：

```ts
{
  runId,
  reviewMode,
  attempt,
  endpoint,
  model,
  thinkingEnabled,
  toolChoice,
  maxOutputTokens,
  sourceCount,
  inputCharacters,
  inputLines,
  inputCodeFenceCount,
  structureMarkerCounts,
  httpStatus,
  finishReason,
  hasMessageContent,
  hasReasoningContent,
  toolCallCount,
  toolNames,
  toolArgumentLength,
  responseLength,
  validationStage,
  validationErrors,
  qualityFallbackToDraft
}
```

不记录 API Key、完整 prompt、完整 reasoning 内容和默认情况下的完整原文。

- [ ] **Step 2: 运行测试确认新字段不存在。**

Expected: 日志事件类型和 Rust 序列化结构缺少上述字段。

- [ ] **Step 3: 在前端 runner 生成请求摘要。**

新增纯函数统计：

- 字符数和行数。
- fenced code block 数量。
- `#` 标题数量。
- `一、`、`（一）`、`1.`、`1、`、`（1）`、`①` 等标记数量。
- `基础：`、`语法：`、`代码：` 等显式分区数量。

每次模型响应后记录完成原因、是否含普通内容、是否含 reasoning、工具调用名称和参数长度。

- [ ] **Step 4: 将 Tauri 桥接层的 HTTP 响应信息返回给前端。**

扩展 `ReviewModelInvocation`，增加内部诊断元数据。返回给前端的 JSON 仍保持 `output` 和 `usage` 兼容，诊断字段只供日志使用。

- [ ] **Step 5: 运行诊断日志测试并确认敏感信息不会写入。**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --configLoader runner --pool=threads --maxWorkers=1 --no-file-parallelism src/lib/lifemind-review-runner.test.ts -t "diagnostic|log" --reporter=verbose
cargo test --manifest-path src-tauri/Cargo.toml diagnostic -- --nocapture
```

---

### Task 3: 增加本地文本结构识别

**Files:**
- Create: `src/lib/lifemind-source-structure.ts`
- Test: `src/lib/lifemind-source-structure.test.ts`
- Modify: `src/lib/lifemind-core.ts`
- Modify: `src/lib/lifemind-review-skill.ts`
- Modify: `src/lib/lifemind-review-runner.ts`

- [ ] **Step 1: 写结构识别失败测试。**

输入：

```text
一、基础：
下拉选择框<select>：
tsx：
<select>...</select>

二、语法：
1. filter() —— 数组筛选器
2. includes() —— 字符串判断
```

期望识别：

```ts
{
  sections: [
    { level: 1, label: "基础" },
    { level: 2, label: "下拉选择框<select>" },
    { level: 3, label: "tsx", kind: "code" },
    { level: 1, label: "语法" },
    { level: 2, label: "filter()", orderedIndex: 1 },
    { level: 2, label: "includes()", orderedIndex: 2 }
  ],
  codeBlockCount: 1
}
```

覆盖 `一、`、`（一）`、`1.`、`1、`、`（1）`、`①`、Markdown 标题、冒号标题和代码围栏。

- [ ] **Step 2: 运行测试确认当前没有结构识别模块。**

- [ ] **Step 3: 实现纯本地解析器。**

解析器只产出结构信号，不生成知识、不改写正文、不决定最终目录。输出包括：

- 层级。
- 标题文本。
- 标记类型。
- 原文起止行。
- 是否代码块。
- 重复段 fingerprint。

- [ ] **Step 4: 把结构信号放入模型请求。**

在 `ReviewAnalysisRequest` 增加 `sourceStructure`，并在提示中明确：

- 结构信号来自用户原文。
- 一级分区优先保留。
- 代码块必须进入相关 section.body。
- 代码不能单独扩写为新的知识点，但不能被删除或仅改写成说明。

- [ ] **Step 5: 增加结构一致性校验。**

若模型输出已有“基础”和“语法”两个本地一级分区，则模型不能把全部 section 合并到同一个分区，除非它明确说明原文内容不足以拆分。

---

### Task 4: 防止代码丢失和幻觉扩写

**Files:**
- Modify: `src/lib/lifemind-review-skill.ts`
- Modify: `src/lib/lifemind-core.ts`
- Test: `src/lib/lifemind-core.test.ts`
- Test: `src/lib/lifemind-review-runner.test.ts`

- [ ] **Step 1: 写代码保留失败测试。**

构造包含 `tsx:` 和 JSX 的 source，以及模型 body 只返回解释、不返回代码的结果。期望：

- 该结果不能直接通过。
- 错误明确指出缺失源码块。
- 不进入 Vault 写入。

再构造模型 body 包含原代码但未加 fenced code 的结果，期望本地仅进行安全包裹，不改变代码字符。

- [ ] **Step 2: 修改提示词的代码规则。**

明确区分：

```text
代码、注释和示例不能产生额外知识点；
但原文中属于教学材料的代码必须原样保留在相关 sections[].body；
不得只用自然语言概括代码；
不得把代码拆成新的幻觉笔记。
```

- [ ] **Step 3: 增加原文代码 fingerprint 校验。**

对每个 source 提取代码块和明显代码段，比较模型 sections.body：

- 完整保留：通过。
- 代码只改变空白：允许。
- 代码被包进 Markdown fence：允许。
- 代码关键 token 丢失：拒绝并触发 repair。
- 原文没有代码但模型自行添加：标记 uncertain，不自动写入为新知识。

- [ ] **Step 4: 增加 repair 请求的缺失项说明。**

repair 请求必须包含类似：

```text
缺失证据：source=pasted-1，代码块 1 未出现在任何 sections[].body。
请重新生成完整计划，保留该代码，不新增原文没有的 section。
```

- [ ] **Step 5: 验证重复代码不重复生成。**

相同代码块出现多次时只要求至少保留一份，并在日志记录 `duplicateCodeBlockCount`，不因为重复原文强制生成多篇笔记。

---

### Task 5: 短文本合并和整合文件夹阈值

**Files:**
- Modify: `src/lib/lifemind-core.ts`
- Modify: `src/lib/lifemind-review-skill.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [ ] **Step 1: 写短文本行为测试。**

覆盖：

1. 小于等于 1800 个有效字符、只有一个主题：输出一篇笔记，无主题文件夹。
2. 小于等于 1800 个有效字符、存在“基础/语法”：输出一篇笔记，正文内保留 `## 基础`、`## 语法`。
3. 1800-5000 字：允许按明确一级结构拆分，但不启用整合文件夹。
4. 超过 5000 字且有两个独立主题：允许整合文件夹。
5. 重复粘贴相同代码不增加有效字数。

- [ ] **Step 2: 运行测试确认当前“两个成员”规则失败。**

当前 `applyAnalysisTopicFolderGrouping()` 只看子成员和已有成员数量，短文本可能因为模型拆成两个 section 就进入文件夹。

- [ ] **Step 3: 实现有效文本统计和短文本保护。**

新增本地判定：

```ts
shouldCreateTopicFolder(source, sections, structure) =
  effectiveChars > 5000 &&
  distinctTopicCount >= 2 &&
  hasExplicitHierarchyOrParentRelations
```

短文本不创建文件夹；父主题仍可作为一篇笔记中的 Markdown 小标题。

- [ ] **Step 4: 保留长文本的多整合主题能力。**

同一根目录下只有满足相同主题 fingerprint 的 section 才能归入同一文件夹。不同主题分别建立文件夹，不能按相同路径粗暴合并。

- [ ] **Step 5: 验证 `<select>` 复现样例。**

期望：

- 不因重复内容生成多篇重复笔记。
- 代码最多保留一份。
- 短文本不创建整合主题文件夹。
- “基础/语法”在同一篇笔记中可见。

---

### Task 6: 建立可增量更新的 Vault 索引摘要

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/lifemind-core.ts`
- Modify: `src/lib/lifemind-review-skill.ts`
- Modify: `src/app/page.tsx`
- Test: `src-tauri/src/lib.rs`
- Test: `src/lib/lifemind-core.test.ts`

- [ ] **Step 1: 写索引文件行为测试。**

验证：

- 首次扫描创建 `.lifemind/index/notes.jsonl`。
- 未修改笔记第二次扫描不重新生成摘要。
- 修改文件只更新该文件索引行。
- `.obsidian`、`.lifemind`、`.git`、`node_modules` 不被索引。
- 索引损坏时可以从 Markdown 文件重建。

- [ ] **Step 2: 扩展索引记录。**

每篇笔记记录：

```json
{
  "path": "React/基础/select.md",
  "title": "下拉选择框 select",
  "root": "React",
  "headings": ["基础", "语法", "代码"],
  "summary": "本地提取的短摘要",
  "keywords": ["select", "option", "value", "onChange"],
  "hasCode": true,
  "contentHash": "sha256:...",
  "modifiedAt": 0
}
```

第一版摘要使用本地规则，不调用 LLM，避免索引本身产生幻觉。

- [ ] **Step 3: 实现增量扫描。**

扫描时比较 path、modifiedAt 和 contentHash：

- 未变化：复用索引记录。
- 变化：重新解析该文件。
- 删除：移除对应记录。
- 新文件：添加记录。

- [ ] **Step 4: 改造模型上下文选择。**

先用索引的标题、路径、关键词、summary 排序，再只加载最相关笔记全文。模型上下文仍设置上限，避免几千篇笔记全部进入请求。

- [ ] **Step 5: 保持用户可见统计准确。**

界面分别显示：

- Vault 总笔记数。
- 本次提供给模型的摘要数。
- 本次提供全文的笔记数。
- 本次实际发送的字符数。

不再用“已参考 X 篇”让用户误以为所有 X 篇全文都发送给了模型。

---

### Task 7: 集成验证、回归审计和 DMG

**Files:**
- Modify only if tests expose a defect.
- Build artifact: `src-tauri/target/release/bundle/dmg/LifeMind_0.2.4_aarch64.dmg`

- [ ] **Step 1: 运行 TypeScript 类型检查。**

```bash
npx tsc --noEmit --pretty false
```

- [ ] **Step 2: 运行聚焦测试。**

```bash
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --configLoader runner --pool=threads --maxWorkers=1 --no-file-parallelism src/lib/lifemind-review-runner.test.ts src/lib/lifemind-core.test.ts src/lib/lifemind-source-structure.test.ts --reporter=verbose
```

- [ ] **Step 3: 运行 UI 合约和前端构建。**

```bash
npm run test:ui-contract
npm run build
```

- [ ] **Step 4: 运行 Rust 测试和发布构建。**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

如 Cargo fingerprint 再次卡死，只清理 `src-tauri/target/release` 后重试，不使用 `git reset --hard` 或删除用户 Vault。

- [ ] **Step 5: 校验 DMG。**

```bash
hdiutil verify src-tauri/target/release/bundle/dmg/LifeMind_0.2.4_aarch64.dmg
shasum -a 256 src-tauri/target/release/bundle/dmg/LifeMind_0.2.4_aarch64.dmg
```

验收标准：

- 二轮审理不再因普通 `message.content` 失败。
- DeepSeek 请求日志能定位协议、接口、模型、校验和回退阶段。
- `<select>` 短文本不生成不必要的整合文件夹。
- `基础/语法` 等原文层级可在结果中保留。
- 代码块不丢失、不被重复扩写。
- 大 Vault 只加载相关摘要和少量全文。
- 原有确认、写入、回滚和审计边界测试全部通过。

---

## 实施顺序

1. Task 1：协议稳定化。
2. Task 2：日志可观测性。
3. Task 3：本地结构识别。
4. Task 4：代码保留与幻觉抑制。
5. Task 5：短文本和文件夹规则。
6. Task 6：持久化索引。
7. Task 7：全量验证与 DMG。

每个 Task 都先写失败测试，再改实现；Task 1 和 Task 2 完成后即可生成一个中间测试版，不必等索引系统完成。
