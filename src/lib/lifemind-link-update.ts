import type { VaultKnowledgeContext, VaultKnowledgeNote } from "./lifemind-core";

export const LOGIC_LINK_PROTOCOL_VERSION = "lifemind.logic-links.v1";

export type LogicLinkUpdateRange =
  | { kind: "recent"; seconds: number }
  | { kind: "custom"; from: number; to: number }
  | { kind: "all" };

export type LogicLinkSuggestionSource = "time-script" | "llm";

export type LogicLinkSuggestion = {
  id: string;
  parentTitle: string;
  parentPath: string;
  childTitle: string;
  childPath: string;
  parentHeadings: string[];
  childHeadings: string[];
  parentSnippet: string;
  childSnippet: string;
  relationType: "包含";
  reason: string;
  source: LogicLinkSuggestionSource;
  parentModifiedAt: number;
  childModifiedAt: number;
};

export type LogicLinkUpdateDraft = {
  id: string;
  createdAt: string;
  rangeLabel: string;
  scannedNoteCount: number;
  selectedNoteCount: number;
  suggestions: LogicLinkSuggestion[];
};

export type LogicLinkUpdateRequest = {
  protocolVersion: typeof LOGIC_LINK_PROTOCOL_VERSION;
  task: "review_logic_link_candidates";
  locale: "zh-CN";
  rangeLabel: string;
  candidates: Array<{
    candidateId: string;
    parentTitle: string;
    parentPath: string;
    childTitle: string;
    childPath: string;
    parentHeadings: string[];
    childHeadings: string[];
    parentSnippet: string;
    childSnippet: string;
    timeOrder: string;
    localReason: string;
  }>;
  constraints: string[];
  outputShape: {
    protocolVersion: typeof LOGIC_LINK_PROTOCOL_VERSION;
    accepted: "Array<{ candidateId: string; reason: string }>";
  };
};

export type LogicLinkUpdateModelOutput = {
  protocolVersion: typeof LOGIC_LINK_PROTOCOL_VERSION;
  accepted: Array<{
    candidateId: string;
    reason: string;
  }>;
};

export function buildLogicLinkSystemPrompt() {
  return [
    "你是 LifeMind 全库逻辑连接更新 Skill，只审理已有 Obsidian 笔记之间是否应该建立“后续枝节”链接。",
    "不要写入文件，不要调用外部工具，只返回严格 JSON。",
    "输入 candidates 已由本地时间排序脚本生成，每条候选表示：在父笔记的 ## 后续枝节 中追加子笔记链接。",
    "你的职责是基于标题、路径和时间顺序判断逻辑关系是否成立：父笔记必须是子笔记的上级主题、后续展开容器或合理的逻辑前置容器。",
    "可以删除不成立的候选；可以根据逻辑关系重排 accepted 顺序；不能新增候选边。",
    "不要因为关键词相似、同目录、同技术栈就接受候选。只有确实存在父子/枝节关系才接受。",
    "输出必须是单个 JSON 对象，protocolVersion 必须为 lifemind.logic-links.v1，不要包裹 Markdown 代码块。",
  ].join("\n");
}

type CreateLogicLinkDraftOptions = {
  now?: number;
  range: LogicLinkUpdateRange;
};

type ParentCandidate = {
  note: VaultKnowledgeNote;
  score: number;
  reason: string;
};

export function createLocalLogicLinkUpdateDraft(
  context: VaultKnowledgeContext,
  options: CreateLogicLinkDraftOptions,
): LogicLinkUpdateDraft {
  const nowMs = options.now === undefined ? Date.now() : options.now * 1000;
  const now = options.now ?? Math.floor(nowMs / 1000);
  const selectedNotes = selectNotesByRange(context.notes, options.range, now).sort(compareNotesByModifiedTime);
  const suggestions: LogicLinkSuggestion[] = [];
  const existingContains = new Set(
    (context.relations ?? [])
      .filter((relation) => relation.type === "包含")
      .map((relation) => relationKey(relation.source, relation.target)),
  );

  for (const child of selectedNotes) {
    const parent = selectParentCandidate(child, context.notes);

    if (!parent) continue;
    if (existingContains.has(relationKey(parent.note.title, child.title))) continue;

    suggestions.push({
      id: logicLinkSuggestionId(parent.note, child),
      parentTitle: parent.note.title,
      parentPath: parent.note.path,
      childTitle: child.title,
      childPath: child.path,
      parentHeadings: parent.note.headings,
      childHeadings: child.headings,
      parentSnippet: parent.note.snippet,
      childSnippet: child.snippet,
      relationType: "包含",
      reason: parent.reason,
      source: "time-script",
      parentModifiedAt: noteModifiedAt(parent.note),
      childModifiedAt: noteModifiedAt(child),
    });
  }

  return {
    id: `logic-links-${formatTimestamp(now)}-${String(Math.floor(nowMs % 1000)).padStart(3, "0")}`,
    createdAt: formatDisplayTime(now),
    rangeLabel: describeRange(options.range, now),
    scannedNoteCount: context.notes.length,
    selectedNoteCount: selectedNotes.length,
    suggestions: dedupeSuggestions(suggestions).slice(0, 80),
  };
}

export function createLogicLinkUpdateRequest(draft: LogicLinkUpdateDraft): LogicLinkUpdateRequest {
  return {
    protocolVersion: LOGIC_LINK_PROTOCOL_VERSION,
    task: "review_logic_link_candidates",
    locale: "zh-CN",
    rangeLabel: draft.rangeLabel,
    candidates: draft.suggestions.map((suggestion, index) => ({
      candidateId: suggestion.id,
      parentTitle: suggestion.parentTitle,
      parentPath: suggestion.parentPath,
      childTitle: suggestion.childTitle,
      childPath: suggestion.childPath,
      parentHeadings: suggestion.parentHeadings,
      childHeadings: suggestion.childHeadings,
      parentSnippet: suggestion.parentSnippet,
      childSnippet: suggestion.childSnippet,
      timeOrder: `${index + 1}. ${formatDisplayTime(suggestion.parentModifiedAt)} -> ${formatDisplayTime(
        suggestion.childModifiedAt,
      )}`,
      localReason: suggestion.reason,
    })),
    constraints: [
      "只返回 JSON，不返回解释文字。",
      "只能接受 candidates 中已有的 candidateId，不能新增候选边。",
      "只有在父笔记确实是子笔记的上级主题、后续枝节或逻辑前置容器时才接受。",
      "可以根据逻辑关系重排 accepted 顺序；不要机械照抄时间顺序。",
      "如果只是关键词相似但没有父子关系，应删除该候选。",
    ],
    outputShape: {
      protocolVersion: LOGIC_LINK_PROTOCOL_VERSION,
      accepted: "Array<{ candidateId: string; reason: string }>",
    },
  };
}

export function parseLogicLinkModelOutput(raw: string): LogicLinkUpdateModelOutput {
  const parsed = JSON.parse(extractJsonObject(raw)) as LogicLinkUpdateModelOutput;

  if (parsed.protocolVersion !== LOGIC_LINK_PROTOCOL_VERSION || !Array.isArray(parsed.accepted)) {
    throw new Error("逻辑连接模型输出不符合 lifemind.logic-links.v1 协议。");
  }

  return {
    protocolVersion: LOGIC_LINK_PROTOCOL_VERSION,
    accepted: parsed.accepted
      .map((item) => ({
        candidateId: String(item?.candidateId ?? "").trim(),
        reason: String(item?.reason ?? "").trim(),
      }))
      .filter((item) => item.candidateId && item.reason),
  };
}

export function mergeLogicLinkModelOutput(
  draft: LogicLinkUpdateDraft,
  output: LogicLinkUpdateModelOutput,
): LogicLinkUpdateDraft {
  const suggestionById = new Map(draft.suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const acceptedSuggestions = output.accepted.flatMap((accepted) => {
    const suggestion = suggestionById.get(accepted.candidateId);

    if (!suggestion) return [];

    return [
      {
        ...suggestion,
        reason: accepted.reason,
        source: "llm" as const,
      },
    ];
  });

  return {
    ...draft,
    suggestions: dedupeSuggestions(acceptedSuggestions),
  };
}

export function buildLogicLinkPreviewFiles(draft: LogicLinkUpdateDraft) {
  return [
    {
      path: "00-逻辑连接更新总览.md",
      content: buildLogicLinkOverviewMarkdown(draft),
    },
    ...draft.suggestions.map((suggestion, index) => ({
      path: `10-后续枝节建议/${String(index + 1).padStart(2, "0")}-${safeFileName(
        `${suggestion.parentTitle}-${suggestion.childTitle}`,
      )}.md`,
      content: [
        `# ${suggestion.parentTitle} -> ${suggestion.childTitle}`,
        "",
        `父笔记：[[${suggestion.parentTitle}]]`,
        `子笔记：[[${suggestion.childTitle}]]`,
        `关系：${suggestion.relationType}`,
        `来源：${suggestion.source === "llm" ? "LLM 审理" : "时间排序脚本"}`,
        "",
        "## 写入动作",
        `- 在 ${suggestion.parentPath} 的 \`## 后续枝节\` 中追加 [[${suggestion.childTitle}]]`,
        "",
        "## 理由",
        `- ${suggestion.reason}`,
      ].join("\n"),
    })),
  ];
}

export function buildLogicLinkPayload(draft: LogicLinkUpdateDraft) {
  return draft.suggestions.map((suggestion) => ({
    parentPath: suggestion.parentPath,
    parentTitle: suggestion.parentTitle,
    childTitle: suggestion.childTitle,
    childPath: suggestion.childPath,
    reason: suggestion.reason,
  }));
}

function selectNotesByRange(notes: VaultKnowledgeNote[], range: LogicLinkUpdateRange, now: number) {
  if (range.kind === "all") return notes;

  if (range.kind === "custom") {
    return notes.filter((note) => {
      const modifiedAt = noteModifiedAt(note);
      return modifiedAt >= range.from && modifiedAt <= range.to;
    });
  }

  const from = now - Math.max(0, range.seconds);

  return notes.filter((note) => noteModifiedAt(note) >= from && noteModifiedAt(note) <= now);
}

function selectParentCandidate(child: VaultKnowledgeNote, notes: VaultKnowledgeNote[]): ParentCandidate | null {
  const candidates = notes
    .filter((note) => note.path !== child.path && note.title !== child.title && note.root === child.root)
    .map((note) => scoreParentCandidate(note, child))
    .filter((candidate): candidate is ParentCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        right.score - left.score ||
        noteModifiedAt(left.note) - noteModifiedAt(right.note) ||
        left.note.path.localeCompare(right.note.path),
    );

  return candidates[0] ?? null;
}

function scoreParentCandidate(parent: VaultKnowledgeNote, child: VaultKnowledgeNote): ParentCandidate | null {
  const parentTitle = normalizeComparableText(parent.title);
  const childTitle = normalizeComparableText(child.title);
  const parentDir = dirname(parent.path);
  const childDir = dirname(child.path);
  let score = 0;
  const reasons: string[] = [];

  if (childTitle.startsWith(parentTitle) && childTitle.length > parentTitle.length) {
    score += 80;
    reasons.push(`子笔记标题以“${parent.title}”为主题前缀`);
  }

  if (childDir === parentDir) {
    score += 35;
    reasons.push("父子笔记位于同一主题目录");
  }

  if (childDir.includes(`/${safePathComparable(parent.title)}`) || childDir.endsWith(safePathComparable(parent.title))) {
    score += 60;
    reasons.push(`子笔记目录落在“${parent.title}”主题容器下`);
  }

  if (noteModifiedAt(parent) <= noteModifiedAt(child)) {
    score += 15;
    reasons.push("父笔记时间早于或等于子笔记，符合时间排序");
  }

  if (score < 100) return null;

  return {
    note: parent,
    score,
    reason: reasons.join("；"),
  };
}

function compareNotesByModifiedTime(left: VaultKnowledgeNote, right: VaultKnowledgeNote) {
  return noteModifiedAt(left) - noteModifiedAt(right) || left.path.localeCompare(right.path);
}

function noteModifiedAt(note: VaultKnowledgeNote) {
  return typeof note.modifiedAt === "number" ? note.modifiedAt : 0;
}

function dirname(path: string) {
  return path.replace(/\\/g, "/").split("/").slice(0, -1).map(safePathComparable).join("/");
}

function safePathComparable(value: string) {
  return normalizeComparableText(value.replace(/\.(?:md|markdown)$/i, ""));
}

function relationKey(source: string, target: string) {
  return `${normalizeComparableText(source)}->${normalizeComparableText(target)}`;
}

function logicLinkSuggestionId(parent: VaultKnowledgeNote, child: VaultKnowledgeNote) {
  return `logic-link-${slugSegment(parent.path)}-${slugSegment(child.path)}`;
}

function slugSegment(value: string) {
  const ascii = value.toLowerCase().match(/[a-z0-9]+/g)?.join("-") ?? "";

  if (ascii) return ascii.slice(0, 80);

  return [...normalizeComparableText(value)]
    .map((character) => character.charCodeAt(0).toString(36))
    .slice(0, 24)
    .join("-");
}

function dedupeSuggestions(suggestions: LogicLinkSuggestion[]) {
  const seen = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = `${suggestion.parentPath}->${suggestion.childTitle}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeRange(range: LogicLinkUpdateRange, now: number) {
  if (range.kind === "all") return "全库";
  if (range.kind === "custom") return `${formatDisplayTime(range.from)} 至 ${formatDisplayTime(range.to)}`;

  const days = Math.round(range.seconds / 86_400);

  if (days >= 1) return `最近 ${days} 天`;
  return `${formatDisplayTime(now - range.seconds)} 至 ${formatDisplayTime(now)}`;
}

function buildLogicLinkOverviewMarkdown(draft: LogicLinkUpdateDraft) {
  const rows =
    draft.suggestions.length > 0
      ? draft.suggestions
          .map(
            (suggestion, index) =>
              `${index + 1}. [[${suggestion.parentTitle}]] -> [[${suggestion.childTitle}]]\n   - ${suggestion.reason}`,
          )
          .join("\n")
      : "- 本次没有可确认的后续枝节建议。";

  return [
    "# LifeMind 逻辑连接更新总览",
    "",
    `批次：${draft.id}`,
    `创建时间：${draft.createdAt}`,
    `范围：${draft.rangeLabel}`,
    `扫描笔记：${draft.scannedNoteCount}`,
    `范围内笔记：${draft.selectedNoteCount}`,
    `建议数量：${draft.suggestions.length}`,
    "",
    "## 后续枝节建议",
    rows,
  ].join("\n");
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "未命名";
}

function formatTimestamp(value: number) {
  const date = new Date(value * 1000);

  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
}

function formatDisplayTime(value: number) {
  if (value <= 0) return "未知时间";

  const date = new Date(value * 1000);

  return `${[date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-")} ${[date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")}`;
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, "").replace(/[\\/]+/g, "/").toLowerCase();
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("模型输出中没有 JSON 对象。");
  }

  return trimmed.slice(start, end + 1);
}
