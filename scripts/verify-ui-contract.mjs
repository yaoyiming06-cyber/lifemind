import fs from "node:fs";

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tsconfig = fs.readFileSync("tsconfig.json", "utf8");
const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const rust = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const core = fs.readFileSync("src/lib/lifemind-core.ts", "utf8");
const reviewSkill = fs.readFileSync("src/lib/lifemind-review-skill.ts", "utf8");
const runner = fs.readFileSync("src/lib/lifemind-review-runner.ts", "utf8");
const logicLink = fs.readFileSync("src/lib/lifemind-link-update.ts", "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`UI contract failed: ${message}`);
    process.exitCode = 1;
  }
}

assert(!page.includes("Java 控制台输出学习笔记.md"), "upload page must not show the Java sample file");
assert(page.includes("等待上传文件"), "upload page should render a neutral empty upload state");
assert(page.includes('useState<NavLabel>("入库")'), "app should open on the real intake workspace");
assert(page.includes("pasteDraft"), "upload page should support pasted text intake");
assert(page.includes("pendingFileItems"), "file drops should register pending file metadata before review");
assert(page.includes("handleStartReview"), "review should start from an explicit user action");
assert(page.includes("handleSourceFiles"), "upload page should support file intake");
assert(!page.includes("await commitReviewBatch(sources);"), "file import should not parse and review immediately on upload");
assert(!page.includes("void handleSourceFiles(event.dataTransfer.files);"), "browser file drops should enqueue metadata instead of parsing immediately");
assert(page.includes("Promise.allSettled"), "mixed file intake should keep supported files when one file type is unsupported");
assert(page.includes("截图 OCR 待接入"), "upload UI should not present screenshot OCR as already supported");
assert(page.includes("文本型 PDF"), "upload UI should clarify that only text-based PDFs are supported");
assert(!page.includes("<span>截图</span>"), "upload type chips should not mark screenshot files as supported before OCR exists");
assert(
  /if \(readableSources\.length === 0\) \{\s*setReviewRunState\("failed"\);/s.test(page),
  "empty review submissions should clear the loading state instead of leaving the overlay stuck",
);
assert(page.includes("runReviewSkill"), "review data should be generated through the skill runner pipeline");
assert(page.includes("qualityPasses: 2"), "normal review should trade extra model time for a second quality pass");
assert(page.includes("testReviewSkillConnection"), "settings should expose a protocol-validated API connection test");
assert(page.includes("fallbackToLocal"), "settings should expose a fallback-to-local toggle for model debugging");
assert(page.includes('reviewRunState === "reviewing"') && page.includes('logicLinkRunState === "reviewing"'), "slow review states should render a full-screen loading surface");
assert(page.includes("lifemind-loading-overlay"), "review loading should use a dedicated frosted overlay");
assert(page.includes("await waitForNextPaint()"), "review should yield a browser paint before invoking slow model or extraction work");
assert(page.includes("waitForMinimumLoading"), "review loading should stay visible long enough to be perceived");
assert(!page.includes("<AnimatePresence>{reviewRunState === \"reviewing\""), "loading overlay should unmount immediately after review to avoid invisible click blockers");
assert(page.includes("previewRequestRef"), "preview open requests should be cancellable when deleting a draft batch");
assert(page.includes("previewState === \"opening\""), "draft batch deletion should be disabled while preview is opening");
assert(page.includes("LifeMind"), "visible product naming should use LifeMind casing");
assert(page.includes("测试 API 连接"), "settings should show a test API connection button");
assert(page.includes("API 测试"), "settings side panel should show API test feedback");
assert(page.includes("formatReviewUsage"), "review page should show request count and estimated API cost");
assert(page.includes("失败后使用本地 fallback"), "settings should show a clear fallback toggle label");
assert(page.includes("run_review_skill_model"), "external model review should call the Tauri backend command");
assert(page.includes("getCurrentWebview"), "desktop file drops should listen to Tauri webview path drop events");
assert(page.includes('"extract_pdf_text_from_path"'), "desktop PDF intake should send file paths to Rust instead of huge JS byte arrays");
assert(page.includes('"extract_text_file_from_path"'), "desktop text/code intake should read dropped paths in Rust too");
assert(page.includes('"select_intake_file_paths"'), "desktop file selection should use a native path picker instead of browser File objects for PDFs");
assert(!page.includes("Array.from(new Uint8Array(await file.arrayBuffer()))"), "PDF intake must not freeze the WebView by expanding bytes on the JS main thread");
assert(page.includes('"extract_webpage_text"'), "web URL intake should call the Tauri webpage extraction command");
assert(page.includes("buildVaultWriteFiles"), "confirmed batches should use final vault write files");
assert(page.includes("buildVaultMoveFiles"), "confirmed batches should include planned existing-note moves");
assert(page.includes("buildBatchPreviewRoot"), "Obsidian previews should use a batch-isolated preview root");
assert(page.includes("reviewBatch"), "review workspace should render the current batch state");
assert(!page.includes('"逻辑结构"'), "review flow should not expose the abandoned logic structure calibration tab");
assert(!page.includes("LogicStructureWorkspace"), "review flow should not render the abandoned logic structure calibration workspace");
assert(!page.includes("applyLogicParentSelection"), "review flow should not keep abandoned manual parent-selection logic");
assert(!page.includes("parentLinkUpdates"), "Tauri confirm payload should not carry abandoned existing-parent link updates");
assert(page.includes("vaultPath"), "settings should keep the real Obsidian vault path in UI state");
assert(page.includes("vaultInspection"), "settings should display real vault validation results");
assert(page.includes('"validate_vault_path"'), "settings should call the Tauri vault validation command");
assert(page.includes('"inspect_vault_write_plan"'), "review confirmation should inspect new versus overwrite write plans");
assert(page.includes('"confirm_review_batch"'), "batch confirmation should call the Tauri vault transaction command");
assert(page.includes('"undo_review_batch"'), "batch rollback should call the Tauri undo command");
assert(page.includes('"list_review_batches"'), "review workspace should load recent batch manifests for rollback");
assert(page.includes('"scan_vault_knowledge"'), "review should scan the real vault into a lightweight knowledge context before model review");
assert(runner.includes("selectVaultContextForSources"), "review runner should send a relevant vault subgraph instead of the whole scanned vault");
assert(runner.includes("callExternalReviewSkillWithQualityPass"), "review runner should support a second quality review pass");
assert(runner.includes("previousAnalysisPlan"), "second quality pass should review the first pass analysis plan instead of repeating blindly");
assert(runner.includes("createReviewAnalysisRequest"), "review runner should use the v2 analysis request");
assert(runner.includes("createReviewBatchFromAnalysisPlan"), "review runner should compile v2 analysis plans locally");
assert(
  runner.includes('url.hostname !== "api.deepseek.com"') && runner.includes("/beta/chat/completions"),
  "DeepSeek strict requests should use the beta chat completions endpoint",
);
assert(runner.includes('baseUrl: "https://api.deepseek.com"'), "DeepSeek preset should use the current API base URL");
assert(page.includes("isLegacyDeepSeekModel"), "legacy DeepSeek model settings should migrate to V4");
assert(tauri.version === pkg.version, "Tauri and frontend package versions should stay synchronized");
assert(pkg.version === "0.2.4", "current patched build should be version 0.2.4");
assert(pkg.scripts["desktop:dev"] === "tauri dev --no-watch", "desktop dev should disable the unstable Rust file watcher");
assert(fs.readFileSync("package-lock.json", "utf8").includes('"version": "0.2.4"'), "package lock should match the patched version");
assert(core.includes("export function selectVaultContextForSources"), "core should expose a reusable vault relationship subgraph selector");
assert(core.includes("scoreVaultRootForQuery"), "vault context selection should recall roots from indexed directory path matches");
assert(core.includes("selectRootPathsForQuery"), "vault context selection should keep matched taxonomy paths before request normalization trims root paths");
assert(!core.includes("applyClassificationHintsToSkillOutput"), "batch creation must not override model paths with local semantic classification hints");
assert(!reviewSkill.includes("classificationHints"), "review skill request must not include local semantic classification hints");
assert(!reviewSkill.includes("recommended-new-branch"), "review skill request must not synthesize local recommended taxonomy branches");
assert(reviewSkill.includes("sourceOrganizationSignals"), "review skill request should expose user organization signals without path overrides");
assert(reviewSkill.includes("explicitHierarchy"), "review skill request should expose explicit user arrow hierarchy signals");
assert(!reviewSkill.includes("recommendedPathPrefix"), "source organization signals must not carry recommended path prefixes");
assert(reviewSkill.includes("taxonomyCandidates"), "review skill request should include taxonomy candidates from the vault directory index");
assert(reviewSkill.includes("buildTaxonomyCandidates"), "review skill should convert the vault index into model-facing directory candidates");
assert(reviewSkill.includes("统一语义归类判断"), "review skill prompt should require one unified semantic path decision process");
assert(reviewSkill.includes("不要仅因为某个目录候选存在"), "review skill prompt should prevent nearby candidates from swallowing new classification branches");
assert(reviewSkill.includes("type VaultKnowledgeRelation"), "review skill protocol should carry existing vault relationship edges");
assert(reviewSkill.includes("vaultContext.relations"), "review skill prompt should explain existing vault relationship edges to the model");
assert(page.includes('"discard_review_preview"'), "draft batch deletion should clear its temporary preview folder");
assert(page.includes('"save_model_api_key"'), "settings should save model API keys through the desktop keychain command");
assert(page.includes('"load_model_api_key"'), "settings should load model API keys through the desktop keychain command");
assert(!page.includes("lifemind.modelApiKey"), "model API keys must not be stored in localStorage");
assert(page.includes("Vault 路径检查"), "settings should expose an explicit vault check result");
assert(page.includes("待写入文件"), "review side panel should show the write plan");
assert(page.includes("最近写入"), "review side panel should show rollback-capable batch history");
assert(page.includes("writeFile?.path"), "preview cards should show final vault write paths");
assert(!page.includes("const uploadedCases = ["), "review upload tab must not depend on hard-coded submitted test cases");
assert(!page.includes("const generatedNotes = ["), "review results must not depend on hard-coded generated notes");
assert(page.includes("Obsidian 预览已打开"), "review preview tab should show Obsidian preview status");
assert(page.includes("openPreviewInObsidian"), "review page should expose an app-owned Obsidian preview action");
assert(page.includes('invoke("open_obsidian_preview"'), "preview action should call the Tauri desktop command");
assert(page.includes("previewRoot: buildBatchPreviewRoot(previewVault.root, reviewBatch.id)"), "preview action should open the current batch folder, not the shared preview parent");
assert(page.includes("由 LifeMind 桌面脚本写入并打开"), "preview page should clarify Obsidian was opened by LifeMind");
assert(page.includes("预览确认上下文"), "preview page should keep confirmation context visible after returning to lifemind");
assert(page.includes("上传原文"), "preview confirmation context should include uploaded source text");
assert(page.includes("AI 审理结果"), "preview confirmation context should include AI review output");
assert(!page.includes('{ label: "批次"'), "batch records should not be exposed in the top navigation yet");
assert(!page.includes('{ label: "知识库"'), "knowledge overview should not be exposed in the top navigation");
assert(!page.includes("批次记录"), "batch records workspace should be removed until rollback exists");
assert(!page.includes("知识库概览"), "user-facing knowledge overview should be removed");
assert(!page.includes("function BatchWorkspace"), "batch records component should be removed");
assert(!page.includes("function VaultWorkspace"), "knowledge overview component should be removed");
assert(page.includes('{ label: "扫描", icon: ScanLine }'), "top navigation should expose the scan/maintenance workspace");
assert(page.includes("LogicLinkUpdateWorkspace"), "scan workspace should render the logic link update module");
assert(page.includes("generateLogicLinkDraft"), "logic link updates should be user-triggered rather than automatic");
assert(page.includes("createLocalLogicLinkUpdateDraft"), "logic link updates should start from a local time-order candidate script");
assert(
  runner.includes("buildLogicLinkSystemPrompt"),
  "logic link updates should support model review through a dedicated prompt",
);
assert(page.includes('"confirm_logic_link_updates"'), "logic link confirmation should call the Tauri transaction command");
assert(page.includes("buildLogicLinkPreviewFiles"), "logic link updates should generate an isolated Obsidian preview");
assert(page.includes("确认后事务写入并删除预览"), "logic link process should tell users preview files are deleted after confirmation");
assert(page.includes("discardLogicLinkDraft"), "logic link drafts should support deleting their preview files before confirmation");
assert(page.includes("clearExistingLogicLinkDraftBeforeGenerate"), "regenerating logic links should clear stale draft state and preview files first");
assert(page.includes("handleLogicLinkRangePresetChange"), "changing logic link range should clear stale suggestions from the previous range");
assert(!page.includes("scanSuggestions"), "scan workspace should not depend on hard-coded scan suggestions");
assert(!page.includes("scan-error-print"), "hard-coded Java scan sample should be removed");
assert(!page.includes("修正 print / println 换行表述"), "hard-coded scan sample text should be removed");
assert(!page.includes("补全 Java 异常处理主题"), "hard-coded scan directory sample should be removed");
assert(logicLink.includes("LOGIC_LINK_PROTOCOL_VERSION"), "logic link module should define a stable protocol version");
assert(logicLink.includes("createLogicLinkUpdateRequest"), "logic link module should create a model-facing review request");
assert(logicLink.includes("mergeLogicLinkModelOutput"), "logic link module should merge model filtering back into local candidates");
assert(logicLink.includes("buildLogicLinkPayload"), "logic link module should build the Tauri confirmation payload");
assert(page.includes("batchStatus"), "batch confirmation should use a real batch status state");
assert(page.includes("整批已确认"), "confirmed batch state should be visible in the UI");
assert(page.includes("onClick={handleConfirmBatch}"), "batch confirmation should use the real write transaction handler");
assert(page.includes("onClick={handleRemoveBatch}"), "batch delete should use the real rollback/delete handler");
assert(!page.includes("hero-strip workspace-panel"), "desktop app should not render a landing-page style hero strip");
assert(!page.includes("window.scrollTo"), "desktop navigation should not use page scrolling behavior");
assert(css.includes("overflow: hidden;"), "desktop shell should suppress document-level scrolling");
assert(css.includes("height: 100vh;"), "app shell should fit the desktop window viewport");
assert(css.includes("position: fixed;"), "desktop shell should be fixed inside the WebView viewport");
assert(css.includes("-webkit-backdrop-filter"), "loading overlay should support frosted blur in the macOS WebView");
assert(css.includes("z-index: 999;"), "loading overlay should sit above the entire app chrome");
assert(css.includes("overflow-y: auto;"), "side panels with long review content should scroll inside their frame");
assert(css.includes("scrollbar-gutter: stable;"), "internal panel scrollbars should not shift the desktop layout");
assert(css.includes(".source-list {"), "uploaded source context should have its own scroll container");
assert(css.includes("-webkit-line-clamp: unset;"), "uploaded source context should not truncate the original text");
assert(css.includes("max-height: min(62vh, 680px);"), "uploaded source cards should keep long text inside a scrollable frame");
assert(css.includes(`grid-template-areas:\n      "brand status"\n      "dock dock";`), "medium windows should keep the header and dock in bounded rows");
assert(css.includes("top: 174px;"), "medium windows should reserve space for the wrapped header");
assert(
  css.includes("  .panel-head {\n    align-items: flex-start;\n    flex-direction: column;\n  }"),
  "medium windows should stack the workspace heading above its tabs",
);
assert(
  css.includes("  .panel-actions {\n    width: 100%;\n    justify-content: space-between;\n  }"),
  "medium windows should give workspace tabs and actions a full row",
);
assert(css.includes(`grid-template-areas:\n      "brand"\n      "dock"\n      "status";`), "small windows should stack the header without overlap");
assert(css.includes("top: 220px;"), "small windows should reserve space for the stacked header");
assert(css.includes("position: sticky;"), "review confirmation actions should remain visible inside the side panel");
assert(
  css.includes("grid-template-columns: minmax(0, 1fr) minmax(260px, 0.78fr);"),
  "settings workspace should use a compact two-column layout so API feedback is visible",
);
assert(css.includes(".settings-list > .setting-row-input:last-child"), "model settings row should span the full settings grid");
assert(tauri.app.windows[0].width >= 1360, "desktop window should be wide enough to show the app without feeling like a webpage");
assert(tauri.app.windows[0].height >= 900, "desktop window should be tall enough to show the app without document scrolling");
assert(tauri.app.windows[0].dragDropEnabled === true, "desktop file drops should be captured by Tauri so the app receives file paths");
assert(
  pkg.scripts.build === "node scripts/build-frontend.mjs",
  "frontend build should use the stable esbuild packaging script for desktop packages",
);
assert(fs.existsSync("scripts/build-frontend.mjs"), "desktop packaging should have a deterministic frontend build script");
assert(pkg.scripts.dev === "vite --configLoader native --host 127.0.0.1 --port 3000", "desktop dev server should use the native Vite config loader");
assert(fs.existsSync("index.html"), "Vite build should have a static HTML entry at the project root");
assert(fs.existsSync("src/main.tsx"), "Vite build should mount the LifeMind React app through src/main.tsx");
assert(fs.existsSync("vite.config.mjs"), "Vite build should use a plain .mjs config so config loading does not depend on esbuild");
assert(
  fs.readFileSync("vite.config.mjs", "utf8").includes("**/src-tauri/target/**"),
  "Vite should ignore the Rust target directory so desktop builds do not scan generated artifacts",
);
assert(
  fs.readFileSync("vite.config.mjs", "utf8").includes("**/vite.config.mjs/**") ||
    fs.readFileSync("vite.config.mjs", "utf8").includes("**/vite.config.mjs"),
  "Vite should ignore its config file so macOS watcher noise cannot trigger repeated restarts",
);
assert(
  fs.readFileSync("vite.config.mjs", "utf8").includes("**/tsconfig.json"),
  "Vite should ignore tsconfig watcher noise during desktop development",
);
assert(!page.includes('from "lucide-react"'), "Vite build should import only the used lucide icons, not the package barrel");
assert(page.includes("lucide-react/dist/esm/icons/file-input.mjs"), "LifeMind should use direct lucide icon imports for fast desktop builds");
assert(!page.includes('from "framer-motion"'), "Vite build should not import the framer-motion package barrel");
assert(!page.includes('from "gsap"') && !page.includes("@gsap/react"), "desktop animation should not pull GSAP into the packaged frontend");
assert(fs.readFileSync("src/components/ui/dock.tsx", "utf8").includes("@/lib/simple-motion"), "dock should use the lightweight local motion shim");
assert(fs.existsSync("src/lib/simple-motion.tsx"), "desktop frontend should provide a local motion shim for fast builds");
assert(!css.includes('@import "tailwindcss"'), "desktop CSS should not invoke Tailwind during Vite builds");
assert(!css.includes("@theme inline"), "desktop CSS should avoid Tailwind-only at-rules when built without Tailwind");
assert(fs.readFileSync("vite.config.mjs", "utf8").includes("postcss: { plugins: [] }"), "Vite should bypass the Tailwind PostCSS config for packaged builds");
assert(!tsconfig.includes('"name": "next"'), "TypeScript checks should not load the Next.js language plugin after moving packaging to Vite");
assert(!tsconfig.includes(".next/"), "TypeScript checks should not scan generated Next.js cache directories");
assert(!tsconfig.includes("next-env.d.ts") && !tsconfig.includes("next.config.ts"), "TypeScript checks should not include Next.js bootstrap files in the Vite app");
assert(tsconfig.includes("src/**/*.test.ts"), "main TypeScript checks should exclude Vitest files so app checks do not load Vitest type packages");
assert(tsconfig.includes("src/app/layout.tsx"), "main TypeScript checks should exclude the unused Next.js app layout file");
assert(tsconfig.includes('"types": ["react", "react-dom"]'), "frontend TypeScript checks should not auto-load every @types package");
assert(rust.includes("open_obsidian_preview"), "Tauri should define an app-owned Obsidian preview command");
assert(rust.includes("run_review_skill_model"), "Tauri should define a backend model review command");
assert(rust.includes("ReviewModelInvocation"), "Tauri should return model output together with usage telemetry");
assert(rust.includes("review_model_usage"), "Tauri should parse usage and reasoning tokens from model responses");
assert(
  rust.includes("api.deepseek.com/beta/chat/completions"),
  "Tauri strict model requests should normalize DeepSeek to the beta chat completions endpoint",
);
assert(rust.includes("is_deepseek_thinking_model"), "Tauri should identify DeepSeek V4 thinking models");
assert(rust.includes("build_chat_completion_request"), "Tauri should isolate model request construction for regression testing");
assert(rust.includes("let thinking_enabled"), "Tauri should derive thinking mode from the review pass");
assert(rust.includes('serde_json::json!({ "type": if thinking_enabled { "enabled" } else { "disabled" } })'), "Tauri should use cheaper disabled thinking for the draft pass");
assert(rust.includes("max_tokens"), "Tauri model requests should cap output tokens");
assert(rust.includes("tool_choice: (!thinking_model)"), "DeepSeek V4 thinking requests must omit unsupported tool_choice");
assert(runner.includes("isDeepSeekThinkingModel"), "browser fallback should identify DeepSeek V4 thinking models");
assert(runner.includes("thinking: { type: thinkingEnabled ? \"enabled\" : \"disabled\" }"), "browser fallback should vary thinking by review pass");
assert(runner.includes("max_tokens: maxOutputTokens"), "browser fallback should cap output tokens");
assert(runner.includes("prompt_cache_hit_tokens"), "browser fallback should parse prompt cache usage");
assert(runner.includes("reasoningTokens"), "browser fallback should expose reasoning token usage");
assert(runner.includes("summarizeReviewUsage"), "review runner should aggregate usage across retries and quality passes");
assert(runner.includes('reasoning_effort: reasoningEffort'), "browser fallback should pass the selected DeepSeek V4 reasoning effort");
assert(runner.includes("temperature: 0"), "legacy DeepSeek requests should retain deterministic temperature");
assert(runner.includes("tool_choice"), "legacy DeepSeek requests should retain fixed tool choice compatibility");
assert(cargoToml.includes('"system-proxy"'), "Tauri reqwest client should include system proxy support for model API calls");
assert(
  ["gzip", "brotli", "deflate", "zstd"].every((feature) => cargoToml.includes(`"${feature}"`)),
  "Tauri reqwest client should decode common compressed model API responses",
);
assert(rust.includes("ACCEPT"), "model API requests should use a shared JSON Accept header");
assert(rust.includes('.header(ACCEPT, "application/json")'), "model API requests should ask providers for JSON responses");
assert(rust.includes("ACCEPT_ENCODING"), "model API requests should control response compression explicitly");
assert(
  (rust.match(/\.header\(ACCEPT_ENCODING, MODEL_ACCEPT_ENCODING\)/g) ?? []).length >= 1,
  "DeepSeek model API requests should request identity response encoding to avoid broken compressed-body decoding",
);
assert(
  rust.includes(".http1_only()") &&
    rust.includes(".connect_timeout(Duration::from_secs(30))") &&
    rust.includes(".timeout(model_request_timeout())"),
  "model HTTP client should use stable HTTP/1.1 and bounded long-response timeouts",
);
assert(rust.includes("read_model_response_with_retry"), "model response reads should retry truncated transport responses");
assert(rust.includes("response.bytes()"), "model responses should be read as raw bytes before UTF-8 conversion");
assert(rust.includes("错误链："), "model response errors should include the underlying transport error chain");
assert(rust.includes("validate_vault_path"), "Tauri should define a vault validation command");
assert(rust.includes("inspect_vault_write_plan"), "Tauri should define a vault write inspection command");
assert(rust.includes("VaultMoveFilePayload"), "Tauri batch confirmation should accept existing-note move operations");
assert(rust.includes("operation == \"move\""), "Tauri rollback should understand move transaction records");
assert(rust.includes("list_review_batches"), "Tauri should define a batch manifest listing command");
assert(rust.includes("scan_vault_knowledge"), "Tauri should define a vault knowledge scan command");
assert(rust.includes("confirm_logic_link_updates"), "Tauri should define a logic link confirmation command");
assert(rust.includes("merge_successor_links"), "logic link confirmation should update parent-note successor sections");
assert(rust.includes("modified_at"), "vault knowledge scan should serialize note modified times for time-range maintenance");
assert(!rust.includes("parent_link_updates"), "Tauri batch confirmation should not accept abandoned existing-parent link updates");
assert(!rust.includes("append_child_link_to_parent_note"), "Tauri should not keep abandoned parent-note append logic");
assert(rust.includes("should_skip_vault_index_dir"), "vault knowledge scan should skip Obsidian/LifeMind private folders");
assert(rust.includes("struct VaultKnowledgeRelation"), "vault knowledge scan should serialize relationship edges");
assert(rust.includes("extract_vault_relations_from_markdown"), "vault knowledge scan should extract links and metadata relations from Markdown");
assert(rust.includes("前置知识"), "vault relation scan should understand LifeMind prerequisite metadata");
assert(rust.includes("discard_review_preview"), "Tauri should define a preview discard command");
assert(rust.includes("extract_pdf_text"), "Tauri should define a PDF extraction command");
assert(rust.includes("extract_pdf_text_from_path"), "Tauri should define a path-based PDF extraction command");
assert(rust.includes("extract_pdf_text_layer"), "PDF text-layer extraction should be isolated behind a bounded helper");
assert(
  rust.includes("PDF_TEXT_SWIFT_SCRIPT") && rust.includes('Duration::from_secs(30), "PDF 文本层抽取"'),
  "PDF text-layer extraction should run in a timeout-protected subprocess before OCR",
);
assert(
  !rust.includes("let text_layer = pdf_extract::extract_text_from_mem(bytes)"),
  "PDF text-layer extraction must not run unbounded in the LifeMind process",
);
assert(rust.includes("extract_text_file_from_path"), "Tauri should define a path-based text/code extraction command");
assert(rust.includes("select_intake_file_paths"), "Tauri should define a native intake file picker command");
assert(rust.includes("extract_webpage_text"), "Tauri should define a webpage extraction command");
assert(rust.includes("save_model_api_key"), "Tauri should define a keychain save command");
assert(rust.includes("load_model_api_key"), "Tauri should define a keychain load command");
assert(rust.includes("open_preview_root_in_obsidian"), "Tauri preview command should open the current batch preview folder");
assert(rust.includes("register_lifemind_preview_vault"), "preview folder should be registered as a temporary Obsidian vault before opening");
assert(rust.includes("quit_obsidian_before_preview"), "preview should gracefully restart Obsidian so an already-open process does not keep stale vault state");
assert(rust.includes("open_macos_app_path(\"Obsidian\", root_path)"), "preview should open the current batch folder directly after Obsidian exits");
assert(!rust.includes(".arg(preview_file)"), "preview should not ask Obsidian to open a specific file before the temporary vault is ready");
assert(!rust.includes("build_obsidian_open_path_uri"), "preview folders should not use obsidian://open?path because it still produces Vault not found popups");
assert(!rust.includes("obsidian://open?path"), "preview folders should not use Obsidian path URLs");
assert(rust.includes("set_focus"), "Tauri preview command should return focus to lifemind after opening Obsidian");

if (!process.exitCode) {
  console.log("UI contract passed.");
}
