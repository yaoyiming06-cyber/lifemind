# 文本与 PDF 笔记组织统一实施计划

**Goal:** 所有 v2 来源共享带编号的二级目录、笔记编号、续号与原文顺序。

**Architecture:** 在分析计划校验后按来源位置排序，再将 PDF 专用编号和目录生成扩展为共享处理。原有语义校验及 PDF 媒体校验保留；合并目标和迁移计划在编译末尾核对。

**Tech Stack:** TypeScript、Vitest、React、Tauri 2。

- [x] 在 `src/lib/lifemind-organization.test.ts` 写真实 v2 编译对照测试，覆盖文本/PDF/Markdown、短文本父子主题、乱序输出、续号、同批次多来源、合并目标、写入路径和双链。运行 `npx vitest run src/lib/lifemind-organization.test.ts`，确认旧代码失败。
- [x] 新增 `src/lib/lifemind-section-order.ts`，按上传来源顺序、PDF 页码或原文标题/证据位置稳定排序，在 `src/lib/lifemind-core.ts` 调用后统一分配笔记编号。移除编号与目录处理中对非 PDF 来源的跳过，复用既有编号目录，保留合并旧笔记目标，映射最终迁移目录。
- [x] 在 `src/lib/lifemind-review-skill.ts` 和 `system/lifemind-review-skill.md` 明确所有来源的组织规则及本地排序职责。更新原有回归测试中与新规则冲突的标题、路径预期，保留语义判断与媒体验证断言。
- [x] 运行 `npm run test:core`、`npm run test:ui-contract`、`npx tsc --noEmit`、全量 lint、`git diff --check`；独立审查改动。仅对新问题继续修改并重跑相关检查。
- [x] 使用 `CARGO_TARGET_DIR=/Users/a0000/Library/Caches/lifemind-cargo-target npm run desktop:build` 构建，验证 DMG 与应用签名，备份并替换 `/Applications/LifeMind.app`，核对新产物与安装二进制一致。

回归结果：6 个文件、149 项通过，其中组织逻辑覆盖 26 项；TypeScript、UI 契约及 diff 检查通过。独立复审发现的选定目录优先级、同目标重复合并、合并/移动冲突、跨来源父子排序与空格路径冲突均已修复，新增用例先复现失败再通过。重复合并旧实现的同步死循环使用可终止子进程验证。

全量 lint 通过，无错误，剩余 8 条既有警告。为避开项目内依赖读取卡顿，使用相同 package-lock 与配置的临时干净依赖执行。原有拖放回调在渲染期间赋值 ref 的错误已改为 effect 更新，并经过复审与最终类型、UI 契约、lint 检查。

2026-10-09 最终安装完成，旧版备份为 `/Users/a0000/Library/Caches/lifemind-replaced-apps/LifeMind-20261009-133437.app`，ref 修复前的中间安装版备份为 `/Users/a0000/Library/Caches/lifemind-replaced-apps/LifeMind-20261009-134637.app`。最终 DMG 重打包后校验通过，挂载后应用与安装应用的签名通过，二进制 SHA-256 均为 `d7b9c5c21b21a2f47d68c1e8c22114880bda53c2ee7d4c8877e50c20ab77d8ef`。
