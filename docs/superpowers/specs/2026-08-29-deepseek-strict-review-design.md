# DeepSeek Strict Review Design

## Goal

将 LifeMind 当前的多模型审理入口收敛为 DeepSeek 单一外部模型入口，减少协议分支，并让模型输出不能直接绕过本地校验。

## Scope

- 保留 DeepSeek 和本地 fallback。
- 删除其他外部模型供应商及其设置选项。
- DeepSeek V4 使用思考模式和严格工具调用返回 `lifemind.review.v2` 分析计划；正式复审默认使用低强度 reasoning，限制输出预算以控制成本。
- 新版分析计划使用 Vault 节点 ID 表达放置和关系：模型选择 `vaultIndex` 中的节点，本地编译器生成最终目录、文件名和 Obsidian 双链。
- 保留旧 `sections[].path` 与关系标题引用的解析能力，仅用于兼容历史计划；新 DeepSeek 工具不再暴露自由路径和自由关系端点。
- 本地继续校验协议、路径、父子关系、关系端点和颗粒度。
- 协议校验失败时只进行一次携带具体错误的定向修复请求。
- 失败细节写入 LifeMind 本地日志，界面显示简短可操作状态。
- 不改变 PDF 提取、知识分类算法、Obsidian 预览和 Vault 事务写入规则。

## Architecture

前端 runner 只暴露 DeepSeek 配置，并将统一的 `submit_review_plan` 工具定义随模型请求传给桌面端适配器。DeepSeek V4 思考模式下只发送 `tools`、`thinking`、`reasoning_effort` 和 `strict: true`，正式复审默认传 `reasoning_effort=low`，不发送固定函数对象形式的 `tool_choice`；旧模型才保留固定 `tool_choice` 兼容路径。适配器从 `tool_calls[0].function.arguments` 提取结果文本后返回前端。

浏览器 fallback 使用同一请求结构和同一响应提取逻辑，便于测试；桌面 App 的真实调用仍优先使用 Rust `invoke`。

审理链为：

```text
请求原文
  -> 本地 Vault 节点索引（root/directory/note + 稳定 nodeId）
  -> DeepSeek draft/final
  -> 工具调用参数提取
  -> 本地 lifemind.review.v2 校验 nodeId 和 placement
  -> 本地编译器根据 nodeId 生成目录、文件和链接
  -> 失败时一次定向协议修复
  -> 再次校验
  -> 生成审理批次
```

新 sections 使用 `placement`，包含 `mode`、`parentNodeId`、`branchName` 和 `targetNodeId`。关系使用 `sourceNodeId` 与 `targetNodeId`。模型不能直接写入文件系统路径，不能使用无法匹配的标题作为关系端点。

二轮质量审理的 final pass 仍然可以基于 draft pass 的有效分析计划复审。若 final pass 在一次协议修复后仍失败，保留已通过校验的 draft pass。

## Error Handling

协议失败不会生成 Obsidian 预览，也不会写入真实 Vault。runner 通过诊断回调报告阶段、错误路径、尝试次数和响应长度；桌面端将这些非敏感摘要追加到应用日志目录。API Key、完整原文和完整模型响应不进入日志。

## Settings

设置页只展示 DeepSeek。保留 API 地址、模型名、API Key、保存 Key、测试连接和本地 fallback 控制。旧的其他供应商存储值读取时迁移为 DeepSeek，不再展示。

## Verification

- 工具定义必须固定为 `submit_review_plan`、严格模式和 v2 分析计划 schema。
- DeepSeek V4 思考模式请求不得发送固定函数对象形式的 `tool_choice`，且不得发送 `temperature`。
- 工具调用成功时能生成批次。
- 有 Vault 时请求必须携带稳定的 `vaultIndex` 节点 ID。
- Port Segment 选择 TI 嵌入式根节点时，本地必须生成 `TI嵌入式/术语/Port Segment.md`，不能被模型输出的型号或 GPIO 路径覆盖。
- 失效的可选 node-id 关系不得阻止有效笔记生成，而应进入不确定项。
- 普通 `message.content` 而没有工具调用时必须失败。
- 第一次协议错误会触发一次定向修复，并把校验错误放入修复请求。
- 修复仍失败时不会无限重试。
- 其他供应商不再出现在类型、预设和设置 UI 中。
