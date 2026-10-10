# Windows 桌面适配

用户已授权将现有 macOS LifeMind 适配到 Windows。继续使用 Tauri 2，共享现有 React 前端和批次确认、撤销协议；原生平台差异由 Rust 处理。继续在当前工作区完成已开始的修改。

文件选择使用 rfd，API Key 使用各系统原生凭据存储。macOS 保留 PDFKit，Windows 使用 Hayro 渲染供模型复核的 PDF 页面；渲染限制页数、图像尺寸和编码大小。Rust 最低版本更新为依赖实际需要的 1.92。

预览根目录由 Tauri app_local_data_dir 提供，所有打开、确认、删除、逻辑连接草稿清理使用相同根目录。Windows 先正常关闭 Obsidian 窗口，退出后登记 %APPDATA%/obsidian/obsidian.json 中的临时 Vault，再通过 Windows ShellExecuteW 打开包含 Vault ID 和相对笔记路径的 Obsidian URI。清理预览时同时移除登记；保留真实 Vault 和配置其他字段。Obsidian 尚未初始化或未能退出时给出可操作错误。

本机验证前端、Rust 公共逻辑和 Windows PDF 渲染路径；GitHub Actions 提供 Windows 原生测试和 MSI/NSIS 打包及产物上传。本机没有 Windows SDK，不将 macOS 上的测试当作 Windows 实机验收。Windows 安装后的文件选择、凭据保存、PDF 导入、Obsidian 预览和事务撤销仍需在 Windows 10/11 上验收。
