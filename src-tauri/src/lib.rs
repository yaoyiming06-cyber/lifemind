use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::{ACCEPT, ACCEPT_ENCODING, CONTENT_ENCODING};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, BTreeSet},
    error::Error,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFilePayload {
    path: String,
    content: String,
    #[serde(default)]
    binary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultWriteFilePayload {
    path: String,
    content: String,
    note_id: String,
    title: String,
    #[serde(default)]
    binary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultMoveFilePayload {
    from_path: String,
    to_path: String,
    note_id: String,
    title: String,
    reason: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogicLinkUpdatePayload {
    parent_path: String,
    parent_title: String,
    child_title: String,
    child_path: String,
    reason: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchFileRecord {
    #[serde(default = "default_batch_file_operation")]
    operation: String,
    path: String,
    #[serde(default)]
    from_path: Option<String>,
    backup_path: Option<String>,
    existed_before: bool,
    note_id: String,
    title: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchManifest {
    batch_id: String,
    status: String,
    committed_at: String,
    files: Vec<BatchFileRecord>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchManifestSummary {
    batch_id: String,
    status: String,
    committed_at: String,
    file_count: usize,
    created_count: usize,
    overwritten_count: usize,
    moved_count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultWritePlanFile {
    path: String,
    title: String,
    note_id: String,
    exists: bool,
    existing_size: Option<u64>,
    existing_preview: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultMovePlanFile {
    from_path: String,
    to_path: String,
    title: String,
    note_id: String,
    reason: String,
    source_exists: bool,
    target_exists: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultWritePlan {
    files: Vec<VaultWritePlanFile>,
    moves: Vec<VaultMovePlanFile>,
    new_count: usize,
    overwrite_count: usize,
    move_count: usize,
}

fn default_batch_file_operation() -> String {
    "write".to_string()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultInspection {
    path: String,
    exists: bool,
    is_dir: bool,
    has_obsidian_config: bool,
    can_write: bool,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultKnowledgeContext {
    roots: Vec<VaultKnowledgeRoot>,
    notes: Vec<VaultKnowledgeNote>,
    relations: Vec<VaultKnowledgeRelation>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultKnowledgeRoot {
    name: String,
    note_count: usize,
    paths: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultKnowledgeNote {
    title: String,
    path: String,
    root: String,
    headings: Vec<String>,
    snippet: String,
    modified_at: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultKnowledgeRelation {
    #[serde(rename = "type")]
    relation_type: String,
    source: String,
    target: String,
    evidence: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewModelRequestPayload {
    base_url: String,
    api_key: String,
    model: String,
    api_format: String,
    system_prompt: String,
    request: serde_json::Value,
    #[serde(default)]
    max_output_tokens: Option<u32>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    tool: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDiagnosticErrorPayload {
    path: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDiagnosticLogPayload {
    provider: String,
    model: String,
    stage: String,
    attempt: usize,
    response_length: usize,
    #[serde(default)]
    request_summary: Option<serde_json::Value>,
    #[serde(default)]
    raw_output_preview: Option<String>,
    errors: Vec<ReviewDiagnosticErrorPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewModelInvocation {
    output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<ReviewModelUsage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewModelUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    prompt_cache_hit_tokens: u64,
    prompt_cache_miss_tokens: u64,
    reasoning_tokens: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfExtractPayload {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedContent {
    title: String,
    content: String,
    source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pdf_evidence: Option<PdfEvidenceResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pdf_quality_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pdf_text_layer_low_quality: Option<bool>,
}

const MODEL_ACCEPT_ENCODING: &str = "identity";
const MODEL_RESPONSE_READ_ATTEMPTS: usize = 3;

fn model_request_timeout() -> Duration {
    Duration::from_secs(600)
}

#[derive(Debug, Clone, Deserialize)]
struct PdfTextDocument {
    pages: Vec<PdfTextPage>,
}

#[derive(Debug, Clone, Deserialize)]
struct PdfTextPage {
    page: usize,
    text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg(test)]
struct PdfOcrDocument {
    pages: Vec<PdfOcrPage>,
}

#[derive(Debug, Clone, Deserialize)]
struct PdfRenderedDocument {
    pages: Vec<PdfRenderedPage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfRenderedPage {
    page: usize,
    image_width: u32,
    image_height: u32,
    image_data_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg(test)]
#[allow(dead_code)]
struct PdfOcrPage {
    page: usize,
    lines: Vec<PdfOcrLine>,
    #[serde(default)]
    image_width: u32,
    #[serde(default)]
    image_height: u32,
    #[serde(default)]
    image_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfEvidenceResponse {
    pages: Vec<PdfEvidencePageResponse>,
    images: Vec<PdfEmbeddedImageResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfEmbeddedImageResponse {
    asset_id: String,
    page: usize,
    image_width: u32,
    image_height: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    image_data_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfEvidencePageResponse {
    page: usize,
    image_width: u32,
    image_height: u32,
    image_review_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_data_url: Option<String>,
    evidence: Vec<PdfEvidenceLineResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfEvidenceLineResponse {
    id: String,
    text: String,
    source: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    confidence: f32,
    candidates: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg(test)]
struct PdfOcrLine {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    confidence: f32,
}

#[derive(Debug, Clone)]
#[cfg(test)]
struct PdfOcrBlock {
    page: usize,
    lines: Vec<String>,
    min_y: f32,
    max_y: f32,
}

#[derive(Debug, Clone)]
#[cfg(test)]
struct PdfOcrEvidenceLine {
    selected: PdfOcrLine,
    candidates: Vec<PdfOcrCandidateEvidence>,
}

#[derive(Debug, Clone)]
#[cfg(test)]
struct PdfOcrCandidateEvidence {
    original: String,
    corrected: String,
    confidence: f32,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Option<Vec<ChatChoice>>,
    usage: Option<ChatUsage>,
    error: Option<ChatError>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: Option<ChatCompletionMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: Option<String>,
    tool_calls: Option<Vec<ChatToolCall>>,
}

#[derive(Debug, Deserialize)]
struct ChatToolCall {
    #[serde(rename = "type")]
    call_type: Option<String>,
    function: Option<ChatToolFunction>,
}

#[derive(Debug, Deserialize)]
struct ChatToolFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct ChatUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    prompt_cache_hit_tokens: Option<u64>,
    prompt_cache_miss_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    completion_tokens_details: Option<ChatCompletionTokensDetails>,
}

#[derive(Debug, Deserialize, Clone)]
struct ChatCompletionTokensDetails {
    reasoning_tokens: Option<u64>,
}

fn review_model_usage(usage: Option<&ChatUsage>) -> Option<ReviewModelUsage> {
    let usage = usage?;
    let prompt_tokens = usage.prompt_tokens.unwrap_or_default();
    let completion_tokens = usage.completion_tokens.unwrap_or_default();
    let prompt_cache_hit_tokens = usage.prompt_cache_hit_tokens.unwrap_or_default();
    let prompt_cache_miss_tokens = usage
        .prompt_cache_miss_tokens
        .unwrap_or_else(|| prompt_tokens.saturating_sub(prompt_cache_hit_tokens));
    let total_tokens = usage
        .total_tokens
        .unwrap_or_else(|| prompt_tokens.saturating_add(completion_tokens));
    let reasoning_tokens = usage
        .reasoning_tokens
        .or_else(|| {
            usage
                .completion_tokens_details
                .as_ref()
                .and_then(|details| details.reasoning_tokens)
        })
        .unwrap_or_default();

    Some(ReviewModelUsage {
        prompt_tokens,
        completion_tokens,
        total_tokens,
        prompt_cache_hit_tokens,
        prompt_cache_miss_tokens,
        reasoning_tokens,
    })
}

#[derive(Debug, Deserialize)]
struct ChatError {
    message: Option<String>,
}

#[tauri::command]
fn confirm_review_batch(
    vault_root: String,
    batch_id: String,
    files: Vec<VaultWriteFilePayload>,
    moves: Vec<VaultMoveFilePayload>,
) -> Result<BatchManifest, String> {
    commit_review_batch_operations(&vault_root, &batch_id, &files, &moves)
}

#[tauri::command]
fn confirm_logic_link_updates(
    vault_root: String,
    batch_id: String,
    links: Vec<LogicLinkUpdatePayload>,
) -> Result<BatchManifest, String> {
    confirm_logic_link_update_files(&vault_root, &batch_id, &links)
}

#[tauri::command]
fn undo_review_batch(vault_root: String, batch_id: String) -> Result<BatchManifest, String> {
    rollback_review_batch_files(&vault_root, &batch_id)
}

#[tauri::command]
fn validate_vault_path(vault_root: String) -> VaultInspection {
    inspect_vault_root(&vault_root)
}

#[tauri::command]
fn inspect_vault_write_plan(
    vault_root: String,
    files: Vec<VaultWriteFilePayload>,
    moves: Vec<VaultMoveFilePayload>,
) -> Result<VaultWritePlan, String> {
    inspect_vault_write_operations(&vault_root, &files, &moves)
}

#[tauri::command]
fn list_review_batches(vault_root: String) -> Result<Vec<BatchManifestSummary>, String> {
    list_batch_manifests(&vault_root)
}

#[tauri::command]
fn scan_vault_knowledge(vault_root: String) -> Result<VaultKnowledgeContext, String> {
    scan_vault_knowledge_files(&vault_root)
}

#[tauri::command]
fn discard_review_preview(preview_root: String) -> Result<(), String> {
    discard_preview_root(&preview_root)
}

#[tauri::command]
fn run_review_skill_model(payload: ReviewModelRequestPayload) -> Result<String, String> {
    let invocation = call_deepseek_strict_model(payload)?;

    serde_json::to_string(&invocation).map_err(|error| format!("无法序列化模型 usage：{error}"))
}

#[tauri::command]
fn write_review_diagnostic_log(event: ReviewDiagnosticLogPayload) -> Result<(), String> {
    append_review_diagnostic_log(&event)
}

#[tauri::command]
fn extract_pdf_text(payload: PdfExtractPayload) -> Result<ExtractedContent, String> {
    extract_pdf_content(&payload.file_name, &payload.bytes)
}

#[tauri::command]
fn extract_pdf_text_from_path(path: String) -> Result<ExtractedContent, String> {
    let path = validate_intake_file_path(&path)?;

    if !path_has_extension(&path, "pdf") {
        return Err("请选择 PDF 文件。".to_string());
    }

    let file_name = file_name_for_path(&path);
    let bytes = fs::read(&path).map_err(|error| format!("无法读取 PDF 文件：{error}"))?;

    extract_pdf_content(&file_name, &bytes)
}

#[tauri::command]
fn extract_text_file_from_path(path: String) -> Result<ExtractedContent, String> {
    let path = validate_intake_file_path(&path)?;
    let file_name = file_name_for_path(&path);
    let source_type = detect_intake_source_type(&file_name);

    if source_type == "pdf" {
        return extract_pdf_text_from_path(path.to_string_lossy().to_string());
    }

    if source_type == "image" {
        return Err(format!(
            "{} 是图片文件，截图 OCR 与思维导图/表格图片分析稍后接入。",
            file_name
        ));
    }

    let bytes = fs::read(&path).map_err(|error| format!("无法读取文件：{error}"))?;
    let content = String::from_utf8_lossy(&bytes).trim().to_string();

    if content.is_empty() {
        return Err(format!("{file_name} 未读取到可审理文本。"));
    }

    Ok(ExtractedContent {
        title: strip_extension(&file_name),
        content,
        source_type: source_type.to_string(),
        pdf_evidence: None,
        pdf_quality_source: None,
        pdf_text_layer_low_quality: None,
    })
}

#[tauri::command]
fn select_intake_file_paths() -> Result<Vec<String>, String> {
    select_files_with_native_dialog()
}

fn extract_pdf_content(file_name: &str, bytes: &[u8]) -> Result<ExtractedContent, String> {
    let title = strip_extension(file_name);
    let text_layer_result = extract_pdf_text_layer(bytes, file_name);
    let text_layer = text_layer_result.as_deref().unwrap_or_default();
    let rendered_result = extract_pdf_page_rendering(bytes, file_name);
    let rendered = rendered_result.as_ref().ok();
    let has_rendered_images = rendered.is_some_and(|document| {
        document
            .pages
            .iter()
            .any(|page| page.image_data_url.is_some())
    });
    let content = build_pdf_review_content(&title, text_layer, has_rendered_images);

    if content.is_empty() {
        let details = [text_layer_result.err(), rendered_result.err()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("；");
        let suffix = if details.is_empty() {
            "可能是扫描件或图片型 PDF。".to_string()
        } else {
            format!("处理细节：{details}")
        };

        return Err(format!("PDF 未提取到可审理文本，{suffix}"));
    }

    let mut pdf_evidence = build_pdf_page_evidence_from_text_layer(&text_layer, rendered);
    pdf_evidence.images = extract_pdf_embedded_images(bytes);

    Ok(ExtractedContent {
        title,
        content,
        source_type: "pdf".to_string(),
        pdf_evidence: Some(pdf_evidence),
        pdf_quality_source: Some(text_layer.to_string()),
        pdf_text_layer_low_quality: Some(is_low_quality_pdf_text_layer(text_layer)),
    })
}

fn validate_intake_file_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err("缺少文件路径。".to_string());
    }

    let path = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path).map_err(|error| format!("无法访问文件：{error}"))?;

    if !metadata.is_file() {
        return Err("请选择一个文件，而不是文件夹。".to_string());
    }

    Ok(path)
}

fn file_name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名文件")
        .to_string()
}

fn path_has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(extension))
        .unwrap_or(false)
}

fn detect_intake_source_type(file_name: &str) -> &'static str {
    let lower = file_name.trim().to_lowercase();

    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        return "markdown";
    }

    if lower.ends_with(".pdf") {
        return "pdf";
    }

    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".heic")
    {
        return "image";
    }

    if [
        ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".cpp", ".cc", ".c", ".rs", ".go", ".sql",
        ".html", ".css", ".json",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
    {
        return "code";
    }

    "text"
}

#[cfg(target_os = "macos")]
fn select_files_with_native_dialog() -> Result<Vec<String>, String> {
    let script = r#"
set chosenFiles to choose file with prompt "选择 LifeMind 要审理的文件" with multiple selections allowed
set output to ""
repeat with chosenFile in chosenFiles
  set output to output & POSIX path of chosenFile & linefeed
end repeat
return output
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("无法打开系统文件选择器：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);

        if stderr.contains("User canceled") || stderr.contains("用户已取消") {
            return Ok(Vec::new());
        }

        return Err(format!("系统文件选择器失败：{}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn select_files_with_native_dialog() -> Result<Vec<String>, String> {
    Err("当前版本的桌面文件选择器先支持 macOS。".to_string())
}

#[tauri::command]
fn extract_webpage_text(url: String) -> Result<ExtractedContent, String> {
    extract_webpage(&url)
}

#[tauri::command]
async fn save_model_api_key(provider: String, api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_api_key(&provider, &api_key))
        .await
        .map_err(|_| "系统钥匙串保存任务失败。".to_string())?
}

#[tauri::command]
async fn load_model_api_key(provider: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || load_api_key(&provider))
        .await
        .map_err(|_| "系统钥匙串读取任务失败。".to_string())?
}

#[tauri::command]
fn open_obsidian_preview(
    app: tauri::AppHandle,
    vault: String,
    file: String,
    preview_root: Option<String>,
    files: Option<Vec<PreviewFilePayload>>,
) -> Result<(), String> {
    let vault = vault.trim();
    let file = file.trim();

    if vault.is_empty() || file.is_empty() {
        return Err("缺少 Obsidian 临时 Vault 或预览文件路径。".to_string());
    }

    if let (Some(root), Some(files)) = (preview_root.as_deref(), files.as_deref()) {
        write_preview_files(root, files)?;
    }

    if let Some(root) = preview_root.as_deref() {
        let root_path = PathBuf::from(root);
        let preview_file = root_path.join(safe_relative_preview_path(file)?);
        open_preview_root_in_obsidian(&root_path, &preview_file)?;
    } else {
        let uri = format!(
            "obsidian://open?vault={}&file={}",
            percent_encode(vault),
            percent_encode(file)
        );
        open_uri(&uri)?;
    };

    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(2600));

        activate_lifemind_app();

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }

        activate_lifemind_app();
    });

    Ok(())
}

fn call_deepseek_strict_model(
    payload: ReviewModelRequestPayload,
) -> Result<ReviewModelInvocation, String> {
    let base_url = payload.base_url.trim();
    let api_key = payload.api_key.trim();
    let model = payload.model.trim();
    let system_prompt = payload.system_prompt.trim();

    if base_url.is_empty() {
        return Err("缺少模型 API base URL。".to_string());
    }

    if api_key.is_empty() {
        return Err("缺少模型 API Key。".to_string());
    }

    if model.is_empty() {
        return Err("缺少模型名称。".to_string());
    }

    if system_prompt.is_empty() {
        return Err("缺少 LifeMind Skill system prompt。".to_string());
    }

    if payload.api_format.trim() != "deepseek-strict-tools" {
        return Err(format!(
            "当前仅支持 DeepSeek Strict Tool Call，收到不支持的格式：{}",
            payload.api_format.trim()
        ));
    }

    let tool = payload
        .tool
        .as_ref()
        .ok_or_else(|| "DeepSeek Strict Tool Call 缺少工具定义。".to_string())?;

    call_deepseek_chat_model(
        base_url,
        api_key,
        model,
        system_prompt,
        &payload.request,
        payload.max_output_tokens,
        payload.reasoning_effort.as_deref(),
        Some(tool),
    )
}

fn call_deepseek_chat_model(
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    request: &serde_json::Value,
    max_output_tokens: Option<u32>,
    requested_reasoning_effort: Option<&str>,
    tool: Option<&serde_json::Value>,
) -> Result<ReviewModelInvocation, String> {
    let chat_request = build_chat_completion_request_with_max_output_tokens(
        model,
        system_prompt,
        request,
        max_output_tokens,
        requested_reasoning_effort,
        tool,
    )?;
    let url = build_chat_completions_url(base_url);
    let client = model_http_client()?;
    let model_response = read_model_response_with_retry(
        || {
            client
                .post(&url)
                .bearer_auth(api_key)
                .header(ACCEPT, "application/json")
                .header(ACCEPT_ENCODING, MODEL_ACCEPT_ENCODING)
                .json(&chat_request)
                .send()
        },
        "DeepSeek Strict Tool Call",
        &url,
    )?;
    let status = model_response.status;
    let response_text = model_response.text;
    let parsed: ChatCompletionResponse = serde_json::from_str(&response_text).map_err(|error| {
        format!(
            "DeepSeek 响应不是合法 JSON：{error}；原始响应：{}",
            truncate_for_error(&response_text)
        )
    })?;
    let usage = review_model_usage(parsed.usage.as_ref());

    if !status.is_success() {
        return Err(parsed
            .error
            .and_then(|error| error.message)
            .unwrap_or_else(|| format!("模型请求失败：HTTP {status}")));
    }

    let message = parsed
        .choices
        .and_then(|mut choices| choices.drain(..).next())
        .and_then(|choice| choice.message)
        .ok_or_else(|| "DeepSeek 响应缺少 choices[0].message。".to_string())?;

    if let Some(tool) = tool {
        let expected_name = tool
            .pointer("/function/name")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "DeepSeek 工具定义缺少 function.name。".to_string())?;

        let output = message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .find(|call| {
                call.call_type.as_deref() == Some("function")
                    && call
                        .function
                        .as_ref()
                        .and_then(|function| function.name.as_deref())
                        == Some(expected_name)
            })
            .and_then(|call| call.function)
            .and_then(|function| function.arguments)
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "DeepSeek 响应缺少 {expected_name} 工具调用参数，未接受普通 message.content。"
                )
            })?;

        return Ok(ReviewModelInvocation { output, usage });
    }

    let output = message
        .content
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "模型响应缺少 choices[0].message.content。".to_string())?;

    Ok(ReviewModelInvocation { output, usage })
}

#[cfg(test)]
fn build_chat_completion_request(
    model: &str,
    system_prompt: &str,
    request: &serde_json::Value,
    tool: Option<&serde_json::Value>,
) -> Result<ChatCompletionRequest, String> {
    build_chat_completion_request_with_max_output_tokens(
        model,
        system_prompt,
        request,
        Some(DEFAULT_MAX_OUTPUT_TOKENS),
        None,
        tool,
    )
}

const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 10_000;

fn build_chat_completion_request_with_max_output_tokens(
    model: &str,
    system_prompt: &str,
    request: &serde_json::Value,
    max_output_tokens: Option<u32>,
    _requested_reasoning_effort: Option<&str>,
    tool: Option<&serde_json::Value>,
) -> Result<ChatCompletionRequest, String> {
    let content = build_model_user_content(request)?;

    build_chat_completion_request_with_content(
        model,
        system_prompt,
        request,
        max_output_tokens,
        _requested_reasoning_effort,
        tool,
        content,
    )
}

fn build_chat_completion_request_with_content(
    model: &str,
    system_prompt: &str,
    _request: &serde_json::Value,
    max_output_tokens: Option<u32>,
    _requested_reasoning_effort: Option<&str>,
    tool: Option<&serde_json::Value>,
    content: serde_json::Value,
) -> Result<ChatCompletionRequest, String> {
    Ok(ChatCompletionRequest {
        model: model.to_string(),
        max_tokens: max_output_tokens
            .unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS)
            .clamp(512, 384_000),
        temperature: Some(0.0),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: serde_json::Value::String(system_prompt.to_string()),
            },
            ChatMessage {
                role: "user".to_string(),
                content,
            },
        ],
        thinking: Some(serde_json::json!({ "type": "disabled" })),
        reasoning_effort: None,
        tools: tool.map(|value| vec![value.clone()]),
        tool_choice: tool.and_then(|value| {
            value
                .pointer("/function/name")
                .and_then(serde_json::Value::as_str)
                .map(|name| {
                    serde_json::json!({
                        "type": "function",
                        "function": { "name": name }
                    })
                })
        }),
    })
}

fn build_model_user_content(request: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut text_request = request.clone();
    let images = text_request
        .as_object_mut()
        .and_then(|object| object.remove("pdfEvidenceImages"))
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    let mut page_image_count = 0;
    let mut embedded_image_count = 0;
    let selected_images = images
        .as_array()
        .ok_or_else(|| "pdfEvidenceImages 必须是数组。".to_string())?
        .iter()
        .filter(|item| {
            let kind = item.get("kind").and_then(serde_json::Value::as_str);
            let url = item
                .get("imageDataUrl")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            let metadata_exists = item
                .get("sourceId")
                .and_then(serde_json::Value::as_str)
                .is_some()
                && item
                    .get("page")
                    .and_then(serde_json::Value::as_u64)
                    .is_some()
                && item
                    .get("assetId")
                    .and_then(serde_json::Value::as_str)
                    .is_some();
            if !metadata_exists || !is_allowed_pdf_image_data_url(url) {
                return false;
            }
            match kind {
                Some("page") if page_image_count < 8 => {
                    page_image_count += 1;
                    true
                }
                Some("embedded") if embedded_image_count < 8 => {
                    embedded_image_count += 1;
                    true
                }
                _ => false,
            }
        })
        .collect::<Vec<_>>();
    let image_items = selected_images
        .iter()
        .filter_map(|item| {
            let url = item.get("imageDataUrl")?.as_str()?.trim();
            Some(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": url },
            }))
        })
        .collect::<Vec<_>>();
    let request_text = serde_json::to_string(&text_request)
        .map_err(|error| format!("无法序列化 Skill 请求：{error}"))?;

    if image_items.is_empty() {
        return Ok(serde_json::Value::String(request_text));
    }

    let image_context = selected_images
        .iter()
        .filter_map(|item| {
            let source_id = item.get("sourceId")?.as_str()?;
            let page = item.get("page")?.as_u64()?;
            let asset_id = item.get("assetId")?.as_str()?;
            let kind = item.get("kind")?.as_str()?;
            let kind_label = if kind == "embedded" {
                "PDF 内嵌图片"
            } else {
                "PDF 页面渲染图（仅供审理）"
            };
            let position = if kind == "embedded" {
                let coordinate = |key: &str| {
                    item.get(key)
                        .and_then(serde_json::Value::as_f64)
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "0".to_string())
                };
                format!(
                    "，位置 x={}、y={}、width={}、height={}",
                    coordinate("x"),
                    coordinate("y"),
                    coordinate("width"),
                    coordinate("height")
                )
            } else {
                String::new()
            };
            Some(format!(
                "{kind_label}：资产 {asset_id}，来源 {source_id}，第 {page} 页{position}。"
            ))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut blocks = vec![serde_json::json!({
        "type": "text",
        "text": format!("{request_text}\n\n{image_context}"),
    })];
    blocks.extend(image_items);

    Ok(serde_json::Value::Array(blocks))
}

fn is_allowed_pdf_image_data_url(value: &str) -> bool {
    value.len() <= 6_000_000
        && (value.starts_with("data:image/jpeg;base64,")
            || value.starts_with("data:image/jpg;base64,")
            || value.starts_with("data:image/png;base64,"))
        && value[value.find(',').unwrap_or(value.len()) + 1..]
            .chars()
            .all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=')
            })
}

fn decode_image_data_url(value: &str) -> Result<Vec<u8>, String> {
    if !is_allowed_pdf_image_data_url(value) {
        return Err("PDF 图片资产不是有效的受支持 data URL。".to_string());
    }
    let (_, encoded) = value
        .split_once(',')
        .ok_or_else(|| "PDF 图片资产缺少 Base64 数据。".to_string())?;
    BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| format!("PDF 图片资产 Base64 解码失败：{error}"))
}

#[allow(dead_code)]
fn commit_review_batch_files(
    vault_root: &str,
    batch_id: &str,
    files: &[VaultWriteFilePayload],
) -> Result<BatchManifest, String> {
    commit_review_batch_operations(vault_root, batch_id, files, &[])
}

fn commit_review_batch_operations(
    vault_root: &str,
    batch_id: &str,
    files: &[VaultWriteFilePayload],
    moves: &[VaultMoveFilePayload],
) -> Result<BatchManifest, String> {
    let root_path = validated_root(vault_root)?;
    let batch_id = safe_batch_id(batch_id)?;

    if files.is_empty() && moves.is_empty() {
        return Err("没有可写入的 Obsidian 笔记。".to_string());
    }

    validate_unique_batch_operation_paths(files, moves)?;

    let batch_dir = root_path.join(".lifemind").join("batches").join(&batch_id);
    let manifest_path = batch_dir.join("manifest.json");

    if manifest_path.exists() {
        return Err("该批次已经写入过，不能重复确认。".to_string());
    }

    fs::create_dir_all(batch_dir.join("backups"))
        .map_err(|error| format!("无法创建批次事务目录：{error}"))?;

    let mut records = Vec::with_capacity(files.len() + moves.len());

    for move_file in moves {
        let from_relative = safe_relative_preview_path(&move_file.from_path)?;
        let to_relative = safe_relative_preview_path(&move_file.to_path)?;
        let source_path = root_path.join(&from_relative);
        let target_path = root_path.join(&to_relative);

        if !source_path.is_file() {
            let _ = rollback_records(&root_path, &records);
            return Err(format!(
                "无法迁移旧笔记，源文件不存在：{}",
                source_path.to_string_lossy()
            ));
        }

        if target_path.exists() {
            let _ = rollback_records(&root_path, &records);
            return Err(format!(
                "无法迁移旧笔记，目标路径已存在：{}",
                target_path.to_string_lossy()
            ));
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                let _ = rollback_records(&root_path, &records);
                format!("无法创建迁移目标目录：{error}")
            })?;
        }

        if let Err(error) = fs::rename(&source_path, &target_path) {
            let _ = rollback_records(&root_path, &records);
            return Err(format!(
                "无法迁移旧笔记 {} 到 {}：{error}",
                source_path.to_string_lossy(),
                target_path.to_string_lossy()
            ));
        }

        records.push(BatchFileRecord {
            operation: "move".to_string(),
            path: path_to_string(&to_relative),
            from_path: Some(path_to_string(&from_relative)),
            backup_path: None,
            existed_before: true,
            note_id: move_file.note_id.clone(),
            title: move_file.title.clone(),
            reason: Some(move_file.reason.clone()),
        });
    }

    for file in files {
        let relative_path = safe_relative_preview_path(&file.path)?;
        let target_path = root_path.join(&relative_path);
        let existed_before = target_path.exists();
        let backup_path = if existed_before {
            let backup_relative = PathBuf::from(".lifemind")
                .join("batches")
                .join(&batch_id)
                .join("backups")
                .join(&relative_path);
            let backup_absolute = root_path.join(&backup_relative);

            if let Some(parent) = backup_absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法创建备份目录：{error}"))?;
            }

            fs::copy(&target_path, &backup_absolute).map_err(|error| {
                format!("无法备份旧笔记 {}：{error}", target_path.to_string_lossy())
            })?;

            Some(path_to_string(&backup_relative))
        } else {
            None
        };

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                let _ = rollback_records(&root_path, &records);
                format!("无法创建笔记目录：{error}")
            })?;
        }

        let content = if file.binary {
            match decode_image_data_url(&file.content) {
                Ok(bytes) => bytes,
                Err(error) => {
                    let _ = rollback_records(&root_path, &records);
                    return Err(error);
                }
            }
        } else {
            file.content.as_bytes().to_vec()
        };

        if let Err(error) = fs::write(&target_path, content) {
            let _ = rollback_records(&root_path, &records);
            return Err(format!(
                "无法写入 Obsidian 笔记 {}：{error}",
                target_path.to_string_lossy()
            ));
        }

        records.push(BatchFileRecord {
            operation: "write".to_string(),
            path: path_to_string(&relative_path),
            from_path: None,
            backup_path,
            existed_before,
            note_id: file.note_id.clone(),
            title: file.title.clone(),
            reason: None,
        });
    }

    let manifest = BatchManifest {
        batch_id,
        status: "confirmed".to_string(),
        committed_at: unix_timestamp_string(),
        files: records,
    };

    write_manifest(&manifest_path, &manifest).map_err(|error| {
        let _ = rollback_records(&root_path, &manifest.files);
        error
    })?;

    Ok(manifest)
}

fn rollback_review_batch_files(vault_root: &str, batch_id: &str) -> Result<BatchManifest, String> {
    let root_path = validated_root(vault_root)?;
    let batch_id = safe_batch_id(batch_id)?;
    let manifest_path = root_path
        .join(".lifemind")
        .join("batches")
        .join(&batch_id)
        .join("manifest.json");

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("无法读取批次事务记录：{error}"))?;
    let mut manifest: BatchManifest = serde_json::from_str(&manifest_content)
        .map_err(|error| format!("批次事务记录损坏：{error}"))?;

    if manifest.status == "removed" {
        return Err("该批次已经撤销。".to_string());
    }

    rollback_records(&root_path, &manifest.files)?;
    manifest.status = "removed".to_string();
    write_manifest(&manifest_path, &manifest)?;

    Ok(manifest)
}

fn confirm_logic_link_update_files(
    vault_root: &str,
    batch_id: &str,
    links: &[LogicLinkUpdatePayload],
) -> Result<BatchManifest, String> {
    let root_path = validated_root(vault_root)?;

    if links.is_empty() {
        return Err("没有可确认的逻辑连接建议。".to_string());
    }

    let mut child_titles_by_parent: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();

    for link in links {
        let parent_relative = safe_relative_preview_path(&link.parent_path)?;
        let child_relative = safe_relative_preview_path(&link.child_path)?;
        let parent_path = path_to_string(&parent_relative);
        let child_title = link.child_title.trim();
        let _reason = link.reason.trim();

        if child_title.is_empty() {
            return Err("逻辑连接缺少子笔记标题。".to_string());
        }

        if !root_path.join(&parent_relative).is_file() {
            return Err(format!("父笔记不存在，无法更新后续枝节：{parent_path}"));
        }

        if !root_path.join(&child_relative).is_file() {
            return Err(format!(
                "子笔记不存在，无法建立后续枝节：{}",
                path_to_string(&child_relative)
            ));
        }

        let entry = child_titles_by_parent
            .entry(parent_path)
            .or_insert_with(|| (link.parent_title.trim().to_string(), Vec::new()));

        if !entry
            .1
            .iter()
            .any(|title| normalize_relation_title(title) == normalize_relation_title(child_title))
        {
            entry.1.push(child_title.to_string());
        }
    }

    let mut files = Vec::with_capacity(child_titles_by_parent.len());

    for (parent_path, (parent_title, child_titles)) in child_titles_by_parent {
        let parent_relative = safe_relative_preview_path(&parent_path)?;
        let parent_absolute = root_path.join(&parent_relative);
        let original = fs::read_to_string(&parent_absolute).map_err(|error| {
            format!(
                "无法读取父笔记 {}：{error}",
                parent_absolute.to_string_lossy()
            )
        })?;
        let merged = merge_successor_links(&original, &child_titles);

        if merged == original {
            continue;
        }

        files.push(VaultWriteFilePayload {
            path: parent_path.clone(),
            content: merged,
            note_id: format!("logic-link-{}", stable_text_hash(&parent_path)),
            title: if parent_title.is_empty() {
                strip_extension(
                    Path::new(&parent_path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("逻辑连接父笔记"),
                )
            } else {
                parent_title
            },
            binary: false,
        });
    }

    if files.is_empty() {
        return Err("这些后续枝节链接已经存在，无需写入。".to_string());
    }

    commit_review_batch_operations(vault_root, batch_id, &files, &[])
}

fn merge_successor_links(content: &str, child_titles: &[String]) -> String {
    let mut lines = content
        .replace("\r\n", "\n")
        .split('\n')
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut missing_links = Vec::new();
    let successor_start = lines.iter().position(|line| line.trim() == "## 后续枝节");
    let successor_end = successor_start
        .map(|start| {
            lines
                .iter()
                .enumerate()
                .skip(start + 1)
                .find(|(_, line)| line.trim_start().starts_with('#'))
                .map(|(index, _)| index)
                .unwrap_or(lines.len())
        })
        .unwrap_or(lines.len());
    let existing_targets = successor_start
        .map(|start| {
            lines[start + 1..successor_end]
                .iter()
                .flat_map(|line| extract_wikilink_targets(line))
                .map(|target| normalize_relation_title(&target))
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();

    for child_title in child_titles {
        let title = child_title.trim();

        if title.is_empty() || existing_targets.contains(&normalize_relation_title(title)) {
            continue;
        }

        missing_links.push(format!("- [[{title}]]"));
    }

    if missing_links.is_empty() {
        return content.to_string();
    }

    if let Some(start) = successor_start {
        let mut insert_at = successor_end;

        while insert_at > start + 1
            && lines
                .get(insert_at - 1)
                .is_some_and(|line| line.trim().is_empty())
        {
            lines.remove(insert_at - 1);
            insert_at -= 1;
        }

        for (offset, link) in missing_links.into_iter().enumerate() {
            lines.insert(insert_at + offset, link);
        }
    } else {
        while lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.pop();
        }

        if !lines.is_empty() {
            lines.push(String::new());
        }

        lines.push("## 后续枝节".to_string());
        lines.extend(missing_links);
    }

    lines.join("\n")
}

fn normalize_relation_title(value: &str) -> String {
    value.replace(char::is_whitespace, "").to_lowercase()
}

fn stable_text_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn validate_unique_batch_operation_paths(
    files: &[VaultWriteFilePayload],
    moves: &[VaultMoveFilePayload],
) -> Result<(), String> {
    let mut target_paths = BTreeSet::new();
    let mut move_sources = BTreeSet::new();

    for move_file in moves {
        let from_relative = safe_relative_preview_path(&move_file.from_path)?;
        let to_relative = safe_relative_preview_path(&move_file.to_path)?;
        let from_path = path_to_string(&from_relative);
        let to_path = path_to_string(&to_relative);

        if from_path == to_path {
            return Err(format!("迁移源路径和目标路径不能相同：{from_path}"));
        }

        if !move_sources.insert(from_path.clone()) {
            return Err(format!("批次事务包含重复迁移源路径：{from_path}"));
        }

        if !target_paths.insert(to_path.clone()) {
            return Err(format!("批次事务包含重复目标路径：{to_path}"));
        }
    }

    for file in files {
        let relative_path = safe_relative_preview_path(&file.path)?;
        let target_path = path_to_string(&relative_path);

        if !target_paths.insert(target_path.clone()) {
            return Err(format!("批次事务包含重复目标路径：{target_path}"));
        }
    }

    Ok(())
}

#[allow(dead_code)]
fn inspect_vault_write_files(
    vault_root: &str,
    files: &[VaultWriteFilePayload],
) -> Result<VaultWritePlan, String> {
    inspect_vault_write_operations(vault_root, files, &[])
}

fn inspect_vault_write_operations(
    vault_root: &str,
    files: &[VaultWriteFilePayload],
    moves: &[VaultMoveFilePayload],
) -> Result<VaultWritePlan, String> {
    let root_path = validated_root(vault_root)?;
    validate_unique_batch_operation_paths(files, moves)?;
    let mut plan_files = Vec::with_capacity(files.len());
    let mut plan_moves = Vec::with_capacity(moves.len());
    let mut new_count = 0;
    let mut overwrite_count = 0;

    for move_file in moves {
        let from_relative = safe_relative_preview_path(&move_file.from_path)?;
        let to_relative = safe_relative_preview_path(&move_file.to_path)?;
        let source_path = root_path.join(&from_relative);
        let target_path = root_path.join(&to_relative);

        plan_moves.push(VaultMovePlanFile {
            from_path: path_to_string(&from_relative),
            to_path: path_to_string(&to_relative),
            title: move_file.title.clone(),
            note_id: move_file.note_id.clone(),
            reason: move_file.reason.clone(),
            source_exists: source_path.is_file(),
            target_exists: target_path.exists(),
        });
    }

    for file in files {
        let relative_path = safe_relative_preview_path(&file.path)?;
        let target_path = root_path.join(&relative_path);
        let exists = target_path.exists();
        let existing_size = if exists {
            fs::metadata(&target_path)
                .ok()
                .map(|metadata| metadata.len())
        } else {
            None
        };
        let existing_preview = if exists && !file.binary {
            fs::read_to_string(&target_path)
                .ok()
                .map(|content| truncate_for_error(&content.replace('\n', " ")))
        } else {
            None
        };

        if exists {
            overwrite_count += 1;
        } else {
            new_count += 1;
        }

        plan_files.push(VaultWritePlanFile {
            path: path_to_string(&relative_path),
            title: file.title.clone(),
            note_id: file.note_id.clone(),
            exists,
            existing_size,
            existing_preview,
        });
    }

    Ok(VaultWritePlan {
        files: plan_files,
        moves: plan_moves,
        new_count,
        overwrite_count,
        move_count: moves.len(),
    })
}

fn list_batch_manifests(vault_root: &str) -> Result<Vec<BatchManifestSummary>, String> {
    let root_path = validated_root(vault_root)?;
    let batches_dir = root_path.join(".lifemind").join("batches");

    if !batches_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();

    for entry in fs::read_dir(&batches_dir).map_err(|error| format!("无法读取批次目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取批次目录项：{error}"))?;
        let manifest_path = entry.path().join("manifest.json");

        if !manifest_path.is_file() {
            continue;
        }

        let manifest_content = fs::read_to_string(&manifest_path).map_err(|error| {
            format!(
                "无法读取批次事务记录 {}：{error}",
                manifest_path.to_string_lossy()
            )
        })?;
        let manifest: BatchManifest = serde_json::from_str(&manifest_content).map_err(|error| {
            format!(
                "批次事务记录损坏 {}：{error}",
                manifest_path.to_string_lossy()
            )
        })?;
        let file_count = manifest
            .files
            .iter()
            .filter(|file| file.operation == "write")
            .count();
        let moved_count = manifest
            .files
            .iter()
            .filter(|file| file.operation == "move")
            .count();
        let overwritten_count = manifest
            .files
            .iter()
            .filter(|file| file.operation == "write" && file.existed_before)
            .count();

        summaries.push(BatchManifestSummary {
            batch_id: manifest.batch_id,
            status: manifest.status,
            committed_at: manifest.committed_at,
            file_count,
            created_count: file_count.saturating_sub(overwritten_count),
            overwritten_count,
            moved_count,
        });
    }

    summaries.sort_by(|left, right| right.committed_at.cmp(&left.committed_at));
    Ok(summaries)
}

fn scan_vault_knowledge_files(vault_root: &str) -> Result<VaultKnowledgeContext, String> {
    const MAX_NOTES: usize = 1200;
    let root_path = validated_root(vault_root)?;
    let mut markdown_files = Vec::new();

    collect_markdown_files(&root_path, &root_path, &mut markdown_files, MAX_NOTES)?;

    markdown_files.sort();

    let mut roots: BTreeMap<String, (usize, BTreeSet<String>)> = BTreeMap::new();
    let mut notes = Vec::with_capacity(markdown_files.len());
    let mut relations = Vec::new();
    let mut relation_keys = BTreeSet::new();

    for file_path in markdown_files.into_iter().take(MAX_NOTES) {
        let relative_path = file_path
            .strip_prefix(&root_path)
            .map_err(|_| "Vault 索引文件路径异常。".to_string())?;
        let relative = path_to_string(relative_path);
        let root = get_first_path_segment(relative_path).unwrap_or_else(|| "未归类".to_string());
        let content = fs::read_to_string(&file_path).unwrap_or_default();
        let title = extract_markdown_title(&content).unwrap_or_else(|| {
            strip_extension(
                file_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("未命名"),
            )
        });
        let headings = extract_markdown_headings(&content);
        let snippet = extract_markdown_snippet(&content);
        let modified_at = fs::metadata(&file_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        let entry = roots
            .entry(root.clone())
            .or_insert_with(|| (0, BTreeSet::new()));

        entry.0 += 1;
        entry.1.insert(root.clone());
        for parent in relative_parent_paths(relative_path) {
            entry.1.insert(parent);
        }

        notes.push(VaultKnowledgeNote {
            title: title.clone(),
            path: relative,
            root: root.clone(),
            headings,
            snippet,
            modified_at,
        });
        push_vault_relation(
            &mut relations,
            &mut relation_keys,
            "包含",
            &root,
            &title,
            "目录结构",
        );
        extract_vault_relations_from_markdown(&title, &content, &mut relations, &mut relation_keys);
    }

    let roots = roots
        .into_iter()
        .map(|(name, (note_count, paths))| VaultKnowledgeRoot {
            name,
            note_count,
            paths: paths.into_iter().take(24).collect(),
        })
        .collect();

    Ok(VaultKnowledgeContext {
        roots,
        notes,
        relations,
    })
}

fn collect_markdown_files(
    vault_root: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
    max_files: usize,
) -> Result<(), String> {
    if files.len() >= max_files {
        return Ok(());
    }

    let entries = fs::read_dir(current)
        .map_err(|error| format!("无法扫描 Vault 目录 {}：{error}", current.to_string_lossy()))?;

    for entry in entries {
        if files.len() >= max_files {
            break;
        }

        let entry = entry.map_err(|error| format!("无法读取 Vault 目录项：{error}"))?;
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");

        if path.is_dir() {
            if should_skip_vault_index_dir(name) {
                continue;
            }

            if !path.starts_with(vault_root) {
                continue;
            }

            collect_markdown_files(vault_root, &path, files, max_files)?;
            continue;
        }

        if is_markdown_path(&path) {
            files.push(path);
        }
    }

    Ok(())
}

fn should_skip_vault_index_dir(name: &str) -> bool {
    matches!(
        name,
        ".obsidian" | ".lifemind" | ".git" | ".trash" | "node_modules"
    ) || name.starts_with("lifemind-review-current-vault")
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn get_first_path_segment(path: &Path) -> Option<String> {
    path.components().find_map(|component| match component {
        Component::Normal(value) => Some(value.to_string_lossy().to_string()),
        _ => None,
    })
}

fn relative_parent_paths(path: &Path) -> Vec<String> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let mut current = PathBuf::new();
    let mut paths = Vec::new();

    for component in parent.components() {
        if let Component::Normal(value) = component {
            current.push(value);
            paths.push(path_to_string(&current));
        }
    }

    paths
}

fn extract_markdown_title(content: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();

            if trimmed.starts_with("# ") {
                Some(trimmed.trim_start_matches("# ").trim().to_string())
            } else {
                None
            }
        })
        .filter(|title| !title.is_empty())
}

fn extract_markdown_headings(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();

            if !trimmed.starts_with('#') || trimmed.starts_with("# ") {
                return None;
            }

            let title = trimmed.trim_start_matches('#').trim();

            if title.is_empty() {
                None
            } else {
                Some(title.to_string())
            }
        })
        .take(8)
        .collect()
}

fn extract_markdown_snippet(content: &str) -> String {
    let mut lines = Vec::new();
    let mut in_frontmatter = false;
    let mut in_code_block = false;

    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        if index == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }

        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }

        if in_code_block
            || trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("粒度：")
            || trimmed.starts_with("归类：")
            || trimmed.starts_with("上级主题：")
            || trimmed.starts_with("前置知识：")
        {
            continue;
        }

        lines.push(trimmed.to_string());

        if lines.join(" ").chars().count() >= 260 {
            break;
        }
    }

    let snippet = lines.join(" ");

    if snippet.chars().count() <= 280 {
        snippet
    } else {
        format!("{}...", snippet.chars().take(280).collect::<String>())
    }
}

fn extract_vault_relations_from_markdown(
    source_title: &str,
    content: &str,
    relations: &mut Vec<VaultKnowledgeRelation>,
    relation_keys: &mut BTreeSet<String>,
) {
    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            continue;
        }

        let linked_titles = extract_wikilink_targets(trimmed);

        for target in &linked_titles {
            push_vault_relation(
                relations,
                relation_keys,
                "双链",
                source_title,
                target,
                &format!("[[{target}]]"),
            );
        }

        let Some(metadata_relation_type) = classify_relation_metadata_line(trimmed) else {
            continue;
        };

        for target in linked_titles {
            if metadata_relation_type == "包含" && is_parent_metadata_line(trimmed) {
                push_vault_relation(
                    relations,
                    relation_keys,
                    metadata_relation_type,
                    &target,
                    source_title,
                    trimmed,
                );
            } else {
                push_vault_relation(
                    relations,
                    relation_keys,
                    metadata_relation_type,
                    source_title,
                    &target,
                    trimmed,
                );
            }
        }
    }
}

fn classify_relation_metadata_line(line: &str) -> Option<&'static str> {
    let label = line
        .split_once('：')
        .or_else(|| line.split_once(':'))
        .map(|(label, _)| label.trim())
        .unwrap_or("");

    match label {
        "前置知识" | "前置语法" => Some("前置知识"),
        "上级主题" | "归类" => Some("包含"),
        "后续枝节" | "下级知识" | "子分支" => Some("包含"),
        "容易混淆" => Some("容易混淆"),
        "应用于" => Some("应用于"),
        "对比" => Some("对比"),
        _ => None,
    }
}

fn is_parent_metadata_line(line: &str) -> bool {
    let label = line
        .split_once('：')
        .or_else(|| line.split_once(':'))
        .map(|(label, _)| label.trim())
        .unwrap_or("");

    matches!(label, "上级主题" | "归类")
}

fn extract_wikilink_targets(line: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut remaining = line;

    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw_target = &after_start[..end];

        if let Some(target) = normalize_wikilink_target(raw_target) {
            targets.push(target);
        }

        remaining = &after_start[end + 2..];
    }

    targets
}

fn normalize_wikilink_target(raw_target: &str) -> Option<String> {
    let target_without_alias = raw_target.split('|').next().unwrap_or("").trim();
    let target_without_heading = target_without_alias.split('#').next().unwrap_or("").trim();
    let last_segment = target_without_heading
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();

    if last_segment.is_empty() {
        return None;
    }

    let title = strip_extension(last_segment).trim().to_string();

    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn push_vault_relation(
    relations: &mut Vec<VaultKnowledgeRelation>,
    relation_keys: &mut BTreeSet<String>,
    relation_type: &str,
    source: &str,
    target: &str,
    evidence: &str,
) {
    let source = source.trim();
    let target = target.trim();

    if source.is_empty() || target.is_empty() || source == target {
        return;
    }

    let key = format!("{relation_type}\u{1f}{source}\u{1f}{target}");

    if !relation_keys.insert(key) {
        return;
    }

    relations.push(VaultKnowledgeRelation {
        relation_type: relation_type.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        evidence: evidence.trim().chars().take(180).collect(),
    });
}

fn strip_extension(name: &str) -> String {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return "未命名 PDF".to_string();
    }

    Path::new(trimmed)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn is_low_quality_pdf_text_layer(content: &str) -> bool {
    let trimmed = content.trim();

    if trimmed.is_empty() {
        return true;
    }

    if trimmed.contains("(cid:") || trimmed.contains('\u{fffd}') {
        return true;
    }

    let char_count = trimmed.chars().count().max(1);
    let compatibility_radicals = trimmed
        .chars()
        .filter(|character| ('\u{2f00}'..='\u{2fdf}').contains(character))
        .count();

    if compatibility_radicals >= 2 || compatibility_radicals * 100 > char_count {
        return true;
    }

    let suspicious_aliases = [
        "STM 2B",
        "PI 1D",
        "PI1 D",
        "PI口",
        "VABT",
        "MCV",
        "ABM",
        "APC DMA",
        "SADC",
        "⾁ 核",
        "串叫",
        "输⼊输出",
        "被控⼜对象",
        "被控又",
        "xrror",
        "ontt)",
    ];

    if suspicious_aliases
        .iter()
        .any(|alias| trimmed.contains(alias))
    {
        return true;
    }

    let compact = trimmed
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();

    if ["PI1D", "PIlD", "PIID", "PI口", "err0r", "xrror"]
        .iter()
        .any(|alias| compact.contains(alias))
    {
        return true;
    }

    let mathematical_symbols = trimmed
        .chars()
        .filter(|character| matches!(*character, 'Ʃ' | '∑' | '∫' | '√' | '≤' | '≥' | '□'))
        .count();
    let formula_like_lines = trimmed
        .lines()
        .filter(|line| {
            let line = line.trim();
            line.contains('=')
                && line
                    .chars()
                    .any(|character| character.is_ascii_alphabetic())
        })
        .count();

    mathematical_symbols >= 2 && formula_like_lines >= 2
}

#[cfg(test)]
fn correct_ocr_technical_terms(value: &str) -> String {
    let mut text = value.trim().to_string();

    let replacements = [
        ("HAL.CPIO", "HAL_GPIO"),
        ("HAL CPIO", "HAL_GPIO"),
        ("HAL_CPI0", "HAL_GPIO"),
        ("HAL_CPIO", "HAL_GPIO"),
        ("HAL. GPIO", "HAL_GPIO"),
        ("HAL GPIO", "HAL_GPIO"),
        ("HAL_GPIO. _", "HAL_GPIO_"),
        ("HAL_GPIO._", "HAL_GPIO_"),
        ("HAL Delay", "HAL_Delay"),
        ("HAL_DeLay", "HAL_Delay"),
        ("HAL DelaY", "HAL_Delay"),
        ("GPI0", "GPIO"),
        ("GP10", "GPIO"),
        ("GPTO", "GPIO"),
        ("GPZD", "GPIO"),
        ("GPZO", "GPIO"),
        ("GPLD", "GPIO"),
        ("GPLO", "GPIO"),
        ("GPiO", "GPIO"),
        ("GTLO", "GPIO"),
        ("GPTOA", "GPIOA"),
        ("GP10A", "GPIOA"),
        ("GPI0A", "GPIOA"),
        ("GPTOC", "GPIOC"),
        ("GP10C", "GPIOC"),
        ("GPI0C", "GPIOC"),
        ("5TM32", "STM32"),
        ("sTM32", "STM32"),
        ("STMI3V", "STM32"),
        ("sTMI3V", "STM32"),
        ("STM 2B", "STM32"),
        ("STM 2 ", "STM32 "),
        ("STM 2", "STM32"),
        ("S7M32", "STM32"),
        ("Systick", "SysTick"),
        ("SYSTiek", "SysTick"),
        ("SYSTick", "SysTick"),
        ("BooT", "BOOT"),
        ("B0oT", "BOOT"),
        ("UARil", "UART"),
        ("UARTl", "UART1"),
        ("VART", "UART"),
        ("UARt", "UART"),
        ("UAR1", "UART"),
        ("cortex-M", "Cortex-M"),
        ("cortex-从", "Cortex-M"),
        ("Cortex一M", "Cortex-M"),
        ("Cortex-M內核", "Cortex-M 内核"),
        ("I5P", "ISP"),
        ("工5P", "ISP"),
        ("MCV", "MCU"),
        ("Cubellx", "CubeMX"),
        ("事口", "串口"),
        ("申断", "中断"),
        ("申斯", "中断"),
        ("中斯", "中断"),
        ("中聯", "中断"),
        ("TIN_ClearITRendingBit", "TIM_ClearITPendingBit"),
        ("TIN_ClearlrPendingBit", "TIM_ClearITPendingBit"),
        ("TIM_ClearITRendingBit", "TIM_ClearITPendingBit"),
        ("ClearlrPendingBit", "ClearITPendingBit"),
        ("ITRendingBit", "ITPendingBit"),
        ("tloat", "float"),
        ("whike", "while"),
        ("SBT", "SET"),
    ];

    for (from, to) in replacements {
        text = text.replace(from, to);
    }

    for suffix in ["_WritePin", "_ReadPin", "_TogglePin"] {
        if text.starts_with(suffix) {
            text = format!("HAL_GPIO{text}");
        }
    }

    if text.starts_with("_Delay") {
        text = format!("HAL{text}");
    }

    if text.contains("闭环")
        || text.contains("比例")
        || text.contains("积分")
        || text.contains("微分")
        || text.contains("位置式")
        || text.contains("增量")
        || text.contains("控制算法")
    {
        for candidate in ["PII", "PI7", "PI.D", "PLD"] {
            text = text.replace(candidate, "PID");
        }
    }

    text
}

#[cfg(test)]
fn merge_ocr_page_lines(page: &PdfOcrPage) -> Vec<PdfOcrLine> {
    merge_ocr_page_line_candidates(page)
        .into_iter()
        .map(|line| line.selected)
        .collect()
}

#[cfg(test)]
fn merge_ocr_page_line_candidates(page: &PdfOcrPage) -> Vec<PdfOcrEvidenceLine> {
    let mut candidates = page
        .lines
        .iter()
        .filter(|line| {
            !line.text.trim().is_empty()
                && line.width > 0.0
                && line.height > 0.0
                && line.confidence >= 0.0
        })
        .cloned()
        .map(|mut line| {
            let original = line.text.trim().to_string();
            line.text = correct_ocr_technical_terms(&line.text);
            let evidence = PdfOcrCandidateEvidence {
                original,
                corrected: line.text.clone(),
                confidence: line.confidence,
            };
            (line, evidence)
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .0
            .y
            .partial_cmp(&left.0.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                left.0
                    .x
                    .partial_cmp(&right.0.x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let mut merged: Vec<PdfOcrEvidenceLine> = Vec::new();

    for (candidate, evidence) in candidates {
        if let Some(existing) = merged
            .iter_mut()
            .find(|existing| ocr_lines_share_visual_region(&existing.selected, &candidate))
        {
            existing.candidates.push(evidence);
            if ocr_line_quality_score(&candidate) > ocr_line_quality_score(&existing.selected) {
                existing.selected = candidate;
            }
        } else {
            merged.push(PdfOcrEvidenceLine {
                selected: candidate,
                candidates: vec![evidence],
            });
        }
    }

    stitch_split_ocr_code_evidence_lines(merged)
}

#[cfg(test)]
fn stitch_split_ocr_code_evidence_lines(lines: Vec<PdfOcrEvidenceLine>) -> Vec<PdfOcrEvidenceLine> {
    let mut stitched = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let current = &lines[index];
        let next = lines.get(index + 1);

        if let Some(next_line) = next {
            if is_standalone_hal_gpio_prefix(&current.selected.text)
                && is_hal_gpio_function_line(&next_line.selected.text)
                && ocr_lines_are_vertically_adjacent(&current.selected, &next_line.selected)
            {
                let mut repaired = next_line.clone();
                repaired.selected.x = current.selected.x.min(next_line.selected.x);
                repaired.selected.y = current.selected.y;
                repaired.selected.width = current.selected.width.max(next_line.selected.width);
                repaired.selected.height = (current.selected.y + current.selected.height
                    - next_line.selected.y)
                    .max(next_line.selected.height);
                repaired.selected.confidence = current
                    .selected
                    .confidence
                    .max(next_line.selected.confidence);
                repaired.candidates.push(PdfOcrCandidateEvidence {
                    original: format!("{} {}", current.selected.text, next_line.selected.text),
                    corrected: repaired.selected.text.clone(),
                    confidence: repaired.selected.confidence,
                });
                stitched.push(repaired);
                index += 2;
                continue;
            }
        }

        stitched.push(current.clone());
        index += 1;
    }

    stitched
}

#[cfg(test)]
fn is_standalone_hal_gpio_prefix(text: &str) -> bool {
    matches!(
        text.trim(),
        "HAL" | "HAL_" | "HAL." | "HAL_GPIO" | "HAL_GPIO." | "HAL_GPIO_"
    )
}

#[cfg(test)]
fn is_hal_gpio_function_line(text: &str) -> bool {
    let trimmed = text.trim();
    [
        "HAL_GPIO_WritePin",
        "HAL_GPIO_ReadPin",
        "HAL_GPIO_TogglePin",
        "HAL_Delay",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

#[cfg(test)]
fn ocr_lines_are_vertically_adjacent(top: &PdfOcrLine, bottom: &PdfOcrLine) -> bool {
    let vertical_gap = (top.y - bottom.y).abs();
    let horizontal_drift = (top.x - bottom.x).abs();

    vertical_gap <= 0.075 && horizontal_drift <= 0.18
}

#[cfg(test)]
fn meaningful_ocr_candidate_lines(page: &PdfOcrPage) -> Vec<PdfOcrEvidenceLine> {
    merge_ocr_page_line_candidates(page)
        .into_iter()
        .filter(has_ocr_candidate_transmission_value)
        .collect()
}

#[cfg(test)]
fn has_ocr_candidate_transmission_value(line: &PdfOcrEvidenceLine) -> bool {
    technical_term_bonus(&line.selected.text) > 0.0
        || suspicious_ocr_penalty(&line.selected.text) > 0.0
        || line.candidates.iter().any(|candidate| {
            candidate.original != candidate.corrected
                || technical_term_bonus(&candidate.original) > 0.0
                || technical_term_bonus(&candidate.corrected) > 0.0
                || suspicious_ocr_penalty(&candidate.original) > 0.0
                || suspicious_ocr_penalty(&candidate.corrected) > 0.0
        })
}

#[cfg(test)]
fn format_ocr_candidate_evidence(line: &PdfOcrEvidenceLine) -> String {
    let mut candidates = line.candidates.clone();
    candidates.sort_by(|left, right| {
        right
            .confidence
            .partial_cmp(&left.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut seen = std::collections::HashSet::new();
    let candidate_lines = candidates
        .into_iter()
        .filter_map(|candidate| {
            let display = if candidate.original == candidate.corrected {
                candidate.original
            } else {
                format!("{} -> {}", candidate.original, candidate.corrected)
            };
            if seen.insert(display.clone()) {
                Some(format!(
                    "候选：{}（置信度 {:.2}）",
                    display, candidate.confidence
                ))
            } else {
                None
            }
        })
        .take(4)
        .collect::<Vec<_>>();

    format!(
        "- 选定：{}\n  {}",
        line.selected.text,
        candidate_lines.join("\n  ")
    )
}

#[cfg(test)]
fn ocr_lines_share_visual_region(left: &PdfOcrLine, right: &PdfOcrLine) -> bool {
    let y_close = (left.y - right.y).abs() <= 0.028;
    let x_close = (left.x - right.x).abs() <= 0.08;
    let left_end = left.x + left.width;
    let right_end = right.x + right.width;
    let overlap = left_end.min(right_end) - left.x.max(right.x);
    let min_width = left.width.min(right.width).max(0.001);

    y_close && (x_close || overlap / min_width >= 0.45)
}

#[cfg(test)]
fn ocr_line_quality_score(line: &PdfOcrLine) -> f32 {
    line.confidence + technical_term_bonus(&line.text) - suspicious_ocr_penalty(&line.text)
        + (line.text.chars().count().min(80) as f32 * 0.001)
}

#[cfg(test)]
fn technical_term_bonus(text: &str) -> f32 {
    let terms = [
        "STM32", "MSPM0", "GPIO", "UART", "USART", "I2C", "SPI", "ADC", "DMA", "PWM", "PID",
        "EXTI", "NVIC", "SysTick", "HAL_", "Cortex-M", "CH340",
    ];

    terms.iter().filter(|term| text.contains(**term)).count() as f32 * 0.08
}

#[cfg(test)]
fn suspicious_ocr_penalty(text: &str) -> f32 {
    let aliases = [
        "GTLO", "GPZD", "GPTO", "GP10", "GPI0", "HAL_CPIO", "PII", "PI7", "PI.D", "PLD", "5TM32",
        "STM 2B", "UARil", "VART",
    ];

    aliases
        .iter()
        .filter(|alias| text.contains(**alias))
        .count() as f32
        * 0.08
}

#[cfg(test)]
fn group_ocr_page_blocks(page: &PdfOcrPage) -> Vec<PdfOcrBlock> {
    const BLOCK_GAP_THRESHOLD: f32 = 0.14;
    let mut lines = merge_ocr_page_lines(page);

    lines.sort_by(|left, right| {
        right
            .y
            .partial_cmp(&left.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                left.x
                    .partial_cmp(&right.x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let mut blocks: Vec<PdfOcrBlock> = Vec::new();

    for line in &lines {
        let line_text = line.text.trim().to_string();
        let should_start_new_block = blocks
            .last()
            .map(|block| block.min_y - line.y > BLOCK_GAP_THRESHOLD)
            .unwrap_or(true);

        if should_start_new_block {
            blocks.push(PdfOcrBlock {
                page: page.page,
                lines: vec![line_text],
                min_y: line.y,
                max_y: line.y + line.height,
            });
        } else if let Some(block) = blocks.last_mut() {
            block.lines.push(line_text);
            block.min_y = block.min_y.min(line.y);
            block.max_y = block.max_y.max(line.y + line.height);
        }
    }

    blocks
}

#[cfg(test)]
fn build_pdf_extracted_content(
    title: &str,
    text_layer: &str,
    ocr: Option<&PdfOcrDocument>,
) -> String {
    let trimmed_text_layer = text_layer.trim();
    let Some(ocr) = ocr else {
        if is_low_quality_pdf_text_layer(trimmed_text_layer) {
            return format!(
                "【PDF 页面视觉证据】\n来源文件：{}\nPDF 文本层质量不足，已从模型正文中移除；请以请求中附带的原始页面图像为主要审理依据。",
                title.trim()
            );
        }
        return trimmed_text_layer.to_string();
    };

    if !ocr
        .pages
        .iter()
        .flat_map(|page| page.lines.iter())
        .any(|line| !line.text.trim().is_empty())
    {
        return trimmed_text_layer.to_string();
    }

    let mut content = String::new();
    content.push_str("【PDF 本地 OCR 结构提示】\n");
    content.push_str(&format!("来源文件：{}\n", title.trim()));
    content.push_str(
        "以下内容由 macOS 本地 Vision OCR 与 PDF 文本层共同生成，没有把页面图片发送给远程模型。两部分都可能存在识别噪声；审理时应优先按技术语境纠正常见 OCR 误读，无法确认的内容标记为不确定。\n\n",
    );
    content.push_str("【OCR 后处理】\n");
    content.push_str("系统已对同一视觉区域的多次 OCR 候选做本地合并，并对常见嵌入式技术词误读做了初步纠正；仍不确定的术语需要在审理时结合上下文判断。\n\n");
    content.push_str("【本地 Vision OCR 页面结构】\n");

    let mut pages = ocr.pages.iter().collect::<Vec<_>>();
    pages.sort_by_key(|page| page.page);

    for page in pages {
        content.push_str(&format!("## 第 {} 页\n", page.page));
        let blocks = group_ocr_page_blocks(page);

        if blocks.is_empty() {
            content.push_str("- 未识别到可用文本行。\n\n");
            continue;
        }

        for (index, block) in blocks.iter().enumerate() {
            content.push_str(&format!("### 第 {} 页视觉块 {}\n", block.page, index + 1));

            for line in &block.lines {
                content.push_str("- ");
                content.push_str(line);
                content.push('\n');
            }
        }

        content.push('\n');
    }

    let mut evidence_lines = Vec::new();
    for page in ocr.pages.iter() {
        for line in meaningful_ocr_candidate_lines(page) {
            evidence_lines.push(format_ocr_candidate_evidence(&line));
            if evidence_lines.len() >= 80 {
                break;
            }
        }
        if evidence_lines.len() >= 80 {
            break;
        }
    }

    if !evidence_lines.is_empty() {
        content.push_str("【OCR 候选证据】\n");
        content.push_str(
            "以下候选来自同一视觉区域的多次本地 OCR 识别与本地纠错，供审理时判断术语，不代表全部都应写入确定知识。\n",
        );
        for evidence in evidence_lines {
            content.push_str(&evidence);
            content.push('\n');
        }
        content.push('\n');
    }

    content.push_str("【PDF 文本层抽取】\n");

    if trimmed_text_layer.is_empty() {
        content.push_str("未提取到可用文本层。");
    } else if is_low_quality_pdf_text_layer(trimmed_text_layer) {
        content.push_str("低质量 PDF 文本层已省略，避免将重复的乱码或 OCR 噪声再次发送给模型；请以本地 Vision OCR 页面结构和候选证据为准。");
    } else {
        content.push_str(trimmed_text_layer);
    }

    content.trim().to_string()
}

fn build_pdf_review_content(title: &str, text_layer: &str, has_page_images: bool) -> String {
    let trimmed_text_layer = text_layer.trim();

    if is_low_quality_pdf_text_layer(trimmed_text_layer) {
        if !has_page_images {
            return String::new();
        }
        return format!(
            "【PDF 页面视觉证据】\n来源文件：{}\nPDF 文本层质量不足，已从模型正文中移除；请以请求中附带的原始页面图像为主要审理依据。",
            title.trim()
        );
    }

    trimmed_text_layer.to_string()
}

fn build_pdf_page_evidence_from_text_layer(
    text_layer: &str,
    rendered: Option<&PdfRenderedDocument>,
) -> PdfEvidenceResponse {
    let pages = if is_low_quality_pdf_text_layer(text_layer) {
        Vec::new()
    } else {
        parse_formatted_pdf_text_pages(text_layer)
    };
    PdfEvidenceResponse {
        pages: build_pdf_page_evidence(&pages, rendered),
        images: Vec::new(),
    }
}

fn parse_formatted_pdf_text_pages(text_layer: &str) -> Vec<PdfTextPage> {
    let mut pages = Vec::new();
    let mut current_page: Option<usize> = None;
    let mut current_lines = Vec::new();

    for line in text_layer.lines() {
        let trimmed = line.trim();
        let page_number = trimmed
            .strip_prefix("## 第 ")
            .and_then(|value| value.strip_suffix(" 页"))
            .and_then(|value| value.parse::<usize>().ok());

        if let Some(page) = page_number {
            if let Some(previous_page) = current_page.take() {
                pages.push(PdfTextPage {
                    page: previous_page,
                    text: current_lines.join("\n"),
                });
                current_lines.clear();
            }
            current_page = Some(page);
        } else if current_page.is_some() && !trimmed.is_empty() {
            current_lines.push(trimmed.to_string());
        }
    }

    if let Some(page) = current_page {
        pages.push(PdfTextPage {
            page,
            text: current_lines.join("\n"),
        });
    }

    if pages.is_empty() && !text_layer.trim().is_empty() {
        pages.push(PdfTextPage {
            page: 1,
            text: text_layer.trim().to_string(),
        });
    }

    pages
}

fn build_pdf_page_evidence(
    text_pages: &[PdfTextPage],
    rendered: Option<&PdfRenderedDocument>,
) -> Vec<PdfEvidencePageResponse> {
    let mut page_numbers = BTreeSet::new();
    page_numbers.extend(text_pages.iter().map(|page| page.page));
    page_numbers.extend(
        rendered
            .into_iter()
            .flat_map(|document| document.pages.iter().map(|page| page.page)),
    );

    page_numbers
        .into_iter()
        .map(|page_number| {
            let text_page = text_pages.iter().find(|page| page.page == page_number);
            let rendered_page = rendered
                .and_then(|document| document.pages.iter().find(|page| page.page == page_number));
            let mut evidence = Vec::new();

            if let Some(page) = text_page {
                for (index, line) in page
                    .text
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .enumerate()
                {
                    evidence.push(PdfEvidenceLineResponse {
                        id: format!("pdf-page-{page_number}-text-{}", index + 1),
                        text: line.to_string(),
                        source: "pdf-text".to_string(),
                        x: 0.0,
                        y: 0.0,
                        width: 0.0,
                        height: 0.0,
                        confidence: 1.0,
                        candidates: Vec::new(),
                    });
                }
            }

            PdfEvidencePageResponse {
                page: page_number,
                image_width: rendered_page.map(|page| page.image_width).unwrap_or(0),
                image_height: rendered_page.map(|page| page.image_height).unwrap_or(0),
                image_review_required: rendered_page
                    .and_then(|page| page.image_data_url.as_ref())
                    .is_some(),
                image_data_url: rendered_page.and_then(|page| page.image_data_url.clone()),
                evidence,
            }
        })
        .collect()
}

fn extract_pdf_embedded_images(pdf_bytes: &[u8]) -> Vec<PdfEmbeddedImageResponse> {
    use lopdf::{content::Content, Document, Object};

    let Ok(document) = Document::load_mem(pdf_bytes) else {
        return Vec::new();
    };
    let mut images = Vec::new();

    for (page_number, page_id) in document.get_pages() {
        let Some(page_box) = pdf_page_display_box(&document, page_id) else {
            continue;
        };
        let Some(xobjects) = pdf_page_xobjects(&document, page_id) else {
            continue;
        };
        let Ok(content_bytes) = document.get_page_content(page_id) else {
            continue;
        };
        let Ok(content) = Content::decode(&content_bytes) else {
            continue;
        };

        let mut matrix = [1.0_f32, 0.0, 0.0, 1.0, 0.0, 0.0];
        let mut matrix_stack = Vec::new();
        let mut placement_index = 0;

        for operation in content.operations {
            match operation.operator.as_str() {
                "q" => matrix_stack.push(matrix),
                "Q" => {
                    if let Some(previous) = matrix_stack.pop() {
                        matrix = previous;
                    }
                }
                "cm" if operation.operands.len() == 6 => {
                    let Some(transform) = operation
                        .operands
                        .iter()
                        .map(|operand| operand.as_float().ok())
                        .collect::<Option<Vec<_>>>()
                        .and_then(|values| <[f32; 6]>::try_from(values).ok())
                    else {
                        continue;
                    };
                    matrix = multiply_pdf_matrices(matrix, transform);
                }
                "Do" => {
                    let Some(Object::Name(name)) = operation.operands.first() else {
                        continue;
                    };
                    let Some(object) = xobjects.get(name) else {
                        continue;
                    };
                    let Some(stream) = object.as_stream().ok() else {
                        continue;
                    };
                    if stream.dict.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Image")
                    {
                        continue;
                    }
                    let Some((x, y, width, height)) = normalized_pdf_image_bounds(matrix, page_box)
                    else {
                        continue;
                    };
                    if is_page_sized_pdf_image(x, y, width, height) {
                        continue;
                    }
                    let Some((image_width, image_height, image_data_url)) =
                        encode_pdf_image(stream)
                    else {
                        continue;
                    };

                    placement_index += 1;
                    images.push(PdfEmbeddedImageResponse {
                        asset_id: format!("pdf-image-page-{page_number}-{placement_index}"),
                        page: page_number as usize,
                        image_width,
                        image_height,
                        x,
                        y,
                        width,
                        height,
                        image_data_url,
                    });
                }
                _ => {}
            }
        }
    }

    images
}

fn pdf_page_xobjects(
    document: &lopdf::Document,
    page_id: lopdf::ObjectId,
) -> Option<BTreeMap<Vec<u8>, lopdf::Object>> {
    use lopdf::Object;

    let (direct_resources, inherited_resource_ids) = document.get_page_resources(page_id).ok()?;
    let mut resources = Vec::new();
    if let Some(resources_dict) = direct_resources {
        resources.push(resources_dict);
    }
    for resource_id in inherited_resource_ids {
        if let Ok(resources_dict) = document.get_dictionary(resource_id) {
            resources.push(resources_dict);
        }
    }

    let mut xobjects = BTreeMap::new();
    for resources_dict in resources {
        let Ok(xobjects_object) = resources_dict.get_deref(b"XObject", document) else {
            continue;
        };
        let Ok(xobjects_dict) = xobjects_object.as_dict() else {
            continue;
        };
        for (name, value) in xobjects_dict.iter() {
            let resolved = match value {
                Object::Reference(id) => document.get_object(*id).ok().cloned(),
                value => Some(value.clone()),
            };
            if let Some(object) = resolved {
                xobjects.entry(name.clone()).or_insert(object);
            }
        }
    }
    Some(xobjects)
}

fn pdf_page_display_box(document: &lopdf::Document, page_id: lopdf::ObjectId) -> Option<[f32; 4]> {
    use lopdf::Object;

    let mut current_id = Some(page_id);
    while let Some(id) = current_id {
        let dictionary = document.get_dictionary(id).ok()?;
        for key in [b"CropBox" as &[u8], b"MediaBox"] {
            let Ok(value) = dictionary.get(key) else {
                continue;
            };
            let value = match value {
                Object::Reference(reference) => document.get_object(*reference).ok()?,
                value => value,
            };
            let values = value
                .as_array()
                .ok()?
                .iter()
                .map(|coordinate| coordinate.as_float().ok())
                .collect::<Option<Vec<_>>>()?;
            let [left, bottom, right, top] = <[f32; 4]>::try_from(values).ok()?;
            if right > left && top > bottom {
                return Some([left, bottom, right, top]);
            }
        }
        current_id = dictionary
            .get(b"Parent")
            .ok()
            .and_then(|parent| parent.as_reference().ok());
    }
    None
}

fn encode_pdf_image(stream: &lopdf::Stream) -> Option<(u32, u32, String)> {
    use lopdf::Object;

    let image_width = u32::try_from(stream.dict.get(b"Width").ok()?.as_i64().ok()?).ok()?;
    let image_height = u32::try_from(stream.dict.get(b"Height").ok()?.as_i64().ok()?).ok()?;
    if image_width == 0 || image_height == 0 || image_width > 10_000 || image_height > 10_000 {
        return None;
    }

    let filters = match stream.dict.get(b"Filter") {
        Ok(Object::Name(name)) => vec![name.as_slice()],
        Ok(Object::Array(filters)) => filters
            .iter()
            .map(Object::as_name)
            .collect::<Result<Vec<_>, _>>()
            .ok()?,
        _ => Vec::new(),
    };
    if filters.as_slice() == [b"DCTDecode"] {
        return Some((
            image_width,
            image_height,
            format!(
                "data:image/jpeg;base64,{}",
                BASE64_STANDARD.encode(&stream.content)
            ),
        ));
    }
    if filters.iter().any(|filter| *filter == b"DCTDecode") {
        return None;
    }

    let bits_per_component = stream
        .dict
        .get(b"BitsPerComponent")
        .and_then(Object::as_i64)
        .ok()?;
    if bits_per_component != 8 {
        return None;
    }
    if stream
        .dict
        .get(b"DecodeParms")
        .and_then(Object::as_dict)
        .and_then(|params| params.get(b"Predictor"))
        .and_then(Object::as_i64)
        .is_ok_and(|predictor| predictor > 1)
    {
        return None;
    }

    let color_space = stream.dict.get(b"ColorSpace").ok()?.as_name().ok()?;
    let (channels, color_type) = match color_space {
        b"DeviceRGB" => (3_u32, png::ColorType::Rgb),
        b"DeviceGray" => (1_u32, png::ColorType::Grayscale),
        _ => return None,
    };
    let expected_length = image_width
        .checked_mul(image_height)?
        .checked_mul(channels)? as usize;
    if expected_length > 64 * 1024 * 1024 {
        return None;
    }
    let pixels = stream.decompressed_content().ok()?;
    if pixels.len() != expected_length {
        return None;
    }

    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, image_width, image_height);
        encoder.set_color(color_type);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }
    Some((
        image_width,
        image_height,
        format!("data:image/png;base64,{}", BASE64_STANDARD.encode(encoded)),
    ))
}

fn multiply_pdf_matrices(left: [f32; 6], right: [f32; 6]) -> [f32; 6] {
    [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
    ]
}

fn normalized_pdf_image_bounds(
    matrix: [f32; 6],
    page_box: [f32; 4],
) -> Option<(f32, f32, f32, f32)> {
    let [left, bottom, right, top] = page_box;
    let page_width = right - left;
    let page_height = top - bottom;
    if page_width <= 0.0 || page_height <= 0.0 {
        return None;
    }

    let corners = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)].map(|(x, y)| {
        (
            matrix[0] * x + matrix[2] * y + matrix[4],
            matrix[1] * x + matrix[3] * y + matrix[5],
        )
    });
    let min_x = corners
        .iter()
        .map(|corner| corner.0)
        .fold(f32::INFINITY, f32::min);
    let max_x = corners
        .iter()
        .map(|corner| corner.0)
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = corners
        .iter()
        .map(|corner| corner.1)
        .fold(f32::INFINITY, f32::min);
    let max_y = corners
        .iter()
        .map(|corner| corner.1)
        .fold(f32::NEG_INFINITY, f32::max);
    let x = ((min_x - left) / page_width).clamp(0.0, 1.0);
    let y = ((top - max_y) / page_height).clamp(0.0, 1.0);
    let width = ((max_x - min_x) / page_width).clamp(0.0, 1.0);
    let height = ((max_y - min_y) / page_height).clamp(0.0, 1.0);
    (width > 0.0 && height > 0.0).then_some((x, y, width, height))
}

fn is_page_sized_pdf_image(x: f32, y: f32, width: f32, height: f32) -> bool {
    x <= 0.03 && y <= 0.03 && x + width >= 0.97 && y + height >= 0.97
}

#[cfg(target_os = "macos")]
fn extract_pdf_text_layer(pdf_bytes: &[u8], _file_name: &str) -> Result<String, String> {
    let temp_root = std::env::temp_dir().join(format!(
        "lifemind-pdf-text-{}-{}",
        std::process::id(),
        unix_timestamp_millis()
    ));
    let result = (|| {
        fs::create_dir_all(&temp_root)
            .map_err(|error| format!("无法创建 PDF 文本层临时目录：{error}"))?;
        let input_path = temp_root.join("input.pdf");
        let script_path = temp_root.join("lifemind_pdf_text.swift");
        let output_path = temp_root.join("text.json");

        fs::write(&input_path, pdf_bytes)
            .map_err(|error| format!("无法写入 PDF 文本层临时文件：{error}"))?;
        fs::write(&script_path, PDF_TEXT_SWIFT_SCRIPT)
            .map_err(|error| format!("无法写入 PDF 文本层 Swift 脚本：{error}"))?;

        run_swift_pdf_text_helper(&script_path, &input_path, &output_path)?;

        let json = fs::read_to_string(&output_path)
            .map_err(|error| format!("无法读取 PDF 文本层输出：{error}"))?;
        let text_document: PdfTextDocument = serde_json::from_str(&json)
            .map_err(|error| format!("无法解析 PDF 文本层 JSON：{error}"))?;

        Ok(format_pdf_text_layer(&text_document))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result
}

#[cfg(not(target_os = "macos"))]
fn extract_pdf_text_layer(pdf_bytes: &[u8], _file_name: &str) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(pdf_bytes)
        .map(|content| content.trim().to_string())
        .map_err(|error| format!("PDF 文本层抽取失败：{error}"))
}

fn format_pdf_text_layer(document: &PdfTextDocument) -> String {
    document
        .pages
        .iter()
        .filter_map(|page| {
            let text = page.text.trim();

            if text.is_empty() {
                None
            } else {
                Some(format!("## 第 {} 页\n{}", page.page, text))
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
        .trim()
        .to_string()
}

#[cfg(target_os = "macos")]
fn run_swift_pdf_text_helper(
    script_path: &Path,
    input_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/swift");
    command
        .arg(script_path)
        .arg(input_path)
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = run_command_with_timeout(command, Duration::from_secs(30), "PDF 文本层抽取")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "PDF 文本层抽取失败，退出码：{}；{}",
        output.status,
        truncate_for_error(stderr.trim())
    ))
}

#[cfg(target_os = "macos")]
fn extract_pdf_page_rendering(
    pdf_bytes: &[u8],
    _file_name: &str,
) -> Result<PdfRenderedDocument, String> {
    let temp_root = std::env::temp_dir().join(format!(
        "lifemind-pdf-render-{}-{}",
        std::process::id(),
        unix_timestamp_millis()
    ));
    let result = (|| {
        fs::create_dir_all(&temp_root)
            .map_err(|error| format!("无法创建 PDF 页面渲染临时目录：{error}"))?;
        let input_path = temp_root.join("input.pdf");
        let script_path = temp_root.join("lifemind_pdf_render.swift");
        let output_path = temp_root.join("pages.json");

        fs::write(&input_path, pdf_bytes)
            .map_err(|error| format!("无法写入 PDF 页面渲染临时 PDF：{error}"))?;
        fs::write(&script_path, PDF_PAGE_RENDER_SWIFT_SCRIPT)
            .map_err(|error| format!("无法写入 PDF 页面渲染 Swift 脚本：{error}"))?;

        run_swift_pdf_render_helper(&script_path, &input_path, &output_path)?;

        let json = fs::read_to_string(&output_path)
            .map_err(|error| format!("无法读取 PDF 页面渲染输出：{error}"))?;
        serde_json::from_str(&json).map_err(|error| format!("无法解析 PDF 页面渲染 JSON：{error}"))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result
}

#[cfg(not(target_os = "macos"))]
fn extract_pdf_page_rendering(
    _pdf_bytes: &[u8],
    _file_name: &str,
) -> Result<PdfRenderedDocument, String> {
    Err("PDF 页面视觉渲染仅支持 macOS。".to_string())
}

#[cfg(target_os = "macos")]
fn run_swift_pdf_render_helper(
    script_path: &Path,
    input_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/swift");
    command
        .arg(script_path)
        .arg(input_path)
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = run_command_with_timeout(command, Duration::from_secs(120), "PDF 页面视觉渲染")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "PDF 页面视觉渲染失败，退出码：{}；{}",
        output.status,
        truncate_for_error(stderr.trim())
    ))
}

#[cfg(all(test, target_os = "macos"))]
fn extract_pdf_ocr_with_vision(
    pdf_bytes: &[u8],
    _file_name: &str,
) -> Result<PdfOcrDocument, String> {
    let temp_root = std::env::temp_dir().join(format!(
        "lifemind-pdf-ocr-{}-{}",
        std::process::id(),
        unix_timestamp_millis()
    ));
    let result = (|| {
        fs::create_dir_all(&temp_root)
            .map_err(|error| format!("无法创建 OCR 临时目录：{error}"))?;
        let input_path = temp_root.join("input.pdf");
        let script_path = temp_root.join("lifemind_pdf_ocr.swift");
        let output_path = temp_root.join("ocr.json");

        fs::write(&input_path, pdf_bytes)
            .map_err(|error| format!("无法写入 OCR 临时 PDF：{error}"))?;
        fs::write(&script_path, VISION_OCR_SWIFT_SCRIPT)
            .map_err(|error| format!("无法写入 OCR Swift 脚本：{error}"))?;

        run_swift_ocr_helper(&script_path, &input_path, &output_path)?;

        let json = fs::read_to_string(&output_path)
            .map_err(|error| format!("无法读取 OCR 输出：{error}"))?;
        serde_json::from_str(&json).map_err(|error| format!("无法解析 OCR 输出 JSON：{error}"))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result
}

#[cfg(all(test, target_os = "macos"))]
fn run_swift_ocr_helper(
    script_path: &Path,
    input_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/swift");
    command
        .arg(script_path)
        .arg(input_path)
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = run_command_with_timeout(command, Duration::from_secs(120), "本地 Vision OCR")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "本地 Vision OCR 执行失败，退出码：{}；{}",
        output.status,
        truncate_for_error(stderr.trim())
    ))
}

fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
    label: &str,
) -> Result<Output, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动{label}：{error}"))?;
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("无法读取{label}结果：{error}"));
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{label}超时（{} 秒），已终止本次处理。请先拆分 PDF 或降低页数后重试。",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("无法检查{label}状态：{error}"));
            }
        }
    }
}

#[cfg(target_os = "macos")]
const PDF_TEXT_SWIFT_SCRIPT: &str = r#"
import Foundation
import PDFKit

struct TextPage: Codable {
    let page: Int
    let text: String
}

struct TextDocument: Codable {
    let pages: [TextPage]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

if CommandLine.arguments.count < 3 {
    fail("usage: lifemind_pdf_text.swift input.pdf output.json")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let document = PDFDocument(url: inputURL) else {
    fail("cannot open PDF")
}

let maxPages = min(document.pageCount, 80)
var pages: [TextPage] = []

for index in 0..<maxPages {
    guard let page = document.page(at: index) else {
        pages.append(TextPage(page: index + 1, text: ""))
        continue
    }

    pages.append(TextPage(page: index + 1, text: page.string ?? ""))
}

let data = try JSONEncoder().encode(TextDocument(pages: pages))
try data.write(to: outputURL)
"#;

#[cfg(target_os = "macos")]
const PDF_PAGE_RENDER_SWIFT_SCRIPT: &str = r#"
import AppKit
import Foundation
import PDFKit

struct RenderedPage: Codable {
    let page: Int
    let imageWidth: Int
    let imageHeight: Int
    let imageDataUrl: String?
}

struct RenderedDocument: Codable {
    let pages: [RenderedPage]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

if CommandLine.arguments.count < 3 {
    fail("usage: lifemind_pdf_render.swift input.pdf output.json")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let document = PDFDocument(url: inputURL) else {
    fail("cannot open PDF")
}

func renderPage(_ page: PDFPage, scale: CGFloat) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let imageSize = NSSize(width: bounds.width * scale, height: bounds.height * scale)
    let image = NSImage(size: imageSize)
    image.lockFocus()
    NSColor.white.setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: imageSize)).fill()
    if let context = NSGraphicsContext.current?.cgContext {
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()
    }
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
    return bitmap.cgImage
}

func jpegDataUrl(_ image: CGImage) -> String? {
    let representation = NSBitmapImageRep(cgImage: image)
    guard let data = representation.representation(using: .jpeg, properties: [.compressionFactor: 0.62]) else {
        return nil
    }
    let encoded = data.base64EncodedString()
    guard encoded.count <= 6_000_000 else { return nil }
    return "data:image/jpeg;base64," + encoded
}

let maxPages = min(document.pageCount, 80)
var pages: [RenderedPage] = []
for index in 0..<maxPages {
    guard let page = document.page(at: index),
          let image = renderPage(page, scale: 1.6) else {
        pages.append(RenderedPage(page: index + 1, imageWidth: 0, imageHeight: 0, imageDataUrl: nil))
        continue
    }
    pages.append(RenderedPage(
        page: index + 1,
        imageWidth: image.width,
        imageHeight: image.height,
        imageDataUrl: jpegDataUrl(image)
    ))
}

let data = try JSONEncoder().encode(RenderedDocument(pages: pages))
try data.write(to: outputURL)
"#;

#[cfg(all(test, target_os = "macos"))]
const VISION_OCR_SWIFT_SCRIPT: &str = r#"
import AppKit
import CoreImage
import Foundation
import PDFKit
import Vision

struct OcrLine: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Double
}

struct OcrPage: Codable {
    let page: Int
    let lines: [OcrLine]
    let imageWidth: Int
    let imageHeight: Int
    let imageDataUrl: String?
}

struct OcrDocument: Codable {
    let pages: [OcrPage]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

if CommandLine.arguments.count < 3 {
    fail("usage: lifemind_pdf_ocr.swift input.pdf output.json")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let document = PDFDocument(url: inputURL) else {
    fail("cannot open PDF")
}

func renderPage(_ page: PDFPage, scale: CGFloat) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let imageSize = NSSize(width: bounds.width * scale, height: bounds.height * scale)
    let image = NSImage(size: imageSize)

    image.lockFocus()
    NSColor.white.setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: imageSize)).fill()

    if let context = NSGraphicsContext.current?.cgContext {
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()
    }

    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff) else {
        return nil
    }

    return bitmap.cgImage
}

let ciContext = CIContext(options: nil)

func colorControlForHandwriting(_ image: CGImage, contrast: Double, brightness: Double) -> CGImage {
    let input = CIImage(cgImage: image)

    guard let filter = CIFilter(name: "CIColorControls") else {
        return image
    }

    filter.setValue(input, forKey: kCIInputImageKey)
    filter.setValue(0.0, forKey: kCIInputSaturationKey)
    filter.setValue(contrast, forKey: kCIInputContrastKey)
    filter.setValue(brightness, forKey: kCIInputBrightnessKey)

    guard let output = filter.outputImage,
          let enhanced = ciContext.createCGImage(output, from: output.extent) else {
        return image
    }

    return enhanced
}

func sharpenForHandwriting(_ image: CGImage) -> CGImage {
    let input = CIImage(cgImage: image)

    guard let filter = CIFilter(name: "CIUnsharpMask") else {
        return image
    }

    filter.setValue(input, forKey: kCIInputImageKey)
    filter.setValue(0.7, forKey: kCIInputRadiusKey)
    filter.setValue(0.45, forKey: kCIInputIntensityKey)

    guard let output = filter.outputImage,
          let sharpened = ciContext.createCGImage(output, from: output.extent) else {
        return image
    }

    return sharpened
}

func jpegDataURL(_ image: CGImage) -> String? {
    let representation = NSBitmapImageRep(cgImage: image)
    guard let data = representation.representation(
        using: .jpeg,
        properties: [.compressionFactor: 0.62]
    ) else {
        return nil
    }

    let encoded = data.base64EncodedString()
    guard encoded.count <= 6_000_000 else { return nil }
    return "data:image/jpeg;base64," + encoded
}

func ocrImageVariants(_ image: CGImage) -> [CGImage] {
    let enhanced = colorControlForHandwriting(image, contrast: 1.28, brightness: 0.02)
    let highContrast = colorControlForHandwriting(image, contrast: 1.62, brightness: 0.04)
    return [
        image,
        enhanced,
        sharpenForHandwriting(highContrast)
    ]
}

func recognizeLines(in image: CGImage) throws -> [OcrLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.customWords = [
        "STM32", "STM32F103", "MSPM0", "MSPM0G3507", "Cortex-M", "ARM",
        "GPIO", "UART", "USART", "I2C", "SPI", "ADC", "DMA", "PWM", "PID",
        "EXTI", "NVIC", "SysTick", "Keil", "CubeMX", "MDK-ARM", "HAL",
        "HAL_GPIO_ReadPin", "HAL_GPIO_WritePin", "HAL_Delay", "CH340",
        "BOOT", "ISP", "SWD", "JTAG", "TIM", "TIM2_IRQHandler"
    ]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []

    return observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }

        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)

        if text.isEmpty {
            return nil
        }

        let box = observation.boundingBox

        return OcrLine(
            text: text,
            x: box.origin.x,
            y: box.origin.y,
            width: box.size.width,
            height: box.size.height,
            confidence: Double(candidate.confidence)
        )
    }
}

var pages: [OcrPage] = []
let maxPages = min(document.pageCount, 40)

for index in 0..<maxPages {
    guard let page = document.page(at: index),
          let image = renderPage(page, scale: 2.8) else {
        pages.append(OcrPage(page: index + 1, lines: [], imageWidth: 0, imageHeight: 0, imageDataUrl: nil))
        continue
    }

    do {
        let primaryLines = try recognizeLines(in: image)
        let primaryTextCount = primaryLines.reduce(0) { $0 + $1.text.count }
        var lines = primaryLines

        if primaryLines.count < 3 || primaryTextCount < 24 {
            for variant in ocrImageVariants(image).dropFirst() {
                lines.append(contentsOf: try recognizeLines(in: variant))
            }
        }

        let preview = renderPage(page, scale: 1.6)
        pages.append(OcrPage(
            page: index + 1,
            lines: lines,
            imageWidth: preview?.width ?? image.width,
            imageHeight: preview?.height ?? image.height,
            imageDataUrl: preview.flatMap(jpegDataURL)
        ))
    } catch {
        let preview = renderPage(page, scale: 1.6)
        pages.append(OcrPage(
            page: index + 1,
            lines: [],
            imageWidth: preview?.width ?? image.width,
            imageHeight: preview?.height ?? image.height,
            imageDataUrl: preview.flatMap(jpegDataURL)
        ))
    }
}

let data = try JSONEncoder().encode(OcrDocument(pages: pages))
try data.write(to: outputURL)
"#;

fn extract_webpage(url: &str) -> Result<ExtractedContent, String> {
    let url = url.trim();

    if url.is_empty() {
        return Err("请先填写网页链接。".to_string());
    }

    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("网页链接需要以 http:// 或 https:// 开头。".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(40))
        .user_agent("lifemind/0.1 static-webpage-extractor")
        .build()
        .map_err(|error| format!("无法初始化网页抓取客户端：{error}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("网页抓取失败：{error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("网页抓取失败：HTTP {status}"));
    }

    let body = response
        .text()
        .map_err(|error| format!("无法读取网页内容：{error}"))?;
    let title = extract_html_title(&body)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| url.to_string());
    let content = html_to_readable_text(&body);

    if content.trim().is_empty() {
        return Err("网页未提取到可审理文本，可能需要登录或动态渲染。".to_string());
    }

    Ok(ExtractedContent {
        title,
        content,
        source_type: "web".to_string(),
        pdf_evidence: None,
        pdf_quality_source: None,
        pdf_text_layer_low_quality: None,
    })
}

fn extract_html_title(html: &str) -> Option<String> {
    let start = find_case_insensitive(html, "<title")?;
    let open_end = html[start..].find('>')? + start + 1;
    let close = find_case_insensitive(&html[open_end..], "</title>")? + open_end;
    Some(decode_html_entities(html[open_end..close].trim()))
}

fn html_to_readable_text(html: &str) -> String {
    let mut cleaned = html.to_string();

    for tag in [
        "script", "style", "noscript", "svg", "nav", "header", "footer",
    ] {
        cleaned = remove_html_tag_blocks(&cleaned, tag);
    }

    let mut text = String::with_capacity(cleaned.len());
    let mut in_tag = false;

    for character in cleaned.chars() {
        match character {
            '<' => {
                in_tag = true;
                text.push('\n');
            }
            '>' => {
                in_tag = false;
                text.push('\n');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    collapse_text_lines(&decode_html_entities(&text))
}

fn remove_html_tag_blocks(input: &str, tag: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    let open_pattern = format!("<{tag}");
    let close_pattern = format!("</{tag}>");

    while let Some(relative_start) = find_case_insensitive(&input[cursor..], &open_pattern) {
        let start = cursor + relative_start;
        output.push_str(&input[cursor..start]);

        let after_start = match input[start..].find('>') {
            Some(value) => start + value + 1,
            None => {
                cursor = input.len();
                break;
            }
        };

        match find_case_insensitive(&input[after_start..], &close_pattern) {
            Some(relative_close) => {
                cursor = after_start + relative_close + close_pattern.len();
            }
            None => {
                cursor = input.len();
                break;
            }
        }
    }

    output.push_str(&input[cursor..]);
    output
}

fn find_case_insensitive(value: &str, pattern: &str) -> Option<usize> {
    value.to_lowercase().find(&pattern.to_lowercase())
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn collapse_text_lines(value: &str) -> String {
    value
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn save_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let provider = safe_provider_key(provider)?;
    let entry = keyring::Entry::new("lifemind.review-model-api-key", &provider)
        .map_err(|error| format!("无法打开系统钥匙串条目：{error}"))?;
    let trimmed = api_key.trim();

    if trimmed.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("无法清除系统钥匙串中的 API Key：{error}")),
        };
    }

    entry
        .set_password(trimmed)
        .map_err(|error| format!("无法保存 API Key 到系统钥匙串：{error}"))
}

fn load_api_key(provider: &str) -> Result<Option<String>, String> {
    let provider = safe_provider_key(provider)?;
    let entry = keyring::Entry::new("lifemind.review-model-api-key", &provider)
        .map_err(|error| format!("无法打开系统钥匙串条目：{error}"))?;

    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法从系统钥匙串读取 API Key：{error}")),
    }
}

fn append_review_diagnostic_log(event: &ReviewDiagnosticLogPayload) -> Result<(), String> {
    let log_directory = review_log_directory()?;
    fs::create_dir_all(&log_directory)
        .map_err(|error| format!("无法创建 LifeMind 诊断日志目录：{error}"))?;

    let record = serde_json::json!({
        "timestamp": unix_timestamp_string(),
        "provider": diagnostic_text(&event.provider, 40),
        "model": diagnostic_text(&event.model, 120),
        "stage": diagnostic_text(&event.stage, 80),
        "attempt": event.attempt,
        "responseLength": event.response_length,
        "requestSummary": event.request_summary.clone().unwrap_or_else(|| serde_json::json!({})),
        "rawOutputPreview": diagnostic_text(event.raw_output_preview.as_deref().unwrap_or(""), 1200),
        "errors": event.errors.iter().map(|error| serde_json::json!({
            "path": diagnostic_text(&error.path, 180),
            "message": diagnostic_text(&error.message, 300),
        })).collect::<Vec<_>>(),
    });
    let line = serde_json::to_string(&record)
        .map_err(|error| format!("无法序列化 LifeMind 诊断日志：{error}"))?;
    let log_path = log_directory.join("review-diagnostics.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("无法打开 LifeMind 诊断日志：{error}"))?;

    writeln!(file, "{line}").map_err(|error| format!("无法写入 LifeMind 诊断日志：{error}"))
}

fn review_log_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let directory = std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("com.lifemind.desktop")
            .join("logs")
    });

    #[cfg(target_os = "windows")]
    let directory = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|app_data| app_data.join("com.lifemind.desktop").join("logs"));

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let directory = std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join(".local")
            .join("share")
            .join("com.lifemind.desktop")
            .join("logs")
    });

    directory.ok_or_else(|| "无法定位 LifeMind 本地应用数据目录。".to_string())
}

fn diagnostic_text(value: &str, max_chars: usize) -> String {
    value
        .replace('\n', " ")
        .replace('\r', " ")
        .chars()
        .take(max_chars)
        .collect()
}

fn safe_provider_key(value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("模型供应商不能为空。".to_string());
    }

    if trimmed != "deepseek" {
        return Err("当前版本只支持 DeepSeek 模型。".to_string());
    }

    Ok(trimmed.to_string())
}

fn inspect_vault_root(value: &str) -> VaultInspection {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return VaultInspection {
            path: String::new(),
            exists: false,
            is_dir: false,
            has_obsidian_config: false,
            can_write: false,
            message: "请先填写真实 Obsidian Vault 路径。".to_string(),
        };
    }

    let root = PathBuf::from(trimmed);

    if !root.exists() {
        return VaultInspection {
            path: trimmed.to_string(),
            exists: false,
            is_dir: false,
            has_obsidian_config: false,
            can_write: false,
            message: "路径不存在。".to_string(),
        };
    }

    if !root.is_dir() {
        return VaultInspection {
            path: trimmed.to_string(),
            exists: true,
            is_dir: false,
            has_obsidian_config: false,
            can_write: false,
            message: "路径不是文件夹。".to_string(),
        };
    }

    let has_obsidian_config = root.join(".obsidian").is_dir();
    let write_probe = root.join(".lifemind-write-check");
    let can_write = match fs::write(&write_probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&write_probe);
            true
        }
        Err(_) => false,
    };

    let message = if !can_write {
        "路径存在，但 LifeMind 没有写入权限。".to_string()
    } else if !has_obsidian_config {
        "路径可写，但未发现 .obsidian 配置目录，请确认这是你的真实 Vault。".to_string()
    } else {
        "Vault 路径可写，已发现 .obsidian 配置目录。".to_string()
    };

    VaultInspection {
        path: trimmed.to_string(),
        exists: true,
        is_dir: true,
        has_obsidian_config,
        can_write,
        message,
    }
}

fn rollback_records(root_path: &Path, records: &[BatchFileRecord]) -> Result<(), String> {
    for record in records.iter().rev() {
        let relative_path = safe_relative_preview_path(&record.path)?;
        let target_path = root_path.join(&relative_path);

        if record.operation == "move" {
            let from_path = record
                .from_path
                .as_ref()
                .ok_or_else(|| format!("缺少旧笔记原路径：{}", record.path))
                .and_then(|path| safe_relative_preview_path(path))?;
            let source_path = root_path.join(from_path);

            if !target_path.exists() {
                continue;
            }

            if source_path.exists() {
                return Err(format!(
                    "无法撤销旧笔记迁移，原路径已存在：{}",
                    source_path.to_string_lossy()
                ));
            }

            if let Some(parent) = source_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法恢复旧笔记目录：{error}"))?;
            }

            fs::rename(&target_path, &source_path).map_err(|error| {
                format!(
                    "无法撤销旧笔记迁移 {} 到 {}：{error}",
                    target_path.to_string_lossy(),
                    source_path.to_string_lossy()
                )
            })?;
            prune_empty_dirs(root_path, target_path.parent());
            continue;
        }

        if record.operation != "write" {
            return Err(format!("未知批次事务操作：{}", record.operation));
        }

        if record.existed_before {
            let backup_path = record
                .backup_path
                .as_ref()
                .ok_or_else(|| format!("缺少旧笔记备份：{}", record.path))
                .and_then(|path| safe_relative_preview_path(path))?;
            let backup_absolute = root_path.join(backup_path);

            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法恢复笔记目录：{error}"))?;
            }

            fs::copy(&backup_absolute, &target_path).map_err(|error| {
                format!("无法恢复旧笔记 {}：{error}", target_path.to_string_lossy())
            })?;
        } else if target_path.exists() {
            fs::remove_file(&target_path).map_err(|error| {
                format!(
                    "无法删除本批次新增笔记 {}：{error}",
                    target_path.to_string_lossy()
                )
            })?;
            prune_empty_dirs(root_path, target_path.parent());
        }
    }

    Ok(())
}

fn write_manifest(path: &Path, manifest: &BatchManifest) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建 manifest 目录：{error}"))?;
    }

    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("无法序列化批次事务记录：{error}"))?;
    fs::write(path, content).map_err(|error| format!("无法写入批次事务记录：{error}"))
}

fn write_preview_files(root: &str, files: &[PreviewFilePayload]) -> Result<(), String> {
    let root = root.trim();

    if root.is_empty() {
        return Err("缺少 Obsidian 临时预览目录。".to_string());
    }

    let root_path = PathBuf::from(root);
    reset_batch_preview_root(&root_path)?;
    prune_stale_lifemind_preview_roots(&root_path)?;
    fs::create_dir_all(&root_path).map_err(|error| format!("无法创建临时预览目录：{error}"))?;
    fs::create_dir_all(root_path.join(".obsidian"))
        .map_err(|error| format!("无法创建 Obsidian 临时 Vault 配置目录：{error}"))?;

    for file in files {
        let relative_path = safe_relative_preview_path(&file.path)?;
        let target_path = root_path.join(relative_path);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建预览文件夹：{error}"))?;
        }

        let content = if file.binary {
            decode_image_data_url(&file.content)?
        } else {
            file.content.as_bytes().to_vec()
        };
        fs::write(&target_path, content).map_err(|error| {
            format!(
                "无法写入 Obsidian 预览文件 {}：{error}",
                target_path.to_string_lossy()
            )
        })?;
    }

    Ok(())
}

fn discard_preview_root(root: &str) -> Result<(), String> {
    let root = root.trim();

    if root.is_empty() {
        return Err("缺少要删除的临时预览目录。".to_string());
    }

    let root_path = PathBuf::from(root);

    if !is_lifemind_batch_preview_root(&root_path) {
        return Err("只能删除 LifeMind 创建的当前批次临时预览目录。".to_string());
    }

    if root_path.exists() {
        fs::remove_dir_all(&root_path).map_err(|error| {
            format!(
                "无法删除当前批次临时预览目录 {}：{error}",
                root_path.to_string_lossy()
            )
        })?;
    }

    unregister_lifemind_preview_vault(&root_path)?;
    Ok(())
}

fn reset_batch_preview_root(root_path: &Path) -> Result<(), String> {
    if !is_lifemind_batch_preview_root(root_path) || !root_path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(root_path).map_err(|error| {
        format!(
            "无法清理当前批次临时预览目录 {}：{error}",
            root_path.to_string_lossy()
        )
    })
}

fn prune_stale_lifemind_preview_roots(current_root: &Path) -> Result<(), String> {
    if !is_lifemind_batch_preview_root(current_root) {
        return Ok(());
    }

    let Some(parent) = current_root.parent() else {
        return Ok(());
    };

    if !parent.is_dir() {
        return Ok(());
    }

    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法读取 LifeMind 临时预览父目录：{error}")),
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取 LifeMind 临时预览目录项：{error}"))?;
        let path = entry.path();

        if path == current_root {
            continue;
        }

        if is_lifemind_batch_preview_root(&path) && path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        }
    }

    Ok(())
}

fn is_lifemind_batch_preview_root(root_path: &Path) -> bool {
    let Some(batch_dir) = root_path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(parent_dir) = root_path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
    else {
        return false;
    };

    batch_dir.starts_with("batch-") && parent_dir.starts_with("lifemind-review-current-vault")
}

fn validated_root(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("请先配置真实 Obsidian Vault 路径。".to_string());
    }

    let root = PathBuf::from(trimmed);

    if !root.exists() {
        return Err("配置的 Obsidian Vault 路径不存在。".to_string());
    }

    if !root.is_dir() {
        return Err("配置的 Obsidian Vault 路径不是文件夹。".to_string());
    }

    Ok(root)
}

fn safe_relative_preview_path(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("预览文件路径不能为空。".to_string());
    }

    let path = Path::new(trimmed);

    if path.is_absolute() {
        return Err("预览文件路径必须是相对路径。".to_string());
    }

    let mut safe_path = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(segment) => safe_path.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("预览文件路径不能离开临时 Vault。".to_string());
            }
        }
    }

    if safe_path.as_os_str().is_empty() {
        return Err("预览文件路径不能为空。".to_string());
    }

    Ok(safe_path)
}

fn safe_batch_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("批次 ID 不能为空。".to_string());
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("批次 ID 只能包含英文、数字、短横线和下划线。".to_string());
    }

    Ok(trimmed.to_string())
}

fn path_to_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn unix_timestamp_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn prune_empty_dirs(root_path: &Path, start: Option<&Path>) {
    let Some(mut current) = start.map(Path::to_path_buf) else {
        return;
    };

    while current.starts_with(root_path) && current != root_path {
        match fs::remove_dir(&current) {
            Ok(()) => {
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                } else {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn build_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');

    if is_deepseek_base_url(trimmed) {
        return "https://api.deepseek.com/beta/chat/completions".to_string();
    }

    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/chat/completions")
    } else {
        format!("{trimmed}/v1/chat/completions")
    }
}

fn is_deepseek_base_url(trimmed: &str) -> bool {
    matches!(
        trimmed,
        "https://api.deepseek.com"
            | "https://api.deepseek.com/beta"
            | "https://api.deepseek.com/v1"
            | "https://api.deepseek.com/chat/completions"
            | "https://api.deepseek.com/beta/chat/completions"
            | "https://api.deepseek.com/v1/chat/completions"
    )
}

fn model_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(30))
        .timeout(model_request_timeout())
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|error| format!("无法初始化模型 HTTP 客户端：{error}"))
}

struct ModelResponseText {
    status: reqwest::StatusCode,
    text: String,
}

fn read_model_response_with_retry<F>(
    mut send: F,
    provider: &str,
    url: &str,
) -> Result<ModelResponseText, String>
where
    F: FnMut() -> Result<reqwest::blocking::Response, reqwest::Error>,
{
    let mut last_error = String::new();

    for attempt in 1..=MODEL_RESPONSE_READ_ATTEMPTS {
        let response = match send() {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("模型请求发送失败：{error}");

                if attempt < MODEL_RESPONSE_READ_ATTEMPTS {
                    thread::sleep(model_response_retry_delay(attempt));
                    continue;
                }

                return Err(format!(
                    "{last_error}；提供商：{provider}；请求地址：{url}；尝试次数：{attempt}"
                ));
            }
        };

        let status = response.status();
        let version = response.version();
        let content_encoding = response_content_encoding(&response);
        let content_length = response_content_length(&response);

        match response.bytes() {
            Ok(bytes) => {
                return Ok(ModelResponseText {
                    status,
                    text: String::from_utf8_lossy(&bytes).into_owned(),
                });
            }
            Err(error) => {
                last_error = format_model_response_read_error(
                    error,
                    status,
                    version,
                    content_encoding.as_deref(),
                    content_length,
                    attempt,
                );

                if attempt < MODEL_RESPONSE_READ_ATTEMPTS {
                    thread::sleep(model_response_retry_delay(attempt));
                    continue;
                }
            }
        }
    }

    Err(format!("{last_error}；提供商：{provider}；请求地址：{url}"))
}

fn model_response_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(250 * attempt as u64)
}

fn response_content_encoding(response: &reqwest::blocking::Response) -> Option<String> {
    response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn response_content_length(response: &reqwest::blocking::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

fn format_model_response_read_error(
    error: reqwest::Error,
    status: reqwest::StatusCode,
    version: reqwest::Version,
    content_encoding: Option<&str>,
    content_length: Option<u64>,
    attempt: usize,
) -> String {
    let encoding = content_encoding.unwrap_or("未声明");
    let length = content_length
        .map(|value| value.to_string())
        .unwrap_or_else(|| "未声明".to_string());
    let mut chain = error.to_string();
    let mut source = error.source();

    while let Some(cause) = source {
        chain.push_str(" -> ");
        chain.push_str(&cause.to_string());
        source = cause.source();
    }

    format!(
        "无法读取模型响应：{error}；HTTP 状态：{status}；HTTP 版本：{version:?}；响应编码：{encoding}；声明长度：{length}；错误链：{chain}；第 {attempt}/{MODEL_RESPONSE_READ_ATTEMPTS} 次尝试"
    )
}

fn truncate_for_error(value: &str) -> String {
    const MAX_LEN: usize = 500;

    if value.chars().count() <= MAX_LEN {
        return value.to_string();
    }

    format!("{}...", value.chars().take(MAX_LEN).collect::<String>())
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }

    encoded
}

#[cfg(target_os = "macos")]
fn activate_lifemind_app() {
    let _ = Command::new("osascript")
        .args(["-e", r#"tell application "LifeMind" to activate"#])
        .status();
    let _ = Command::new("open").arg("-a").arg("LifeMind").status();
}

#[cfg(not(target_os = "macos"))]
fn activate_lifemind_app() {}

#[cfg(target_os = "macos")]
fn open_preview_root_in_obsidian(root_path: &Path, _preview_file: &Path) -> Result<(), String> {
    register_lifemind_preview_vault(root_path)?;
    quit_obsidian_before_preview()?;
    open_macos_app_path("Obsidian", root_path)
}

#[cfg(not(target_os = "macos"))]
fn open_preview_root_in_obsidian(root_path: &Path, _preview_file: &Path) -> Result<(), String> {
    open_uri(&root_path.to_string_lossy())
}

#[cfg(target_os = "macos")]
fn register_lifemind_preview_vault(root_path: &Path) -> Result<String, String> {
    let Some(home) = std::env::var_os("HOME") else {
        return Err("无法定位用户 HOME 目录，不能登记 Obsidian 临时预览 Vault。".to_string());
    };
    let registry_path = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("obsidian")
        .join("obsidian.json");

    if !registry_path.exists() {
        return Ok(stable_lifemind_preview_vault_id(root_path));
    }

    let content = fs::read_to_string(&registry_path)
        .map_err(|error| format!("无法读取 Obsidian Vault 注册表：{error}"))?;
    let id = stable_lifemind_preview_vault_id(root_path);
    let updated =
        upsert_obsidian_preview_vault_config(&content, root_path, unix_timestamp_millis())?;
    let backup_path = registry_path.with_file_name("obsidian.json.lifemind-backup");

    if !backup_path.exists() {
        let _ = fs::copy(&registry_path, &backup_path);
    }

    fs::write(&registry_path, updated)
        .map_err(|error| format!("无法登记 Obsidian 临时预览 Vault：{error}"))?;

    Ok(id)
}

#[cfg(target_os = "macos")]
fn unregister_lifemind_preview_vault(root_path: &Path) -> Result<(), String> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(());
    };
    let registry_path = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("obsidian")
        .join("obsidian.json");

    if !registry_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&registry_path)
        .map_err(|error| format!("无法读取 Obsidian Vault 注册表：{error}"))?;
    let updated = remove_obsidian_preview_vault_config(&content, root_path)?;

    fs::write(&registry_path, updated)
        .map_err(|error| format!("无法移除 Obsidian 临时预览 Vault 登记：{error}"))
}

#[cfg(not(target_os = "macos"))]
fn unregister_lifemind_preview_vault(_root_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn quit_obsidian_before_preview() -> Result<(), String> {
    if !is_process_running("Obsidian") {
        return Ok(());
    }

    let _ = Command::new("osascript")
        .args(["-e", r#"tell application "Obsidian" to quit"#])
        .status();

    for _ in 0..50 {
        if !is_process_running("Obsidian") {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(100));
    }

    Err("Obsidian 正在运行且暂时无法退出，请先关闭 Obsidian 后再打开预览。".to_string())
}

#[cfg(target_os = "macos")]
fn is_process_running(process_name: &str) -> bool {
    Command::new("pgrep")
        .arg("-x")
        .arg(process_name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn open_macos_app_path(app_name: &str, path: &Path) -> Result<(), String> {
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(path)
        .status()
        .map_err(|error| format!("无法调用 macOS open 打开 {app_name}：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "打开 {app_name} 失败，退出码：{status}；路径：{}",
            path.to_string_lossy()
        ))
    }
}

fn upsert_obsidian_preview_vault_config(
    content: &str,
    root_path: &Path,
    timestamp: u64,
) -> Result<String, String> {
    let mut registry: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Obsidian Vault 注册表不是合法 JSON：{error}"))?;

    if !registry.is_object() {
        return Err("Obsidian Vault 注册表必须是 JSON 对象。".to_string());
    }

    if registry.get("vaults").is_none() || !registry["vaults"].is_object() {
        registry["vaults"] = serde_json::json!({});
    }

    let vaults = registry["vaults"]
        .as_object_mut()
        .ok_or_else(|| "Obsidian Vault 注册表 vaults 字段不是对象。".to_string())?;
    let id = stable_lifemind_preview_vault_id(root_path);

    vaults.retain(
        |_, value| match value.pointer("/path").and_then(serde_json::Value::as_str) {
            Some(path) => !is_lifemind_batch_preview_path(path),
            None => true,
        },
    );

    vaults.insert(
        id,
        serde_json::json!({
            "path": root_path.to_string_lossy(),
            "ts": timestamp,
            "open": true
        }),
    );

    serde_json::to_string_pretty(&registry)
        .map_err(|error| format!("无法序列化 Obsidian Vault 注册表：{error}"))
}

fn remove_obsidian_preview_vault_config(content: &str, root_path: &Path) -> Result<String, String> {
    let mut registry: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Obsidian Vault 注册表不是合法 JSON：{error}"))?;

    if !registry.is_object() {
        return Err("Obsidian Vault 注册表必须是 JSON 对象。".to_string());
    }

    let Some(vaults) = registry
        .get_mut("vaults")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return serde_json::to_string_pretty(&registry)
            .map_err(|error| format!("无法序列化 Obsidian Vault 注册表：{error}"));
    };
    let target = root_path.to_string_lossy().to_string();
    let id = stable_lifemind_preview_vault_id(root_path);

    vaults.retain(|key, value| {
        if key == &id {
            return false;
        }

        value.pointer("/path").and_then(serde_json::Value::as_str) != Some(target.as_str())
    });

    serde_json::to_string_pretty(&registry)
        .map_err(|error| format!("无法序列化 Obsidian Vault 注册表：{error}"))
}

fn is_lifemind_batch_preview_path(value: &str) -> bool {
    is_lifemind_batch_preview_root(Path::new(value))
}

fn stable_lifemind_preview_vault_id(root_path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    root_path.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn unix_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn open_uri(uri: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(uri)
        .status()
        .map_err(|error| format!("无法调用 macOS open 命令：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("打开 Obsidian URI 失败，退出码：{status}"))
    }
}

#[cfg(target_os = "windows")]
fn open_uri(uri: &str) -> Result<(), String> {
    let status = Command::new("cmd")
        .args(["/C", "start", "", uri])
        .status()
        .map_err(|error| format!("无法调用 Windows start 命令：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("打开 Obsidian URI 失败，退出码：{status}"))
    }
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn open_uri(uri: &str) -> Result<(), String> {
    let status = Command::new("xdg-open")
        .arg(uri)
        .status()
        .map_err(|error| format!("无法调用 xdg-open 命令：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("打开 Obsidian URI 失败，退出码：{status}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_obsidian_preview,
            run_review_skill_model,
            confirm_review_batch,
            confirm_logic_link_updates,
            undo_review_batch,
            validate_vault_path,
            inspect_vault_write_plan,
            list_review_batches,
            scan_vault_knowledge,
            discard_review_preview,
            extract_pdf_text,
            extract_pdf_text_from_path,
            extract_text_file_from_path,
            select_intake_file_paths,
            extract_webpage_text,
            save_model_api_key,
            load_model_api_key,
            write_review_diagnostic_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn accepts_nested_markdown_preview_paths() {
        let path =
            safe_relative_preview_path("20-生成预览/Java/Java基础语法/Java 控制台输出.md").unwrap();

        assert_eq!(
            path.to_string_lossy(),
            "20-生成预览/Java/Java基础语法/Java 控制台输出.md"
        );
    }

    #[test]
    fn runs_keychain_work_off_the_calling_thread() {
        let caller = std::thread::current().id();
        let worker = tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn_blocking(|| std::thread::current().id())
                .await
                .unwrap()
        });

        assert_ne!(worker, caller);
    }

    #[test]
    fn rejects_paths_that_escape_preview_root() {
        assert!(safe_relative_preview_path("../真实知识库.md").is_err());
        assert!(safe_relative_preview_path("/Users/a0000/真实知识库.md").is_err());
    }

    #[test]
    fn builds_deepseek_chat_completion_urls() {
        assert_eq!(
            build_chat_completions_url("https://api.deepseek.com"),
            "https://api.deepseek.com/beta/chat/completions"
        );
        assert_eq!(
            build_chat_completions_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/beta/chat/completions"
        );
        assert_eq!(
            build_chat_completions_url("https://api.deepseek.com/v1/chat/completions"),
            "https://api.deepseek.com/beta/chat/completions"
        );
        assert_eq!(
            build_chat_completions_url("https://api.deepseek.com/beta"),
            "https://api.deepseek.com/beta/chat/completions"
        );
    }

    #[test]
    fn serializes_multimodal_user_content_for_deepseek_flash() {
        let tool = serde_json::json!({
            "type": "function",
            "function": { "name": "submit_review_plan" }
        });
        let content = serde_json::json!([
            { "type": "text", "text": "第 2 页证据 pdf-page-2-ocr-1" },
            { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,aW1hZ2U=" } }
        ]);
        let request = build_chat_completion_request_with_content(
            "deepseek-flash",
            "system",
            &serde_json::json!({}),
            Some(10_000),
            None,
            Some(&tool),
            content,
        )
        .unwrap();
        let payload = serde_json::to_value(request).unwrap();

        assert_eq!(payload["model"], "deepseek-flash");
        assert_eq!(payload["messages"][1]["content"][1]["type"], "image_url");
        assert_eq!(
            payload["messages"][1]["content"][1]["image_url"]["url"],
            "data:image/jpeg;base64,aW1hZ2U="
        );
        assert_eq!(
            payload["thinking"],
            serde_json::json!({ "type": "disabled" })
        );
        assert_eq!(
            payload["tool_choice"]["function"]["name"],
            "submit_review_plan"
        );
    }

    #[test]
    fn sends_page_and_embedded_pdf_images_with_matching_metadata() {
        let images = (0..16)
            .map(|index| {
                serde_json::json!({
                    "sourceId": "src-pdf",
                    "page": index / 8 + 1,
                    "assetId": format!("pdf-asset-{index}"),
                    "kind": if index < 8 { "page" } else { "embedded" },
                    "x": 0.125,
                    "y": 0.25,
                    "width": 0.5,
                    "height": 0.25,
                    "imageDataUrl": "data:image/png;base64,aW1hZ2U=",
                })
            })
            .collect::<Vec<_>>();
        let content =
            build_model_user_content(&serde_json::json!({ "pdfEvidenceImages": images })).unwrap();
        let blocks = content.as_array().unwrap();
        let request_context = blocks[0]["text"].as_str().unwrap();

        assert_eq!(blocks.len(), 17);
        assert!(request_context.contains("pdf-asset-8"));
        assert!(request_context.contains("PDF 内嵌图片"));
        assert!(request_context.contains("x=0.125"));
        assert!(request_context.contains("y=0.25"));
        assert!(request_context.contains("width=0.5"));
        assert!(request_context.contains("height=0.25"));
        assert_eq!(
            blocks[9]["image_url"]["url"],
            "data:image/png;base64,aW1hZ2U="
        );
    }

    #[test]
    fn assigns_normalized_stable_ids_to_pdf_evidence_lines() {
        let pages = vec![PdfTextPage {
            page: 2,
            text: "E=mc^2".to_string(),
        }];
        let evidence = build_pdf_page_evidence(&pages, None);

        assert_eq!(evidence[0].page, 2);
        assert_eq!(evidence[0].evidence[0].id, "pdf-page-2-text-1");
        assert_eq!(evidence[0].evidence[0].source, "pdf-text");
        assert_eq!(evidence[0].evidence[0].x, 0.0);
        assert_eq!(evidence[0].evidence[0].confidence, 1.0);
    }

    #[test]
    fn builds_page_evidence_from_rendered_images_without_ocr() {
        let rendered = PdfRenderedDocument {
            pages: vec![PdfRenderedPage {
                page: 7,
                image_width: 1200,
                image_height: 1600,
                image_data_url: Some("data:image/jpeg;base64,aW1hZ2U=".to_string()),
            }],
        };

        let evidence = build_pdf_page_evidence(&[], Some(&rendered));

        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].page, 7);
        assert!(evidence[0].image_review_required);
        assert_eq!(evidence[0].image_width, 1200);
        assert_eq!(evidence[0].image_height, 1600);
        assert!(evidence[0].evidence.is_empty());
    }

    #[test]
    fn extracts_pdf_image_xobjects_with_normalized_page_positions() {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let image = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 2,
                "Height" => 1,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            vec![255, 0, 0, 0, 255, 0],
        );
        let image_id = document.add_object(image);
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let content_id = document.add_object(Stream::new(
            lopdf::Dictionary::new(),
            b"BT /F1 12 Tf 20 200 Td (image fixture) Tj ET q 200 0 0 100 20 30 cm /Im0 Do Q"
                .to_vec(),
        ));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 400.into(), 400.into()],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
                "XObject" => dictionary! { "Im0" => image_id },
            },
            "Contents" => content_id,
        });
        document.set_object(
            pages_id,
            dictionary! {
                "Type" => "Pages",
                "Count" => 1,
                "Kids" => vec![Object::Reference(page_id)],
            },
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        let mut pdf_bytes = Vec::new();
        document.save_to(&mut pdf_bytes).unwrap();

        let extracted = extract_pdf_content("image-fixture.pdf", &pdf_bytes).unwrap();
        let evidence = serde_json::to_value(extracted.pdf_evidence.unwrap()).unwrap();
        let image = evidence["images"].as_array().unwrap().first().unwrap();

        assert_eq!(image["page"], 1);
        assert_eq!(image["imageWidth"], 2);
        assert_eq!(image["imageHeight"], 1);
        assert!((image["x"].as_f64().unwrap() - 0.05).abs() < 0.001);
        assert!((image["y"].as_f64().unwrap() - 0.675).abs() < 0.001);
        assert!((image["width"].as_f64().unwrap() - 0.5).abs() < 0.001);
        assert!((image["height"].as_f64().unwrap() - 0.25).abs() < 0.001);
        assert!(image["imageDataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn excludes_page_sized_scan_images_from_embedded_note_assets() {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let image_id = document.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1,
                "Height" => 1,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            vec![255, 255, 255],
        ));
        let content_id = document.add_object(Stream::new(
            lopdf::Dictionary::new(),
            b"q 400 0 0 400 0 0 cm /Scan Do Q q 384 0 0 384 8 8 cm /Scan Do Q".to_vec(),
        ));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 400.into(), 400.into()],
            "Resources" => dictionary! {
                "XObject" => dictionary! { "Scan" => image_id },
            },
            "Contents" => content_id,
        });
        document.set_object(
            pages_id,
            dictionary! {
                "Type" => "Pages",
                "Count" => 1,
                "Kids" => vec![Object::Reference(page_id)],
            },
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        let mut pdf_bytes = Vec::new();
        document.save_to(&mut pdf_bytes).unwrap();

        assert!(extract_pdf_embedded_images(&pdf_bytes).is_empty());
    }

    #[test]
    fn omits_low_quality_pdf_text_evidence_but_keeps_rendered_page_images() {
        let rendered = PdfRenderedDocument {
            pages: vec![PdfRenderedPage {
                page: 1,
                image_width: 1200,
                image_height: 1600,
                image_data_url: Some("data:image/jpeg;base64,aW1hZ2U=".to_string()),
            }],
        };
        let evidence = build_pdf_page_evidence_from_text_layer(
            "## 第 1 页\nE[xiu) = Ʃ| xuP\nPEx(n)=□x(n) / N",
            Some(&rendered),
        );

        assert_eq!(evidence.pages.len(), 1);
        assert!(evidence.pages[0].image_review_required);
        assert!(evidence.pages[0].evidence.is_empty());
    }

    #[test]
    fn uses_disabled_thinking_and_fixed_tool_choice_for_deepseek_v4_requests() {
        let tool = serde_json::json!({
            "type": "function",
            "function": { "name": "submit_review_plan" }
        });
        let request = build_chat_completion_request(
            "deepseek-v4-pro",
            "system",
            &serde_json::json!({}),
            Some(&tool),
        )
        .unwrap();
        let payload = serde_json::to_value(request).unwrap();

        assert_eq!(
            payload["thinking"],
            serde_json::json!({ "type": "disabled" })
        );
        assert!(payload.get("reasoning_effort").is_none());
        assert_eq!(
            payload["tool_choice"],
            serde_json::json!({
                "type": "function",
                "function": { "name": "submit_review_plan" }
            })
        );
        assert_eq!(payload["temperature"], 0.0);
    }

    #[test]
    fn honors_low_reasoning_effort_for_cost_controlled_review_requests() {
        let tool = serde_json::json!({
            "type": "function",
            "function": { "name": "submit_review_plan" }
        });
        let request = build_chat_completion_request_with_max_output_tokens(
            "deepseek-v4-pro",
            "system",
            &serde_json::json!({ "reviewMode": "final-pass" }),
            Some(10_000),
            Some("low"),
            Some(&tool),
        )
        .unwrap();
        let payload = serde_json::to_value(request).unwrap();

        assert_eq!(payload["max_tokens"], 10_000);
        assert_eq!(
            payload["thinking"],
            serde_json::json!({ "type": "disabled" })
        );
        assert!(payload.get("reasoning_effort").is_none());
        assert_eq!(
            payload["tool_choice"],
            serde_json::json!({
                "type": "function",
                "function": { "name": "submit_review_plan" }
            })
        );
    }

    #[test]
    fn uses_the_same_strict_request_shape_for_legacy_deepseek_models() {
        let tool = serde_json::json!({
            "type": "function",
            "function": { "name": "submit_review_plan" }
        });
        let request = build_chat_completion_request(
            "deepseek-chat",
            "system",
            &serde_json::json!({}),
            Some(&tool),
        )
        .unwrap();
        let payload = serde_json::to_value(request).unwrap();

        assert_eq!(payload["temperature"], 0.0);
        assert_eq!(
            payload["tool_choice"],
            serde_json::json!({
                "type": "function",
                "function": { "name": "submit_review_plan" }
            })
        );
        assert_eq!(
            payload["thinking"],
            serde_json::json!({ "type": "disabled" })
        );
        assert!(payload.get("reasoning_effort").is_none());
    }

    #[test]
    fn preserves_model_usage_and_reasoning_tokens_in_the_bridge_envelope() {
        let response: ChatCompletionResponse = serde_json::from_value(serde_json::json!({
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 90,
                "total_tokens": 210,
                "prompt_cache_hit_tokens": 80,
                "prompt_cache_miss_tokens": 40,
                "completion_tokens_details": {
                    "reasoning_tokens": 60
                }
            }
        }))
        .unwrap();
        let usage = review_model_usage(response.usage.as_ref()).unwrap();
        let envelope = ReviewModelInvocation {
            output: "{}".to_string(),
            usage: Some(usage),
        };
        let payload = serde_json::to_value(envelope).unwrap();

        assert_eq!(payload["usage"]["promptTokens"], 120);
        assert_eq!(payload["usage"]["promptCacheHitTokens"], 80);
        assert_eq!(payload["usage"]["promptCacheMissTokens"], 40);
        assert_eq!(payload["usage"]["reasoningTokens"], 60);
    }

    #[test]
    fn truncates_large_model_error_bodies() {
        let long = "x".repeat(800);
        let truncated = truncate_for_error(&long);

        assert!(truncated.ends_with("..."));
        assert!(truncated.len() < long.len());
    }

    #[test]
    fn model_response_read_errors_include_status_and_encoding() {
        let client = reqwest::blocking::Client::builder().build().unwrap();
        let error = client
            .get("http://127.0.0.1:1")
            .send()
            .expect_err("closed localhost port should fail");

        let message = format_model_response_read_error(
            error,
            reqwest::StatusCode::OK,
            reqwest::Version::HTTP_11,
            Some("gzip"),
            Some(128),
            2,
        );

        assert!(message.contains("无法读取模型响应"));
        assert!(message.contains("HTTP 状态：200 OK"));
        assert!(message.contains("响应编码：gzip"));
        assert!(message.contains("错误链："));
    }

    #[test]
    fn model_response_timeouts_allow_slow_pdf_reviews_without_unbounded_waiting() {
        assert!(model_request_timeout() >= Duration::from_secs(300));
        assert!(model_request_timeout() <= Duration::from_secs(900));
    }

    #[test]
    fn retries_a_truncated_model_response_before_failing() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for attempt in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0_u8; 1024];
                let _ = stream.read(&mut request);

                if attempt == 0 {
                    let truncated = "{\"x\":";
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 10\r\nConnection: close\r\n\r\n{truncated}"
                    )
                    .unwrap();
                } else {
                    let body = "{\"x\":\"ok\"}";
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                }
            }
        });

        let client = model_http_client().unwrap();
        let url = format!("http://{address}/model");
        let response =
            read_model_response_with_retry(|| client.get(&url).send(), "测试模型", &url).unwrap();

        assert_eq!(response.status, reqwest::StatusCode::OK);
        assert_eq!(response.text, "{\"x\":\"ok\"}");
        server.join().unwrap();
    }

    #[test]
    fn writes_preview_files_under_the_preview_root() {
        let root =
            std::env::temp_dir().join(format!("lifemind-preview-test-{}", std::process::id()));
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);

        write_preview_files(
            &root_string,
            &[PreviewFilePayload {
                path: "00-审理确认总览.md".to_string(),
                content: "# 总览".to_string(),
                binary: false,
            }],
        )
        .unwrap();

        let written = fs::read_to_string(root.join("00-审理确认总览.md")).unwrap();
        assert_eq!(written, "# 总览");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rewrites_batch_preview_root_without_stale_files() {
        let root = std::env::temp_dir()
            .join(format!(
                "lifemind-review-current-vault-rewrite-{}",
                std::process::id()
            ))
            .join("batch-test-clean");
        let root_string = root.to_string_lossy().to_string();
        let stale_file = root.join("20-生成预览").join("旧结果.md");
        let _ = fs::remove_dir_all(root.parent().unwrap());
        fs::create_dir_all(stale_file.parent().unwrap()).unwrap();
        fs::write(&stale_file, "old").unwrap();

        write_preview_files(
            &root_string,
            &[PreviewFilePayload {
                path: "00-审理确认总览.md".to_string(),
                content: "# 当前总览".to_string(),
                binary: false,
            }],
        )
        .unwrap();

        assert!(!stale_file.exists());
        assert_eq!(
            fs::read_to_string(root.join("00-审理确认总览.md")).unwrap(),
            "# 当前总览"
        );

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn registers_preview_root_without_removing_existing_obsidian_vaults() {
        let root = PathBuf::from("/tmp/lifemind-review-current-vault/batch-test-preview");
        let content = upsert_obsidian_preview_vault_config(
            r#"{"vaults":{"existing":{"path":"/Users/a0000/obsidian/mind","ts":1,"open":false}}}"#,
            &root,
            42,
        )
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let vaults = parsed.pointer("/vaults").unwrap().as_object().unwrap();

        assert!(vaults.contains_key("existing"));
        let preview = vaults
            .values()
            .find(|value| {
                value.pointer("/path").and_then(serde_json::Value::as_str)
                    == Some(root.to_str().unwrap())
            })
            .expect("preview vault should be registered");

        assert_eq!(
            preview.pointer("/ts").and_then(serde_json::Value::as_u64),
            Some(42)
        );
        assert_eq!(
            preview
                .pointer("/open")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn registers_only_the_current_lifemind_preview_vault() {
        let current = PathBuf::from("/tmp/lifemind-review-current-vault/batch-current");
        let content = upsert_obsidian_preview_vault_config(
            r#"{"vaults":{
              "real":{"path":"/Users/a0000/obsidian/mind","ts":1,"open":true},
              "old-a":{"path":"/tmp/lifemind-review-current-vault/batch-old-a","ts":2,"open":true},
              "old-b":{"path":"/tmp/lifemind-review-current-vault/batch-old-b","ts":3}
            }}"#,
            &current,
            42,
        )
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let vaults = parsed.pointer("/vaults").unwrap().as_object().unwrap();

        assert!(vaults.contains_key("real"));
        assert!(!vaults.contains_key("old-a"));
        assert!(!vaults.contains_key("old-b"));
        assert_eq!(
            vaults
                .values()
                .filter(|value| value
                    .pointer("/path")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|path| path.contains("lifemind-review-current-vault")))
                .count(),
            1
        );
    }

    #[test]
    fn discards_only_lifemind_batch_preview_roots() {
        let root = std::env::temp_dir()
            .join(format!(
                "lifemind-review-current-vault-discard-{}",
                std::process::id()
            ))
            .join("batch-discard");
        let root_string = root.to_string_lossy().to_string();
        let file = root.join("00-审理确认总览.md");
        let _ = fs::remove_dir_all(root.parent().unwrap());
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "# old").unwrap();

        discard_preview_root(&root_string).unwrap();

        assert!(!root.exists());

        let unsafe_root = std::env::temp_dir().join(format!("not-lifemind-{}", std::process::id()));
        let unsafe_string = unsafe_root.to_string_lossy().to_string();
        fs::create_dir_all(&unsafe_root).unwrap();

        assert!(discard_preview_root(&unsafe_string).is_err());
        assert!(unsafe_root.exists());

        let _ = fs::remove_dir_all(root.parent().unwrap());
        let _ = fs::remove_dir_all(unsafe_root);
    }

    #[test]
    fn confirms_batch_and_removes_new_files_on_undo() {
        let root = test_root("confirm-remove-new");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let manifest = commit_review_batch_files(
            &root_string,
            "batch-test-new",
            &[VaultWriteFilePayload {
                path: "Java/Java基础语法/输入与输出/Java 控制台输出.md".to_string(),
                content: "# Java 控制台输出".to_string(),
                note_id: "note-java".to_string(),
                title: "Java 控制台输出".to_string(),
                binary: false,
            }],
        )
        .unwrap();

        assert_eq!(manifest.status, "confirmed");
        assert!(root
            .join("Java/Java基础语法/输入与输出/Java 控制台输出.md")
            .exists());
        assert!(root
            .join(".lifemind/batches/batch-test-new/manifest.json")
            .exists());

        let removed = rollback_review_batch_files(&root_string, "batch-test-new").unwrap();

        assert_eq!(removed.status, "removed");
        assert!(!root
            .join("Java/Java基础语法/输入与输出/Java 控制台输出.md")
            .exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn confirms_batch_and_restores_overwritten_files_on_undo() {
        let root = test_root("confirm-restore-existing");
        let root_string = root.to_string_lossy().to_string();
        let target = root.join("Python/Python基础语法/列表/Python 列表 append.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "旧内容").unwrap();

        commit_review_batch_files(
            &root_string,
            "batch-test-existing",
            &[VaultWriteFilePayload {
                path: "Python/Python基础语法/列表/Python 列表 append.md".to_string(),
                content: "新内容".to_string(),
                note_id: "note-python".to_string(),
                title: "Python 列表 append".to_string(),
                binary: false,
            }],
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "新内容");

        rollback_review_batch_files(&root_string, "batch-test-existing").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "旧内容");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn confirms_batch_moves_existing_topic_note_and_rolls_it_back() {
        let root = test_root("confirm-move-existing-topic");
        let root_string = root.to_string_lossy().to_string();
        let existing = root.join("TI嵌入式/MSPM0G3507/PWM.md");
        let moved = root.join("TI嵌入式/MSPM0G3507/PWM/PWM.md");
        let generated = root.join("TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(existing.parent().unwrap()).unwrap();
        fs::write(&existing, "# PWM\n旧 PWM 内容").unwrap();

        let manifest = commit_review_batch_operations(
            &root_string,
            "batch-test-move-topic",
            &[VaultWriteFilePayload {
                path: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md".to_string(),
                content: "粒度：小颗粒度\n上级主题：[[PWM]]".to_string(),
                note_id: "note-pwm-modes".to_string(),
                title: "PWM 计数模式".to_string(),
                binary: false,
            }],
            &[VaultMoveFilePayload {
                from_path: "TI嵌入式/MSPM0G3507/PWM.md".to_string(),
                to_path: "TI嵌入式/MSPM0G3507/PWM/PWM.md".to_string(),
                note_id: "promote-existing-topic-pwm".to_string(),
                title: "PWM".to_string(),
                reason: "测试主题升级".to_string(),
            }],
        )
        .unwrap();

        assert_eq!(manifest.status, "confirmed");
        assert!(!existing.exists());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "# PWM\n旧 PWM 内容");
        assert_eq!(
            fs::read_to_string(&generated).unwrap(),
            "粒度：小颗粒度\n上级主题：[[PWM]]"
        );
        assert_eq!(
            manifest
                .files
                .iter()
                .filter(|record| record.operation == "move")
                .count(),
            1
        );

        rollback_review_batch_files(&root_string, "batch-test-move-topic").unwrap();

        assert_eq!(fs::read_to_string(&existing).unwrap(), "# PWM\n旧 PWM 内容");
        assert!(!moved.exists());
        assert!(!generated.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_duplicate_batch_operation_targets_before_writing() {
        let root = test_root("reject-duplicate-targets");
        let root_string = root.to_string_lossy().to_string();
        let target = root.join("TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let result = commit_review_batch_operations(
            &root_string,
            "batch-test-duplicate-targets",
            &[
                VaultWriteFilePayload {
                    path: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md".to_string(),
                    content: "第一篇".to_string(),
                    note_id: "note-a".to_string(),
                    title: "PWM 计数模式".to_string(),
                    binary: false,
                },
                VaultWriteFilePayload {
                    path: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md".to_string(),
                    content: "第二篇".to_string(),
                    note_id: "note-b".to_string(),
                    title: "PWM 计数模式".to_string(),
                    binary: false,
                },
            ],
            &[],
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("重复"));
        assert!(!target.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn confirms_logic_link_updates_append_successors_and_rolls_back() {
        let root = test_root("confirm-logic-links");
        let root_string = root.to_string_lossy().to_string();
        let parent = root.join("TI嵌入式/MSPM0G3507/PWM/PWM.md");
        let child = root.join("TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(parent.parent().unwrap()).unwrap();
        fs::write(&parent, "粒度：中颗粒度\n\n## 正文\n- PWM 是脉宽调制。").unwrap();
        fs::write(&child, "粒度：小颗粒度\n\n## 正文\n- PWM 计数模式。").unwrap();

        let manifest = confirm_logic_link_update_files(
            &root_string,
            "batch-test-logic-links",
            &[LogicLinkUpdatePayload {
                parent_path: "TI嵌入式/MSPM0G3507/PWM/PWM.md".to_string(),
                parent_title: "PWM".to_string(),
                child_title: "PWM 计数模式".to_string(),
                child_path: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md".to_string(),
                reason: "测试逻辑连接".to_string(),
            }],
        )
        .unwrap();

        assert_eq!(manifest.status, "confirmed");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].operation, "write");
        assert!(fs::read_to_string(&parent)
            .unwrap()
            .contains("## 后续枝节\n- [[PWM 计数模式]]"));

        rollback_review_batch_files(&root_string, "batch-test-logic-links").unwrap();

        assert_eq!(
            fs::read_to_string(&parent).unwrap(),
            "粒度：中颗粒度\n\n## 正文\n- PWM 是脉宽调制。"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn logic_link_updates_do_not_duplicate_existing_successor_links() {
        let content = "## 正文\n- PWM。\n\n## 后续枝节\n- [[PWM 计数模式]]";
        let updated = merge_successor_links(
            content,
            &["PWM 计数模式".to_string(), "PWM 占空比".to_string()],
        );

        assert_eq!(
            updated,
            "## 正文\n- PWM。\n\n## 后续枝节\n- [[PWM 计数模式]]\n- [[PWM 占空比]]"
        );
    }

    #[test]
    fn rejects_vault_write_paths_that_escape_root() {
        let root = test_root("reject-escape");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);

        let result = commit_review_batch_files(
            &root_string,
            "batch-test-escape",
            &[VaultWriteFilePayload {
                path: "../escape.md".to_string(),
                content: "bad".to_string(),
                note_id: "bad".to_string(),
                title: "bad".to_string(),
                binary: false,
            }],
        );

        assert!(result.is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_existing_obsidian_vault_as_writable() {
        let root = test_root("validate-good-vault");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".obsidian")).unwrap();

        let inspection = inspect_vault_root(&root_string);

        assert!(inspection.exists);
        assert!(inspection.is_dir);
        assert!(inspection.has_obsidian_config);
        assert!(inspection.can_write);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_plain_folder_without_obsidian_config_as_warning() {
        let root = test_root("validate-plain-folder");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let inspection = inspect_vault_root(&root_string);

        assert!(inspection.exists);
        assert!(inspection.is_dir);
        assert!(!inspection.has_obsidian_config);
        assert!(inspection.can_write);
        assert!(inspection.message.contains(".obsidian"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_missing_vault_path_as_not_writable() {
        let root = test_root("validate-missing");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);

        let inspection = inspect_vault_root(&root_string);

        assert!(!inspection.exists);
        assert!(!inspection.is_dir);
        assert!(!inspection.can_write);
    }

    #[test]
    fn inspects_vault_write_plan_for_new_and_existing_files() {
        let root = test_root("inspect-write-plan");
        let root_string = root.to_string_lossy().to_string();
        let existing = root.join("Git/Git工具/Git 工具总览.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(existing.parent().unwrap()).unwrap();
        fs::write(&existing, "# 旧总览\n旧内容").unwrap();

        let plan = inspect_vault_write_files(
            &root_string,
            &[
                VaultWriteFilePayload {
                    path: "Git/Git工具/Git 工具总览.md".to_string(),
                    content: "# 新总览".to_string(),
                    note_id: "note-git-overview".to_string(),
                    title: "Git 工具总览".to_string(),
                    binary: false,
                },
                VaultWriteFilePayload {
                    path: "Git/Git工具/基本概念/Git 工具基本概念.md".to_string(),
                    content: "# 基本概念".to_string(),
                    note_id: "note-git-concept".to_string(),
                    title: "Git 工具基本概念".to_string(),
                    binary: false,
                },
            ],
        )
        .unwrap();

        assert_eq!(plan.new_count, 1);
        assert_eq!(plan.overwrite_count, 1);
        assert_eq!(plan.files[0].path, "Git/Git工具/Git 工具总览.md");
        assert!(plan.files[0].exists);
        assert!(plan.files[0]
            .existing_preview
            .as_deref()
            .unwrap()
            .contains("旧总览"));
        assert!(!plan.files[1].exists);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_vault_knowledge_context_without_private_system_dirs() {
        let root = test_root("scan-vault-knowledge");
        let root_string = root.to_string_lossy().to_string();
        let gpio = root.join("嵌入式/GPIO/GPIO 接口.md");
        let delay = root.join("嵌入式/系统时序/系统延时.md");
        let hidden = root.join(".lifemind/batches/batch-old/manifest.md");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(gpio.parent().unwrap()).unwrap();
        fs::create_dir_all(delay.parent().unwrap()).unwrap();
        fs::create_dir_all(hidden.parent().unwrap()).unwrap();
        fs::write(
            &gpio,
            "# GPIO 接口\n\n粒度：中颗粒度\n\n## 基本概念\nGPIO 用于通用输入输出，常配合 [[系统延时]] 等待外设稳定。\n\n## 寄存器配置\n配置模式。",
        )
        .unwrap();
        fs::write(
            &delay,
            "# 系统延时\n\n上级主题：[[嵌入式]]\n前置知识：[[GPIO 接口]]\n\n## 应用场景\n等待外设状态稳定。",
        )
        .unwrap();
        fs::write(&hidden, "# 不应进入索引").unwrap();

        let context = scan_vault_knowledge_files(&root_string).unwrap();

        assert_eq!(context.roots.len(), 1);
        assert_eq!(context.roots[0].name, "嵌入式");
        assert_eq!(context.roots[0].note_count, 2);
        assert!(context.roots[0].paths.contains(&"嵌入式/GPIO".to_string()));
        assert!(context.notes.iter().any(|note| note.title == "GPIO 接口"
            && note.root == "嵌入式"
            && note.headings.contains(&"基本概念".to_string())
            && note.snippet.contains("GPIO 用于通用输入输出")));
        assert!(context
            .notes
            .iter()
            .all(|note| !note.path.contains(".lifemind")));
        assert!(context
            .relations
            .iter()
            .any(|relation| relation.relation_type == "双链"
                && relation.source == "GPIO 接口"
                && relation.target == "系统延时"));
        assert!(context
            .relations
            .iter()
            .any(|relation| relation.relation_type == "前置知识"
                && relation.source == "系统延时"
                && relation.target == "GPIO 接口"));
        assert!(context
            .relations
            .iter()
            .any(|relation| relation.relation_type == "包含"
                && relation.source == "嵌入式"
                && relation.target == "系统延时"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_vault_knowledge_beyond_the_old_small_index_cap() {
        let root = test_root("scan-vault-knowledge-large");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);

        for index in 0..180 {
            let note = root.join(format!("TI嵌入式/MSPM0G3507/术语/术语-{index:03}.md"));
            fs::create_dir_all(note.parent().unwrap()).unwrap();
            fs::write(&note, format!("# 术语 {index:03}\n\n## 定义\n测试术语。")).unwrap();
        }

        let context = scan_vault_knowledge_files(&root_string).unwrap();

        assert!(context.notes.len() >= 180);
        assert!(context
            .notes
            .iter()
            .any(|note| note.title == "术语 179" && note.path.contains("术语-179.md")));
        assert!(context
            .roots
            .iter()
            .any(|root| root.paths.contains(&"TI嵌入式/MSPM0G3507/术语".to_string())));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_batch_manifests_with_counts_newest_first() {
        let root = test_root("list-batches");
        let root_string = root.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&root);

        write_manifest(
            &root.join(".lifemind/batches/batch-old/manifest.json"),
            &BatchManifest {
                batch_id: "batch-old".to_string(),
                status: "removed".to_string(),
                committed_at: "100".to_string(),
                files: vec![BatchFileRecord {
                    operation: "write".to_string(),
                    path: "A.md".to_string(),
                    from_path: None,
                    backup_path: None,
                    existed_before: false,
                    note_id: "a".to_string(),
                    title: "A".to_string(),
                    reason: None,
                }],
            },
        )
        .unwrap();
        write_manifest(
            &root.join(".lifemind/batches/batch-new/manifest.json"),
            &BatchManifest {
                batch_id: "batch-new".to_string(),
                status: "confirmed".to_string(),
                committed_at: "200".to_string(),
                files: vec![
                    BatchFileRecord {
                        operation: "write".to_string(),
                        path: "B.md".to_string(),
                        from_path: None,
                        backup_path: Some(".lifemind/batches/batch-new/backups/B.md".to_string()),
                        existed_before: true,
                        note_id: "b".to_string(),
                        title: "B".to_string(),
                        reason: None,
                    },
                    BatchFileRecord {
                        operation: "write".to_string(),
                        path: "C.md".to_string(),
                        from_path: None,
                        backup_path: None,
                        existed_before: false,
                        note_id: "c".to_string(),
                        title: "C".to_string(),
                        reason: None,
                    },
                ],
            },
        )
        .unwrap();

        let summaries = list_batch_manifests(&root_string).unwrap();

        assert_eq!(
            summaries
                .iter()
                .map(|item| item.batch_id.as_str())
                .collect::<Vec<_>>(),
            vec!["batch-new", "batch-old",]
        );
        assert_eq!(summaries[0].file_count, 2);
        assert_eq!(summaries[0].created_count, 1);
        assert_eq!(summaries[0].overwritten_count, 1);
        assert_eq!(summaries[1].status, "removed");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extracts_title_and_readable_text_from_static_html() {
        let html = r#"
      <!doctype html>
      <html>
        <head>
          <title>Git &amp; 团队协作</title>
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <nav>导航不应进入正文</nav>
          <article>
            <h1>Git 基本概念</h1>
            <p>main 分支用于稳定代码。</p>
            <script>console.log("ignore")</script>
            <p>Pull Request 用于合并评审。</p>
          </article>
        </body>
      </html>
    "#;

        assert_eq!(extract_html_title(html).as_deref(), Some("Git & 团队协作"));

        let text = html_to_readable_text(html);

        assert!(text.contains("Git 基本概念"));
        assert!(text.contains("main 分支用于稳定代码。"));
        assert!(text.contains("Pull Request 用于合并评审。"));
        assert!(!text.contains("导航不应进入正文"));
        assert!(!text.contains("console.log"));
    }

    #[test]
    fn validates_provider_keys_before_using_keychain() {
        assert_eq!(safe_provider_key("deepseek").unwrap(), "deepseek");
        assert!(safe_provider_key("openai-compatible").is_err());
        assert!(safe_provider_key("../bad").is_err());
        assert!(safe_provider_key("").is_err());
    }

    #[test]
    fn strips_file_extension_for_extracted_pdf_titles() {
        assert_eq!(strip_extension("Git 团队协作.pdf"), "Git 团队协作");
        assert_eq!(strip_extension("archive.note.v1.pdf"), "archive.note.v1");
        assert_eq!(strip_extension(""), "未命名 PDF");
    }

    #[test]
    fn detects_noisy_handwritten_pdf_text_layer() {
        let noisy = "STM 2B 基于 ARMcortexM ⾁ 核，串叫 VABT 1 下载，MCV 开发板，(cid:15482)";
        let clean = "STM32 基于 ARM Cortex-M 内核，UART 用于串口通信。";

        assert!(is_low_quality_pdf_text_layer(noisy));
        assert!(!is_low_quality_pdf_text_layer(clean));
    }

    #[test]
    fn detects_pid_handwritten_pdf_text_noise() {
        let noisy = "PI1 D→一种闭环控制算法，PI口 输出同时可获取反馈，ontt)= kp* xrror(t)。";

        assert!(is_low_quality_pdf_text_layer(noisy));
    }

    #[test]
    fn detects_linearized_formula_text_as_low_quality() {
        let noisy = "E[xiu) =Ʃ| xuP\nPEx(n)=□x(n) / N";

        assert!(is_low_quality_pdf_text_layer(noisy));
        assert!(build_pdf_review_content("公式讲义", noisy, true).contains("页面视觉证据"));
    }

    #[test]
    fn excludes_noisy_pdf_text_from_model_content_without_ocr() {
        let content = build_pdf_review_content(
            "数字信号处理",
            "STM 2B 基于 ARMcortexM ⾁ 核，串叫 VABT 1 下载。",
            true,
        );

        assert!(!content.contains("STM 2B 基于"));
        assert!(content.contains("PDF 页面视觉证据"));
    }

    #[test]
    fn rejects_noisy_pdf_text_when_page_rendering_failed() {
        let content = build_pdf_review_content(
            "数字信号处理",
            "STM 2B 基于 ARMcortexM ⾁ 核，串叫 VABT 1 下载。",
            false,
        );

        assert!(content.is_empty());
    }

    #[test]
    fn groups_pdf_ocr_lines_into_visual_blocks() {
        let page = PdfOcrPage {
            page: 1,
            lines: vec![
                PdfOcrLine {
                    text: "PID 是闭环控制算法".to_string(),
                    x: 0.10,
                    y: 0.90,
                    width: 0.60,
                    height: 0.03,
                    confidence: 0.9,
                },
                PdfOcrLine {
                    text: "P 比例项只和当前误差有关".to_string(),
                    x: 0.12,
                    y: 0.84,
                    width: 0.70,
                    height: 0.03,
                    confidence: 0.9,
                },
                PdfOcrLine {
                    text: "I 积分项用于消除稳态误差".to_string(),
                    x: 0.12,
                    y: 0.62,
                    width: 0.72,
                    height: 0.03,
                    confidence: 0.9,
                },
            ],
            image_width: 0,
            image_height: 0,
            image_data_url: None,
        };

        let blocks = group_ocr_page_blocks(&page);

        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[0].lines,
            vec!["PID 是闭环控制算法", "P 比例项只和当前误差有关"]
        );
        assert_eq!(blocks[1].lines, vec!["I 积分项用于消除稳态误差"]);
    }

    #[test]
    fn builds_pdf_content_with_ocr_page_structure_and_text_layer() {
        let ocr = PdfOcrDocument {
            pages: vec![PdfOcrPage {
                page: 1,
                lines: vec![PdfOcrLine {
                    text: "GPIO 通用输入输出端口".to_string(),
                    x: 0.1,
                    y: 0.9,
                    width: 0.5,
                    height: 0.03,
                    confidence: 0.88,
                }],
                image_width: 0,
                image_height: 0,
                image_data_url: None,
            }],
        };
        let content = build_pdf_extracted_content("STM32", "STM 2B 通用输⼊输出", Some(&ocr));

        assert!(content.contains("本地 Vision OCR 页面结构"));
        assert!(content.contains("## 第 1 页"));
        assert!(content.contains("GPIO 通用输入输出端口"));
        assert!(content.contains("PDF 文本层抽取"));
        assert!(content.contains("低质量 PDF 文本层已省略"));
        assert!(!content.contains("STM 2B 通用输⼊输出"));
    }

    #[test]
    fn formats_pdf_text_layer_with_page_boundaries() {
        let document = PdfTextDocument {
            pages: vec![
                PdfTextPage {
                    page: 1,
                    text: "  STM32 GPIO 基础  ".to_string(),
                },
                PdfTextPage {
                    page: 2,
                    text: "".to_string(),
                },
                PdfTextPage {
                    page: 3,
                    text: "PID 闭环控制".to_string(),
                },
            ],
        };

        let text = format_pdf_text_layer(&document);

        assert!(text.contains("## 第 1 页\nSTM32 GPIO 基础"));
        assert!(!text.contains("## 第 2 页"));
        assert!(text.contains("## 第 3 页\nPID 闭环控制"));
    }

    #[test]
    fn includes_ocr_candidate_evidence_for_ambiguous_regions() {
        let ocr = PdfOcrDocument {
            pages: vec![PdfOcrPage {
                page: 1,
                lines: vec![
                    PdfOcrLine {
                        text: "PI7 一种闭环控制算法".to_string(),
                        x: 0.1,
                        y: 0.9,
                        width: 0.5,
                        height: 0.03,
                        confidence: 0.58,
                    },
                    PdfOcrLine {
                        text: "PID 一种闭环控制算法".to_string(),
                        x: 0.11,
                        y: 0.905,
                        width: 0.5,
                        height: 0.03,
                        confidence: 0.81,
                    },
                ],
                image_width: 0,
                image_height: 0,
                image_data_url: None,
            }],
        };

        let content = build_pdf_extracted_content("PID", "", Some(&ocr));

        assert!(content.contains("【OCR 候选证据】"));
        assert!(content.contains("选定：PID 一种闭环控制算法"));
        assert!(content.contains("PI7 一种闭环控制算法 -> PID 一种闭环控制算法"));
        assert!(content.contains("置信度 0.58"));
    }

    #[test]
    fn omits_low_value_ocr_candidate_evidence_without_terms_or_corrections() {
        let ocr = PdfOcrDocument {
            pages: vec![PdfOcrPage {
                page: 1,
                lines: vec![
                    PdfOcrLine {
                        text: "能快速准确稳定地跟踪目标值".to_string(),
                        x: 0.1,
                        y: 0.9,
                        width: 0.5,
                        height: 0.03,
                        confidence: 0.58,
                    },
                    PdfOcrLine {
                        text: "能快速唯确稳定地跟踪目不值".to_string(),
                        x: 0.11,
                        y: 0.905,
                        width: 0.5,
                        height: 0.03,
                        confidence: 0.56,
                    },
                ],
                image_width: 0,
                image_height: 0,
                image_data_url: None,
            }],
        };

        let content = build_pdf_extracted_content("PID", "", Some(&ocr));

        assert!(!content.contains("【OCR 候选证据】"));
    }

    #[test]
    fn corrects_common_embedded_ocr_technical_term_noise() {
        let corrected = correct_ocr_technical_terms(
            "GTLO=通用输入输出端口，HAL_CPIO_ReadPin 读取，5TM32 控制 GPZD 上下拉，PII 闭环控制。",
        );

        assert!(corrected.contains("GPIO=通用输入输出端口"));
        assert!(corrected.contains("HAL_GPIO_ReadPin"));
        assert!(corrected.contains("STM32 控制 GPIO 上下拉"));
        assert!(corrected.contains("PID 闭环控制"));

        let corrected =
            correct_ocr_technical_terms("PI7-2一种闭环控制算法，sTMI3V 控制 GPiO，UARTl串口");

        assert!(corrected.contains("PID-2一种闭环控制算法"));
        assert!(corrected.contains("STM32 控制 GPIO"));
        assert!(corrected.contains("UART1串口"));
    }

    #[test]
    fn corrects_handwritten_embedded_chinese_and_code_noise() {
        let corrected = correct_ocr_technical_terms(
            "事口通讯，EXTI一外部申断，TIN_ClearITRendingBit，tloat Target，whike（1），if 为 SBT",
        );

        assert!(corrected.contains("串口通讯"));
        assert!(corrected.contains("EXTI一外部中断"));
        assert!(corrected.contains("TIM_ClearITPendingBit"));
        assert!(corrected.contains("float Target"));
        assert!(corrected.contains("while（1）"));
        assert!(corrected.contains("if 为 SET"));

        let corrected = correct_ocr_technical_terms("_WritePin（GPIOA, LED_Pin, GPIO_PIN_SET）");

        assert!(corrected.starts_with("HAL_GPIO_WritePin"));
    }

    #[test]
    fn stitches_split_hal_gpio_function_prefixes() {
        let page = PdfOcrPage {
            page: 1,
            lines: vec![
                PdfOcrLine {
                    text: "HAL_GPIO.".to_string(),
                    x: 0.10,
                    y: 0.80,
                    width: 0.20,
                    height: 0.03,
                    confidence: 0.70,
                },
                PdfOcrLine {
                    text: "_WritePin（GPIOA, LED_Pin, GPIO_PIN_SET）".to_string(),
                    x: 0.12,
                    y: 0.765,
                    width: 0.68,
                    height: 0.03,
                    confidence: 0.72,
                },
            ],
            image_width: 0,
            image_height: 0,
            image_data_url: None,
        };

        let merged = merge_ocr_page_lines(&page);

        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].text,
            "HAL_GPIO_WritePin（GPIOA, LED_Pin, GPIO_PIN_SET）"
        );
    }

    #[test]
    fn merges_repeated_ocr_candidates_from_the_same_visual_region() {
        let page = PdfOcrPage {
            page: 1,
            lines: vec![
                PdfOcrLine {
                    text: "GTLO=通用输入输出端口".to_string(),
                    x: 0.10,
                    y: 0.80,
                    width: 0.50,
                    height: 0.04,
                    confidence: 0.63,
                },
                PdfOcrLine {
                    text: "GPIO=通用输入输出端口".to_string(),
                    x: 0.10,
                    y: 0.805,
                    width: 0.51,
                    height: 0.04,
                    confidence: 0.88,
                },
                PdfOcrLine {
                    text: "HAL_CPIO_ReadPin 读取按键".to_string(),
                    x: 0.12,
                    y: 0.70,
                    width: 0.60,
                    height: 0.04,
                    confidence: 0.72,
                },
            ],
            image_width: 0,
            image_height: 0,
            image_data_url: None,
        };

        let merged = merge_ocr_page_lines(&page);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].text, "GPIO=通用输入输出端口");
        assert_eq!(merged[1].text, "HAL_GPIO_ReadPin 读取按键");
    }

    #[test]
    fn includes_ocr_postprocess_guidance_in_pdf_content() {
        let ocr = PdfOcrDocument {
            pages: vec![PdfOcrPage {
                page: 1,
                lines: vec![PdfOcrLine {
                    text: "GPZD的上下拉".to_string(),
                    x: 0.1,
                    y: 0.9,
                    width: 0.4,
                    height: 0.03,
                    confidence: 0.5,
                }],
                image_width: 0,
                image_height: 0,
                image_data_url: None,
            }],
        };

        let content = build_pdf_extracted_content("STM32", "", Some(&ocr));

        assert!(content.contains("OCR 后处理"));
        assert!(content.contains("GPIO的上下拉"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn vision_ocr_script_runs_multiple_image_variants_per_page() {
        assert!(VISION_OCR_SWIFT_SCRIPT.contains("ocrImageVariants"));
        assert!(VISION_OCR_SWIFT_SCRIPT.contains("for variant in ocrImageVariants"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pdf_text_layer_script_is_page_capped_and_json_encoded() {
        assert!(PDF_TEXT_SWIFT_SCRIPT.contains("PDFKit"));
        assert!(PDF_TEXT_SWIFT_SCRIPT.contains("let maxPages = min(document.pageCount, 80)"));
        assert!(PDF_TEXT_SWIFT_SCRIPT.contains("page.string"));
        assert!(PDF_TEXT_SWIFT_SCRIPT.contains("JSONEncoder().encode"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pdf_page_renderer_is_independent_of_vision_ocr() {
        assert!(PDF_PAGE_RENDER_SWIFT_SCRIPT.contains("PDFKit"));
        assert!(PDF_PAGE_RENDER_SWIFT_SCRIPT.contains("imageDataUrl"));
        assert!(PDF_PAGE_RENDER_SWIFT_SCRIPT.contains("let maxPages = min(document.pageCount, 80)"));
        assert!(!PDF_PAGE_RENDER_SWIFT_SCRIPT.contains("import Vision"));
        assert!(!PDF_PAGE_RENDER_SWIFT_SCRIPT.contains("VNRecognizeTextRequest"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn terminates_a_stuck_ocr_process_instead_of_waiting_forever() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sleep 2")
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let started_at = std::time::Instant::now();

        let result = run_command_with_timeout(command, Duration::from_millis(80), "测试 OCR");

        assert!(result.is_err());
        assert!(started_at.elapsed() < Duration::from_secs(1));
        assert!(result.unwrap_err().contains("超时"));
    }

    #[test]
    #[ignore]
    fn probes_local_pdf_page_rendering_without_model_ocr() {
        let path = std::env::var("LIFEMIND_OCR_TEST_PDF")
            .expect("set LIFEMIND_OCR_TEST_PDF to a local PDF path");
        let bytes = fs::read(&path).unwrap();
        let file_name = Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("ocr-probe.pdf")
            .to_string();

        let extracted = extract_pdf_text(PdfExtractPayload { file_name, bytes }).unwrap();
        let pages = extracted.pdf_evidence.as_ref().unwrap().pages.as_slice();

        assert_eq!(pages.len(), 7);
        assert!(pages.iter().all(|page| page.image_review_required));
        assert!(pages.iter().all(|page| page.image_data_url.is_some()));
        assert_eq!(extracted.pdf_text_layer_low_quality, Some(true));
        assert!(pages.iter().all(|page| page.evidence.is_empty()));
        assert!(extracted.content.contains("PDF 页面视觉证据"));
        println!(
            "{} 页均具有独立渲染图，模型正文已排除 OCR 文本。",
            pages.len()
        );
        assert!(!extracted.content.trim().is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn probes_local_pdf_ocr_as_manual_diagnostic_only() {
        let path = std::env::var("LIFEMIND_OCR_TEST_PDF")
            .expect("set LIFEMIND_OCR_TEST_PDF to a local PDF path");
        let bytes = fs::read(&path).unwrap();
        let file_name = Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("ocr-probe.pdf")
            .to_string();
        let ocr = extract_pdf_ocr_with_vision(&bytes, &file_name).unwrap();
        let line_count = ocr.pages.iter().map(|page| page.lines.len()).sum::<usize>();
        let image_count = ocr
            .pages
            .iter()
            .filter(|page| page.image_data_url.is_some())
            .count();

        assert!(line_count > 0);
        println!(
            "诊断 OCR 识别到 {line_count} 行，并生成 {image_count} 张图；正式审理链路不会调用 OCR。"
        );
    }

    #[test]
    fn path_based_pdf_extraction_rejects_non_pdf_files() {
        let root = test_root("path-pdf-non-pdf");
        fs::create_dir_all(&root).unwrap();
        let text_path = root.join("note.txt");
        fs::write(&text_path, "not a pdf").unwrap();

        let result = extract_pdf_text_from_path(text_path.to_string_lossy().to_string());

        assert!(result.is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn path_based_pdf_extraction_rejects_missing_files() {
        let missing = test_root("path-pdf-missing").join("missing.pdf");

        let result = extract_pdf_text_from_path(missing.to_string_lossy().to_string());

        assert!(result.is_err());
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lifemind-{name}-{}", std::process::id()))
    }
}
