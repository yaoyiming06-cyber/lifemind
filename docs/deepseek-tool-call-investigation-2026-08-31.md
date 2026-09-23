# DeepSeek 工具调用异常排查（2026-08-31）

## 结论

LifeMind 的审理链条此前将 `strict: true` 工具定义发送到常规
`https://api.deepseek.com/chat/completions` 端点。DeepSeek 官方文档将严格工具调用列为 Beta
功能，并要求使用 `https://api.deepseek.com/beta`。因此，应用侧虽然声明了严格 schema，服务端
不一定会执行严格校验，模型可能返回不符合 `lifemind.review.v2` 的工具参数。

这与本地诊断日志中出现的现象一致：工具调用本身存在，但根对象缺少
`protocolVersion`、`stackDecisions`、`sections`、`relations`、`corrections`、`uncertain` 等协议字段，
或出现截断 JSON。

## 当前审理链条

一次用户点击“开始审理”会执行：

1. `draft-pass`：生成初步结构。
2. 如结构校验失败：执行一次 `repair-pass`。
3. `final-pass`：带着初步结构再次复审定稿。
4. 如定稿结构校验失败：执行一次修复；若定稿仍失败，则保留已经通过的草稿。

每个 Chat Completions 请求本身是无状态的。跨用户审理不会携带上一次模型对话；已确认写入
Vault 的知识结构会在下一次审理前重新扫描，并以 `vaultContext`/`vaultIndex` 的形式提供给模型。

## 处理建议

1. 对 DeepSeek 严格工具调用统一使用 `/beta/chat/completions`，前端直连和 Tauri 后端路径必须一致。
2. 保留本地 schema 校验和一次修复请求。服务端 strict 只保证 JSON schema 形状，不能保证字段
   引用、Vault 节点有效性或知识逻辑正确。
3. 为每次调用写入不含正文、不含 API Key 的诊断摘要：审理阶段、请求序号、是否 strict、响应完成原因、
   是否通过、token usage。这样能区分“首轮失败后修复成功”“二轮复审失败但保留草稿”和“整次外部调用失败”。
4. 在 thinking mode 中，显式选择工具需要先通过官方 Beta 端点实测确认兼容性；官方 API 文档说明
   `tool_choice` 默认是 `auto`，而近期 SDK 兼容层存在与 thinking mode 的兼容性问题。

## 参考

- DeepSeek Tool Calls（Strict Mode Beta）：https://api-docs.deepseek.com/guides/tool_calls
- DeepSeek Multi-round Conversation（Chat Completions 无状态）：https://api-docs.deepseek.com/guides/multi_round_chat
- DeepSeek Chat Completion API Reference：https://api-docs.deepseek.com/api/create-chat-completion
- LangChain issue #40031（strict 未到达 beta 端点）：https://github.com/langchain-ai/langchain/issues/40031
- Inngest agent-kit issue #329（strict 工具参数间歇性 JSON 解析失败）：https://github.com/inngest/agent-kit/issues/329
