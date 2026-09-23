"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ArchiveRestore from "lucide-react/dist/esm/icons/archive-restore.mjs";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock.mjs";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2.mjs";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import FileInput from "lucide-react/dist/esm/icons/file-input.mjs";
import GitBranch from "lucide-react/dist/esm/icons/git-branch.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import NotebookTabs from "lucide-react/dist/esm/icons/notebook-tabs.mjs";
import ScanLine from "lucide-react/dist/esm/icons/scan-line.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import UploadCloud from "lucide-react/dist/esm/icons/upload-cloud.mjs";
import WandSparkles from "lucide-react/dist/esm/icons/wand-sparkles.mjs";
import XCircle from "lucide-react/dist/esm/icons/x-circle.mjs";
import { Dock, DockIcon, DockItem, DockLabel } from "@/components/ui/dock";
import { LifemindMark } from "@/components/lifemind-mark";
import { motion, AnimatePresence } from "@/lib/simple-motion";
import {
  buildBatchPreviewRoot,
  buildPreviewFiles,
  buildVaultMoveFiles,
  buildVaultWriteFiles,
  preparePdfExtractedContent,
  type BatchStatus,
  type IntakeSource,
  type IntakeSourceType,
  type PreviewFile,
  type ReviewBatch,
  type VaultKnowledgeContext,
} from "@/lib/lifemind-core";
import {
  getReviewModelProviderPreset,
  createDeepSeekLogicLinkModelRequest,
  reviewModelProviderPresets,
  runReviewSkill,
  testReviewSkillConnection,
  type OpenAICompatibleModelRequest,
  type ReviewModelInvocation,
  type ReviewSkillProvider,
  type ReviewUsageSummary,
} from "@/lib/lifemind-review-runner";
import {
  buildLogicLinkPayload,
  buildLogicLinkPreviewFiles,
  createLocalLogicLinkUpdateDraft,
  mergeLogicLinkModelOutput,
  parseLogicLinkModelOutput,
  type LogicLinkUpdateDraft,
  type LogicLinkUpdateRange,
} from "@/lib/lifemind-link-update";

const navItems = [
  { label: "入库", icon: FileInput },
  { label: "审理", icon: WandSparkles },
  { label: "扫描", icon: ScanLine },
  { label: "设置", icon: Settings2 },
] as const;

type NavLabel = "入库" | "审理" | "扫描" | "设置";

const intakeTabs = ["上传内容", "AI 结果", "Obsidian 预览"];
const reviewTabs = ["上传内容", "AI 结果", "Obsidian 预览"];
type PreviewState = "idle" | "opening" | "opened" | "failed";
type VaultCheckState = "idle" | "checking" | "checked" | "failed";

const previewVault = {
  name: "lifemindreview01",
  root: "/Users/a0000/Documents/obsidian项目/lifemind-review-current-vault",
  indexFile: "00-审理确认总览.md",
};

const vaultPathStorageKey = "lifemind.vaultPath";
const reviewProviderStorageKey = "lifemind.reviewProvider";
const modelBaseUrlStorageKey = "lifemind.modelBaseUrl";
const modelNameStorageKey = "lifemind.modelName";
const modelFallbackStorageKey = "lifemind.modelFallbackToLocal";

type TransactionState = "idle" | "writing" | "written" | "undoing" | "undone" | "failed";
type ReviewRunState = "idle" | "reviewing" | "failed";
type KeychainState = "idle" | "loading" | "saved" | "failed";
type ApiTestState = "idle" | "testing" | "passed" | "failed";

type VaultInspection = {
  path: string;
  exists: boolean;
  isDir: boolean;
  hasObsidianConfig: boolean;
  canWrite: boolean;
  message: string;
};

type BatchManifest = {
  batchId: string;
  status: string;
  committedAt: string;
  files: Array<{
    operation?: "write" | "move";
    path: string;
    fromPath?: string | null;
    backupPath: string | null;
    existedBefore: boolean;
    noteId: string;
    title: string;
    reason?: string | null;
  }>;
};

type BatchManifestSummary = {
  batchId: string;
  status: string;
  committedAt: string;
  fileCount: number;
  createdCount: number;
  overwrittenCount: number;
  movedCount?: number;
};

type VaultWritePlanFile = {
  path: string;
  title: string;
  noteId: string;
  exists: boolean;
  existingSize: number | null;
  existingPreview: string | null;
};

type VaultMovePlanFile = {
  fromPath: string;
  toPath: string;
  title: string;
  noteId: string;
  reason: string;
  sourceExists: boolean;
  targetExists: boolean;
};

type VaultWritePlan = {
  files: VaultWritePlanFile[];
  moves: VaultMovePlanFile[];
  newCount: number;
  overwriteCount: number;
  moveCount: number;
};

type ExtractedContent = {
  title: string;
  content: string;
  sourceType: IntakeSourceType;
};

type PendingFileItem = {
  id: string;
  title: string;
  type: IntakeSourceType;
  sizeLabel: string;
  origin: "desktop-path" | "browser-file";
  path?: string;
  file?: File;
};

const pageMeta: Record<
  NavLabel,
  { eyebrow: string; title: string; metrics: string[]; panelTitle: string }
> = {
  入库: {
    eyebrow: "等待上传学习材料",
    title: "把文本和 Markdown 转成可审阅的 Obsidian 入库批次。",
    metrics: ["文本输入", "Markdown", "人工确认"],
    panelTitle: "上传内容 / AI 结果 / 预览",
  },
  审理: {
    eyebrow: "AI 审理结果等待确认",
    title: "把零散学习笔记整理成可跳转的 Obsidian 知识结构。",
    metrics: ["3 篇笔记", "1 条纠错", "4 条关系"],
    panelTitle: "审理结果 / 纠错 / 预览",
  },
  扫描: {
    eyebrow: "全库关系维护",
    title: "按时间范围扫描已入库笔记，补全父笔记里的后续枝节链接。",
    metrics: ["时间排序", "LLM 复审", "确认写入"],
    panelTitle: "逻辑连接更新",
  },
  设置: {
    eyebrow: "本地配置",
    title: "配置 Vault、审理 Skill、模型接入和隐私边界。",
    metrics: ["Vault 已选择", "Skill 已启用", "模型未启用"],
    panelTitle: "设置",
  },
};

type LogicLinkRangePreset = "1d" | "7d" | "30d" | "all";
type LogicLinkRunState = "idle" | "scanning" | "reviewing" | "ready" | "confirming" | "confirmed" | "failed";

export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourcePathHandlerRef = useRef<(paths: string[]) => void>(() => undefined);
  const previewRequestRef = useRef(0);
  const [activeNav, setActiveNav] = useState<NavLabel>("入库");
  const [activeTab, setActiveTab] = useState("上传内容");
  const [batchStatus, setBatchStatus] = useState<BatchStatus>("draft");
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewError, setPreviewError] = useState("");
  const [pasteDraft, setPasteDraft] = useState("");
  const [webUrlDraft, setWebUrlDraft] = useState("");
  const [pendingFileItems, setPendingFileItems] = useState<PendingFileItem[]>([]);
  const [stackHint, setStackHint] = useState("");
  const [intakeError, setIntakeError] = useState("");
  const [reviewBatch, setReviewBatch] = useState<ReviewBatch | null>(null);
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);
  const [writePlan, setWritePlan] = useState<VaultWritePlan | null>(null);
  const [batchHistory, setBatchHistory] = useState<BatchManifestSummary[]>([]);
  const [vaultPath, setVaultPath] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(vaultPathStorageKey) ?? ""),
  );
  const [reviewProvider, setReviewProvider] = useState<ReviewSkillProvider>(() =>
    typeof window === "undefined"
      ? "deepseek"
      : readStoredReviewProvider(window.localStorage.getItem(reviewProviderStorageKey)),
  );
  const [modelBaseUrl, setModelBaseUrl] = useState(() =>
    typeof window === "undefined"
      ? getDefaultDeepSeekSetting("baseUrl")
      : readStoredDeepSeekSetting(
          window.localStorage.getItem(modelBaseUrlStorageKey),
          window.localStorage.getItem(reviewProviderStorageKey),
          "baseUrl",
        ),
  );
  const [modelName, setModelName] = useState(() =>
    typeof window === "undefined"
      ? getDefaultDeepSeekSetting("model")
      : readStoredDeepSeekSetting(
          window.localStorage.getItem(modelNameStorageKey),
          window.localStorage.getItem(reviewProviderStorageKey),
          "model",
        ),
  );
  const [fallbackToLocal, setFallbackToLocal] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem(modelFallbackStorageKey) !== "false",
  );
  const [modelApiKey, setModelApiKey] = useState("");
  const [keychainState, setKeychainState] = useState<KeychainState>("idle");
  const [keychainMessage, setKeychainMessage] = useState("");
  const [apiTestState, setApiTestState] = useState<ApiTestState>("idle");
  const [apiTestMessage, setApiTestMessage] = useState("");
  const [vaultCheckState, setVaultCheckState] = useState<VaultCheckState>("idle");
  const [vaultInspection, setVaultInspection] = useState<VaultInspection | null>(null);
  const [reviewRunState, setReviewRunState] = useState<ReviewRunState>("idle");
  const [reviewEngineMessage, setReviewEngineMessage] = useState("");
  const [reviewUsage, setReviewUsage] = useState<ReviewUsageSummary | null>(null);
  const [transactionState, setTransactionState] = useState<TransactionState>("idle");
  const [transactionMessage, setTransactionMessage] = useState("");
  const [lastManifest, setLastManifest] = useState<BatchManifest | null>(null);
  const [logicLinkRangePreset, setLogicLinkRangePreset] = useState<LogicLinkRangePreset>("7d");
  const [logicLinkDraft, setLogicLinkDraft] = useState<LogicLinkUpdateDraft | null>(null);
  const [logicLinkRunState, setLogicLinkRunState] = useState<LogicLinkRunState>("idle");
  const [logicLinkMessage, setLogicLinkMessage] = useState("");
  const [logicLinkPreviewState, setLogicLinkPreviewState] = useState<PreviewState>("idle");
  const [logicLinkLastManifest, setLogicLinkLastManifest] = useState<BatchManifest | null>(null);
  const meta = pageMeta[activeNav];
  const batchSources = reviewBatch?.sources ?? [];
  const batchNotes = reviewBatch?.notes ?? [];
  const batchCorrections = reviewBatch?.corrections ?? [];
  const batchRelations = reviewBatch?.relations ?? [];
  const pendingTextCount = pasteDraft.trim() ? 1 : 0;
  const pendingInputCount = pendingTextCount + pendingFileItems.length;
  const pendingFileTypeSummary =
    pendingFileItems.length > 0
      ? Array.from(new Set(pendingFileItems.map((item) => sourceTypeLabel(item.type)))).join(" / ")
      : "未选择文件";
  const currentStackHintCopy = stackHint.trim() || "未填写，AI 将根据内容判断";
  const vaultWriteFiles = reviewBatch ? buildVaultWriteFiles(reviewBatch) : [];
  const vaultMoveFiles = reviewBatch ? buildVaultMoveFiles(reviewBatch) : [];
  const currentPreviewRoot = reviewBatch ? buildBatchPreviewRoot(previewVault.root, reviewBatch.id) : previewVault.root;
  const firstNote = batchNotes[0];
  const firstPathSegments = firstNote?.path.split("/").map((segment) => segment.trim()) ?? [];
  const visibleTabs = activeNav === "审理" ? reviewTabs : intakeTabs;
  const logicLinkSuggestionCount = logicLinkDraft?.suggestions.length ?? 0;
  const reviewEngineLabel =
    reviewProvider === "local"
      ? "本地 fallback"
      : modelBaseUrl.trim() && modelName.trim() && modelApiKey.trim()
        ? `${getReviewProviderLabel(reviewProvider)} 已配置`
        : `${getReviewProviderLabel(reviewProvider)} 待补全`;
  const batchPanelTitle =
    !reviewBatch
      ? "等待批次"
      : batchStatus === "confirmed"
      ? "整批已确认"
      : batchStatus === "removed"
        ? "本批次已删除"
        : "整批确认";
  const batchStatusLabel =
    !reviewBatch
      ? "暂无审理批次"
      : batchStatus === "confirmed"
      ? `已确认批次 ${reviewBatch.id}`
      : batchStatus === "removed"
        ? `已删除批次 ${reviewBatch.id}`
        : `草稿批次 ${reviewBatch.id}`;
  const batchStatusCopy =
    !reviewBatch
      ? "上传或粘贴学习材料后，这里会生成可确认的审理批次。"
      : batchStatus === "confirmed"
      ? "已确认：本批次已写入真实 Obsidian Vault，可通过撤销写入恢复。"
      : batchStatus === "removed"
        ? "已删除：本批次已撤销，新增文件会被清理，覆盖文件会恢复旧内容。"
        : "等待确认：检查无误后可以整批写入真实 Vault，或删除本批次重新生成。";
  const previewStatusCopy =
    previewState === "opened"
      ? `由 LifeMind 桌面脚本写入并打开当前批次文件夹；预览目录：${currentPreviewRoot}`
      : previewState === "opening"
        ? "正在打开 Obsidian 临时预览，打开后 LifeMind 会自动回到审理确认页。"
        : previewState === "failed"
          ? `Obsidian 预览打开失败：${previewError || "请确认 Obsidian 已安装并已注册临时 Vault。"}`
          : "点击打开预览后，LifeMind 会调用桌面脚本打开 Obsidian，再回到这里等待确认。";
  const statusPillCopy =
    activeNav === "入库"
      ? reviewRunState === "reviewing"
        ? "正在审理"
        : pendingInputCount > 0
          ? `${pendingInputCount} 条待审理`
          : "等待上传文件"
      : activeNav === "扫描"
        ? logicLinkRunState === "ready"
          ? `${logicLinkSuggestionCount} 条连接建议待确认`
          : logicLinkRunState === "confirming"
            ? "正在写入连接"
            : "等待关系扫描"
        : activeNav === "设置"
          ? "本地配置"
          : batchStatusLabel;
  const writePlanCopy = writePlan
    ? `${writePlan.newCount} 条新建 / ${writePlan.overwriteCount} 条覆盖 / ${writePlan.moveCount} 条迁移`
    : vaultPath.trim() && reviewBatch
      ? "等待检查"
      : "确认前检查";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storage = window.localStorage;
    const storedProvider = storage.getItem(reviewProviderStorageKey);
    const providerWasMigrated = storedProvider !== "deepseek";
    const storedModel = storage.getItem(modelNameStorageKey);
    const modelWasMigrated = isLegacyDeepSeekModel(storedModel);

    storage.setItem(reviewProviderStorageKey, "deepseek");

    if (providerWasMigrated || !storage.getItem(modelBaseUrlStorageKey)?.trim()) {
      storage.setItem(modelBaseUrlStorageKey, getDefaultDeepSeekSetting("baseUrl"));
    }

    if (providerWasMigrated || modelWasMigrated || !storedModel?.trim()) {
      storage.setItem(modelNameStorageKey, getDefaultDeepSeekSetting("model"));
    }
  }, []);

  useEffect(() => {
    if (reviewProvider === "local") {
      return;
    }

    if (!isDesktopApp()) {
      return;
    }

    let cancelled = false;

    void Promise.resolve()
      .then(async () => {
        if (cancelled) return;
        setKeychainState("loading");
        setKeychainMessage("正在从系统钥匙串读取 API Key...");
        const value = await invoke<string | null>("load_model_api_key", { provider: reviewProvider });
        if (cancelled) return;
        setModelApiKey(value ?? "");
        setKeychainState("idle");
        setKeychainMessage(value ? "已从系统钥匙串读取 API Key。" : "系统钥匙串中还没有该模型的 API Key。");
      })
      .catch((error) => {
        if (cancelled) return;
        setModelApiKey("");
        setKeychainState("failed");
        setKeychainMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [reviewProvider]);

  useEffect(() => {
    if (!isDesktopApp()) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          sourcePathHandlerRef.current(event.payload.paths);
        }
      })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        if (!cancelled) {
          setIntakeError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function handleNavChange(label: NavLabel) {
    setActiveNav(label);

    if (label === "入库") {
      setActiveTab("上传内容");
    }
    if (label === "审理") {
      setActiveTab(reviewBatch ? "AI 结果" : "上传内容");
    }
  }

  function handleVaultPathChange(value: string) {
    setVaultPath(value);
    window.localStorage.setItem(vaultPathStorageKey, value);
    setVaultCheckState("idle");
    setVaultInspection(null);
    setWritePlan(null);
    setBatchHistory([]);
  }

  function handleReviewProviderChange(value: ReviewSkillProvider) {
    setReviewProvider(value);
    window.localStorage.setItem(reviewProviderStorageKey, value);
    setApiTestState("idle");
    setApiTestMessage("");

    if (value === "local") {
      setModelApiKey("");
      setKeychainState("idle");
      setKeychainMessage("");
    } else if (!isDesktopApp()) {
      setKeychainState("idle");
      setKeychainMessage("API Key 只在桌面 App 中保存到系统钥匙串。");
    }
  }

  function handleModelBaseUrlChange(value: string) {
    setModelBaseUrl(value);
    window.localStorage.setItem(modelBaseUrlStorageKey, value);
    setApiTestState("idle");
    setApiTestMessage("");
  }

  function handleModelNameChange(value: string) {
    setModelName(value);
    window.localStorage.setItem(modelNameStorageKey, value);
    setApiTestState("idle");
    setApiTestMessage("");
  }

  function handleFallbackToLocalChange(value: boolean) {
    setFallbackToLocal(value);
    window.localStorage.setItem(modelFallbackStorageKey, value ? "true" : "false");
  }

  function handleLogicLinkRangePresetChange(value: LogicLinkRangePreset) {
    setLogicLinkRangePreset(value);

    if (logicLinkDraft) {
      void clearExistingLogicLinkDraftBeforeGenerate(`已切换到${logicLinkRangeLabel(value)}，请重新生成逻辑连接建议。`);
      return;
    }

    setLogicLinkPreviewState("idle");
    if (logicLinkRunState === "failed" || logicLinkRunState === "confirmed") {
      setLogicLinkRunState("idle");
      setLogicLinkMessage("");
    }
  }

  function handleModelApiKeyChange(value: string) {
    setModelApiKey(value);
    setKeychainState("idle");
    setKeychainMessage("Key 尚未保存到系统钥匙串。");
    setApiTestState("idle");
    setApiTestMessage("");
  }

  async function handleSaveModelApiKey() {
    if (reviewProvider === "local") return;

    if (!isDesktopApp()) {
      setKeychainState("failed");
      setKeychainMessage("API Key 只能在 LifeMind 桌面 App 中保存。");
      return;
    }

    setKeychainState("loading");
    setKeychainMessage("正在保存 API Key 到系统钥匙串...");

    try {
      await invoke("save_model_api_key", {
        provider: reviewProvider,
        apiKey: modelApiKey,
      });
      setKeychainState("saved");
      setKeychainMessage(modelApiKey.trim() ? "API Key 已保存到系统钥匙串。" : "已清除系统钥匙串中的 API Key。");
    } catch (error) {
      setKeychainState("failed");
      setKeychainMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTestModelApiConnection() {
    if (reviewProvider === "local") {
      setApiTestState("failed");
      setApiTestMessage("请选择一个外部模型供应商后再测试 API 连接。");
      return;
    }

    if (!modelApiKey.trim()) {
      setApiTestState("failed");
      setApiTestMessage("请先填写 API Key。");
      return;
    }

    setApiTestState("testing");
    setApiTestMessage("正在用 lifemind.review.v2 最小样例测试连接...");

    try {
      const result = await testReviewSkillConnection({
        provider: reviewProvider,
        baseUrl: modelBaseUrl,
        apiKey: modelApiKey,
        model: modelName,
        modelInvoker: isDesktopApp() ? invokeReviewSkillModel : undefined,
      });
      setApiTestState("passed");
      setApiTestMessage(`连接成功：${getReviewProviderLabel(result.provider)} 返回已通过协议校验。`);
    } catch (error) {
      setApiTestState("failed");
      setApiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleValidateVaultPath() {
    return validateVaultPath();
  }

  async function validateVaultPath() {
    const normalizedPath = vaultPath.trim();

    if (!normalizedPath) {
      const inspection: VaultInspection = {
        path: "",
        exists: false,
        isDir: false,
        hasObsidianConfig: false,
        canWrite: false,
        message: "请先填写真实 Obsidian Vault 路径。",
      };
      setVaultInspection(inspection);
      setVaultCheckState("failed");
      return inspection;
    }

    if (!("__TAURI_INTERNALS__" in window)) {
      const inspection: VaultInspection = {
        path: normalizedPath,
        exists: false,
        isDir: false,
        hasObsidianConfig: false,
        canWrite: false,
        message: "Vault 路径检查只能在 LifeMind 桌面 App 中执行。",
      };
      setVaultInspection(inspection);
      setVaultCheckState("failed");
      return inspection;
    }

    setVaultCheckState("checking");

    try {
      const inspection = await invoke<VaultInspection>("validate_vault_path", {
        vaultRoot: normalizedPath,
      });
      setVaultInspection(inspection);
      setVaultCheckState(inspection.canWrite && inspection.hasObsidianConfig ? "checked" : "failed");

      if (inspection.canWrite && inspection.hasObsidianConfig) {
        await refreshBatchHistory(normalizedPath);
        if (reviewBatch) {
          await inspectWritePlan(reviewBatch, normalizedPath);
        }
      }

      return inspection;
    } catch (error) {
      const inspection: VaultInspection = {
        path: normalizedPath,
        exists: false,
        isDir: false,
        hasObsidianConfig: false,
        canWrite: false,
        message: error instanceof Error ? error.message : String(error),
      };
      setVaultInspection(inspection);
      setVaultCheckState("failed");
      return inspection;
    }
  }

  async function inspectWritePlan(batch: ReviewBatch, root = vaultPath.trim()) {
    if (!root || !isDesktopApp()) {
      setWritePlan(null);
      return null;
    }

    try {
      const plan = await invoke<VaultWritePlan>("inspect_vault_write_plan", {
        vaultRoot: root,
        files: buildVaultWriteFiles(batch),
        moves: buildVaultMoveFiles(batch),
      });
      setWritePlan(plan);
      return plan;
    } catch (error) {
      setWritePlan(null);
      setTransactionMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function refreshBatchHistory(root = vaultPath.trim()) {
    if (!root || !isDesktopApp()) {
      setBatchHistory([]);
      return;
    }

    try {
      const history = await invoke<BatchManifestSummary[]>("list_review_batches", {
        vaultRoot: root,
      });
      setBatchHistory(history);
    } catch {
      setBatchHistory([]);
    }
  }

  async function commitReviewBatch(sources: IntakeSource[]) {
    const readableSources = sources.filter((source) => source.content.trim().length > 0);

    if (readableSources.length === 0) {
      setReviewRunState("failed");
      setReviewEngineMessage("");
      setIntakeError("没有可审理的文本内容。当前支持文本、Markdown、代码、文本型 PDF 和静态网页；截图 OCR 稍后接入。");
      return false;
    }

    setReviewRunState("reviewing");
    setIntakeError("");
    setReviewEngineMessage("正在生成 Skill 请求并审理上传内容...");
    setReviewUsage(null);
    const loadingStartedAt = getInteractionTimeMs();
    await waitForNextPaint();

    try {
      const vaultKnowledge = await loadVaultKnowledgeContext();
      const result = await runReviewSkill(readableSources, {
        provider: reviewProvider,
        baseUrl: modelBaseUrl,
        apiKey: modelApiKey,
        model: modelName,
        fallbackToLocal,
        qualityPasses: 2,
        vaultContext: vaultKnowledge.context,
        modelInvoker: isDesktopApp() ? invokeReviewSkillModel : undefined,
        diagnosticLogger: isDesktopApp()
          ? async (event) => {
              try {
                await invoke("write_review_diagnostic_log", { event });
              } catch {
                // 本地诊断日志失败不能阻断审理流程。
              }
            }
          : undefined,
      });
      const nextBatch = result.batch;

      setReviewBatch(nextBatch);
      setReviewUsage(result.usage);
      setPreviewFiles(buildPreviewFiles(nextBatch));
      setBatchStatus("draft");
      setPreviewState("idle");
      setPreviewError("");
      setTransactionState("idle");
      setTransactionMessage("");
      setLastManifest(null);
      setWritePlan(null);
      await waitForMinimumLoading(loadingStartedAt);
      setReviewRunState("idle");
      setReviewEngineMessage(vaultKnowledge.message ? `${result.message} ${vaultKnowledge.message}` : result.message);
      setActiveNav("审理");
      setActiveTab("AI 结果");

      void inspectWritePlan(nextBatch);
      void refreshBatchHistory();
      return true;
    } catch (error) {
      await waitForMinimumLoading(loadingStartedAt);
      setReviewRunState("failed");
      setReviewEngineMessage("");
      setIntakeError(formatReviewFailure(error));
      return false;
    }
  }

  async function loadVaultKnowledgeContext(): Promise<{ context: VaultKnowledgeContext | null; message: string }> {
    const root = vaultPath.trim();

    if (!root || !isDesktopApp()) {
      return { context: null, message: "" };
    }

    setReviewEngineMessage("正在读取真实 Vault 的既有知识结构...");

    try {
      const context = await invoke<VaultKnowledgeContext>("scan_vault_knowledge", {
        vaultRoot: root,
      });
      const message =
        context.roots.length > 0 || context.notes.length > 0
          ? `已参考 ${context.roots.length} 个技术栈 / ${context.notes.length} 篇既有笔记。`
          : "真实 Vault 目前没有可参考的 Markdown 索引。";
      return { context, message };
    } catch (error) {
      const message = `Vault 索引读取失败，已改用无索引审理：${error instanceof Error ? error.message : String(error)}`;

      return { context: null, message };
    }
  }

  async function handleStartReview() {
    const content = pasteDraft.trim();

    if (!content && pendingFileItems.length === 0) {
      setIntakeError("请先粘贴学习材料，或上传一个待审理文件。");
      return;
    }

    setActiveNav("入库");
    setActiveTab("上传内容");
    setReviewRunState("reviewing");
    setIntakeError("");
    setReviewEngineMessage("正在解析待审理输入...");
    await waitForNextPaint();

    const textSources: IntakeSource[] = content
      ? [
          {
            id: "pasted-1",
            title: inferTitleFromText(content),
            type: "text",
            stackHint,
            content,
          },
        ]
      : [];
    const extracted = await Promise.allSettled(
      pendingFileItems.map((item, index) => extractPendingFileSource(item, index, stackHint)),
    );
    const fileSources = extracted.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
    const extractionErrors = extracted.flatMap((item) =>
      item.status === "rejected" ? [item.reason instanceof Error ? item.reason.message : String(item.reason)] : [],
    );
    const committed = await commitReviewBatch([...textSources, ...fileSources]);

    if (!committed) return;

    setPasteDraft("");
    setPendingFileItems([]);

    if (extractionErrors.length > 0) {
      setReviewEngineMessage((current) =>
        [current, `已跳过 ${extractionErrors.length} 个暂不支持的文件：${extractionErrors.join("；")}`]
          .filter(Boolean)
          .join(" "),
      );
    }
  }

  function handleSourceFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files);

    if (selectedFiles.length === 0) return;

    setActiveNav("入库");
    setActiveTab("上传内容");
    setIntakeError("");
    setReviewEngineMessage(`已加入 ${selectedFiles.length} 个待审理文件，点击开始审理后再解析。`);
    enqueuePendingFiles(selectedFiles.map((file, index) => createPendingBrowserFileItem(file, index)));
  }

  function handleSourcePaths(paths: string[]) {
    const selectedPaths = paths.map((path) => path.trim()).filter(Boolean);

    if (selectedPaths.length === 0) return;

    if (reviewRunState === "reviewing") {
      setIntakeError("当前已有审理任务正在运行，请稍后再导入。");
      return;
    }

    setActiveNav("入库");
    setActiveTab("上传内容");
    setIntakeError("");
    setReviewEngineMessage(`已加入 ${selectedPaths.length} 个待审理文件，点击开始审理后再解析。`);
    enqueuePendingFiles(selectedPaths.map((path, index) => createPendingPathFileItem(path, index)));
  }

  sourcePathHandlerRef.current = (paths: string[]) => {
    handleSourcePaths(paths);
  };

  async function handleWebUrlReview() {
    const url = webUrlDraft.trim();

    if (!url) {
      setIntakeError("请先填写网页链接。");
      return;
    }

    if (!isDesktopApp()) {
      setIntakeError("网页抓取只能在 LifeMind 桌面 App 中执行。");
      return;
    }

    setReviewRunState("reviewing");
    setIntakeError("");
    setReviewEngineMessage("正在抓取网页正文...");
    const loadingStartedAt = getInteractionTimeMs();
    await waitForNextPaint();

    try {
      const extracted = await invoke<ExtractedContent>("extract_webpage_text", { url });
      setReviewEngineMessage("网页正文已提取，正在进入 Skill 审理...");
      await commitReviewBatch([
        {
          id: "web-1",
          title: extracted.title || url,
          type: extracted.sourceType,
          stackHint,
          content: extracted.content,
        },
      ]);
    } catch (error) {
      await waitForMinimumLoading(loadingStartedAt);
      setReviewRunState("failed");
      setReviewEngineMessage("");
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.currentTarget.files) {
      handleSourceFiles(event.currentTarget.files);
      event.currentTarget.value = "";
    }
  }

  async function handleSelectFiles() {
    if (!isDesktopApp()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const paths = await invoke<string[]>("select_intake_file_paths");
      handleSourcePaths(paths);
    } catch (error) {
      setReviewRunState("failed");
      setReviewEngineMessage("");
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleSourceFiles(event.dataTransfer.files);
  }

  function enqueuePendingFiles(items: PendingFileItem[]) {
    setPendingFileItems((current) => {
      const existingKeys = new Set(current.map(getPendingFileKey));
      const uniqueItems = items.filter((item) => {
        const key = getPendingFileKey(item);

        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      return [...current, ...uniqueItems];
    });
  }

  function removePendingFile(id: string) {
    setPendingFileItems((current) => current.filter((item) => item.id !== id));
  }

  function clearPendingFiles() {
    setPendingFileItems([]);
    setReviewEngineMessage("");
  }

  async function handleConfirmBatch() {
    if (!reviewBatch) return;

    if (!vaultPath.trim()) {
      setTransactionState("failed");
      setTransactionMessage("请先在设置页填写真实 Obsidian Vault 路径。");
      setActiveNav("设置");
      return;
    }

    const inspection = await validateVaultPath();

    if (!inspection.canWrite) {
      setTransactionState("failed");
      setTransactionMessage(inspection.message);
      setActiveNav("设置");
      return;
    }

    if (!inspection.hasObsidianConfig) {
      setTransactionState("failed");
      setTransactionMessage("未发现 .obsidian 配置目录，为避免误写入，已停止确认。");
      setActiveNav("设置");
      return;
    }

    setTransactionState("writing");
    setTransactionMessage("正在检查写入计划...");

    try {
      await inspectWritePlan(reviewBatch, vaultPath.trim());
      setTransactionMessage("正在写入真实 Obsidian Vault...");
      const manifest = await invoke<BatchManifest>("confirm_review_batch", {
        vaultRoot: vaultPath.trim(),
        batchId: reviewBatch.id,
        files: vaultWriteFiles,
        moves: vaultMoveFiles,
      });
      const confirmedPreviewRoot = buildBatchPreviewRoot(previewVault.root, reviewBatch.id);
      let cleanupMessage = "临时预览已清理";

      if (isDesktopApp()) {
        try {
          await invoke("discard_review_preview", {
            previewRoot: confirmedPreviewRoot,
          });
        } catch (error) {
          cleanupMessage = `临时预览清理失败：${error instanceof Error ? error.message : String(error)}`;
        }
      }

      setLastManifest(manifest);
      setBatchStatus("confirmed");
      setReviewBatch((current) => (current ? { ...current, status: "confirmed" } : current));
      setPreviewFiles([]);
      setPreviewState("idle");
      setTransactionState("written");
      setTransactionMessage(
        `已写入 ${vaultWriteFiles.length} 条笔记，迁移 ${vaultMoveFiles.length} 条旧笔记，并创建批次事务记录；${cleanupMessage}。`,
      );
      void refreshBatchHistory();
    } catch (error) {
      setTransactionState("failed");
      setTransactionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRemoveBatch() {
    if (!reviewBatch) return;

    if (batchStatus !== "confirmed") {
      const removedBatchId = reviewBatch.id;
      const removedPreviewRoot = buildBatchPreviewRoot(previewVault.root, reviewBatch.id);

      previewRequestRef.current += 1;
      setBatchStatus("draft");
      setReviewBatch(null);
      setReviewUsage(null);
      setPreviewFiles([]);
      setWritePlan(null);
      setLastManifest(null);
      setPreviewState("idle");
      setPreviewError("");
      setTransactionState("idle");
      setTransactionMessage("");
      setReviewEngineMessage(`已删除未确认批次 ${removedBatchId}，没有写入真实 Vault。`);
      setActiveNav("入库");
      setActiveTab("上传内容");

      if (isDesktopApp()) {
        void invoke("discard_review_preview", {
          previewRoot: removedPreviewRoot,
        }).catch((error) => {
          setReviewEngineMessage(
            `已删除未确认批次 ${removedBatchId}，但临时预览目录清理失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      return;
    }

    if (!vaultPath.trim()) {
      setTransactionState("failed");
      setTransactionMessage("缺少真实 Obsidian Vault 路径，无法撤销已确认批次。");
      setActiveNav("设置");
      return;
    }

    if (!isDesktopApp()) {
      setTransactionState("failed");
      setTransactionMessage("真实 Vault 撤销只能在 LifeMind 桌面 App 中执行。");
      return;
    }

    setTransactionState("undoing");
    setTransactionMessage("正在撤销本批次写入...");

    try {
      const manifest = await invoke<BatchManifest>("undo_review_batch", {
        vaultRoot: vaultPath.trim(),
        batchId: reviewBatch.id,
      });
      setLastManifest(manifest);
      setBatchStatus("removed");
      setReviewBatch((current) => (current ? { ...current, status: "removed" } : current));
      setTransactionState("undone");
      setTransactionMessage("已撤销本批次写入：新增文件已删除，覆盖文件已恢复。");
      setWritePlan(null);
      void refreshBatchHistory();
    } catch (error) {
      setTransactionState("failed");
      setTransactionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleUndoHistoryBatch(batchId: string) {
    if (!vaultPath.trim()) {
      setTransactionState("failed");
      setTransactionMessage("缺少真实 Obsidian Vault 路径，无法撤销历史批次。");
      setActiveNav("设置");
      return;
    }

    if (!isDesktopApp()) {
      setTransactionState("failed");
      setTransactionMessage("历史批次撤销只能在 LifeMind 桌面 App 中执行。");
      return;
    }

    setTransactionState("undoing");
    setTransactionMessage(`正在撤销批次 ${batchId}...`);

    try {
      const manifest = await invoke<BatchManifest>("undo_review_batch", {
        vaultRoot: vaultPath.trim(),
        batchId,
      });
      setLastManifest(manifest);

      if (reviewBatch?.id === batchId) {
        setBatchStatus("removed");
        setReviewBatch((current) => (current ? { ...current, status: "removed" } : current));
        setWritePlan(null);
      }

      setTransactionState("undone");
      setTransactionMessage(`已撤销批次 ${batchId}。`);
      void refreshBatchHistory();
    } catch (error) {
      setTransactionState("failed");
      setTransactionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateLogicLinkDraft() {
    if (!vaultPath.trim()) {
      setLogicLinkRunState("failed");
      setLogicLinkMessage("请先在设置页填写真实 Obsidian Vault 路径。");
      setActiveNav("设置");
      return;
    }

    if (!isDesktopApp()) {
      setLogicLinkRunState("failed");
      setLogicLinkMessage("逻辑连接更新只能在 LifeMind 桌面 App 中扫描真实 Vault。");
      return;
    }

    setLogicLinkRunState("scanning");
    setLogicLinkMessage("正在扫描真实 Vault 的笔记、目录和现有关系...");
    setLogicLinkPreviewState("idle");
    const loadingStartedAt = getInteractionTimeMs();
    await waitForNextPaint();
    const cleanupWarning = await clearExistingLogicLinkDraftBeforeGenerate(undefined, {
      resetRunState: false,
    });

    try {
      const inspection = await validateVaultPath();

      if (!inspection.canWrite || !inspection.hasObsidianConfig) {
        setLogicLinkRunState("failed");
        setLogicLinkMessage(inspection.hasObsidianConfig ? inspection.message : "未发现 .obsidian 配置目录，已停止扫描。");
        return;
      }

      const context = await invoke<VaultKnowledgeContext>("scan_vault_knowledge", {
        vaultRoot: vaultPath.trim(),
      });
      const localDraft = createLocalLogicLinkUpdateDraft(context, {
        range: logicLinkRangeToRequest(logicLinkRangePreset),
      });

      if (localDraft.suggestions.length === 0) {
        await waitForMinimumLoading(loadingStartedAt);
        setLogicLinkDraft(localDraft);
        setLogicLinkRunState("ready");
        setLogicLinkMessage(
          `已扫描 ${localDraft.scannedNoteCount} 篇笔记，本次范围内没有可补全的后续枝节候选。${cleanupWarning}`,
        );
        return;
      }

      if (reviewProvider === "local") {
        await waitForMinimumLoading(loadingStartedAt);
        setLogicLinkDraft(localDraft);
        setLogicLinkRunState("ready");
        setLogicLinkMessage(
          `已用本地时间排序脚本生成 ${localDraft.suggestions.length} 条候选；当前未调用外部模型复审。${cleanupWarning}`,
        );
        return;
      }

      setLogicLinkRunState("reviewing");
      setLogicLinkMessage("本地候选已生成，正在调用模型复审逻辑关系...");
      const reviewResult = await reviewLogicLinkDraftWithModel(localDraft);
      await waitForMinimumLoading(loadingStartedAt);
      setLogicLinkDraft(reviewResult.draft);
      setLogicLinkRunState("ready");
      if (reviewResult.usedFallback) {
        setLogicLinkMessage(
          `外部模型复审失败，已保留本地时间排序候选 ${reviewResult.draft.suggestions.length} 条：${reviewResult.fallbackReason}${cleanupWarning}`,
        );
      } else {
        setLogicLinkMessage(
          `模型复审完成：本地候选 ${localDraft.suggestions.length} 条，保留 ${reviewResult.draft.suggestions.length} 条可确认连接。${cleanupWarning}`,
        );
      }
    } catch (error) {
      await waitForMinimumLoading(loadingStartedAt);
      if (reviewProvider !== "local" && fallbackToLocal) {
        setLogicLinkRunState("failed");
        setLogicLinkMessage(`逻辑连接更新失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      setLogicLinkRunState("failed");
      setLogicLinkMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function clearExistingLogicLinkDraftBeforeGenerate(
    nextMessage?: string,
    options: { resetRunState?: boolean } = {},
  ) {
    const draftId = logicLinkDraft?.id;

    if (!draftId) {
      if (nextMessage !== undefined) {
        setLogicLinkMessage(nextMessage);
      }
      return "";
    }

    setLogicLinkDraft(null);
    setLogicLinkPreviewState("idle");
    if (options.resetRunState ?? true) {
      setLogicLinkRunState("idle");
    }

    let cleanupWarning = "";

    if (isDesktopApp()) {
      try {
        await invoke("discard_review_preview", {
          previewRoot: buildBatchPreviewRoot(previewVault.root, draftId),
        });
      } catch (error) {
        cleanupWarning = ` 旧预览清理失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (nextMessage !== undefined) {
      setLogicLinkMessage(`${nextMessage}${cleanupWarning}`);
    }

    return cleanupWarning;
  }

  async function reviewLogicLinkDraftWithModel(localDraft: LogicLinkUpdateDraft) {
    const preset = getReviewModelProviderPreset(reviewProvider);
    const baseUrl = (modelBaseUrl || preset?.baseUrl || "").trim();
    const apiKey = modelApiKey.trim();
    const model = (modelName || preset?.model || "").trim();

    if (!baseUrl || !apiKey || !model) {
      if (fallbackToLocal) {
        return {
          draft: localDraft,
          usedFallback: true,
          fallbackReason: "模型配置不完整",
        };
      }
      throw new Error("逻辑连接模型复审缺少 base URL、模型名称或 API Key。");
    }

    try {
      const modelInvocation = await invokeReviewSkillModel(
        createDeepSeekLogicLinkModelRequest({
          baseUrl,
          apiKey,
          model,
          draft: localDraft,
        }),
      );
      const rawOutput =
        typeof modelInvocation === "string" ? modelInvocation : modelInvocation.output;

      return {
        draft: mergeLogicLinkModelOutput(localDraft, parseLogicLinkModelOutput(rawOutput)),
        usedFallback: false,
      };
    } catch (error) {
      if (fallbackToLocal) {
        return {
          draft: localDraft,
          usedFallback: true,
          fallbackReason: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  }

  async function openLogicLinkPreviewInObsidian() {
    if (!logicLinkDraft) {
      setLogicLinkPreviewState("failed");
      setLogicLinkMessage("还没有可预览的逻辑连接更新草稿。");
      return;
    }

    setLogicLinkPreviewState("opening");
    setLogicLinkMessage("正在打开本次逻辑连接更新的独立 Obsidian 预览...");

    try {
      await invoke("open_obsidian_preview", {
        vault: previewVault.name,
        file: "00-逻辑连接更新总览.md",
        previewRoot: buildBatchPreviewRoot(previewVault.root, logicLinkDraft.id),
        files: buildLogicLinkPreviewFiles(logicLinkDraft),
      });
      setLogicLinkPreviewState("opened");
      setLogicLinkMessage("预览已打开，确认写入后会删除本次临时预览文件。");
      setActiveNav("扫描");
    } catch (error) {
      setLogicLinkPreviewState("failed");
      setLogicLinkMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmLogicLinkUpdates() {
    if (!logicLinkDraft) return;

    if (logicLinkDraft.suggestions.length === 0) {
      setLogicLinkRunState("failed");
      setLogicLinkMessage("本次没有可确认的后续枝节链接。");
      return;
    }

    if (!vaultPath.trim()) {
      setLogicLinkRunState("failed");
      setLogicLinkMessage("请先在设置页填写真实 Obsidian Vault 路径。");
      setActiveNav("设置");
      return;
    }

    setLogicLinkRunState("confirming");
    setLogicLinkMessage("正在把后续枝节链接写入真实 Vault...");

    try {
      const inspection = await validateVaultPath();

      if (!inspection.canWrite || !inspection.hasObsidianConfig) {
        setLogicLinkRunState("failed");
        setLogicLinkMessage(inspection.hasObsidianConfig ? inspection.message : "未发现 .obsidian 配置目录，已停止确认。");
        return;
      }

      const manifest = await invoke<BatchManifest>("confirm_logic_link_updates", {
        vaultRoot: vaultPath.trim(),
        batchId: logicLinkDraft.id,
        links: buildLogicLinkPayload(logicLinkDraft),
      });
      const confirmedPreviewRoot = buildBatchPreviewRoot(previewVault.root, logicLinkDraft.id);
      let cleanupMessage = "临时预览已删除";

      try {
        await invoke("discard_review_preview", {
          previewRoot: confirmedPreviewRoot,
        });
      } catch (error) {
        cleanupMessage = `临时预览删除失败：${error instanceof Error ? error.message : String(error)}`;
      }

      setLogicLinkLastManifest(manifest);
      setLogicLinkDraft(null);
      setLogicLinkPreviewState("idle");
      setLogicLinkRunState("confirmed");
      setLogicLinkMessage(`已写入 ${manifest.files.length} 个父笔记的后续枝节链接；${cleanupMessage}。`);
      void refreshBatchHistory();
    } catch (error) {
      setLogicLinkRunState("failed");
      setLogicLinkMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function discardLogicLinkDraft() {
    const draftId = logicLinkDraft?.id;

    setLogicLinkDraft(null);
    setLogicLinkPreviewState("idle");
    setLogicLinkRunState("idle");
    setLogicLinkMessage(draftId ? `已放弃逻辑连接更新草稿 ${draftId}。` : "");

    if (draftId && isDesktopApp()) {
      await invoke("discard_review_preview", {
        previewRoot: buildBatchPreviewRoot(previewVault.root, draftId),
      }).catch((error) => {
        setLogicLinkMessage(`已放弃草稿 ${draftId}，但临时预览删除失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  async function openPreviewInObsidian() {
    if (!reviewBatch) {
      setPreviewState("failed");
      setPreviewError("还没有可预览的审理批次。");
      return;
    }

    const previewRequestId = previewRequestRef.current + 1;
    previewRequestRef.current = previewRequestId;
    setActiveNav("审理");
    setActiveTab("Obsidian 预览");
    setPreviewState("opening");
    setPreviewError("");

    try {
      const activePreviewFiles = previewFiles.length > 0 ? previewFiles : buildPreviewFiles(reviewBatch);

      if (isDesktopApp()) {
        await invoke("open_obsidian_preview", {
          vault: previewVault.name,
          file: previewVault.indexFile,
          previewRoot: buildBatchPreviewRoot(previewVault.root, reviewBatch.id),
          files: activePreviewFiles,
        });
      }
      if (previewRequestRef.current !== previewRequestId) return;
      setPreviewFiles(activePreviewFiles);
      setPreviewState("opened");
      setActiveNav("审理");
      setActiveTab("AI 结果");
    } catch (error) {
      if (previewRequestRef.current !== previewRequestId) return;
      setPreviewState("failed");
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    container.current?.classList.add("app-ready");
  }, []);

  return (
    <main ref={container} className="app-shell">
      <div className="ambient-line ambient-line-one" />
      <div className="ambient-line ambient-line-two" />

      <header className="app-chrome">
        <div className="brand-lockup" aria-label="LifeMind">
          <LifemindMark />
          <div>
            <p className="brand-name">LifeMind</p>
            <p className="brand-caption">本地知识入库审阅台</p>
          </div>
        </div>

        <nav className="top-dock-wrap" aria-label="主导航">
          <Dock>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <DockItem
                  key={item.label}
                  active={activeNav === item.label}
                  ariaLabel={item.label}
                  onClick={() => handleNavChange(item.label)}
                >
                  <DockLabel>{item.label}</DockLabel>
                  <DockIcon>
                    <Icon aria-hidden="true" strokeWidth={1.7} />
                  </DockIcon>
                </DockItem>
              );
            })}
          </Dock>
        </nav>

        <div className="status-pill">
          <span className="status-dot" data-state={batchStatus} />
          {statusPillCopy}
        </div>
      </header>

      {(reviewRunState === "reviewing" ||
        logicLinkRunState === "scanning" ||
        logicLinkRunState === "reviewing" ||
        logicLinkRunState === "confirming") && (
        <motion.div
          className="lifemind-loading-overlay"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <motion.div
            className="lifemind-loading-logo"
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: [0.94, 1.02, 0.98], y: [8, 0, 4] }}
            transition={{ duration: 1.8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
          >
            <span className="loading-ring loading-ring-one" />
            <span className="loading-ring loading-ring-two" />
            <LifemindMark />
          </motion.div>
        </motion.div>
      )}

      <section className="workspace-grid">
        <div className="main-panel workspace-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">主工作区</p>
              <h2>{meta.panelTitle}</h2>
            </div>
            {(activeNav === "入库" || activeNav === "审理") && (
              <div className="panel-actions">
                <div className="tab-list" role="tablist" aria-label="主工作区切换">
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={activeTab === tab ? "tab-active" : ""}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {activeNav === "审理" && (
                  <button
                    type="button"
                    className="preview-open-button"
                    disabled={previewState === "opening" || batchStatus !== "draft" || !reviewBatch}
                    onClick={openPreviewInObsidian}
                  >
                    <ExternalLink size={15} />
                    {previewState === "opening" ? "正在打开" : "打开 Obsidian 预览"}
                  </button>
                )}
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeNav === "入库" && activeTab === "上传内容" && (
              <motion.div
                key="input"
                className="content-card input-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <UploadCloud size={30} />
                <h3>上传或粘贴学习材料</h3>
                <p>文件会先加入待审理队列，点击开始审理后才解析 PDF、文本和代码内容。</p>
                <div className="intake-form">
                  <textarea
                    value={pasteDraft}
                    onChange={(event) => setPasteDraft(event.target.value)}
                    placeholder="粘贴一段学习笔记、代码片段或 Markdown 内容"
                    aria-label="粘贴学习材料"
                    disabled={reviewRunState === "reviewing"}
                  />
                  <div className="web-intake-row">
                    <input
                      value={webUrlDraft}
                      onChange={(event) => setWebUrlDraft(event.target.value)}
                      placeholder="粘贴网页链接，例如 https://example.com/article"
                      aria-label="网页链接"
                      disabled={reviewRunState === "reviewing"}
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={reviewRunState === "reviewing"}
                      onClick={handleWebUrlReview}
                    >
                      <Link2 size={16} />
                      抓取网页
                    </button>
                  </div>
                  <div className="intake-controls">
                    <input
                      value={stackHint}
                      onChange={(event) => setStackHint(event.target.value)}
                      placeholder="技术栈提示，例如 Java / Python / 数据库"
                      aria-label="技术栈提示"
                      disabled={reviewRunState === "reviewing"}
                    />
                    <input
                      ref={fileInputRef}
                      className="hidden-file-input"
                      type="file"
                      multiple
                      onChange={handleFileInputChange}
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={reviewRunState === "reviewing"}
                      onClick={() => void handleSelectFiles()}
                    >
                      <FileInput size={16} />
                      选择文件
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={reviewRunState === "reviewing"}
                      onClick={() => void handleStartReview()}
                    >
                      <WandSparkles size={16} />
                      {reviewRunState === "reviewing" ? "审理中" : "开始审理"}
                    </button>
                  </div>
                  {pendingFileItems.length > 0 && (
                    <section className="pending-file-list" aria-label="待审理文件">
                      <div className="pending-file-list-head">
                        <strong>待审理文件</strong>
                        <button type="button" disabled={reviewRunState === "reviewing"} onClick={clearPendingFiles}>
                          清空
                        </button>
                      </div>
                      {pendingFileItems.map((item) => (
                        <article className="pending-file-row" key={item.id}>
                          <div>
                            <strong>{item.title}</strong>
                            <p>
                              {sourceTypeLabel(item.type)} / {item.sizeLabel} /{" "}
                              {item.origin === "desktop-path" ? "桌面路径" : "浏览器文件"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={reviewRunState === "reviewing"}
                            onClick={() => removePendingFile(item.id)}
                          >
                            移除
                          </button>
                        </article>
                      ))}
                    </section>
                  )}
                  {intakeError && <p className="intake-error">{intakeError}</p>}
                  {reviewEngineMessage && <p className="intake-status">{reviewEngineMessage}</p>}
                </div>
                <div className="upload-types" aria-label="支持的上传类型">
                  <span>文本</span>
                  <span>Markdown</span>
                  <span>文本型 PDF</span>
                  <span>网页链接</span>
                  <span>代码文件</span>
                  <span data-state="pending">截图 OCR 待接入</span>
                </div>
              </motion.div>
            )}

            {activeNav === "入库" && activeTab === "AI 结果" && (
              <EmptyWorkspace
                key="empty-result"
                icon={<WandSparkles size={28} />}
                title="等待 AI 审理结果"
                text="上传内容并完成提取后，这里会显示纠错、分类、关系和待写入笔记。"
              />
            )}

            {activeNav === "审理" && activeTab === "上传内容" && (
              <>
                {reviewBatch ? (
                  <motion.div
                    key="review-input"
                    className="content-card uploaded-case-grid"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {batchSources.map((item, index) => (
                      <article className="uploaded-case-card" key={item.id}>
                        <div className="case-head">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <div className="case-meta">
                          <span>{sourceTypeLabel(item.type)}</span>
                          <span>{item.stackHint || "未填写技术栈"}</span>
                        </div>
                        <pre>{item.content}</pre>
                      </article>
                    ))}
                  </motion.div>
                ) : (
                  <EmptyWorkspace
                    key="empty-review-input"
                    icon={<FileInput size={28} />}
                    title="还没有审理批次"
                    text="先在入库页上传或粘贴学习材料。"
                  />
                )}
              </>
            )}

            {activeNav === "审理" && activeTab === "AI 结果" && reviewBatch && (
              <motion.div
                key="result"
                className="result-stack"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="knowledge-map">
                  <div className="map-node map-node-large pulse-node">{firstPathSegments[0] ?? "知识库"}</div>
                  <div className="map-branch" />
                  <div className="map-node map-node-medium pulse-node">{firstPathSegments[1] ?? "待细分"}</div>
                  <div className="map-children">
                    {batchNotes.slice(0, 3).map((note) => (
                      <span className="pulse-node" key={note.id}>
                        {note.title}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="note-list">
                  {batchNotes.map((note, index) => (
                    <motion.article
                      key={note.title}
                      className="note-card"
                      whileHover={{ y: -4, scale: 1.006 }}
                      transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    >
                      <div className="note-index">{String(index + 1).padStart(2, "0")}</div>
                      <div>
                        <h3>{note.title}</h3>
                        <p>{note.path}</p>
                      </div>
                      <div className="note-meta">
                        <span>{note.grain}</span>
                        <span>{note.status}</span>
                      </div>
                    </motion.article>
                  ))}
                </div>
              </motion.div>
            )}

            {activeNav === "审理" && activeTab === "AI 结果" && !reviewBatch && (
              <EmptyWorkspace
                key="empty-review-result"
                icon={<WandSparkles size={28} />}
                title="等待审理结果"
                text="生成批次后会显示纠错、分类路径和关系。"
              />
            )}

            {activeNav === "入库" && activeTab === "Obsidian 预览" && (
              <EmptyWorkspace
                key="empty-preview"
                icon={<NotebookTabs size={28} />}
                title="等待 Obsidian 预览"
                text="审理完成后会生成可检查的 Markdown 预览，确认前不会写入真实 Vault。"
              />
            )}

            {activeNav === "审理" && activeTab === "Obsidian 预览" && reviewBatch && (
              <motion.div
                key="preview"
                className="content-card preview-review"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="preview-banner" data-state={previewState}>
                  <NotebookTabs size={20} />
                  <div>
                    <h3>{previewState === "failed" ? "Obsidian 预览需要重试" : "Obsidian 预览已打开"}</h3>
                    <p>{previewStatusCopy}</p>
                  </div>
                  <button
                    type="button"
                    className="preview-inline-action"
                    disabled={previewState === "opening" || batchStatus !== "draft" || !reviewBatch}
                    onClick={openPreviewInObsidian}
                  >
                    <ExternalLink size={15} />
                    {previewState === "opening" ? "打开中" : "重新打开"}
                  </button>
                </div>
                <div className="preview-note-list">
                  {batchNotes.map((note) => {
                    const writeFile = vaultWriteFiles.find((file) => file.noteId === note.id);

                    return (
                      <article className="preview-note-card" key={note.title}>
                        <p>{writeFile?.path ?? note.path}</p>
                        <h3>{note.title}</h3>
                        <span>
                          {note.status} / {note.grain}
                        </span>
                      </article>
                    );
                  })}
                </div>
                <section className="preview-confirmation-context" aria-label="预览确认上下文">
                  <div className="context-section-title">
                    <strong>预览确认上下文</strong>
                    <span>对照上传原文与 AI 审理结果后，再在右侧整批确认。</span>
                  </div>
                  <article className="context-card">
                    <div className="context-title">
                      <strong>上传原文</strong>
                      <span>{batchSources.length} 条输入</span>
                    </div>
                    <div className="source-list">
                      {batchSources.map((item, index) => (
                        <div className="source-row" key={item.id}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className="context-card">
                    <div className="context-title">
                      <strong>AI 审理结果</strong>
                      <span>纠错 / 分类 / 链接</span>
                    </div>
                    <div className="review-context-list">
                      {batchNotes.map((note) => (
                        <div className="review-context-row" key={note.title}>
                          <strong>{note.title}</strong>
                          <p>{note.path}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              </motion.div>
            )}

            {activeNav === "审理" && activeTab === "Obsidian 预览" && !reviewBatch && (
              <EmptyWorkspace
                key="empty-review-preview"
                icon={<NotebookTabs size={28} />}
                title="等待 Obsidian 预览"
                text="生成审理批次后才能打开临时预览。"
              />
            )}

            {activeNav === "扫描" && (
              <LogicLinkUpdateWorkspace
                key="logic-link-update"
                draft={logicLinkDraft}
                rangePreset={logicLinkRangePreset}
                runState={logicLinkRunState}
                message={logicLinkMessage}
                previewState={logicLinkPreviewState}
                onRangePresetChange={handleLogicLinkRangePresetChange}
                onGenerate={() => void generateLogicLinkDraft()}
                onOpenPreview={() => void openLogicLinkPreviewInObsidian()}
                onConfirm={() => void confirmLogicLinkUpdates()}
                onDiscard={() => void discardLogicLinkDraft()}
              />
            )}
            {activeNav === "设置" && (
              <SettingsWorkspace
                key="settings"
                vaultPath={vaultPath}
                vaultCheckState={vaultCheckState}
                vaultInspection={vaultInspection}
                reviewProvider={reviewProvider}
                modelBaseUrl={modelBaseUrl}
                modelName={modelName}
                modelApiKey={modelApiKey}
                fallbackToLocal={fallbackToLocal}
                keychainState={keychainState}
                keychainMessage={keychainMessage}
                apiTestState={apiTestState}
                apiTestMessage={apiTestMessage}
                onVaultPathChange={handleVaultPathChange}
                onValidateVaultPath={handleValidateVaultPath}
                onReviewProviderChange={handleReviewProviderChange}
                onModelBaseUrlChange={handleModelBaseUrlChange}
                onModelNameChange={handleModelNameChange}
                onModelApiKeyChange={handleModelApiKeyChange}
                onFallbackToLocalChange={handleFallbackToLocalChange}
                onSaveModelApiKey={handleSaveModelApiKey}
                onTestModelApiConnection={handleTestModelApiConnection}
              />
            )}
          </AnimatePresence>
        </div>

        <aside className="side-panel workspace-panel" aria-label="检查与操作面板">
          <div className="panel-head side-head">
            <div>
              <p className="panel-kicker">检查 / 操作面板</p>
              <h2>{activeNav === "审理" ? batchPanelTitle : `${activeNav}操作`}</h2>
            </div>
            <Sparkles size={19} />
          </div>

          {activeNav === "入库" && (
            <>
              <SideSummary
                items={[
                  ["当前阶段", reviewRunState === "reviewing" ? "正在审理" : pendingInputCount > 0 ? "待开始审理" : "等待上传"],
                  ["待审理输入", `${pendingInputCount} 条 / 文件 ${pendingFileItems.length} 个 / 粘贴文本 ${pendingTextCount} 条`],
                  ["文件类型", pendingFileTypeSummary],
                  ["技术栈提示", currentStackHintCopy],
                  ["审理引擎", reviewEngineLabel],
                  ["真实 Vault", vaultPath.trim() || "未配置"],
                ]}
              />
              <section className="check-section pending-intake-panel">
                <h3>
                  <FileInput size={15} />
                  上传检查
                </h3>
                {pendingInputCount > 0 ? (
                  <div className="pending-inspection-list">
                    {pendingTextCount > 0 && (
                      <div className="pending-inspection-row">
                        <span>文本</span>
                        <div>
                          <strong>{inferTitleFromText(pasteDraft.trim())}</strong>
                          <p>点击开始审理后进入 Skill Runner。</p>
                        </div>
                      </div>
                    )}
                    {pendingFileItems.map((item) => (
                      <div className="pending-inspection-row" key={`side-${item.id}`}>
                        <span>{sourceTypeLabel(item.type)}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <p>
                            {item.sizeLabel} / {item.origin === "desktop-path" ? "开始审理时由 Rust 读取路径" : "开始审理时读取文件内容"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">拖入或选择文件后，这里会显示文件名、类型和处理流程。</div>
                )}
              </section>
              <section className="check-section">
                <h3>
                  <TriangleAlert size={15} />
                  处理说明
                </h3>
                <div className="empty-state">上传阶段不解析 PDF，也不调用模型；开始审理后才执行提取、纠错、分类和关系生成。</div>
              </section>
            </>
          )}

          {activeNav === "审理" && (
            <>
              <section className="batch-state-card" data-state={batchStatus}>
                <span>当前批次</span>
                <strong>{batchPanelTitle}</strong>
                <p>{batchStatusCopy}</p>
              </section>

              <section className="check-section side-summary">
                <div className="summary-row">
                  <span>真实 Vault</span>
                  <strong>{vaultPath.trim() || "未配置"}</strong>
                </div>
                <div className="summary-row" data-state={vaultCheckState}>
                  <span>Vault 检查</span>
                  <strong>{vaultInspection?.message ?? "确认前会自动检查"}</strong>
                </div>
                <div className="summary-row">
                  <span>待写入</span>
                  <strong>{vaultWriteFiles.length} 条 Markdown 更新 / {vaultMoveFiles.length} 条旧笔记迁移</strong>
                </div>
                <div className="summary-row" data-state={writePlan?.overwriteCount ? "failed" : "idle"}>
                  <span>写入计划</span>
                  <strong>{writePlanCopy}</strong>
                </div>
                <div className="summary-row">
                  <span>审理引擎</span>
                  <strong>{reviewEngineMessage || reviewEngineLabel}</strong>
                </div>
                <div className="summary-row" data-state={reviewUsage?.estimatedCostCny ? "checked" : "idle"}>
                  <span>本次 API 用量</span>
                  <strong>{formatReviewUsage(reviewUsage)}</strong>
                </div>
                {lastManifest && (
                  <div className="summary-row">
                    <span>事务记录</span>
                    <strong>{`.lifemind/batches/${lastManifest.batchId}/manifest.json`}</strong>
                  </div>
                )}
                {transactionMessage && (
                  <div className="summary-row" data-state={transactionState}>
                    <span>事务状态</span>
                    <strong>{transactionMessage}</strong>
                  </div>
                )}
              </section>

              <section className="check-section write-plan-section">
                <h3>
                  <NotebookTabs size={15} />
                  待写入文件
                </h3>
                {writePlan && (writePlan.moves.length > 0 || writePlan.files.length > 0) ? (
                  <div className="write-plan-list">
                    {writePlan.moves.map((move) => (
                      <div
                        className="write-plan-row"
                        data-state={move.sourceExists && !move.targetExists ? "move" : "overwrite"}
                        key={`${move.fromPath}->${move.toPath}`}
                      >
                        <span>迁移</span>
                        <div>
                          <strong>{move.title}</strong>
                          <p>{move.fromPath} → {move.toPath}</p>
                          <em>{move.reason}</em>
                        </div>
                      </div>
                    ))}
                    {writePlan.files.map((file) => (
                      <div className="write-plan-row" data-state={file.exists ? "overwrite" : "new"} key={file.path}>
                        <span>{file.exists ? "覆盖" : "新建"}</span>
                        <div>
                          <strong>{file.title}</strong>
                          <p>{file.path}</p>
                          {file.existingPreview && <em>旧内容：{file.existingPreview}</em>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">配置并检查真实 Vault 后，会显示新建/覆盖计划。</div>
                )}
              </section>

              <section className="check-section">
                <h3>
                  <TriangleAlert size={15} />
                  错误纠正
                </h3>
                {batchCorrections.length > 0 ? (
                  batchCorrections.map((item) => (
                    <div className="correction-card" key={`${item.sourceId}-${item.original}`}>
                      <p>
                        <span>原文</span>
                        <strong>{item.original}</strong>
                      </p>
                      <p>
                        <span>修正</span>
                        <strong>{item.fixed}</strong>
                      </p>
                      <p>
                        <span>理由</span>
                        <em>{item.reason}</em>
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">当前批次暂无明确错误纠正</div>
                )}
              </section>

              <section className="check-section inline-section">
                <h3>
                  <XCircle size={15} />
                  不确定内容
                </h3>
                <div className="empty-state">本批次暂无不确定项</div>
              </section>

              <section className="check-section relations-section">
                <h3>
                  <Link2 size={15} />
                  关系检查
                </h3>
                <div className="relation-list">
                  {batchRelations.length > 0 ? (
                    batchRelations.map((relation) => (
                      <div className="relation-row" key={`${relation.type}-${relation.source}-${relation.target}`}>
                        <span>{relation.type}</span>
                        <p>
                          {relation.source} → {relation.target}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">当前批次暂无新增关系</div>
                  )}
                </div>
              </section>

              <section className="check-section batch-history-section">
                <h3>
                  <ArchiveRestore size={15} />
                  最近写入
                </h3>
                {batchHistory.length > 0 ? (
                  <div className="batch-history-list">
                    {batchHistory.slice(0, 4).map((item) => (
                      <div className="batch-history-row" data-state={item.status} key={item.batchId}>
                        <div>
                          <strong>{item.batchId}</strong>
                          <p>
                            {formatTimestamp(item.committedAt)} / {item.fileCount} 条 / 新建 {item.createdCount} / 覆盖{" "}
                            {item.overwrittenCount} / 迁移 {item.movedCount ?? 0}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={item.status === "removed" || transactionState === "undoing"}
                          onClick={() => void handleUndoHistoryBatch(item.batchId)}
                        >
                          {item.status === "removed" ? "已撤销" : "撤销"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">检查真实 Vault 后，会显示最近的 LifeMind 批次事务。</div>
                )}
              </section>

              <div className="action-panel">
                <motion.button
                  type="button"
                  className="secondary-action"
                  whileTap={{ scale: 0.98 }}
                  disabled={
                    !reviewBatch ||
                    batchStatus === "removed" ||
                    previewState === "opening" ||
                    transactionState === "writing" ||
                    transactionState === "undoing"
                  }
                  onClick={handleRemoveBatch}
                >
                  <ArchiveRestore size={16} />
                  {batchStatus === "confirmed" ? "撤销写入" : batchStatus === "removed" ? "已删除" : "删除本批次"}
                </motion.button>
                <motion.button
                  type="button"
                  className="primary-action"
                  whileTap={{ scale: 0.98 }}
                  disabled={batchStatus !== "draft" || !reviewBatch || transactionState === "writing" || transactionState === "undoing"}
                  onClick={handleConfirmBatch}
                >
                  <CheckCircle2 size={16} />
                  {transactionState === "writing" ? "写入中" : batchStatus === "confirmed" ? "已确认" : "整批确认"}
                </motion.button>
              </div>
            </>
          )}

          {activeNav === "扫描" && (
            <LogicLinkSidePanel
              draft={logicLinkDraft}
              runState={logicLinkRunState}
              message={logicLinkMessage}
              previewState={logicLinkPreviewState}
              lastManifest={logicLinkLastManifest}
              vaultPath={vaultPath}
              onGenerate={() => void generateLogicLinkDraft()}
              onOpenPreview={() => void openLogicLinkPreviewInObsidian()}
              onConfirm={() => void confirmLogicLinkUpdates()}
              onDiscard={() => void discardLogicLinkDraft()}
            />
          )}
          {activeNav === "设置" && (
            <SideSummary
              items={[
                ["Vault", vaultPath.trim() || "待填写真实路径"],
                ["路径检查", vaultInspection?.message ?? "未检查"],
                ["审理 Skill", "lifemind.review.v2 已接入"],
                ["模型", reviewEngineLabel],
                ["API 测试", apiTestMessage ? `${apiTestStatusLabel(apiTestState)}：${apiTestMessage}` : "未测试"],
                ["Fallback", fallbackToLocal ? "开启，模型失败后使用本地审理" : "关闭，模型失败会直接报错"],
              ]}
            />
          )}
        </aside>
      </section>
    </main>
  );
}

function detectSourceType(file: File): IntakeSourceType {
  return detectSourceTypeFromName(file.name);
}

function detectSourceTypeFromName(fileName: string): IntakeSourceType {
  const name = fileName.toLowerCase();

  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(name)) return "image";
  if (/\.(ts|tsx|js|jsx|py|java|cpp|cc|c|rs|go|sql|html|css|json)$/.test(name)) return "code";

  return "text";
}

function canReadAsText(type: IntakeSourceType) {
  return type === "text" || type === "markdown" || type === "code" || type === "web";
}

async function extractFileSource(file: File, index: number, stackHint: string): Promise<IntakeSource> {
  const type = detectSourceType(file);

  if (type === "image") {
    throw new Error(`${file.name} 是图片文件，截图 OCR 与思维导图/表格图片分析稍后接入。`);
  }

  if (type === "pdf") {
    throw new Error(`${file.name} 是 PDF，请使用 LifeMind 桌面 App 的“选择文件”按钮或直接拖入文件。`);
  }

  if (!canReadAsText(type)) {
    throw new Error(`${file.name} 当前版本暂不支持提取。`);
  }

  return {
    id: `file-${index + 1}-${safeSourceId(file.name)}`,
    title: stripExtension(file.name),
    type,
    stackHint,
    content: await file.text(),
  };
}

async function extractPathSource(path: string, index: number, stackHint: string): Promise<IntakeSource> {
  const fileName = fileNameFromPath(path);
  const type = detectSourceTypeFromName(fileName);

  if (type === "image") {
    throw new Error(`${fileName} 是图片文件，截图 OCR 与思维导图/表格图片分析稍后接入。`);
  }

  const command = type === "pdf" ? "extract_pdf_text_from_path" : "extract_text_file_from_path";
  const extracted = await invoke<ExtractedContent>(command, { path });
  const title = extracted.title || stripExtension(fileName);
  const content =
    extracted.sourceType === "pdf" ? preparePdfExtractedContent(title, extracted.content).content : extracted.content;

  return {
    id: `file-${index + 1}-${safeSourceId(fileName)}`,
    title,
    type: extracted.sourceType,
    stackHint,
    content,
  };
}

async function extractPendingFileSource(item: PendingFileItem, index: number, stackHint: string): Promise<IntakeSource> {
  if (item.origin === "desktop-path") {
    if (!item.path) {
      throw new Error(`${item.title} 缺少文件路径。`);
    }

    return extractPathSource(item.path, index, stackHint);
  }

  if (!item.file) {
    throw new Error(`${item.title} 缺少浏览器文件对象。`);
  }

  return extractFileSource(item.file, index, stackHint);
}

function createPendingBrowserFileItem(file: File, index: number): PendingFileItem {
  const type = detectSourceType(file);

  return {
    id: `browser-${Date.now()}-${index}-${safeSourceId(file.name)}`,
    title: stripExtension(file.name),
    type,
    sizeLabel: formatByteSize(file.size),
    origin: "browser-file",
    file,
  };
}

function createPendingPathFileItem(path: string, index: number): PendingFileItem {
  const fileName = fileNameFromPath(path);

  return {
    id: `path-${Date.now()}-${index}-${safeSourceId(path)}`,
    title: stripExtension(fileName),
    type: detectSourceTypeFromName(fileName),
    sizeLabel: "本地路径",
    origin: "desktop-path",
    path,
  };
}

function getPendingFileKey(item: PendingFileItem) {
  return item.path ?? `${item.file?.name ?? item.title}:${item.file?.size ?? item.sizeLabel}`;
}

function isDesktopApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function safeSourceId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "source"
  );
}

function formatByteSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "大小未知";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readStoredReviewProvider(value: string | null): ReviewSkillProvider {
  // 旧版本保存过的供应商全部迁移到当前唯一外部模型。
  void value;
  return "deepseek";
}

function getDefaultDeepSeekSetting(key: "baseUrl" | "model") {
  const preset = reviewModelProviderPresets[0];
  return key === "baseUrl" ? preset?.baseUrl ?? "https://api.deepseek.com" : preset?.model ?? "deepseek-v4-pro";
}

function readStoredDeepSeekSetting(
  value: string | null,
  storedProvider: string | null,
  key: "baseUrl" | "model",
) {
  if (storedProvider !== "deepseek") return getDefaultDeepSeekSetting(key);
  if (key === "model" && isLegacyDeepSeekModel(value)) {
    return getDefaultDeepSeekSetting(key);
  }
  return value?.trim() || getDefaultDeepSeekSetting(key);
}

function isLegacyDeepSeekModel(value: string | null) {
  return value === "deepseek-chat" || value === "deepseek-reasoner";
}

function getReviewProviderLabel(provider: ReviewSkillProvider) {
  if (provider === "local") return "本地 fallback";
  return getReviewModelProviderPreset(provider)?.label ?? "自定义模型";
}

async function invokeReviewSkillModel(payload: OpenAICompatibleModelRequest<unknown>) {
  const response = await invoke<unknown>("run_review_skill_model", { payload });

  if (typeof response !== "string") {
    return response as ReviewModelInvocation;
  }

  try {
    const parsed = JSON.parse(response) as { output?: unknown; usage?: unknown };

    if (typeof parsed.output === "string") {
      return {
        output: parsed.output,
        usage: parsed.usage as ReviewModelInvocation["usage"],
      };
    }
  } catch {
    // 兼容旧版桌面后端返回的原始工具参数字符串。
  }

  return response;
}

function formatReviewUsage(usage: ReviewUsageSummary | null) {
  if (!usage) return "本次模型未返回 usage";

  const availability = usage.usageAvailable ? "" : "，部分请求无 usage";
  return [
    `${usage.requestCount} 次请求`,
    `总 ${usage.totalTokens.toLocaleString("zh-CN")} tokens`,
    `输入 ${usage.promptTokens.toLocaleString("zh-CN")}`,
    `输出 ${usage.completionTokens.toLocaleString("zh-CN")}`,
    `思考 ${usage.reasoningTokens.toLocaleString("zh-CN")}`,
    `缓存命中 ${usage.promptCacheHitTokens.toLocaleString("zh-CN")}`,
    `约 ¥${usage.estimatedCostCny.toFixed(4)}`,
  ].join(" / ") + availability;
}

function formatReviewFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/知识库 Skill v2 分析计划无效|模型输出经一次协议修复仍未通过 Skill 校验/u.test(message)) {
    return "AI 审理结果的结构格式不完整，LifeMind 已阻止写入。请再次点击开始审理，详细诊断已记录到本地日志。";
  }

  if (message.length > 240) {
    return `${message.slice(0, 240)}…（详细诊断已记录到本地日志）`;
  }

  return message;
}

function sourceTypeLabel(type: IntakeSourceType) {
  const labels: Record<IntakeSourceType, string> = {
    text: "文本",
    markdown: "Markdown",
    pdf: "PDF",
    image: "截图",
    web: "网页链接",
    code: "代码文件",
  };

  return labels[type];
}

function apiTestStatusLabel(state: ApiTestState) {
  if (state === "testing") return "测试中";
  if (state === "passed") return "成功";
  if (state === "failed") return "失败";
  return "未测试";
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function formatTimestamp(value: string) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000) : new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inferTitleFromText(content: string) {
  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) return "粘贴文本";

  return firstMeaningfulLine.replace(/^#+\s*/, "").slice(0, 28);
}

function EmptyWorkspace({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <motion.div
      className="content-card input-drop"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </motion.div>
  );
}

function LogicLinkUpdateWorkspace({
  draft,
  rangePreset,
  runState,
  message,
  previewState,
  onRangePresetChange,
  onGenerate,
  onOpenPreview,
  onConfirm,
  onDiscard,
}: {
  draft: LogicLinkUpdateDraft | null;
  rangePreset: LogicLinkRangePreset;
  runState: LogicLinkRunState;
  message: string;
  previewState: PreviewState;
  onRangePresetChange: (value: LogicLinkRangePreset) => void;
  onGenerate: () => void;
  onOpenPreview: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const isBusy = runState === "scanning" || runState === "reviewing" || runState === "confirming";
  const suggestions = draft?.suggestions ?? [];

  return (
    <motion.div
      className="content-card scan-workspace logic-link-workspace"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <section className="scan-queue logic-link-control-panel" aria-label="逻辑连接更新时间范围">
        <div className="scan-section-head">
          <span>更新时间范围</span>
          <strong>{draft?.rangeLabel ?? "未扫描"}</strong>
        </div>
        <div className="logic-range-list">
          {logicLinkRangeOptions.map((option) => (
            <button
              type="button"
              className={rangePreset === option.value ? "logic-range-active" : ""}
              disabled={isBusy}
              key={option.value}
              onClick={() => onRangePresetChange(option.value)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <div className="scan-diff-panel logic-link-status-card" data-state={runState}>
          <div>
            <span>处理状态</span>
            <strong>{logicLinkRunStateLabel(runState)}</strong>
          </div>
          <p>{message || "选择时间范围后生成建议。系统只生成草稿，确认前不会写入真实 Vault。"}</p>
        </div>
        <button type="button" className="primary-action logic-full-action" disabled={isBusy} onClick={onGenerate}>
          <ScanLine size={16} />
          {isBusy ? "处理中" : "生成逻辑连接建议"}
        </button>
      </section>

      <section className="scan-review-main logic-link-main" aria-label="逻辑连接更新主面板">
        <div className="scan-review-hero">
          <span>后续枝节</span>
          <h3>{draft ? "本次逻辑连接草稿" : "等待生成关系建议"}</h3>
          <p>
            {draft
              ? `扫描 ${draft.scannedNoteCount} 篇笔记，范围内 ${draft.selectedNoteCount} 篇，生成 ${suggestions.length} 条待确认连接。`
              : "系统会先按文件时间找出新增或近期修改的笔记，再由模型复审是否真的构成父子枝节关系。"}
          </p>
        </div>

        <div className="scan-review-grid">
          <div>
            <span>扫描范围</span>
            <strong>{draft?.rangeLabel ?? logicLinkRangeLabel(rangePreset)}</strong>
          </div>
          <div>
            <span>候选数量</span>
            <strong>{suggestions.length} 条</strong>
          </div>
          <div>
            <span>预览状态</span>
            <strong>{logicLinkPreviewStateLabel(previewState)}</strong>
          </div>
          <div>
            <span>写入方式</span>
            <strong>确认后追加到父笔记</strong>
          </div>
        </div>

        {suggestions.length > 0 ? (
          <div className="logic-link-suggestion-list">
            {suggestions.map((suggestion, index) => (
              <article className="logic-link-suggestion-card" key={suggestion.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>
                    {suggestion.parentTitle} → {suggestion.childTitle}
                  </h3>
                  <p>{suggestion.reason}</p>
                  <em>
                    {suggestion.parentPath} / {suggestion.source === "llm" ? "模型复审" : "时间排序脚本"}
                  </em>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="scan-diff-panel logic-empty-panel">
            <div>
              <span>当前草稿</span>
              <strong>{draft ? "没有可确认连接" : "尚未生成"}</strong>
            </div>
            <p>没有建议时不会写入 Vault。你可以扩大时间范围，或等新批次确认后再更新后续枝节。</p>
          </div>
        )}

        <div className="logic-link-inline-actions">
          <button type="button" className="secondary-action" disabled={!draft || isBusy} onClick={onDiscard}>
            <XCircle size={16} />
            放弃草稿
          </button>
          <button type="button" className="secondary-action" disabled={!draft || isBusy} onClick={onOpenPreview}>
            <ExternalLink size={16} />
            打开预览
          </button>
          <button type="button" className="primary-action" disabled={!draft || suggestions.length === 0 || isBusy} onClick={onConfirm}>
            <CheckCircle2 size={16} />
            确认写入
          </button>
        </div>
      </section>
    </motion.div>
  );
}

function LogicLinkSidePanel({
  draft,
  runState,
  message,
  previewState,
  lastManifest,
  vaultPath,
  onGenerate,
  onOpenPreview,
  onConfirm,
  onDiscard,
}: {
  draft: LogicLinkUpdateDraft | null;
  runState: LogicLinkRunState;
  message: string;
  previewState: PreviewState;
  lastManifest: BatchManifest | null;
  vaultPath: string;
  onGenerate: () => void;
  onOpenPreview: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const isBusy = runState === "scanning" || runState === "reviewing" || runState === "confirming";
  const suggestionCount = draft?.suggestions.length ?? 0;

  return (
    <>
      <section className="batch-state-card" data-state={runState}>
        <span>逻辑连接更新</span>
        <strong>{logicLinkRunStateLabel(runState)}</strong>
        <p>{message || "用户主动触发后，系统才会扫描时间范围并生成后续枝节写入草稿。"}</p>
      </section>

      <section className="check-section scan-process-panel">
        <h3>
          <ScanLine size={15} />
          更新链路
        </h3>
        <div className="scan-process-list">
          {["扫描真实 Vault", "按时间范围生成候选", "模型复审逻辑关系", "Obsidian 独立预览", "确认后事务写入并删除预览"].map(
            (step, index) => (
              <div className="scan-process-item" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="check-section scan-side-detail">
        <h3>
          <Link2 size={15} />
          本次草稿
        </h3>
        <div className="summary-row">
          <span>真实 Vault</span>
          <strong>{vaultPath.trim() || "未配置"}</strong>
        </div>
        <div className="summary-row">
          <span>建议数量</span>
          <strong>{suggestionCount} 条</strong>
        </div>
        <div className="summary-row">
          <span>预览状态</span>
          <strong>{logicLinkPreviewStateLabel(previewState)}</strong>
        </div>
        {draft && (
          <div className="summary-row">
            <span>草稿批次</span>
            <strong>{draft.id}</strong>
          </div>
        )}
        {lastManifest && (
          <div className="summary-row">
            <span>最近事务</span>
            <strong>{`.lifemind/batches/${lastManifest.batchId}/manifest.json`}</strong>
          </div>
        )}
      </section>

      <div className="action-panel scan-action-panel">
        <motion.button type="button" className="secondary-action" whileTap={{ scale: 0.98 }} disabled={isBusy} onClick={onGenerate}>
          <ScanLine size={16} />
          {isBusy ? "处理中" : "重新生成"}
        </motion.button>
        <motion.button
          type="button"
          className="secondary-action"
          whileTap={{ scale: 0.98 }}
          disabled={!draft || isBusy}
          onClick={onOpenPreview}
        >
          <ExternalLink size={16} />
          打开预览
        </motion.button>
        <motion.button
          type="button"
          className="secondary-action"
          whileTap={{ scale: 0.98 }}
          disabled={!draft || isBusy}
          onClick={onDiscard}
        >
          <XCircle size={16} />
          放弃草稿
        </motion.button>
        <motion.button
          type="button"
          className="primary-action"
          whileTap={{ scale: 0.98 }}
          disabled={!draft || suggestionCount === 0 || isBusy}
          onClick={onConfirm}
        >
          <CheckCircle2 size={16} />
          {runState === "confirming" ? "写入中" : "确认写入"}
        </motion.button>
      </div>
    </>
  );
}

const logicLinkRangeOptions: Array<{
  value: LogicLinkRangePreset;
  label: string;
  description: string;
}> = [
  { value: "1d", label: "最近 1 天", description: "只处理今天附近的新笔记" },
  { value: "7d", label: "最近 7 天", description: "适合每周整理一次" },
  { value: "30d", label: "最近 30 天", description: "适合阶段性补链" },
  { value: "all", label: "全库", description: "成本更高，适合首次维护" },
];

function logicLinkRangeToRequest(value: LogicLinkRangePreset): LogicLinkUpdateRange {
  if (value === "1d") return { kind: "recent", seconds: 86_400 };
  if (value === "7d") return { kind: "recent", seconds: 604_800 };
  if (value === "30d") return { kind: "recent", seconds: 2_592_000 };
  return { kind: "all" };
}

function logicLinkRangeLabel(value: LogicLinkRangePreset) {
  return logicLinkRangeOptions.find((option) => option.value === value)?.label ?? "最近 7 天";
}

function logicLinkRunStateLabel(state: LogicLinkRunState) {
  if (state === "scanning") return "扫描中";
  if (state === "reviewing") return "模型复审中";
  if (state === "ready") return "等待确认";
  if (state === "confirming") return "写入中";
  if (state === "confirmed") return "已确认";
  if (state === "failed") return "需要处理";
  return "未开始";
}

function logicLinkPreviewStateLabel(state: PreviewState) {
  if (state === "opening") return "打开中";
  if (state === "opened") return "已打开";
  if (state === "failed") return "打开失败";
  return "未打开";
}

function SettingsWorkspace({
  vaultPath,
  vaultCheckState,
  vaultInspection,
  reviewProvider,
  modelBaseUrl,
  modelName,
  modelApiKey,
  fallbackToLocal,
  keychainState,
  keychainMessage,
  apiTestState,
  apiTestMessage,
  onVaultPathChange,
  onValidateVaultPath,
  onReviewProviderChange,
  onModelBaseUrlChange,
  onModelNameChange,
  onModelApiKeyChange,
  onFallbackToLocalChange,
  onSaveModelApiKey,
  onTestModelApiConnection,
}: {
  vaultPath: string;
  vaultCheckState: VaultCheckState;
  vaultInspection: VaultInspection | null;
  reviewProvider: ReviewSkillProvider;
  modelBaseUrl: string;
  modelName: string;
  modelApiKey: string;
  fallbackToLocal: boolean;
  keychainState: KeychainState;
  keychainMessage: string;
  apiTestState: ApiTestState;
  apiTestMessage: string;
  onVaultPathChange: (value: string) => void;
  onValidateVaultPath: () => Promise<VaultInspection>;
  onReviewProviderChange: (value: ReviewSkillProvider) => void;
  onModelBaseUrlChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onModelApiKeyChange: (value: string) => void;
  onFallbackToLocalChange: (value: boolean) => void;
  onSaveModelApiKey: () => Promise<void>;
  onTestModelApiConnection: () => Promise<void>;
}) {
  const modelConfigured = modelBaseUrl.trim() && modelName.trim() && modelApiKey.trim();

  return (
    <motion.div
      className="content-card settings-list"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <article className="setting-row setting-row-input">
        <Database size={19} />
        <div>
          <h3>Obsidian Vault</h3>
          <p>真实写入只会操作这个文件夹，批次事务记录会写入该目录下的 .lifemind/batches。</p>
          <input
            value={vaultPath}
            onChange={(event) => onVaultPathChange(event.target.value)}
            placeholder="/Users/你的用户名/Documents/ObsidianVault"
            aria-label="真实 Obsidian Vault 路径"
          />
        </div>
        <button type="button" className="setting-action" onClick={() => void onValidateVaultPath()}>
          {vaultCheckState === "checking" ? "检查中" : vaultInspection?.canWrite ? "重新检查" : "检查路径"}
        </button>
      </article>
      {vaultInspection && (
        <article className="setting-row setting-validation-row" data-state={vaultCheckState}>
          <CheckCircle2 size={19} />
          <div>
            <h3>Vault 路径检查</h3>
            <p>{vaultInspection.message}</p>
            <div className="validation-badges">
              <span>{vaultInspection.exists ? "路径存在" : "路径不存在"}</span>
              <span>{vaultInspection.isDir ? "文件夹" : "非文件夹"}</span>
              <span>{vaultInspection.hasObsidianConfig ? "发现 .obsidian" : "未发现 .obsidian"}</span>
              <span>{vaultInspection.canWrite ? "可写" : "不可写"}</span>
            </div>
          </div>
          <span className="setting-state">{vaultCheckState === "checked" ? "通过" : "需处理"}</span>
        </article>
      )}
      {[
        ["知识库审理 Skill", "固定 JSON 协议已接入，当前所有审理批次都会先经过本地校验器。", WandSparkles, "已启用"],
        ["批次事务", "确认写入后创建 manifest 与覆盖备份，支持按批次撤销。", GitBranch],
        ["日历计划", "后续版本同步学习计划到 Apple Calendar。", CalendarClock],
      ].map(([title, text, Icon, state]) => (
        <article className="setting-row" key={title as string}>
          <Icon size={19} />
          <div>
            <h3>{title as string}</h3>
            <p>{text as string}</p>
          </div>
          <span className="setting-state">{(state as string | undefined) ?? "后续"}</span>
        </article>
      ))}
      <article className="setting-row setting-row-input">
        <KeyRound size={19} />
        <div>
          <h3>审理引擎</h3>
          <p>外部模型只负责返回 lifemind.review.v2 结构分析计划；笔记编译、写入、预览和回滚仍由 LifeMind 本地执行。</p>
          <div className="provider-toggle provider-grid" aria-label="审理引擎选择">
            {reviewModelProviderPresets.map((preset) => (
              <button
                type="button"
                key={preset.provider}
                className={reviewProvider === preset.provider ? "provider-active" : ""}
                onClick={() => {
                  onReviewProviderChange(preset.provider);
                  if (preset.baseUrl) onModelBaseUrlChange(preset.baseUrl);
                  if (preset.model) onModelNameChange(preset.model);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {reviewProvider !== "local" && (
            <div className="setting-input-grid">
              <input
                value={modelBaseUrl}
                onChange={(event) => onModelBaseUrlChange(event.target.value)}
                placeholder="https://api.deepseek.com"
                aria-label="模型 API base URL"
              />
              <input
                value={modelName}
                onChange={(event) => onModelNameChange(event.target.value)}
                placeholder="deepseek-v4-pro"
                aria-label="模型名称"
              />
              <input
                value={modelApiKey}
                onChange={(event) => onModelApiKeyChange(event.target.value)}
                placeholder="API Key，点击保存后进入系统钥匙串"
                aria-label="模型 API Key"
                type="password"
                autoComplete="off"
              />
              <div className="setting-button-row">
                <button
                  type="button"
                  className="setting-save-key"
                  disabled={keychainState === "loading"}
                  onClick={() => void onSaveModelApiKey()}
                >
                  {keychainState === "loading" ? "保存中" : "保存 Key"}
                </button>
                <button
                  type="button"
                  className="setting-test-api"
                  disabled={apiTestState === "testing" || keychainState === "loading"}
                  onClick={() => void onTestModelApiConnection()}
                >
                  {apiTestState === "testing" ? "测试中" : "测试 API 连接"}
                </button>
              </div>
              <label className="setting-switch-row">
                <input
                  type="checkbox"
                  checked={fallbackToLocal}
                  onChange={(event) => onFallbackToLocalChange(event.target.checked)}
                />
                <span>失败后使用本地 fallback</span>
              </label>
              {keychainMessage && <p className="keychain-message">{keychainMessage}</p>}
              {apiTestMessage && (
                <p className="api-test-message" data-state={apiTestState}>
                  {apiTestMessage}
                </p>
              )}
            </div>
          )}
        </div>
        <span className="setting-state">
          {reviewProvider === "local"
            ? "本地"
            : apiTestState === "passed"
              ? "已验证"
              : modelConfigured
                ? "已配置"
                : keychainState === "failed" || apiTestState === "failed"
                  ? "异常"
                  : "待补全"}
        </span>
      </article>
    </motion.div>
  );
}

function SideSummary({ items }: { items: Array<[string, string]> }) {
  return (
    <section className="check-section side-summary">
      {items.map(([label, value]) => (
        <div className="summary-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function waitForNextPaint() {
  if (typeof window === "undefined") return Promise.resolve();

  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function waitForMinimumLoading(startedAt: number) {
  if (typeof window === "undefined") return Promise.resolve();

  const remainingMs = Math.max(0, 900 - (getInteractionTimeMs() - startedAt));

  if (remainingMs === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remainingMs);
  });
}

function getInteractionTimeMs() {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}
