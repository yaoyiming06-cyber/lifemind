# LifeMind

LifeMind 是一款面向 Obsidian 知识库的桌面整理工具。它把文本、Markdown 和 PDF 学习材料整理成可检查的笔记批次，并在用户确认后写入指定的 Obsidian Vault。

## 功能

- 导入学习材料，提取文本；PDF 会独立渲染页面图像供视觉模型复核，正式审理不运行 OCR。
- 使用 DeepSeek 结构化审理材料，并在本地校验生成结果。
- 在写入前预览笔记、目录和关系；确认后才修改真实 Vault。
- 记录批次写入信息，支持撤销已确认的批次。
- 扫描现有 Vault，为笔记关系补全提供候选建议。
- 将模型 API Key 保存到 macOS 钥匙串或 Windows 凭据管理器。

LifeMind 会把模型输出当作候选结果，而不是直接写入指令。外部模型不可用时，可按应用设置使用本地 fallback。

## 技术栈

- React、TypeScript、Vite 和 esbuild
- Tauri 2 与 Rust
- DeepSeek Chat Completions 兼容接口
- 跨平台 Rust PDF 页面渲染、系统凭据存储

桌面版支持 macOS 和 Windows 10/11 x64。前端逻辑共用，系统文件选择器、凭据存储和 PDF 页面渲染由平台适配层处理。

## 开发环境

需要安装 Node.js、npm 和 Rust/Cargo。macOS 构建还需要 Xcode Command Line Tools；Windows 构建需要 Visual Studio Build Tools、WebView2 和 Windows 签名/打包环境。

```bash
npm ci
npm run desktop:dev
```

只运行前端开发服务器可使用 `npm run dev`。完整的文件系统、钥匙串和 Obsidian 集成功能需要通过 Tauri 桌面应用运行。

启动后，在设置页选择真实 Obsidian Vault，并配置模型供应商和 API Key。Windows 示例路径为 `C:\\Users\\你的用户名\\Documents\\ObsidianVault`，macOS 示例路径为 `~/Documents/ObsidianVault`。API Key 由桌面后端存入系统凭据管理器，不应写入源代码或提交到 Git。

## 构建与检查

```bash
npm run desktop:build
npm run lint
npm run test:core
npm run test:ui-contract
```

Windows 安装包必须在 Windows 主机或 Windows CI 上构建，`desktop:build` 会生成 MSI/NSIS 安装包；仓库中的 Windows workflow 会上传这两类产物。运行预览功能前请安装 Obsidian 桌面版。

原生 Rust 测试：

```bash
cd src-tauri
cargo test --no-default-features
```

## 隐私说明

真实 Vault 只会在用户确认后写入。使用外部模型审理时，所选学习材料以及为本次审理选出的相关知识库上下文会发送给配置的模型服务商；请先确认符合自己的隐私要求。API Key 通过系统钥匙串保存。

不要将真实 Obsidian Vault、API Key、个人审计材料、诊断日志或打包产物提交到仓库。
