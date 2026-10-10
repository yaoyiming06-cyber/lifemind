# Windows 桌面适配实施计划

**Goal:** 现有 LifeMind 共用业务协议，并可在 Windows x64 构建和使用。

**Architecture:** 沿用 Tauri 平台分支，把机器固定路径改为应用本地目录，使用 Windows 原生启动器和 Obsidian 注册表集成。

**Tech Stack:** React、TypeScript、Tauri 2、Rust 1.92+、rfd、keyring、Hayro、Windows Shell API。

- [ ] 在 `scripts/verify-ui-contract.mjs` 锁住动态预览目录和原生 Windows 打开契约；运行 `npm run test:ui-contract` 确认旧代码失败。
- [ ] 修改 `src/app/page.tsx`，删除固定根路径；所有预览与清理通过 `get_preview_root` 后构建批次目录。使用跨平台凭据文案和 Vault 路径提示。
- [ ] 在 `src-tauri/src/lib.rs` 增加 `get_preview_root`、跨平台 Obsidian 注册/注销、Windows 正常退出和 URI 启动。测试相对路径编码、注册/注销保留真实 Vault 和配置字段、未初始化错误及配置备份。
- [ ] 将 Hayro 路径纳入 macOS 测试编译，合成 PDF 验证页码、PNG、尺寸边界和坏 PDF。在 `src-tauri/Cargo.toml` 修正最低 Rust 版本，Windows 使用 windows-sys ShellExecuteW。
- [ ] 添加 `.github/workflows/windows.yml`，执行前端和 Rust 检查，生成 MSI/NSIS 并上传产物。README 记录 Windows 构建前提、产物位置和实机验收范围。
- [ ] 执行 `npm run test:core`、`npm run test:ui-contract`、TypeScript、lint、前端构建、Rust 测试/格式检查及 diff 检查；使用 requesting-code-review 技能安排独立审查并修复发现的问题。
