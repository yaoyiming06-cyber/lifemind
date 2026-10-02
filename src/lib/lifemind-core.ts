import {
  REVIEW_ANALYSIS_PROTOCOL_VERSION,
  REVIEW_SKILL_PROTOCOL_VERSION,
  buildTaxonomyCandidates,
  buildVaultKnowledgeIndex,
  normalizeVaultContext,
  parseReviewAnalysisPlan,
  extractSourceOrganizationSignals,
  validateReviewAnalysisPlan,
  validateReviewSkillOutput,
  type ReviewAnalysisPlan,
  type ReviewAnalysisPlacement,
  type ReviewAnalysisRelation,
  type ReviewAnalysisSection,
  type ReviewAnalysisFormula,
  type ReviewAnalysisImagePlacement,
  type ReviewAnalysisPageCoverage,
  type ReviewAnalysisValidationOptions,
  type ReviewSkillOutput,
  type SourceOrganizationSignal,
  type VaultKnowledgeContext,
  type VaultKnowledgeNote,
  type VaultKnowledgeNode,
  type VaultKnowledgeRoot,
} from "./lifemind-review-skill";
import { formatKnowledgeMarkdown, normalizeFormulaExpression } from "./lifemind-presentation";
import { effectiveSourceCharacterCount } from "./lifemind-source-structure";

export {
  REVIEW_ANALYSIS_PROTOCOL_VERSION,
  REVIEW_SKILL_PROTOCOL_VERSION,
  buildReviewSkillSystemPrompt,
  buildVaultKnowledgeIndex,
  createReviewAnalysisRequest,
  createReviewSkillRequest,
  parseReviewSkillOutput,
  parseReviewAnalysisPlan,
  validateReviewAnalysisPlan,
  validateReviewSkillOutput,
  type ReviewSkillOutput,
  type ReviewAnalysisPlan,
  type ReviewAnalysisRequest,
  type ReviewAnalysisSection,
  type ReviewAnalysisPlacement,
  type ReviewAnalysisValidationOptions,
  type ReviewSkillRequest,
  type ReviewSkillValidationError,
  type ReviewSkillValidationResult,
  type SourceOrganizationSignal,
  type VaultKnowledgeContext,
  type VaultKnowledgeNote,
  type VaultKnowledgeRelation,
  type VaultKnowledgeRoot,
  type VaultKnowledgeNode,
  type VaultTaxonomyCandidate,
} from "./lifemind-review-skill";

export type IntakeSourceType = "text" | "markdown" | "pdf" | "image" | "web" | "code";
export type BatchStatus = "draft" | "confirmed" | "removed";
export type KnowledgeGrain = "大颗粒度" | "中颗粒度" | "小颗粒度";
export type PdfQualityStatus = "normal" | "warning" | "partial" | "blocked";
export type RelationType =
  | "依赖"
  | "包含"
  | "并列"
  | "递进"
  | "对比"
  | "应用于"
  | "容易混淆"
  | "前置知识";

export type IntakeSource = {
  id: string;
  title: string;
  type: IntakeSourceType;
  content: string;
  stackHint?: string;
  pdfQuality?: PdfQualityAssessment;
  pdfEvidence?: PdfEvidence;
};

export type PdfEvidence = {
  pages: PdfPageEvidence[];
  images?: PdfEmbeddedImage[];
};

export type PdfEmbeddedImage = {
  assetId: string;
  page: number;
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageDataUrl?: string;
};

export type PdfPageEvidence = {
  page: number;
  assetId?: string;
  imageWidth: number;
  imageHeight: number;
  imageReviewRequired: boolean;
  imageDataUrl?: string;
  evidence: PdfEvidenceLine[];
};

export type PdfEvidenceLine = {
  id: string;
  text: string;
  source: "pdf-text" | "vision-ocr";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence: number;
  candidates: string[];
};

export type PdfQualityAssessment = {
  qualityStatus: PdfQualityStatus;
  difficultyRatio: number;
  difficultCharacterCount: number;
  totalCharacterCount: number;
  requiresManualReview: boolean;
  criticalUnresolved: string[];
  textLayerLowQuality?: boolean;
};

export type Correction = {
  sourceId: string;
  original: string;
  fixed: string;
  reason: string;
};

export type GeneratedNote = {
  id: string;
  sourceId: string;
  title: string;
  grain: KnowledgeGrain;
  path: string;
  status: "新建笔记" | "合并到旧笔记";
  markdown: string;
};

export type KnowledgeRelation = {
  type: RelationType;
  source: string;
  target: string;
};

export type ReviewBatch = {
  id: string;
  status: BatchStatus;
  createdAt: string;
  sources: IntakeSource[];
  corrections: Correction[];
  notes: GeneratedNote[];
  relations: KnowledgeRelation[];
  moves: VaultMoveFile[];
  uncertain: string[];
};

export type PreviewFile = {
  path: string;
  content: string;
};

export type PreparedPdfExtractedContent = {
  content: string;
  warnings: string[];
  quality: PdfQualityAssessment;
};

export type VaultWriteFile = {
  path: string;
  content: string;
  noteId: string;
  title: string;
  binary?: boolean;
};

export type VaultAssetFile = {
  path: string;
  dataUrl: string;
  noteId: string;
  title: string;
};

export type VaultMoveFile = {
  fromPath: string;
  toPath: string;
  noteId: string;
  title: string;
  reason: string;
};

type CreateReviewBatchOptions = {
  now?: Date;
  vaultContext?: VaultKnowledgeContext | null;
  externalReferenceTitles?: string[];
  allowTrustedDerivedPaths?: boolean;
  allowedPdfImageEvidence?: ReviewAnalysisValidationOptions["allowedPdfImageEvidence"];
};

const javaPrintOriginal = "print 会自动换行，println 主要用于不换行输出。";
const pythonAppendOriginal = "append 会返回一个新的列表。";
const sqlWhereOriginal = "where count(*) > 3";

export function preparePdfExtractedContent(
  title: string,
  content: string,
  pdfEvidence?: PdfEvidence,
  qualityContent?: string,
  textLayerLowQuality = false,
): PreparedPdfExtractedContent {
  const normalizedContent = content.trim();
  const normalizedQualityContent = (qualityContent ?? content).trim();
  const measuredQuality = assessPdfExtractionQuality(normalizedQualityContent);
  const quality: PdfQualityAssessment = textLayerLowQuality
    ? {
        ...measuredQuality,
        qualityStatus: measuredQuality.qualityStatus === "normal" ? "warning" : measuredQuality.qualityStatus,
        requiresManualReview: true,
        textLayerLowQuality: true,
      }
    : measuredQuality;
  const noisyExtraction = isNoisyPdfExtraction(normalizedQualityContent);
  const hasVisualEvidence = Boolean(
    pdfEvidence?.pages.some((page) => page.imageReviewRequired && page.imageDataUrl),
  );
  const warnings = buildPdfQualityWarnings(quality, noisyExtraction, hasVisualEvidence);

  if (!noisyExtraction && quality.qualityStatus === "normal" && !quality.requiresManualReview) {
    return {
      content: normalizedContent,
      warnings,
      quality,
    };
  }

  return {
    content: [
      "【PDF 抽取质量提示】",
      textLayerLowQuality
        ? "- PDF 文本层存在公式结构或字符映射异常，已从正文和逐行证据中移除；请检查随请求发送的原始页面图像。"
        : "- 这份 PDF 可能是手写或扫描笔记；以下正文来自 PDF 文本层提取，可能存在错别字、拆字、乱码和技术名误识别。",
      "- 审理时请结合技术栈提示、上下文和常见嵌入式术语进行语义纠偏，例如 STM32、UART、GPIO、ADC、DMA、PWM、TIM、I2C、SPI、PID 等。",
      "- 不要逐字照搬识别噪声；无法确认的内容放入 uncertain，不要编造成确定知识。",
      `- 本地质量阀门：困难文字占比约 ${Math.round(quality.difficultyRatio * 100)}%，当前状态为 ${pdfQualityStatusLabel(quality)}。`,
      ...(quality.qualityStatus === "partial" ? ["- 只允许对可确认内容进行部分审理，困难片段必须放入 uncertain。"] : []),
      ...(quality.qualityStatus === "blocked"
        ? ["- 困难文字超过 50%；先结合对应原始页图像进行视觉复核，只能把视觉明确确认的片段用于确定知识；无法确认的内容放入 uncertain。"]
        : []),
      ...(quality.criticalUnresolved.length > 0
        ? ["- 以下关键结构包含无法确认的文字，必须人工复核，不得当作确定公式、定义或关系：", ...quality.criticalUnresolved.map((line) => `  - ${line}`)]
        : []),
      "",
      `【PDF 文件名】${title.trim() || "未命名 PDF"}`,
      "",
      "【PDF 抽取正文】",
      normalizedContent,
    ].join("\n"),
    warnings,
    quality,
  };
}

export function assessPdfExtractionQuality(content: string): PdfQualityAssessment {
  const normalizedContent = content.trim();
  const compact = normalizedContent.replace(/\s+/gu, "");
  const totalCharacterCount = Array.from(compact).length;
  const difficultCharacterCount = countDifficultPdfCharacters(compact);
  const difficultyRatio = totalCharacterCount === 0 ? 0 : difficultCharacterCount / totalCharacterCount;
  const qualityStatus = getPdfQualityStatus(difficultyRatio);
  const criticalUnresolved = normalizedContent
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && hasDifficultPdfSignal(line) && isCriticalPdfLine(line))
    .slice(0, 8);

  return {
    qualityStatus,
    difficultyRatio,
    difficultCharacterCount,
    totalCharacterCount,
    requiresManualReview: qualityStatus !== "normal" || criticalUnresolved.length > 0,
    criticalUnresolved,
  };
}

function countDifficultPdfCharacters(content: string) {
  const directDifficultCharacters = Array.from(content).filter((character) =>
    /[�□\u2f00-\u2fdf]/u.test(character),
  ).length;
  const difficultTokens = [
    /\(cid:\d+\)/giu,
    /\b(?:STM\s*2B|VABT|MCV|ABM|OI[O0]|GTM|APC\s*DMA|SADC)\b/giu,
    /(?:⾁\s*核|串叫|输⼊输出|被控[⼜又]对象)/gu,
  ];
  const difficultTokenCharacters = difficultTokens.reduce(
    (count, pattern) => count + (content.match(pattern) ?? []).reduce((total, token) => total + Array.from(token).length, 0),
    0,
  );

  return Math.min(Array.from(content).length, directDifficultCharacters + difficultTokenCharacters);
}

function hasDifficultPdfSignal(line: string) {
  return countDifficultPdfCharacters(line.replace(/\s+/gu, "")) > 0;
}

function isCriticalPdfLine(line: string) {
  return (
    /(?:公式|定义|原理|关系|依赖|箭头|步骤|核心|定理)/u.test(line) ||
    /^(?:#{1,6}\s+|(?:[一二三四五六七八九十百]+[、.．]|\d+[.)、．]))/u.test(line) ||
    /(?:=|->|→|=>|≤|≥|∑|∫|√)/u.test(line)
  );
}

function getPdfQualityStatus(difficultyRatio: number): PdfQualityStatus {
  if (difficultyRatio > 0.5) return "blocked";
  if (difficultyRatio > 0.3) return "partial";
  if (difficultyRatio > 0.2) return "warning";
  return "normal";
}

function pdfQualityStatusLabel(quality: PdfQualityAssessment) {
  if (quality.textLayerLowQuality) return "PDF 文本层结构异常，需按页面图像复核";

  switch (quality.qualityStatus) {
    case "warning":
      return "允许审理但需提示风险（20%～30%）";
    case "partial":
      return "仅部分审理（30%～50%）";
    case "blocked":
      return "禁止生成确定知识（超过 50%）";
    default:
      return "正常审理（不超过 20%）";
  }
}

function buildPdfQualityWarnings(
  quality: PdfQualityAssessment,
  noisyExtraction: boolean,
  hasVisualEvidence = false,
) {
  const warnings: string[] = [];

  if (noisyExtraction) {
    warnings.push("检测到这可能是手写或扫描笔记，PDF 文本层存在错字、拆字或乱码。");
  }

  if (quality.textLayerLowQuality) {
    warnings.push("Rust PDF 文本层检测到公式或字符映射异常；确定知识必须以页面图像复核为准。");
  } else if (quality.qualityStatus === "warning") {
    warnings.push("PDF 困难文字占比处于 20%～30% 区间，允许审理但需要提示风险。");
  } else if (quality.qualityStatus === "partial") {
    warnings.push("PDF 困难文字占比处于 30%～50% 区间，只允许对可确认内容进行部分审理。");
  } else if (quality.qualityStatus === "blocked") {
    warnings.push("PDF 困难文字超过 50%，禁止生成确定知识。");
  }

  if (quality.criticalUnresolved.length > 0) {
    warnings.push("PDF 的关键公式、标题、定义或关系存在无法确认的文字，必须人工复核。");
  }

  if (quality.requiresManualReview && hasVisualEvidence) {
    warnings.push("对应 PDF 页面图像已附带到模型请求，可用于视觉复核。");
  }

  return warnings;
}

function isNoisyPdfExtraction(content: string) {
  if (!content) return false;

  const compact = content.replace(/\s+/g, "");
  const characterCount = Math.max(1, compact.length);
  const compatibilityRadicalCount = (compact.match(/[\u2f00-\u2fdf]/gu) ?? []).length;
  const cidCount = (content.match(/\(?cid:\d+\)?/giu) ?? []).length;
  const replacementCount = (content.match(/[�□]/gu) ?? []).length;
  const suspiciousTechnicalAliasCount = (
    content.match(/\b(?:STM\s*2B|VABT|MCV|ABM|OI[O0]|GTM|APC\s*DMA|SADC)\b/giu) ?? []
  ).length;
  const compatibilityRatio = compatibilityRadicalCount / characterCount;

  return (
    cidCount > 0 ||
    replacementCount > 0 ||
    suspiciousTechnicalAliasCount >= 2 ||
    (content.length > 180 && compatibilityRatio > 0.012)
  );
}

export function createReviewBatch(
  sources: IntakeSource[],
  options: CreateReviewBatchOptions = {},
): ReviewBatch {
  const normalizedSources = sources.map(normalizeSource);
  const localSkillOutput = createLocalReviewSkillOutput(normalizedSources);

  return createReviewBatchFromAnalysisPlan(
    normalizedSources,
    adaptReviewSkillOutputToAnalysisPlan(normalizedSources, localSkillOutput),
    {
      ...options,
      externalReferenceTitles: [
        ...(options.externalReferenceTitles ?? []),
        ...(options.vaultContext?.notes.map((note) => note.title) ?? []),
        ...(options.vaultContext?.roots.map((root) => root.name) ?? []),
        ...localSkillOutput.relations.flatMap((relation) => [relation.source, relation.target]),
      ],
      allowTrustedDerivedPaths: true,
    },
  );
}

export function selectVaultContextForSources(
  context: VaultKnowledgeContext | null | undefined,
  sources: IntakeSource[],
): VaultKnowledgeContext | null {
  const maxSelectedNotes = 12;
  const maxSelectedRelations = 40;

  if (!context || sources.length === 0) return null;

  const queryText = sources
    .map((source) => `${source.title}\n${source.stackHint ?? ""}\n${source.content}`)
    .join("\n")
    .toLowerCase();
  const queryTokens = extractSearchTokens(queryText);
  const explicitRootNames = new Set(
    sources
      .map((source) => source.stackHint?.split(/[\\/]/)[0]?.trim() ?? "")
      .filter(Boolean)
      .map(normalizeComparableText),
  );
  const hasExplicitRoot = explicitRootNames.size > 0;
  const directNoteTitles = new Set<string>();
  const noteScoreByTitle = new Map<string, number>();

  for (const note of context.notes) {
    if (hasExplicitRoot && !explicitRootNames.has(normalizeComparableText(note.root))) {
      continue;
    }

    const score = scoreVaultNoteForQuery(note, queryText, queryTokens);

    if (score <= 0) continue;
    directNoteTitles.add(note.title);
    noteScoreByTitle.set(note.title, score);
  }

  const selectedNoteTitles = new Set([...directNoteTitles]);
  const noteByTitle = new Map(context.notes.map((note) => [note.title, note]));
  const sortedDirectTitles = [...directNoteTitles].sort(
    (left, right) => (noteScoreByTitle.get(right) ?? 0) - (noteScoreByTitle.get(left) ?? 0),
  );

  for (const title of sortedDirectTitles) {
    if (selectedNoteTitles.size >= maxSelectedNotes) break;

    for (const relation of context.relations ?? []) {
      if (selectedNoteTitles.size >= maxSelectedNotes) break;

      if (relation.source === title && noteByTitle.has(relation.target)) {
        selectedNoteTitles.add(relation.target);
      }

      if (relation.target === title && noteByTitle.has(relation.source)) {
        selectedNoteTitles.add(relation.source);
      }
    }
  }

  const selectedNotes = context.notes.filter((note) => selectedNoteTitles.has(note.title)).slice(0, maxSelectedNotes);
  const selectedRootNames = new Set(selectedNotes.map((note) => note.root));

  for (const root of context.roots) {
    if (hasExplicitRoot && !explicitRootNames.has(normalizeComparableText(root.name))) {
      continue;
    }

    if (scoreVaultRootForQuery(root, queryText, queryTokens) > 0) {
      selectedRootNames.add(root.name);
    }

    if (hasExplicitRoot && explicitRootNames.has(normalizeComparableText(root.name))) {
      selectedRootNames.add(root.name);
    }
  }

  const selectedRoots = context.roots
    .filter((root) => selectedRootNames.has(root.name))
    .map((root) => ({
      ...root,
      paths:
        hasExplicitRoot && explicitRootNames.has(normalizeComparableText(root.name))
          ? uniqueLines([root.name, ...root.paths]).slice(0, 24)
          : selectRootPathsForQuery(root, queryText, queryTokens),
    }))
    .slice(0, 12);
  const selectedRelations = (context.relations ?? [])
    .filter((relation) => selectedNoteTitles.has(relation.source) && selectedNoteTitles.has(relation.target))
    .slice(0, maxSelectedRelations);

  if (selectedRoots.length === 0 && selectedNotes.length === 0 && selectedRelations.length === 0) {
    return null;
  }

  return {
    roots: selectedRoots,
    notes: selectedNotes,
    relations: selectedRelations,
  };
}

export function createReviewBatchFromSkillOutput(
  sources: IntakeSource[],
  skillOutput: unknown,
  options: CreateReviewBatchOptions = {},
): ReviewBatch {
  const now = options.now ?? new Date();
  const normalizedSources = sources.map(normalizeSource);
  const validation = validateReviewSkillOutput(skillOutput, normalizedSources);

  if (!validation.ok) {
    const details = validation.errors.map((error) => `${error.path} ${error.message}`).join("；");
    throw new Error(`知识库 Skill 输出无效：${details}`);
  }
  const organizationAlignedNotes = alignNotesWithSourceOrganizationSignals(
    validation.output.notes,
    normalizedSources,
    options.vaultContext ?? null,
  );
  const pathNormalizedNotes = organizationAlignedNotes.map(normalizeGeneratedNotePath);
  const promotionPlan = applyExistingTopicPromotions(
    pathNormalizedNotes,
    normalizedSources,
    options.vaultContext ?? null,
  );
  const uniqueTargetNotes = ensureUniqueGeneratedNoteTargets(promotionPlan.notes);
  const relations = normalizeRelations(
    [...validation.output.relations, ...promotionPlan.relations],
    uniqueTargetNotes,
  );
  const notes = uniqueTargetNotes.map((note) => normalizeGeneratedNote(note, relations));

  return {
    id: createBatchId(now),
    status: "draft",
    createdAt: formatLocalDateTime(now),
    sources: normalizedSources,
    corrections: validation.output.corrections,
    notes,
    relations,
    moves: promotionPlan.moves,
    uncertain: validation.output.uncertain,
  };
}

export function createReviewBatchFromAnalysisPlan(
  sources: IntakeSource[],
  analysisPlan: unknown,
  options: CreateReviewBatchOptions = {},
): ReviewBatch {
  const now = options.now ?? new Date();
  const normalizedSources = sources.map(normalizeSource);
  const vaultIndex = buildVaultKnowledgeIndex(options.vaultContext);
  const validationOptions: ReviewAnalysisValidationOptions = {
    enforceStackHints: true,
    externalReferenceTitles: [
      ...(options.externalReferenceTitles ?? []),
      ...(options.vaultContext?.notes.map((note) => note.title) ?? []),
      ...(options.vaultContext?.roots.map((root) => root.name) ?? []),
    ],
    knownRootNames: options.vaultContext?.roots.map((root) => root.name) ?? [],
    taxonomyCandidates: buildTaxonomyCandidates(normalizeVaultContext(options.vaultContext)),
    vaultIndex,
    allowedPdfImageEvidence: options.allowedPdfImageEvidence,
    allowTrustedDerivedPaths: options.allowTrustedDerivedPaths,
    allowLegacyPathCompatibility: true,
  };
  const validation = validateReviewAnalysisPlan(analysisPlan, normalizedSources, validationOptions);

  if (!validation.ok) {
    const details = validation.errors.map((error) => `${error.path} ${error.message}`).join("；");
    throw new Error(`知识库 Skill v2 分析计划无效：${details}`);
  }

  const stackBySourceId = new Map(
    validation.output.stackDecisions.map((decision) => [decision.sourceId, decision.name]),
  );
  const numberedSections = applyPdfSectionNumbers(
    validation.output.sections,
    normalizedSources,
    validation.output.pageCoverage,
    options.vaultContext,
  );
  const draftNotes = numberedSections.map((section) =>
    compileAnalysisSection(
      section,
      stackBySourceId.get(section.sourceId) ?? "未归类",
      vaultIndex,
      normalizedSources.find((source) => source.id === section.sourceId),
    ),
  );
  const organizationAlignedNotes = draftNotes.map((note) => {
    const section = numberedSections.find((candidate) => candidate.id === note.id);

    if (section?.placement) return note;

    return alignNotesWithSourceOrganizationSignals(
      [note],
      normalizedSources,
      options.vaultContext ?? null,
    )[0] ?? note;
  });
  const pathNormalizedNotes = organizationAlignedNotes.map((note) => {
    const section = numberedSections.find((candidate) => candidate.id === note.id);
    return section?.placement ? note : normalizeGeneratedNotePath(note);
  });
  const topicFolderPlan = applyAnalysisTopicFolderGrouping(
    pathNormalizedNotes,
    numberedSections,
    validation.output.relations,
    normalizedSources,
    vaultIndex,
    options.vaultContext ?? null,
  );
  const usesNodePlacement = numberedSections.some((section) => section.placement);
  const promotionPlan = usesNodePlacement
    ? { notes: topicFolderPlan.notes, moves: [], relations: [] }
    : applyExistingTopicPromotions(
        topicFolderPlan.notes,
        normalizedSources,
        options.vaultContext ?? null,
      );
  const numberedPdfNotes = applyNumberedPdfTopicFolders(
    promotionPlan.notes,
    numberedSections,
    normalizedSources,
    validation.output.pageCoverage,
  );
  const uniqueNotes = ensureUniqueGeneratedNoteTargets(numberedPdfNotes);
  const moves = dedupeVaultMoveFiles([...topicFolderPlan.moves, ...promotionPlan.moves]);
  const relationCandidates = [
    ...numberedSections.flatMap((section) =>
      section.parentId
        ? [{ type: "包含" as const, source: section.parentId, target: section.id }]
        : [],
    ),
    ...validation.output.relations.map((relation) => ({
      type: relation.type,
      source: resolveAnalysisReference(relation.source, numberedSections, uniqueNotes),
      target: resolveAnalysisReference(relation.target, numberedSections, uniqueNotes),
      ...(relation.sourceNodeId ? { sourceNodeId: relation.sourceNodeId } : {}),
      ...(relation.targetNodeId ? { targetNodeId: relation.targetNodeId } : {}),
    })),
    ...promotionPlan.relations,
  ];
  const unresolvedRelations = collectUnresolvedNodeRelations(relationCandidates, uniqueNotes, vaultIndex);
  const relations = normalizeRelations(relationCandidates, uniqueNotes, vaultIndex);
  const notes = uniqueNotes.map((note) => normalizeGeneratedNote(note, relations));

  return {
    id: createBatchId(now),
    status: "draft",
    createdAt: formatLocalDateTime(now),
    sources: normalizedSources,
    corrections: validation.output.corrections,
    notes,
    relations,
    moves,
    uncertain: [...validation.output.uncertain, ...unresolvedRelations, ...topicFolderPlan.uncertain],
  };
}

export function adaptReviewSkillOutputToAnalysisPlan(
  sources: IntakeSource[],
  legacyOutput: ReviewSkillOutput,
): ReviewAnalysisPlan {
  const normalizedSources = sources.map(normalizeSource);
  const notesBySourceId = new Map<string, GeneratedNote[]>();

  for (const note of legacyOutput.notes) {
    notesBySourceId.set(note.sourceId, [...(notesBySourceId.get(note.sourceId) ?? []), note]);
  }

  const stackDecisions = normalizedSources.map((source) => {
    const sourceNote = notesBySourceId.get(source.id)?.[0];
    const hintedRoot = source.stackHint?.split(/[\\/]/)[0]?.trim() ?? "";
    const inferredRoot = sourceNote ? getRootPathSegment(sourceNote.path) : "";
    const name = hintedRoot || inferredRoot || "未归类";

    return {
      sourceId: source.id,
      name,
      confidence: hintedRoot ? ("高" as const) : ("中" as const),
      evidence: [hintedRoot ? "用户技术栈提示" : "兼容 v1 笔记路径推断"],
    };
  });
  const sectionIdByTitle = new Map(legacyOutput.notes.map((note) => [normalizeComparableText(note.title), note.id]));
  const sections = legacyOutput.notes.map((note) => {
    const stack = stackDecisions.find((decision) => decision.sourceId === note.sourceId)?.name ?? "未归类";
    const path = note.path
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment, index, segments) => {
        if (index === 0 && normalizeComparableText(segment) === normalizeComparableText(stack)) return false;
        return index !== segments.length - 1 || normalizeComparableText(segment) !== normalizeComparableText(note.title);
      });
    const parentRelation = legacyOutput.relations.find(
      (relation) =>
        relation.type === "包含" &&
        normalizeComparableText(relation.target) === normalizeComparableText(note.title) &&
        sectionIdByTitle.has(normalizeComparableText(relation.source)),
    );
    const fallbackPath = path.length > 0 ? path : [note.grain === "大颗粒度" ? "总览" : "知识"];

    return {
      id: note.id,
      sourceId: note.sourceId,
      title: note.title,
      role: note.grain === "大颗粒度" ? "总览" : "知识",
      grain: note.grain,
      path: fallbackPath,
      ...(parentRelation
        ? { parentId: sectionIdByTitle.get(normalizeComparableText(parentRelation.source)) }
        : {}),
      status: note.status,
      body: note.markdown,
      formulas: [],
      imagePlacements: [],
      evidence: ["兼容 v1 笔记内容"],
    };
  });
  const relations = legacyOutput.relations.map((relation) => ({
    ...relation,
    evidence: "兼容 v1 关系输出",
    confidence: "中" as const,
  }));

  return {
    protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
    stackDecisions,
    sections,
    relations,
    corrections: legacyOutput.corrections,
    uncertain: legacyOutput.uncertain,
  };
}

function compileAnalysisSection(
  section: ReviewAnalysisSection,
  stack: string,
  vaultIndex: VaultKnowledgeNode[] = [],
  source?: IntakeSource,
): GeneratedNote {
  const modelRelativePath = section.placement
    ? resolvePlacementRelativePath(section.placement, stack, vaultIndex)
    : section.path ?? [];
  const relativePath = modelRelativePath
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment, index) => index !== 0 || normalizeComparableText(segment) !== normalizeComparableText(stack));

  return {
    id: section.id,
    sourceId: section.sourceId,
    title: section.title,
    grain: section.grain,
    path: [stack, ...relativePath].join(" / "),
    status: section.status,
    markdown: compileAnalysisSectionMarkdown(section, source),
  };
}

function compileAnalysisSectionMarkdown(section: ReviewAnalysisSection, source?: IntakeSource) {
  let body = source?.type === "pdf" ? removePdfBodyImages(section.body) : section.body;

  for (const formula of section.formulas) {
    const marker = `{{formula:${formula.id}}}`;
    const rendered = renderAnalysisFormula(formula);
    body = body.split(marker).join(rendered);
  }

  const placements = section.imagePlacements.map((placement) => ({
    placement,
    markdown: renderAnalysisImagePlacement(placement, source),
  }));

  for (const item of placements.filter(({ placement }) => placement.placement === "inline")) {
    if (item.placement.anchor) {
      body = body.split(item.placement.anchor).join(item.markdown);
    }
  }

  const before = placements
    .filter(({ placement }) => placement.placement === "before-section")
    .map(({ markdown }) => markdown);
  const after = placements
    .filter(({ placement }) => placement.placement === "after-section")
    .map(({ markdown }) => markdown);

  return [...before, body, ...after].filter((part) => part.trim().length > 0).join("\n\n");
}

function removePdfBodyImages(body: string) {
  return body
    .replace(/!\[\[[^\]]*\]\]/gu, "")
    .replace(/!\[[^\]]*\]\([^\n)]*\)/gu, "")
    .replace(/<img\b[^>]*>/giu, "");
}

function applyPdfSectionNumbers(
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  pageCoverage?: ReviewAnalysisPageCoverage[],
  vaultContext?: VaultKnowledgeContext | null,
) {
  const pdfSourceIds = new Set(sources.filter((source) => source.type === "pdf").map((source) => source.id));
  const chapterBySource = new Map<string, string>();
  const countBySourceAndChapter = new Map<string, number>();
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const pageRankBySectionId = new Map<string, number>();

  for (const coverage of pageCoverage ?? []) {
    for (const sectionId of coverage.sectionIds) {
      const current = pageRankBySectionId.get(sectionId);
      if (current === undefined || coverage.page < current) pageRankBySectionId.set(sectionId, coverage.page);
    }
  }
  const orderedIds = sections
    .map((section, index) => ({ id: section.id, index, page: pageRankBySectionId.get(section.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.page - right.page || left.index - right.index)
    .map((item) => item.id);
  const numberedTitles = new Map<string, string>();
  const existingNumberByChapter = collectExistingPdfNumbers(vaultContext, sources);
  const existingTopicsBySource = collectExistingPdfTopics(vaultContext, sources);

  for (const sectionId of orderedIds) {
    const section = sectionById.get(sectionId);
    if (!section) continue;
    if (!pdfSourceIds.has(section.sourceId)) {
      numberedTitles.set(section.id, section.title);
      continue;
    }
    const explicitChapter = extractChapterNumber(section.title);
    if (explicitChapter) {
      chapterBySource.set(section.sourceId, explicitChapter);
      numberedTitles.set(section.id, section.title);
      continue;
    }

    const existingNumber = /^(\d+)(?:\.(\d+))?\s+/u.exec(section.title.trim());
    if (existingNumber) {
      const chapter = existingNumber[1];
      chapterBySource.set(section.sourceId, chapter);
      if (existingNumber[2]) {
        const key = `${section.sourceId}:${chapter}`;
        countBySourceAndChapter.set(key, Math.max(countBySourceAndChapter.get(key) ?? 0, Number(existingNumber[2])));
      }
      numberedTitles.set(section.id, section.title);
      continue;
    }

    const parent = section.parentId ? sectionById.get(section.parentId) : undefined;
    const parentChapter = parent ? extractChapterNumber(parent.title) : undefined;
    const matchingExistingChapter = findMatchingExistingChapter(
      section,
      existingTopicsBySource.get(section.sourceId),
    );
    const previousSection = sections
      .slice(0, sections.indexOf(section))
      .reverse()
      .find((candidate) => candidate.sourceId === section.sourceId && pdfSourceIds.has(candidate.sourceId));
    const sameLocalPath = Boolean(
      previousSection &&
        (previousSection.path ?? []).join("/") === (section.path ?? []).join("/"),
    );
    const chapter =
      parentChapter ??
      matchingExistingChapter ??
      (existingNumberByChapter.get(section.sourceId)?.size
        ? sameLocalPath
          ? chapterBySource.get(section.sourceId) ?? "1"
          : inferNextPdfChapter(existingNumberByChapter.get(section.sourceId))
        : chapterBySource.get(section.sourceId) ?? "1");
    chapterBySource.set(section.sourceId, chapter);
    const key = `${section.sourceId}:${chapter}`;
    const next = Math.max(
      (countBySourceAndChapter.get(key) ?? 0) + 1,
      (existingNumberByChapter.get(section.sourceId)?.get(chapter) ?? 0) + 1,
    );
    countBySourceAndChapter.set(key, next);
    numberedTitles.set(section.id, `${chapter}.${next} ${section.title}`);
  }

  return sections.map((section) => ({ ...section, ...(numberedTitles.has(section.id) ? { title: numberedTitles.get(section.id) } : {}) }));
}

function collectExistingPdfTopics(
  vaultContext: VaultKnowledgeContext | null | undefined,
  sources: IntakeSource[],
) {
  const result = new Map<string, Array<{ chapter: string; title: string; path: string }>>();
  for (const source of sources) {
    const root = normalizeComparableText(source.stackHint?.split(/[\\/]/)[0] ?? "");
    const notes = (vaultContext?.notes ?? [])
      .filter((note) => normalizeComparableText(note.root) === root)
      .flatMap((note) => {
        const chapter = note.title.match(/^(\d+)\./u)?.[1];
        return chapter
          ? [{
              chapter,
              title: note.title.replace(/^\d+\.\d+\s*/u, ""),
              path: note.path,
            }]
          : [];
      });
    if (notes.length) result.set(source.id, notes);
  }
  return result;
}

function findMatchingExistingChapter(
  section: ReviewAnalysisSection,
  topics: Array<{ chapter: string; title: string; path: string }> | undefined,
) {
  const normalizedTitle = normalizeComparableText(section.title);
  const sectionPath = (section.path ?? []).map(normalizeComparableText).filter(Boolean);
  return topics?.find((topic) => {
    const normalizedTopicTitle = normalizeComparableText(topic.title);
    const titleMatch = normalizedTitle.includes(normalizedTopicTitle) || normalizedTopicTitle.includes(normalizedTitle);
    const pathMatch = sectionPath.some((segment) => normalizeComparableText(topic.path).includes(segment));
    return titleMatch || pathMatch;
  })?.chapter;
}

function collectExistingPdfNumbers(
  vaultContext: VaultKnowledgeContext | null | undefined,
  sources: IntakeSource[],
) {
  const result = new Map<string, Map<string, number>>();
  const roots = new Set(sources.filter((source) => source.type === "pdf").map((source) => normalizeComparableText(source.stackHint?.split(/[\\/]/)[0] ?? "")));
  for (const note of vaultContext?.notes ?? []) {
    if (!roots.has(normalizeComparableText(note.root))) continue;
    const match = /^(\d+)\.(\d+)\s+/u.exec(note.title.trim());
    if (!match) continue;
    const chapters = result.get(note.root) ?? new Map<string, number>();
    chapters.set(match[1], Math.max(chapters.get(match[1]) ?? 0, Number(match[2])));
    result.set(note.root, chapters);
  }
  const bySource = new Map<string, Map<string, number>>();
  for (const source of sources) {
    const chapters = result.get(source.stackHint?.split(/[\\/]/)[0] ?? "");
    if (chapters) bySource.set(source.id, chapters);
  }
  return bySource;
}

function inferNextPdfChapter(existing: Map<string, number> | undefined) {
  if (!existing || existing.size === 0) return "1";
  return String(Math.max(...existing.keys().map(Number)) + 1);
}

function extractChapterNumber(title: string) {
  const normalized = title.trim();
  const arabic = /(?:第\s*)?(\d+)\s*章/u.exec(normalized);
  if (arabic) return arabic[1];

  const chinese = /第\s*([一二三四五六七八九十百零〇两]+)\s*章/u.exec(normalized)?.[1];
  if (!chinese) return undefined;

  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (chinese === "十") return "10";
  if (chinese.includes("十")) {
    const [tens, ones] = chinese.split("十");
    return String((tens ? (digits[tens] ?? 0) : 1) * 10 + (ones ? digits[ones] ?? 0 : 0));
  }
  return String(digits[chinese] ?? Number(chinese));
}

function renderAnalysisFormula(formula: ReviewAnalysisFormula) {
  const latex = normalizeFormulaExpression(formula.latex);

  return formula.display === "block" ? `$$\n${latex}\n$$` : `$${latex}$`;
}

function renderAnalysisImagePlacement(placement: ReviewAnalysisImagePlacement, source?: IntakeSource) {
  const image = source?.pdfEvidence?.images?.find((candidate) => candidate.assetId === placement.assetId);
  if (!image?.imageDataUrl) return "";
  const extension = image.imageDataUrl.startsWith("data:image/png;") ? "png" : "jpg";
  const defaultAlt = `${source?.title ?? "PDF"}第 ${placement.sourcePage} 页图片`;
  const alt = (placement.alt ?? placement.caption ?? defaultAlt).trim() || defaultAlt;
  const markdownImage = `![[附件/PDF图片/${safePathSegment(placement.assetId)}.${extension}]]`;

  return placement.caption && placement.caption.trim() && placement.caption.trim() !== alt
    ? `${markdownImage}\n*${placement.caption.trim()}*`
    : markdownImage;
}

function applyNumberedPdfTopicFolders(
  notes: GeneratedNote[],
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  pageCoverage?: ReviewAnalysisPageCoverage[],
) {
  const pdfSourceIds = new Set(sources.filter((source) => source.type === "pdf").map((source) => source.id));
  if (pdfSourceIds.size === 0 || notes.length === 0) return notes;

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const parentById = new Map(sections.map((section) => [section.id, section.parentId]));
  const firstPageBySection = new Map<string, number>();

  for (const coverage of pageCoverage ?? []) {
    if (coverage.status !== "covered") continue;
    for (const sectionId of coverage.sectionIds) {
      const current = firstPageBySection.get(sectionId);
      if (current === undefined || coverage.page < current) firstPageBySection.set(sectionId, coverage.page);
    }
  }
  const resultByNoteId = new Map<string, GeneratedNote>();
  for (const sourceId of pdfSourceIds) {
    const sourceSections = sections.filter((section) => section.sourceId === sourceId);
    const topicIdBySection = new Map<string, string>();

    for (const section of sourceSections) {
      let topic = section;
      const visited = new Set<string>();
      while (topic.parentId && !visited.has(topic.parentId)) {
        visited.add(topic.parentId);
        const parent = sectionById.get(topic.parentId);
        if (!parent || extractChapterNumber(parent.title)) break;
        topic = parent;
      }
      topicIdBySection.set(section.id, topic.id);
    }

    const topicPages = new Map<string, number>();
    for (const section of sourceSections) {
      const topicId = topicIdBySection.get(section.id) ?? section.id;
      const page = firstPageBySection.get(section.id) ?? Number.MAX_SAFE_INTEGER;
      topicPages.set(topicId, Math.min(topicPages.get(topicId) ?? Number.MAX_SAFE_INTEGER, page));
    }
    const topicIds = [...topicPages.keys()].sort((left, right) =>
      (topicPages.get(left) ?? Number.MAX_SAFE_INTEGER) - (topicPages.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      sourceSections.findIndex((section) => section.id === left) - sourceSections.findIndex((section) => section.id === right),
    );

    topicIds.forEach((topicId, index) => {
      const topicTitle = stripPdfSectionNumber(sectionById.get(topicId)?.title ?? "未分类主题") || "未分类主题";
      const folderName = `${String(index + 1).padStart(2, "0")}-${topicTitle}`;
      for (const [sectionId, mappedTopicId] of topicIdBySection) {
        if (mappedTopicId !== topicId) continue;
        const note = noteById.get(sectionId);
        if (!note) continue;

        const segments = splitLogicalNotePath(note.path);
        const root = segments.shift() ?? "未归类";
        const relative = segments.filter((segment, relativeIndex) =>
          !(relativeIndex === 0 && (normalizeComparableText(segment) === normalizeComparableText(topicTitle) || normalizeComparableText(segment) === normalizeComparableText(folderName))),
        );
        resultByNoteId.set(note.id, { ...note, path: [root, folderName, ...relative].join(" / ") });
      }
    });
  }

  return notes.map((note) => resultByNoteId.get(note.id) ?? note);
}

function stripPdfSectionNumber(title: string) {
  return title.replace(/^\d+(?:\.\d+)*\s*/u, "").trim();
}

function resolvePlacementRelativePath(
  placement: ReviewAnalysisPlacement,
  stack: string,
  vaultIndex: VaultKnowledgeNode[],
) {
  if (placement.mode === "new-root") {
    return [stack, ...(placement.branchName ? [normalizePlacementBranchName(placement.branchName)] : [])];
  }

  const selectedNodeId = placement.mode === "existing-note" ? placement.targetNodeId : placement.parentNodeId;
  const selectedNode = selectedNodeId
    ? vaultIndex.find((node) => node.id === selectedNodeId)
    : undefined;

  if (!selectedNode) return [stack];

  const parentPath = selectedNode.kind === "note" ? selectedNode.path.split("/").slice(0, -1) : selectedNode.path.split("/");
  const normalizedParentPath = parentPath.map((segment) => segment.trim()).filter(Boolean);

  return [
    ...(normalizedParentPath.length > 0 ? normalizedParentPath : [stack]),
    ...(placement.branchName ? [normalizePlacementBranchName(placement.branchName)] : []),
  ];
}

function normalizePlacementBranchName(value: string) {
  return value.replace(/[\\/]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolveAnalysisReference(
  reference: string,
  sections: ReviewAnalysisSection[],
  notes: GeneratedNote[],
) {
  const noteById = new Map(notes.map((note) => [note.id, note.title]));
  const sectionByTitle = new Map(
    sections.map((section) => [normalizeComparableText(section.title), section.id]),
  );

  if (noteById.has(reference)) return noteById.get(reference) ?? reference;

  const sectionId = sectionByTitle.get(normalizeComparableText(reference));

  return sectionId ? noteById.get(sectionId) ?? reference : reference;
}

export function buildPreviewFiles(batch: ReviewBatch): PreviewFile[] {
  return [
    {
      path: "00-审理确认总览.md",
      content: buildOverviewMarkdown(batch),
    },
    ...batch.sources.map((source) => ({
      path: `00-原始上传/${safeFileName(`${source.id}-${source.title}`)}.md`,
      content: buildSourceMarkdown(source),
    })),
    ...batch.notes.map((note) => ({
      path: `10-审理结果/${safeFileName(note.title)}.md`,
      content: buildReviewMarkdown(batch, note),
    })),
    ...buildRootGuideFiles(batch, "preview").map((file) => ({
      path: file.path,
      content: file.content,
    })),
    ...batch.notes.map((note) => ({
      path: notePreviewPath(note),
      content: note.markdown,
    })),
    ...buildPdfAssetPreviewFiles(batch),
  ];
}

export function buildPdfAssetPreviewFiles(batch: ReviewBatch): PreviewFile[] {
  return buildPdfAssetFiles(batch).map((asset) => ({
    path: asset.path,
    content: asset.dataUrl,
  }));
}

export function buildBatchPreviewRoot(parentRoot: string, batchId: string) {
  const root = parentRoot.trim().replace(/[\\/]+$/g, "");
  const safeId = safeBatchIdSegment(batchId);

  if (!root) return safeId;
  return `${root}/${safeId}`;
}

export function notePreviewPath(note: GeneratedNote) {
  const pathSegments = note.path.split("/").map((segment) => segment.trim().replace(/\s+/g, ""));
  return `20-生成预览/${pathSegments.map(safePathSegment).join("/")}/${safeFileName(note.title)}.md`;
}

export function buildVaultWriteFiles(batch: ReviewBatch): VaultWriteFile[] {
  return [
    ...batch.notes.map((note) => ({
      path: noteVaultPath(note),
      content: note.markdown,
      noteId: note.id,
      title: note.title,
    })),
    ...buildPdfAssetFiles(batch).map((asset) => ({
      path: asset.path,
      content: asset.dataUrl,
      noteId: asset.noteId,
      title: asset.title,
      binary: true,
    })),
  ];
}

export function buildVaultAssetFiles(batch: ReviewBatch): VaultAssetFile[] {
  return buildPdfAssetFiles(batch);
}

function buildPdfAssetFiles(batch: ReviewBatch): VaultAssetFile[] {
  const assets = new Map<string, VaultAssetFile>();
  const referencedAssetIds = new Set<string>();
  for (const note of batch.notes) {
    for (const match of note.markdown.matchAll(/!\[\[附件\/PDF图片\/([^\]]+)\]\]/gu)) {
      const assetId = /^(.*)\.(?:png|jpe?g)$/iu.exec(match[1] ?? "")?.[1];
      if (assetId) referencedAssetIds.add(assetId);
    }
  }

  for (const source of batch.sources) {
    if (source.type !== "pdf") continue;
    for (const image of source.pdfEvidence?.images ?? []) {
      if (!image.imageDataUrl || !referencedAssetIds.has(image.assetId) || !/^data:image\/(?:png|jpe?g);base64,/iu.test(image.imageDataUrl)) continue;
      const extension = image.imageDataUrl.startsWith("data:image/png;") ? "png" : "jpg";
      const assetId = image.assetId;
      assets.set(assetId, {
        path: `附件/PDF图片/${safePathSegment(assetId)}.${extension}`,
        dataUrl: image.imageDataUrl,
        noteId: `${batch.id}-${assetId}`,
        title: `${source.title} 第 ${image.page} 页图片`,
      });
    }
  }

  return [...assets.values()];
}

export function buildVaultMoveFiles(batch: ReviewBatch): VaultMoveFile[] {
  return batch.moves;
}

export function noteVaultPath(note: GeneratedNote) {
  const pathSegments = note.path.split("/").map((segment) => segment.trim().replace(/\s+/g, ""));
  return `${pathSegments.map(safePathSegment).join("/")}/${safeFileName(note.title)}.md`;
}

type GuideMode = "preview" | "vault";

function buildRootGuideFiles(batch: ReviewBatch, mode: GuideMode): VaultWriteFile[] {
  const groups = groupNotesByRoot(batch.notes);

  return [...groups.entries()].map(([root, notes]) => {
    const title = `${root} 导览`;
    const safeRoot = safePathSegment(root);
    const pathPrefix = mode === "preview"
      ? `20-生成预览/${safeRoot}/00-导览`
      : `${safeRoot}/00-导览`;

    return {
      path: `${pathPrefix}/00-${safeFileName(title)}.md`,
      content: buildRootGuideMarkdown(batch, root, notes, mode),
      noteId: `${batch.id}-guide-${safeRoot}`,
      title,
    };
  });
}

function groupNotesByRoot(notes: GeneratedNote[]) {
  const groups = new Map<string, GeneratedNote[]>();

  for (const note of notes) {
    const root = getRootPathSegment(note.path);
    groups.set(root, [...(groups.get(root) ?? []), note]);
  }

  return groups;
}

function scoreVaultNoteForQuery(note: VaultKnowledgeNote, queryText: string, queryTokens: Set<string>) {
  let score = 0;
  const title = note.title.toLowerCase();
  const root = note.root.toLowerCase();

  if (title && queryText.includes(title)) score += 80;
  if (root && queryText.includes(root)) score += 30;

  for (const token of extractSearchTokens(note.title)) {
    if (queryTokens.has(token)) score += token.length <= 3 ? 18 : 24;
  }

  for (const segment of note.path.split(/[\\/]/)) {
    const normalized = segment.replace(/\.md$/i, "").trim().toLowerCase();

    if (normalized && queryText.includes(normalized)) score += 12;
  }

  for (const heading of note.headings) {
    const normalized = heading.trim().toLowerCase();

    if (normalized && queryText.includes(normalized)) score += 8;
  }

  for (const token of extractSearchTokens(note.snippet)) {
    if (queryTokens.has(token)) score += 4;
  }

  return score;
}

function scoreVaultRootForQuery(root: VaultKnowledgeRoot, queryText: string, queryTokens: Set<string>) {
  let score = 0;
  const rootName = root.name.toLowerCase();

  if (rootName && queryText.includes(rootName)) score += 30;

  for (const path of root.paths) {
    for (const segment of path.split(/[\\/]/)) {
      const normalized = segment.trim().toLowerCase();

      if (!normalized || normalized === rootName) continue;
      if (queryText.includes(normalized)) {
        score += 24;
        continue;
      }

      for (const token of extractSearchTokens(normalized)) {
        if (queryTokens.has(token)) {
          score += token.length <= 3 ? 4 : 12;
        } else if (hasFuzzyTokenMatch(token, queryTokens)) {
          score += token.length <= 3 ? 2 : 8;
        }
      }
    }
  }

  return score;
}

function selectRootPathsForQuery(root: VaultKnowledgeRoot, queryText: string, queryTokens: Set<string>) {
  const rootName = root.name.trim();
  const rankedPaths = root.paths
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({
      path,
      score: scoreVaultRootPathForQuery(path, rootName, queryText, queryTokens),
    }))
    .filter((item) => item.path === rootName || item.score > 0)
    .sort((left, right) => right.score - left.score || left.path.length - right.path.length);
  const selected = [rootName, ...rankedPaths.map((item) => item.path)];

  return uniqueLines(selected).slice(0, 20);
}

function scoreVaultRootPathForQuery(path: string, rootName: string, queryText: string, queryTokens: Set<string>) {
  const segments = path
    .split(/[\\/]/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  const leaf = segments[segments.length - 1] ?? "";

  if (!leaf) return 0;
  if (leaf === rootName.toLowerCase()) return 1;
  if (queryText.includes(leaf)) return 30;

  return [...extractSearchTokens(leaf)].reduce(
    (sum, token) => {
      if (queryTokens.has(token)) return sum + (token.length <= 3 ? 2 : 10);
      if (hasFuzzyTokenMatch(token, queryTokens)) return sum + (token.length <= 3 ? 1 : 8);
      return sum;
    },
    0,
  );
}

function hasFuzzyTokenMatch(candidateToken: string, queryTokens: Set<string>) {
  if (candidateToken.length < 4) return false;

  for (const queryToken of queryTokens) {
    if (queryToken.length < 4) continue;
    if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) return true;
  }

  return false;
}

function extractSearchTokens(text: string) {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();

  for (const match of normalized.matchAll(/[a-z0-9_+#.-]{2,}/g)) {
    tokens.add(match[0]);
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,12}/g)) {
    const value = match[0];
    tokens.add(value);

    for (let length = 2; length <= Math.min(6, value.length); length += 1) {
      for (let index = 0; index <= value.length - length; index += 1) {
        tokens.add(value.slice(index, index + length));
      }
    }
  }

  return tokens;
}

function buildRootGuideMarkdown(batch: ReviewBatch, root: string, notes: GeneratedNote[], mode: GuideMode) {
  const pathForNote = mode === "preview" ? notePreviewPath : noteVaultPath;
  const noteRows = notes
    .map((note) => {
      const link = pathForNote(note).replace(/\.md$/, "");
      return `- [[${link}|${note.title}]] - ${note.grain} - ${note.path}`;
    })
    .join("\n");
  const relationRows = batch.relations
    .filter((relation) =>
      notes.some((note) => relation.source === note.title || relation.target === note.title),
    )
    .map((relation) => `- ${relation.type}：[[${relation.source}]] → [[${relation.target}]]`)
    .join("\n");

  return [
    `技术栈：[[${root}]]`,
    `批次：${batch.id}`,
    `创建时间：${batch.createdAt}`,
    "",
    "## 本批次入口",
    noteRows || "- 本批次暂无可写入笔记。",
    "",
    "## 本批次关系",
    relationRows || "- 本批次暂无新增关系。",
  ].join("\n");
}

function normalizeSource(source: IntakeSource): IntakeSource {
  return {
    ...source,
    id: source.id.trim(),
    title: source.title.trim() || "未命名上传",
    content: source.content.trim(),
    stackHint: source.stackHint?.trim(),
  };
}

const topicFolderGroupingMinimumEffectiveCharacters = 5000;

function applyAnalysisTopicFolderGrouping(
  notes: GeneratedNote[],
  sections: ReviewAnalysisSection[],
  relations: ReviewAnalysisRelation[],
  sources: IntakeSource[],
  vaultIndex: VaultKnowledgeNode[],
  vaultContext: VaultKnowledgeContext | null,
): { notes: GeneratedNote[]; moves: VaultMoveFile[]; uncertain: string[] } {
  if (notes.length === 0 || sections.length === 0) {
    return { notes, moves: [], uncertain: [] };
  }

  const noteById = new Map(notes.map((note) => [note.id, note]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const childrenByParentId = new Map<string, ReviewAnalysisSection[]>();

  for (const section of sections) {
    if (!section.parentId) continue;
    childrenByParentId.set(section.parentId, [...(childrenByParentId.get(section.parentId) ?? []), section]);
  }

  if (childrenByParentId.size === 0) {
    return { notes, moves: [], uncertain: [] };
  }

  const vaultNodeById = new Map(vaultIndex.map((node) => [node.id, node]));
  const contextPathSet = new Set((vaultContext?.notes ?? []).map((note) => normalizeVaultRelativePath(note.path)));
  const groupedNotes = new Map<string, GeneratedNote>();
  const moves: VaultMoveFile[] = [];
  const uncertain: string[] = [];
  const plannedMoveSources = new Set<string>();
  const plannedMoveTargets = new Set<string>();

  for (const parentSection of sections) {
    const parentNote = noteById.get(parentSection.id);

    if (!parentNote || !isPromotableExistingTopicTitle(parentNote.title)) continue;
    if (!canCreateAnalysisTopicFolder(parentSection, sourceById)) continue;

    const topicFolderPath = appendTopicFolderPath(parentNote.path, parentNote.title);
    const childNotes = (childrenByParentId.get(parentSection.id) ?? [])
      .map((childSection) => noteById.get(childSection.id))
      .filter((childNote): childNote is GeneratedNote => Boolean(childNote))
      .filter((childNote) => isTopicFolderChild(parentNote, childNote, topicFolderPath));
    const existingMembers = collectExistingTopicFolderMembers(
      parentSection,
      parentNote,
      topicFolderPath,
      relations,
      vaultNodeById,
      contextPathSet,
      plannedMoveSources,
      plannedMoveTargets,
    );

    if (childNotes.length === 0 || childNotes.length + existingMembers.memberCount < 2) continue;

    for (const childNote of childNotes) {
      groupedNotes.set(childNote.id, {
        ...childNote,
        path: isNotePathInsideTopicFolder(childNote.path, topicFolderPath) ? childNote.path : topicFolderPath,
      });
    }

    moves.push(...existingMembers.moves);
    uncertain.push(...existingMembers.uncertain);
  }

  if (groupedNotes.size === 0 && moves.length === 0 && uncertain.length === 0) {
    return { notes, moves: [], uncertain: [] };
  }

  return {
    notes: notes.map((note) => groupedNotes.get(note.id) ?? note),
    moves: dedupeVaultMoveFiles(moves),
    uncertain: uniqueLines(uncertain),
  };
}

function canCreateAnalysisTopicFolder(parentSection: ReviewAnalysisSection, sourceById: Map<string, IntakeSource>) {
  const source = sourceById.get(parentSection.sourceId);

  if (!source) return false;

  return effectiveSourceCharacterCount(source.content) > topicFolderGroupingMinimumEffectiveCharacters;
}

function appendTopicFolderPath(basePath: string, topicTitle: string) {
  const segments = splitLogicalNotePath(basePath);
  const title = topicTitle.trim();

  if (!title) return segments.join(" / ");
  if (normalizeComparableText(segments.at(-1) ?? "") === normalizeComparableText(title)) {
    return segments.join(" / ");
  }

  return [...segments, title].join(" / ");
}

function isTopicFolderChild(parentNote: GeneratedNote, childNote: GeneratedNote, topicFolderPath: string) {
  const parentPath = normalizeLogicalNotePath(parentNote.path);
  const childPath = normalizeLogicalNotePath(childNote.path);

  return childPath === parentPath || isNotePathInsideTopicFolder(childNote.path, topicFolderPath);
}

function isNotePathInsideTopicFolder(path: string, topicFolderPath: string) {
  const notePath = normalizeLogicalNotePath(path);
  const folderPath = normalizeLogicalNotePath(topicFolderPath);

  return notePath === folderPath || notePath.startsWith(`${folderPath}/`);
}

function collectExistingTopicFolderMembers(
  parentSection: ReviewAnalysisSection,
  parentNote: GeneratedNote,
  topicFolderPath: string,
  relations: ReviewAnalysisRelation[],
  vaultNodeById: Map<string, VaultKnowledgeNode>,
  contextPathSet: Set<string>,
  plannedMoveSources: Set<string>,
  plannedMoveTargets: Set<string>,
): { memberCount: number; moves: VaultMoveFile[]; uncertain: string[] } {
  let memberCount = 0;
  const moves: VaultMoveFile[] = [];
  const uncertain: string[] = [];
  const parentFolderPath = notePathToVaultFolderPath(parentNote.path);
  const topicVaultFolderPath = notePathToVaultFolderPath(topicFolderPath);
  const parentRoot = normalizeComparableText(getRootPathSegment(parentNote.path));

  for (const relation of relations) {
    if (relation.type !== "包含" || !isRelationFromTopicParent(relation, parentSection, parentNote)) continue;

    const targetNode = resolveVaultNoteRelationTarget(relation, vaultNodeById);

    if (!targetNode) continue;

    const targetRoot = normalizeComparableText(targetNode.root);

    if (parentRoot && targetRoot && parentRoot !== targetRoot) {
      uncertain.push(`旧笔记“${targetNode.title}”不在整合主题“${parentNote.title}”的同一根目录，已仅保留关系、不自动迁移。`);
      continue;
    }

    const fromPath = normalizeVaultRelativePath(targetNode.path);
    const fromSegments = fromPath.split("/").filter(Boolean);
    const fileName = fromSegments.at(-1) ?? `${safeFileName(targetNode.title)}.md`;
    const sourceFolderPath = fromSegments.slice(0, -1).join("/");
    const toPath = normalizeVaultRelativePath(`${topicVaultFolderPath}/${fileName}`);

    if (sourceFolderPath === topicVaultFolderPath) {
      memberCount += 1;
      continue;
    }

    if (sourceFolderPath !== parentFolderPath) {
      uncertain.push(`旧笔记“${targetNode.title}”不在“${parentNote.path}”下，已仅保留关系、不自动迁移。`);
      continue;
    }

    if (contextPathSet.has(toPath)) {
      uncertain.push(`旧笔记“${targetNode.title}”迁移目标已存在：${toPath}，已跳过自动迁移。`);
      continue;
    }

    if (plannedMoveSources.has(fromPath) || plannedMoveTargets.has(toPath)) {
      uncertain.push(`旧笔记“${targetNode.title}”存在重复迁移目标，已跳过自动迁移。`);
      continue;
    }

    plannedMoveSources.add(fromPath);
    plannedMoveTargets.add(toPath);
    memberCount += 1;
    moves.push({
      fromPath,
      toPath,
      noteId: topicGroupingMoveId(targetNode.title),
      title: targetNode.title,
      reason: `既有笔记“${targetNode.title}”属于整合主题“${parentNote.title}”，确认后迁移到对应整合文件夹。`,
    });
  }

  return { memberCount, moves, uncertain };
}

function isRelationFromTopicParent(
  relation: ReviewAnalysisRelation,
  parentSection: ReviewAnalysisSection,
  parentNote: GeneratedNote,
) {
  const source = relation.sourceNodeId ?? relation.source;

  return (
    source === parentSection.id ||
    normalizeComparableText(source) === normalizeComparableText(parentSection.title) ||
    normalizeComparableText(source) === normalizeComparableText(parentNote.title)
  );
}

function resolveVaultNoteRelationTarget(
  relation: ReviewAnalysisRelation,
  vaultNodeById: Map<string, VaultKnowledgeNode>,
) {
  const directNode = relation.targetNodeId ? vaultNodeById.get(relation.targetNodeId) : vaultNodeById.get(relation.target);

  if (directNode?.kind === "note") return directNode;

  const normalizedTarget = normalizeComparableText(relation.target);

  return (
    [...vaultNodeById.values()].find(
      (node) => node.kind === "note" && normalizeComparableText(node.title) === normalizedTarget,
    ) ?? null
  );
}

function splitLogicalNotePath(path: string) {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeLogicalNotePath(path: string) {
  return splitLogicalNotePath(path).map(normalizeComparableText).join("/");
}

function notePathToVaultFolderPath(path: string) {
  return splitLogicalNotePath(path)
    .map((segment) => safePathSegment(segment.replace(/\s+/g, "")))
    .join("/");
}

function normalizeRelations(
  relations: Array<
    KnowledgeRelation & {
      sourceNodeId?: string;
      targetNodeId?: string;
    }
  >,
  notes: GeneratedNote[],
  vaultIndex: VaultKnowledgeNode[] = [],
) {
  const titleById = new Map([
    ...notes.map((note) => [note.id, note.title] as const),
    ...vaultIndex.map((node) => [node.id, node.title] as const),
  ]);

  return dedupeRelations(
    relations.map((relation) => ({
      ...relation,
      source: titleById.get(relation.source) ?? relation.source,
      target: titleById.get(relation.target) ?? relation.target,
    })).filter((relation) => {
      if (relation.sourceNodeId && !titleById.has(relation.sourceNodeId)) return false;
      if (relation.targetNodeId && !titleById.has(relation.targetNodeId)) return false;
      return true;
    }).map(({ sourceNodeId: _sourceNodeId, targetNodeId: _targetNodeId, ...relation }) => relation),
  );
}

function collectUnresolvedNodeRelations(
  relations: Array<
    KnowledgeRelation & {
      sourceNodeId?: string;
      targetNodeId?: string;
    }
  >,
  notes: GeneratedNote[],
  vaultIndex: VaultKnowledgeNode[],
) {
  const knownNodeIds = new Set([...notes.map((note) => note.id), ...vaultIndex.map((node) => node.id)]);

  return relations.flatMap((relation) => {
    const missing = [
      relation.sourceNodeId && !knownNodeIds.has(relation.sourceNodeId) ? `source=${relation.sourceNodeId}` : "",
      relation.targetNodeId && !knownNodeIds.has(relation.targetNodeId) ? `target=${relation.targetNodeId}` : "",
    ].filter(Boolean);

    return missing.length > 0
      ? [`关系未能连接到已知节点（${missing.join("，")}），已暂不写入。`]
      : [];
  });
}

function ensureUniqueGeneratedNoteTargets(notes: GeneratedNote[]) {
  const usedPaths = new Set<string>();

  return notes.map((note) => {
    let nextNote = note;
    let suffix = 2;

    while (usedPaths.has(normalizeComparableText(noteVaultPath(nextNote)))) {
      nextNote = {
        ...note,
        title: `${note.title} ${suffix}`,
      };
      suffix += 1;
    }

    usedPaths.add(normalizeComparableText(noteVaultPath(nextNote)));
    return nextNote;
  });
}

function dedupeVaultMoveFiles(moves: VaultMoveFile[]) {
  const seen = new Set<string>();

  return moves.filter((move) => {
    const key = `${normalizeVaultRelativePath(move.fromPath)}->${normalizeVaultRelativePath(move.toPath)}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function topicGroupingMoveId(title: string) {
  const asciiSlug = title.toLowerCase().match(/[a-z0-9]+/g)?.join("-") || "";

  if (asciiSlug) return `group-existing-topic-${asciiSlug}`;

  const fallbackSlug = [...normalizeComparableText(title)]
    .map((char) => char.charCodeAt(0).toString(36))
    .slice(0, 8)
    .join("-");

  return `group-existing-topic-${fallbackSlug || "note"}`;
}

type ExistingTopicPromotionCandidate = {
  title: string;
  normalizedTitle: string;
  root: string;
  fromPath: string;
  toPath: string;
  targetFolderPath: string;
};

type ExistingTopicPromotionSelection = {
  candidate: ExistingTopicPromotionCandidate;
  note: GeneratedNote;
  score: number;
};

const nonPromotableTopicTitles = new Set(
  [
    "总览",
    "导览",
    "术语",
    "基本概念",
    "应用步骤",
    "具体代码",
    "常用命令",
    "命令与代码",
    "代码",
    "问题排查",
    "对比",
    "待细分",
  ].map(normalizeComparableText),
);

function applyExistingTopicPromotions(
  notes: GeneratedNote[],
  sources: IntakeSource[],
  vaultContext: VaultKnowledgeContext | null,
): { notes: GeneratedNote[]; moves: VaultMoveFile[]; relations: KnowledgeRelation[] } {
  if (!vaultContext || notes.length === 0 || vaultContext.notes.length === 0) {
    return { notes, moves: [], relations: [] };
  }

  const contextPathSet = new Set(vaultContext.notes.map((note) => normalizeVaultRelativePath(note.path)));
  const candidates = vaultContext.notes
    .map((note) => createExistingTopicPromotionCandidate(note, contextPathSet))
    .filter((candidate): candidate is ExistingTopicPromotionCandidate => Boolean(candidate));

  if (candidates.length === 0) {
    return { notes, moves: [], relations: [] };
  }

  const sourceTextById = new Map(
    sources.map((source) => [
      source.id,
      normalizeComparableText(`${source.title}\n${source.stackHint ?? ""}\n${source.content}`),
    ]),
  );
  const selectionByNoteId = new Map<string, ExistingTopicPromotionSelection>();

  for (const note of notes) {
    const sourceText = sourceTextById.get(note.sourceId) ?? "";
    const selection = selectExistingTopicPromotion(note, sourceText, candidates);

    if (selection) {
      selectionByNoteId.set(note.id, selection);
    }
  }

  if (selectionByNoteId.size === 0) {
    return { notes, moves: [], relations: [] };
  }

  const selectedCandidates = new Map<string, ExistingTopicPromotionCandidate>();

  for (const selection of selectionByNoteId.values()) {
    selectedCandidates.set(selection.candidate.fromPath, selection.candidate);
  }

  const notesWithPromotedPaths = notes.map((note) => {
    const selection = selectionByNoteId.get(note.id);

    if (selection) {
      return {
        ...note,
        path: selection.candidate.targetFolderPath,
      };
    }

    const sourceText = sourceTextById.get(note.sourceId) ?? "";
    const duplicateGuideCandidate = selectGeneratedSameTitleGuidePromotion(
      note,
      sourceText,
      [...selectedCandidates.values()],
    );

    if (!duplicateGuideCandidate) return note;

    return {
      ...note,
      title: uniqueSupplementTitle(duplicateGuideCandidate.title, notes),
      path: duplicateGuideCandidate.targetFolderPath,
    };
  });

  const moves = [...selectedCandidates.values()].map((candidate) => {
    const firstChild = [...selectionByNoteId.values()].find(
      (selection) => selection.candidate.fromPath === candidate.fromPath,
    )?.note.title;

    return {
      fromPath: candidate.fromPath,
      toPath: candidate.toPath,
      noteId: topicPromotionMoveId(candidate.title),
      title: candidate.title,
      reason: `新笔记“${firstChild ?? "本批次新笔记"}”是既有主题“${candidate.title}”的下级分支，需把单篇旧笔记升级为主题文件夹。`,
    };
  });
  const relations = dedupeRelations(
    [...selectionByNoteId.values()]
      .filter((selection) => normalizeComparableText(selection.note.title) !== selection.candidate.normalizedTitle)
      .map((selection) => ({
        type: "包含" as const,
        source: selection.candidate.title,
        target: selection.note.id,
      })),
  );

  return {
    notes: notesWithPromotedPaths,
    moves,
    relations,
  };
}

function createExistingTopicPromotionCandidate(
  note: VaultKnowledgeNote,
  contextPathSet: Set<string>,
): ExistingTopicPromotionCandidate | null {
  const title = note.title.trim();
  const normalizedTitle = normalizeComparableText(title);

  if (!isPromotableExistingTopicTitle(title)) return null;

  const fromPath = normalizeVaultRelativePath(note.path);
  const segments = fromPath.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";

  if (segments.length === 0 || !/\.md$/i.test(fileName) || /^00-/.test(fileName)) return null;

  const fileStem = stripMarkdownExtension(fileName);
  const parentSegments = segments.slice(0, -1);

  if (normalizeComparableText(parentSegments.at(-1) ?? "") === normalizedTitle) return null;

  const targetFolderSegments = [...parentSegments, safePathSegment(title)];
  const toPath = normalizeVaultRelativePath([...targetFolderSegments, fileName].join("/"));

  if (normalizeComparableText(fileStem) !== normalizedTitle) return null;
  if (contextPathSet.has(toPath)) return null;

  return {
    title,
    normalizedTitle,
    root: note.root.trim(),
    fromPath,
    toPath,
    targetFolderPath: targetFolderSegments.join(" / "),
  };
}

function isPromotableExistingTopicTitle(title: string) {
  const normalized = normalizeComparableText(title);

  if (normalized.length < 2) return false;
  if (nonPromotableTopicTitles.has(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/(导览|总览)$/.test(title.trim())) return false;

  return true;
}

function selectExistingTopicPromotion(
  note: GeneratedNote,
  sourceText: string,
  candidates: ExistingTopicPromotionCandidate[],
): ExistingTopicPromotionSelection | null {
  const selections = candidates
    .map((candidate) => ({
      candidate,
      note,
      score: scoreExistingTopicPromotion(note, sourceText, candidate),
    }))
    .filter((selection) => selection.score >= 100)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.normalizedTitle.length - left.candidate.normalizedTitle.length ||
        left.candidate.fromPath.localeCompare(right.candidate.fromPath),
    );

  return selections[0] ?? null;
}

function scoreExistingTopicPromotion(
  note: GeneratedNote,
  sourceText: string,
  candidate: ExistingTopicPromotionCandidate,
) {
  const noteTitle = normalizeComparableText(note.title);
  const pathSegments = note.path
    .split("/")
    .map((segment) => normalizeComparableText(segment))
    .filter(Boolean);
  const noteRoot = normalizeComparableText(getRootPathSegment(note.path));
  const candidateRoot = normalizeComparableText(candidate.root);

  if (noteTitle === candidate.normalizedTitle) return 0;
  if (candidateRoot && noteRoot && candidateRoot !== noteRoot && !sourceText.includes(candidateRoot)) return 0;

  let score = 0;

  if (noteTitle.startsWith(candidate.normalizedTitle)) score += 100;
  if (pathSegments.includes(candidate.normalizedTitle)) score += 90;
  if (sourceText.includes(candidate.normalizedTitle)) score += 20;
  if (candidateRoot && noteRoot === candidateRoot) score += 12;
  if (normalizeComparableText(note.markdown).includes(candidate.normalizedTitle)) score += 8;

  return score;
}

function selectGeneratedSameTitleGuidePromotion(
  note: GeneratedNote,
  sourceText: string,
  candidates: ExistingTopicPromotionCandidate[],
) {
  const noteTitle = normalizeComparableText(note.title);
  const pathSegments = note.path
    .split("/")
    .map((segment) => normalizeComparableText(segment))
    .filter(Boolean);
  const noteRoot = normalizeComparableText(getRootPathSegment(note.path));

  return (
    candidates
      .filter((candidate) => candidate.normalizedTitle === noteTitle)
      .filter((candidate) => {
        const candidateRoot = normalizeComparableText(candidate.root);

        if (candidateRoot && noteRoot && candidateRoot !== noteRoot && !sourceText.includes(candidateRoot)) {
          return false;
        }

        return pathSegments.includes(candidate.normalizedTitle) || sourceText.includes(candidate.normalizedTitle);
      })
      .sort(
        (left, right) =>
          right.normalizedTitle.length - left.normalizedTitle.length || left.fromPath.localeCompare(right.fromPath),
      )[0] ?? null
  );
}

function uniqueSupplementTitle(topicTitle: string, notes: GeneratedNote[]) {
  const baseTitle = `${topicTitle} 补充说明`;
  const usedTitles = new Set(notes.map((note) => normalizeComparableText(note.title)));

  if (!usedTitles.has(normalizeComparableText(baseTitle))) return baseTitle;

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseTitle} ${index}`;

    if (!usedTitles.has(normalizeComparableText(candidate))) return candidate;
  }

  return `${baseTitle} ${Date.now()}`;
}

function normalizeVaultRelativePath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function stripMarkdownExtension(fileName: string) {
  return fileName.replace(/\.(?:md|markdown)$/i, "");
}

function topicPromotionMoveId(title: string) {
  const asciiSlug = title.toLowerCase().match(/[a-z0-9]+/g)?.join("-") || "";

  if (asciiSlug) return `promote-existing-topic-${asciiSlug}`;

  const fallbackSlug = [...normalizeComparableText(title)]
    .map((char) => char.charCodeAt(0).toString(36))
    .slice(0, 8)
    .join("-");

  return `promote-existing-topic-${fallbackSlug || "note"}`;
}

function alignNotesWithSourceOrganizationSignals(
  notes: GeneratedNote[],
  sources: IntakeSource[],
  vaultContext: VaultKnowledgeContext | null,
) {
  const signalBySourceId = new Map(
    extractSourceOrganizationSignals(sources, vaultContext).map((signal) => [signal.sourceId, signal]),
  );

  return notes.map((note) => alignNoteWithSourceOrganizationSignal(note, signalBySourceId.get(note.sourceId)));
}

function alignNoteWithSourceOrganizationSignal(
  note: GeneratedNote,
  signal: SourceOrganizationSignal | undefined,
): GeneratedNote {
  const explicitHierarchy = signal?.explicitHierarchy?.map((segment) => segment.trim()).filter(Boolean) ?? [];

  if (explicitHierarchy.length >= 2) {
    return alignNoteWithExplicitHierarchy(note, explicitHierarchy);
  }

  const root = signal?.root?.trim();
  const role = signal?.knowledgeRole?.trim();

  if (!root || !role) return note;

  const pathSegments = note.path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length === 0) return note;
  if (normalizeComparableText(pathSegments[0]) !== normalizeComparableText(root)) return note;
  if (pathSegments.some((segment) => normalizeComparableText(segment) === normalizeComparableText(role))) return note;

  return {
    ...note,
    path: `${root} / ${role}`,
  };
}

function alignNoteWithExplicitHierarchy(note: GeneratedNote, explicitHierarchy: string[]): GeneratedNote {
  const pathSegments = note.path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length > 0 && hasPathPrefix(pathSegments, explicitHierarchy)) return note;

  return {
    ...note,
    path: explicitHierarchy.join(" / "),
  };
}

function hasPathPrefix(pathSegments: string[], prefixSegments: string[]) {
  if (pathSegments.length < prefixSegments.length) return false;

  return prefixSegments.every(
    (segment, index) => normalizeComparableText(pathSegments[index]) === normalizeComparableText(segment),
  );
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function normalizeGeneratedNote(note: GeneratedNote, relations: KnowledgeRelation[]): GeneratedNote {
  return {
    ...note,
    markdown: normalizeGeneratedNoteMarkdown(note, relations),
  };
}

function normalizeGeneratedNotePath(note: GeneratedNote): GeneratedNote {
  const normalizedTitle = normalizeComparableText(note.title);
  const segments = note.path
    .split("/")
    .map((segment) => normalizeGeneratedNotePathSegment(segment.trim()))
    .filter((segment) => segment.value.length > 0);
  const normalizedSegments = segments
    .filter((segment, index) => {
      if (index !== segments.length - 1) return true;
      return normalizeComparableText(segment.value) !== normalizedTitle;
    })
    .map((segment) => segment.value);

  if (normalizedSegments.length === 0) return note;

  return {
    ...note,
    path: normalizedSegments.join(" / "),
  };
}

function normalizeGeneratedNotePathSegment(segment: string) {
  const value = segment.replace(/\.(?:md|markdown)$/i, "").trim();

  return {
    value,
    hadMarkdownExtension: value !== segment,
  };
}

function normalizeGeneratedNoteMarkdown(note: GeneratedNote, relations: KnowledgeRelation[]) {
  const body = formatKnowledgeMarkdown(
    stripManagedMarkdownSections(stripLeadingTitle(note.markdown, note.title)),
  );
  const metadata = buildNoteMetadata(note, relations);
  const childLinks = getChildRelationTargets(note, relations);
  const sections = [...metadata, "", body || "## 正文\n- 内容待确认。"];

  if (childLinks.length > 0) {
    sections.push("", "## 后续枝节", ...childLinks.map((target) => `- [[${target}]]`));
  }

  return tidyMarkdown(sections.join("\n"));
}

function buildNoteMetadata(note: GeneratedNote, relations: KnowledgeRelation[]) {
  const metadata = [`粒度：${note.grain}`];
  const parents = getParentRelationSources(note, relations);
  const prerequisites = getPrerequisiteRelationTargets(note, relations);

  if (parents.length > 0) {
    metadata.push(`上级主题：${parents.map((title) => `[[${title}]]`).join("、")}`);
  } else {
    metadata.push(`归类：[[${getRootPathSegment(note.path)}]]`);
  }

  if (prerequisites.length > 0) {
    metadata.push(`前置知识：${prerequisites.map((title) => `[[${title}]]`).join("、")}`);
  }

  return metadata;
}

function getParentRelationSources(note: GeneratedNote, relations: KnowledgeRelation[]) {
  return uniqueLines(
    relations
      .filter((relation) => relation.type === "包含" && relation.target === note.title && relation.source !== note.title)
      .map((relation) => relation.source),
  );
}

function getChildRelationTargets(note: GeneratedNote, relations: KnowledgeRelation[]) {
  return uniqueLines(
    relations
      .filter((relation) => relation.type === "包含" && relation.source === note.title && relation.target !== note.title)
      .map((relation) => relation.target),
  );
}

function getPrerequisiteRelationTargets(note: GeneratedNote, relations: KnowledgeRelation[]) {
  return uniqueLines([
    ...relations
      .filter((relation) => relation.type === "前置知识" && relation.source === note.title && relation.target !== note.title)
      .map((relation) => relation.target),
    ...relations
      .filter((relation) => relation.type === "递进" && relation.target === note.title && relation.source !== note.title)
      .map((relation) => relation.source),
  ]);
}

function stripLeadingTitle(markdown: string, title: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  while (lines[0]?.trim() === "") lines.shift();

  if (/^#\s+/.test(lines[0] ?? "")) {
    lines.shift();
    while (lines[0]?.trim() === "") lines.shift();
  }

  return lines.join("\n").replace(new RegExp(`^#\\s+${escapeRegExp(title)}\\s*\\n+`, "i"), "");
}

function stripManagedMarkdownSections(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let skippingSection = false;

  for (const line of lines) {
    if (/^#{2,6}\s*(相关笔记|相关主题|分支知识|后续枝节|下级知识|子分支)\s*$/.test(line.trim())) {
      skippingSection = true;
      continue;
    }

    if (skippingSection && /^#{1,6}\s+/.test(line.trim())) {
      skippingSection = false;
    }

    if (skippingSection) continue;

    if (/^(粒度|归类|上级主题|前置知识|前置语法|相关笔记|相关主题)\s*[：:]/.test(line.trim())) {
      continue;
    }

    kept.push(line);
  }

  return tidyMarkdown(kept.join("\n"));
}

function tidyMarkdown(markdown: string) {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function getRootPathSegment(path: string) {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)[0] || "未归类";
}

function createLocalReviewSkillOutput(sources: IntakeSource[]): ReviewSkillOutput {
  const corrections = sources.flatMap(createCorrectionsForSource);
  const notes = sources.flatMap(createNotesForSource);

  return {
    protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
    corrections,
    notes,
    relations: createRelationsForNotes(notes),
    uncertain: [],
  };
}

function createCorrectionsForSource(source: IntakeSource): Correction[] {
  const corrections: Correction[] = [];
  const compact = source.content.replace(/\s+/g, " ");

  if (compact.includes(javaPrintOriginal)) {
    corrections.push({
      sourceId: source.id,
      original: javaPrintOriginal,
      fixed: "print 不自动换行；println 输出后追加换行。",
      reason: "Java 的 System.out.print 只输出内容本身，System.out.println 会在内容后追加换行符。",
    });
  }

  if (compact.includes(pythonAppendOriginal)) {
    corrections.push({
      sourceId: source.id,
      original: pythonAppendOriginal,
      fixed: "list.append() 会原地修改列表，并返回 None。",
      reason: "Python 的 append 是可变列表对象方法，它改变调用者本身，不创建新列表。",
    });
  }

  if (/where\s+count\s*\(\s*\*\s*\)\s*>\s*3/i.test(source.content)) {
    corrections.push({
      sourceId: source.id,
      original: sqlWhereOriginal,
      fixed: "having count(*) > 3",
      reason: "WHERE 过滤分组前的行；HAVING 过滤 GROUP BY 和聚合计算后的结果。",
    });
  }

  return corrections;
}

function createNotesForSource(source: IntakeSource): GeneratedNote[] {
  if (isJavaOutputSource(source)) {
    return [
      {
        id: `${source.id}-java-output`,
        sourceId: source.id,
        title: "Java 控制台输出",
        grain: "中颗粒度",
        path: "Java / Java 基础语法 / 输入与输出",
        status: "新建笔记",
        markdown: [
          "# Java 控制台输出",
          "",
          "粒度：中颗粒度",
          "前置语法：[[Java 基础语法]]",
          "相关主题：[[格式化输出]]",
          "",
          "## 核心结论",
          "- `System.out.print` 输出内容本身，不会自动换行。",
          "- `System.out.println` 会在输出内容后追加换行。",
          "- `System.out.printf` 用于格式化输出。",
          "",
          "## 容易混淆",
          "- 不要把 `print` 和 `println` 的换行行为反过来。",
        ].join("\n"),
      },
    ];
  }

  if (isPythonAppendSource(source)) {
    return [
      {
        id: `${source.id}-python-append`,
        sourceId: source.id,
        title: "Python 列表 append",
        grain: "小颗粒度",
        path: "Python / Python 基础语法 / 列表",
        status: "新建笔记",
        markdown: [
          "# Python 列表 append",
          "",
          "粒度：小颗粒度",
          "前置语法：[[Python 列表]]",
          "",
          "## 核心结论",
          "- `list.append(value)` 会原地修改列表。",
          "- `append` 的返回值是 `None`，不能把它当成新列表使用。",
          "",
          "## 对比",
          "- 需要得到新列表时，应使用拼接、切片或列表推导等方式。",
        ].join("\n"),
      },
    ];
  }

  if (isSqlHavingSource(source)) {
    return [
      {
        id: `${source.id}-sql-where-having`,
        sourceId: source.id,
        title: "SQL WHERE 与 HAVING",
        grain: "小颗粒度",
        path: "数据库 / SQL 查询 / 聚合查询",
        status: "新建笔记",
        markdown: [
          "# SQL WHERE 与 HAVING",
          "",
          "粒度：小颗粒度",
          "前置知识：[[SQL GROUP BY]]",
          "",
          "## 核心结论",
          "- `WHERE` 过滤分组前的原始行。",
          "- `HAVING` 过滤分组和聚合计算后的结果。",
          "- 聚合表达式如 `count(*) > 3` 应放在 `HAVING` 中。",
          "",
          "## 修正示例",
          "```sql",
          "select user_id, count(*) as total",
          "from orders",
          "group by user_id",
          "having count(*) > 3;",
          "```",
        ].join("\n"),
      },
    ];
  }

  if (isGitWorkflowSource(source)) {
    return createGitWorkflowNotes(source);
  }

  const stack = inferStack(source);
  const title = source.title || `${stack} 导入笔记`;

  return [
    {
      id: `${source.id}-generic`,
      sourceId: source.id,
      title,
      grain: "中颗粒度",
      path: `${stack} / 待细分 / ${title}`,
      status: "新建笔记",
      markdown: [
        `# ${title}`,
        "",
        "粒度：中颗粒度",
        `归类：[[${stack}]]`,
        "",
        "## 原始提炼内容",
        source.content,
      ].join("\n"),
    },
  ];
}

function createGitWorkflowNotes(source: IntakeSource): GeneratedNote[] {
  const application = extractPurpose(source.content) || "团队多人管理项目版本，分流开发。";
  const conceptLines = extractDefinitionLines(source.content);
  const commandLines = extractCommandLines(source.content);
  const stepLines = extractGitStepLines(source.content, conceptLines, commandLines);
  const basePath = "Git / Git 工具";

  return [
    {
      id: `${source.id}-git-overview`,
      sourceId: source.id,
      title: "Git 工具总览",
      grain: "大颗粒度",
      path: basePath,
      status: "新建笔记",
      markdown: [
        "# Git 工具总览",
        "",
        "粒度：大颗粒度",
        "归类：[[Git]]",
        "前置知识：[[版本控制]]",
        "",
        "## 简要说明",
        "Git 是用于记录、分支管理和协作合并的版本控制工具。",
        "",
        "## 应用场景",
        `- ${application}`,
        "",
        "## 分支知识",
        "- [[Git 工具基本概念]]",
        "- [[Git 工具应用步骤]]",
        "- [[Git 常用命令与代码]]",
      ].join("\n"),
    },
    {
      id: `${source.id}-git-concepts`,
      sourceId: source.id,
      title: "Git 工具基本概念",
      grain: "中颗粒度",
      path: `${basePath} / 基本概念`,
      status: "新建笔记",
      markdown: [
        "# Git 工具基本概念",
        "",
        "粒度：中颗粒度",
        "上级主题：[[Git 工具总览]]",
        "",
        "## 核心概念",
        formatBulletLines(conceptLines, "原文未提取到明确概念定义，需要人工补充。"),
      ].join("\n"),
    },
    {
      id: `${source.id}-git-steps`,
      sourceId: source.id,
      title: "Git 工具应用步骤",
      grain: "中颗粒度",
      path: `${basePath} / 应用步骤`,
      status: "新建笔记",
      markdown: [
        "# Git 工具应用步骤",
        "",
        "粒度：中颗粒度",
        "上级主题：[[Git 工具总览]]",
        "前置知识：[[Git 工具基本概念]]",
        "",
        "## 操作流程",
        formatNumberedLines(stepLines, "原文未提取到明确操作步骤，需要人工补充。"),
      ].join("\n"),
    },
    {
      id: `${source.id}-git-commands`,
      sourceId: source.id,
      title: "Git 常用命令与代码",
      grain: "小颗粒度",
      path: `${basePath} / 命令与代码`,
      status: "新建笔记",
      markdown: [
        "# Git 常用命令与代码",
        "",
        "粒度：小颗粒度",
        "上级主题：[[Git 工具总览]]",
        "前置知识：[[Git 工具应用步骤]]",
        "",
        "## 命令代码",
        formatCommandBlock(commandLines, "原文未提取到明确 Git 命令，确认时可手动补充。"),
      ].join("\n"),
    },
  ];
}

function createRelationsForNotes(notes: GeneratedNote[]): KnowledgeRelation[] {
  const relations = notes.flatMap(createRelationsForNote);
  const notesBySource = new Map<string, GeneratedNote[]>();

  for (const note of notes) {
    notesBySource.set(note.sourceId, [...(notesBySource.get(note.sourceId) ?? []), note]);
  }

  for (const sourceNotes of notesBySource.values()) {
    const overview = sourceNotes.find((note) => note.grain === "大颗粒度");
    const children = sourceNotes.filter((note) => note !== overview);

    if (!overview || children.length === 0) continue;

    for (const child of children) {
      relations.push({
        type: "包含",
        source: overview.title,
        target: child.title,
      });
    }

    for (let index = 0; index < children.length - 1; index += 1) {
      relations.push({
        type: "递进",
        source: children[index].title,
        target: children[index + 1].title,
      });
    }
  }

  return dedupeRelations(relations);
}

function createRelationsForNote(note: GeneratedNote): KnowledgeRelation[] {
  if (note.title === "Java 控制台输出") {
    return [
      { type: "前置知识", source: "Java 控制台输出", target: "Java 基础语法" },
      { type: "应用于", source: "System.out.printf", target: "格式化输出" },
    ];
  }

  if (note.title === "Python 列表 append") {
    return [{ type: "容易混淆", source: "Python append", target: "返回新对象" }];
  }

  if (note.title === "SQL WHERE 与 HAVING") {
    return [{ type: "对比", source: "SQL WHERE", target: "SQL HAVING" }];
  }

  return [];
}

function extractPurpose(content: string) {
  const purposeLine = normalizeLines(content).find((line) => /^作用\s*[：:]/.test(line));
  return purposeLine?.replace(/^作用\s*[：:]\s*/, "").trim();
}

function extractDefinitionLines(content: string) {
  return uniqueLines(
    normalizeLines(content).filter((line) => {
      if (!/[：:]/.test(line)) return false;
      if (/^作用\s*[：:]/.test(line)) return false;
      if (isCommandLine(line)) return false;

      return /(分支|仓库|Pull Request|PR|main|feature|本地|远程|版本|合并)/i.test(line);
    }),
  );
}

function extractGitStepLines(content: string, conceptLines: string[], commandLines: string[]) {
  const conceptSet = new Set(conceptLines);
  const commandSet = new Set(commandLines);

  return uniqueLines(
    normalizeLines(content)
      .filter((line) => !conceptSet.has(line) && !commandSet.has(line))
      .filter((line) => !/^作用\s*[：:]/.test(line))
      .filter((line) => {
        if (/^(一|二|三|四|五|六|七|八|九|十)、?\s*基础概念/.test(line)) return false;
        if (/^\d+(\.\d+)*\s+/.test(line)) return true;
        if (/(登录|点击|选择|填写|创建|提交|推送|拉取|合并|发起|打开|复制|克隆|新建|切换)/.test(line)) {
          return true;
        }
        return /(repository|pull request|merge|commit|push|clone|checkout)/i.test(line);
      }),
  );
}

function extractCommandLines(content: string) {
  const lines = normalizeLines(content);
  const commands: string[] = [];
  let insideFence = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence || isCommandLine(line)) {
      commands.push(line);
    }
  }

  return uniqueLines(commands);
}

function isCommandLine(line: string) {
  return /^(git|gh|cd|mkdir|touch|npm|pnpm|yarn)\b/i.test(line.trim());
}

function formatBulletLines(lines: string[], fallback: string) {
  const rows = lines.length > 0 ? lines : [fallback];
  return rows.map((line) => `- ${line}`).join("\n");
}

function formatNumberedLines(lines: string[], fallback: string) {
  const rows = lines.length > 0 ? lines : [fallback];
  return rows.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function formatCommandBlock(lines: string[], fallback: string) {
  if (lines.length === 0) return `- ${fallback}`;

  return ["```bash", ...lines, "```"].join("\n");
}

function normalizeLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueLines(lines: string[]) {
  return [...new Set(lines)];
}

function dedupeRelations(relations: KnowledgeRelation[]) {
  const seen = new Set<string>();

  return relations.filter((relation) => {
    const key = `${relation.type}:${relation.source}:${relation.target}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildOverviewMarkdown(batch: ReviewBatch) {
  const sourceRows = batch.sources
    .map((source) => `- [[00-原始上传/${safeFileName(`${source.id}-${source.title}`)}|${source.title}]]`)
    .join("\n");
  const correctionRows =
    batch.corrections.length > 0
      ? batch.corrections
          .map((item) => `- 原文错误点：${item.original}\n  - 修正：${item.fixed}\n  - 理由：${item.reason}`)
          .join("\n")
      : "- 本批次暂无明确错误纠正。";
  const noteRows = batch.notes
    .map((note) => {
      const link = notePreviewPath(note).replace(/\.md$/, "");
      return `- [[${link}|${note.title}]] - ${note.grain} - ${note.path}`;
    })
    .join("\n");
  const relationRows =
    batch.relations.length > 0
      ? batch.relations.map((item) => `- ${item.type}：[[${item.source}]] → [[${item.target}]]`).join("\n")
      : "- 本批次暂无新增关系。";
  const moveRows =
    batch.moves.length > 0
      ? batch.moves
          .map((item) => `- 迁移旧笔记：${item.fromPath} → ${item.toPath}\n  - 理由：${item.reason}`)
          .join("\n")
      : "- 本批次暂无旧笔记迁移。";

  return [
    "# lifemind 审理确认总览",
    "",
    `批次：${batch.id}`,
    `状态：${batch.status}`,
    `创建时间：${batch.createdAt}`,
    "",
    "## 上传原文",
    sourceRows,
    "",
    "## 原文错误点与修正理由",
    correctionRows,
    "",
    "## 待生成笔记",
    noteRows,
    "",
    "## 新增关系",
    relationRows,
    "",
    "## 旧笔记迁移计划",
    moveRows,
  ].join("\n");
}

function buildSourceMarkdown(source: IntakeSource) {
  return [
    `# ${source.title}`,
    "",
    `来源类型：${source.type}`,
    `技术栈提示：${source.stackHint || "未填写"}`,
    "",
    "## 原文",
    source.content,
  ].join("\n");
}

function buildReviewMarkdown(batch: ReviewBatch, note: GeneratedNote) {
  const corrections = batch.corrections.filter((item) => item.sourceId === note.sourceId);
  const correctionRows =
    corrections.length > 0
      ? corrections.map((item) => `- ${item.original}\n  - ${item.fixed}\n  - ${item.reason}`).join("\n")
      : "- 无明确错误纠正。";

  return [
    `# ${note.title} 审理结果`,
    "",
    `目标路径：${note.path}`,
    `粒度：${note.grain}`,
    `写入方式：${note.status}`,
    "",
    "## 错误纠正",
    correctionRows,
    "",
    "## 生成笔记预览",
    note.markdown,
  ].join("\n");
}

function isJavaOutputSource(source: IntakeSource) {
  const content = source.content.toLowerCase();
  return inferStack(source) === "Java" || content.includes("system.out") || content.includes("println");
}

function isPythonAppendSource(source: IntakeSource) {
  const content = source.content.toLowerCase();
  return inferStack(source) === "Python" || (content.includes("append") && content.includes("list"));
}

function isSqlHavingSource(source: IntakeSource) {
  return inferStack(source).includes("SQL") || /where\s+count\s*\(\s*\*\s*\)/i.test(source.content);
}

function isGitWorkflowSource(source: IntakeSource) {
  const searchable = `${source.stackHint ?? ""}\n${source.title}\n${source.content}`.toLowerCase();
  return (
    searchable.includes("git") ||
    searchable.includes("github") ||
    searchable.includes("pull request") ||
    searchable.includes("repository") ||
    searchable.includes("main分支") ||
    searchable.includes("功能分支")
  );
}

function inferStack(source: IntakeSource) {
  const hint = source.stackHint?.trim();
  const searchable = `${source.title}\n${source.content}`.toLowerCase();

  if (hint) return hint;

  const organizationRoot = extractSourceOrganizationSignals([source], null)[0]?.root?.trim();

  if (organizationRoot) return organizationRoot;

  if (
    searchable.includes("git") ||
    searchable.includes("github") ||
    searchable.includes("pull request") ||
    searchable.includes("repository") ||
    searchable.includes("main分支")
  ) {
    return "Git";
  }
  if (searchable.includes("system.out") || searchable.includes("java")) return "Java";
  if (searchable.includes("python") || searchable.includes("append")) return "Python";
  if (searchable.includes("select ") || searchable.includes("group by") || searchable.includes("sql")) {
    return "数据库 / SQL";
  }
  if (searchable.includes("c++") || searchable.includes("vector")) return "C++";

  return "未归类";
}

function createBatchId(now: Date) {
  return `batch-${formatLocalDate(now)}-${formatLocalTime(now)}`;
}

function formatLocalDateTime(value: Date) {
  return `${formatLocalDateDisplay(value)} ${formatLocalTimeDisplay(value)}`;
}

function formatLocalDate(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map(padDatePart).join("");
}

function formatLocalTime(value: Date) {
  return [value.getHours(), value.getMinutes(), value.getSeconds()].map(padDatePart).join("");
}

function formatLocalDateDisplay(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map(padDatePart).join("-");
}

function formatLocalTimeDisplay(value: Date) {
  return [value.getHours(), value.getMinutes(), value.getSeconds()].map(padDatePart).join(":");
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function safeBatchIdSegment(value: string) {
  const trimmed = value.trim();

  if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error("批次 ID 只能包含英文、数字、短横线和下划线。");
  }

  return trimmed;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "未命名";
}

function safePathSegment(value: string) {
  return safeFileName(value).replace(/\.+$/g, "") || "未命名";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
