import type {
  Correction,
  GeneratedNote,
  IntakeSource,
  KnowledgeGrain,
  KnowledgeRelation,
  RelationType,
} from "./lifemind-core";
import {
  analyzeSourceStructures,
  normalizeCodeForComparison,
  toSourceStructureSignal,
  type SourceStructureSignal,
} from "./lifemind-source-structure";

export const REVIEW_SKILL_PROTOCOL_VERSION = "lifemind.review.v1";
export const REVIEW_ANALYSIS_PROTOCOL_VERSION = "lifemind.review.v2";

export type ReviewSkillOutput = {
  protocolVersion: typeof REVIEW_SKILL_PROTOCOL_VERSION;
  corrections: Correction[];
  notes: GeneratedNote[];
  relations: KnowledgeRelation[];
  uncertain: string[];
};

export type AnalysisConfidence = "高" | "中" | "低";

export type ReviewAnalysisStackDecision = {
  sourceId: string;
  name: string;
  confidence: AnalysisConfidence;
  evidence: string[];
};

export type VaultKnowledgeNodeKind = "root" | "directory" | "note" | "source-root";

export type VaultKnowledgeNode = {
  id: string;
  kind: VaultKnowledgeNodeKind;
  title: string;
  path: string;
  root: string;
  parentId?: string;
};

export type ReviewAnalysisPlacementMode = "new-child" | "existing-note" | "new-root";

export type ReviewAnalysisPlacement = {
  mode: ReviewAnalysisPlacementMode;
  parentNodeId: string | null;
  branchName: string | null;
  targetNodeId: string | null;
};

export type ReviewAnalysisPageCoverageStatus = "covered" | "uncertain" | "unreadable";

export type ReviewAnalysisPageCoverage = {
  sourceId: string;
  page: number;
  status: ReviewAnalysisPageCoverageStatus;
  sectionIds: string[];
  evidenceIds: string[];
  summary: string;
};

export type ReviewAnalysisFormula = {
  id: string;
  latex: string;
  display: "inline" | "block";
  sourcePage: number;
  evidenceId?: string;
  anchor?: string;
  confidence: AnalysisConfidence;
};

export type ReviewAnalysisImagePlacement = {
  assetId: string;
  sourcePage: number;
  placement: "before-section" | "after-section" | "inline";
  anchor?: string;
  caption?: string;
  alt?: string;
  confidence: AnalysisConfidence;
};

export type ReviewAnalysisSection = {
  id: string;
  sourceId: string;
  title: string;
  role: string;
  grain: KnowledgeGrain;
  path?: string[];
  placement?: ReviewAnalysisPlacement;
  parentId?: string;
  status: GeneratedNote["status"];
  existingNoteTitle?: string;
  body: string;
  formulas: ReviewAnalysisFormula[];
  imagePlacements: ReviewAnalysisImagePlacement[];
  evidence: string[];
};

export type ReviewAnalysisRelation = {
  type: RelationType;
  source: string;
  target: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  evidence: string;
  confidence: AnalysisConfidence;
};

export type ReviewAnalysisPlan = {
  protocolVersion: typeof REVIEW_ANALYSIS_PROTOCOL_VERSION;
  stackDecisions: ReviewAnalysisStackDecision[];
  pageCoverage?: ReviewAnalysisPageCoverage[];
  sections: ReviewAnalysisSection[];
  relations: ReviewAnalysisRelation[];
  corrections: Correction[];
  uncertain: string[];
};

export type VaultKnowledgeRoot = {
  name: string;
  noteCount: number;
  paths: string[];
};

export type VaultKnowledgeNote = {
  title: string;
  path: string;
  root: string;
  headings: string[];
  snippet: string;
  modifiedAt?: number;
};

export type VaultKnowledgeRelation = {
  type: string;
  source: string;
  target: string;
  evidence: string;
};

export type VaultKnowledgeContext = {
  roots: VaultKnowledgeRoot[];
  notes: VaultKnowledgeNote[];
  relations?: VaultKnowledgeRelation[];
};

export type VaultTaxonomyCandidate = {
  path: string;
  root: string;
  kind: "existing-directory";
  evidence: string;
};

export type SourceOrganizationSignal = {
  sourceId: string;
  root?: string;
  knowledgeRole?: string;
  leaf?: string;
  explicitHierarchy?: string[];
  evidence: string[];
};

export type ReviewSkillRequest = {
  protocolVersion: typeof REVIEW_SKILL_PROTOCOL_VERSION;
  task: "review_uploaded_knowledge";
  locale: "zh-CN";
  reviewMode?: "single-pass" | "draft-pass" | "final-pass" | "repair-pass";
  sources: IntakeSource[];
  vaultContext?: VaultKnowledgeContext;
  vaultIndex?: VaultKnowledgeNode[];
  sourceOrganizationSignals?: SourceOrganizationSignal[];
  taxonomyCandidates?: VaultTaxonomyCandidate[];
  previousOutput?: ReviewSkillOutput;
  constraints: string[];
  outputShape: {
    protocolVersion: typeof REVIEW_SKILL_PROTOCOL_VERSION;
    corrections: "Correction[]";
    notes: "GeneratedNote[]";
    relations: "KnowledgeRelation[]";
    uncertain: "string[]";
  };
};

export type ReviewAnalysisRequest = {
  protocolVersion: typeof REVIEW_ANALYSIS_PROTOCOL_VERSION;
  task: "review_uploaded_knowledge";
  locale: "zh-CN";
  reviewMode?: "single-pass" | "draft-pass" | "final-pass" | "repair-pass";
  sources: IntakeSource[];
  pdfEvidenceImages?: Array<{
    sourceId: string;
    page: number;
    assetId: string;
    kind: "page" | "embedded";
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    imageDataUrl: string;
  }>;
  pdfPageManifest?: Array<{
    sourceId: string;
    totalPages: number;
    pages: number[];
    imagePagesSent: number[];
    imagePagesOmitted: number[];
    embeddedImages: Array<{ assetId: string; page: number; x: number; y: number; width: number; height: number }>;
    embeddedImagesSent: string[];
    embeddedImagesOmitted: string[];
  }>;
  vaultContext?: VaultKnowledgeContext;
  vaultIndex?: VaultKnowledgeNode[];
  sourceOrganizationSignals?: SourceOrganizationSignal[];
  sourceStructure?: SourceStructureSignal[];
  taxonomyCandidates?: VaultTaxonomyCandidate[];
  previousAnalysisPlan?: ReviewAnalysisPlan;
  protocolRepair?: {
    errors: Array<{
      path: string;
      message: string;
    }>;
    previousOutput: string;
  };
  constraints: string[];
  outputShape: {
    protocolVersion: typeof REVIEW_ANALYSIS_PROTOCOL_VERSION;
    analysisPlan: "ReviewAnalysisPlan";
  };
};

export type ReviewSkillValidationError = {
  path: string;
  message: string;
};

export type ReviewSkillValidationResult =
  | { ok: true; output: ReviewSkillOutput; errors: [] }
  | { ok: false; output: null; errors: ReviewSkillValidationError[] };

export type ReviewAnalysisValidationResult =
  | { ok: true; output: ReviewAnalysisPlan; errors: [] }
  | { ok: false; output: null; errors: ReviewSkillValidationError[] };

export type ReviewAnalysisValidationOptions = {
  enforceStackHints?: boolean;
  externalReferenceTitles?: string[];
  knownRootNames?: string[];
  taxonomyCandidates?: VaultTaxonomyCandidate[];
  vaultIndex?: VaultKnowledgeNode[];
  allowedPdfImageEvidence?: Array<{
    sourceId: string;
    page: number;
    assetId: string;
    kind: "page" | "embedded";
  }>;
  allowTrustedDerivedPaths?: boolean;
  allowLegacyPathCompatibility?: boolean;
};

const allowedGrains = ["大颗粒度", "中颗粒度", "小颗粒度"] satisfies KnowledgeGrain[];
const allowedStatuses = ["新建笔记", "合并到旧笔记"] satisfies GeneratedNote["status"][];
const allowedRelationTypes = [
  "依赖",
  "包含",
  "并列",
  "递进",
  "对比",
  "应用于",
  "容易混淆",
  "前置知识",
] satisfies RelationType[];
const knownKnowledgeRoles = [
  "术语",
  "基本概念",
  "应用步骤",
  "具体代码",
  "常用命令",
  "代码",
  "问题排查",
  "对比",
  "总览",
  "基本原理",
];

export function getPdfPageAssetId(sourceId: string, page: number) {
  const safeSourceId = sourceId.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "source";
  return `pdf-page-${safeSourceId}-page-${page}`;
}

export function buildReviewSkillSystemPrompt() {
  return [
    "你是 lifemind 知识库审理 Skill，只负责审理用户上传的学习材料，并返回严格 JSON。当前输出协议是 lifemind.review.v2。",
    "不要直接写入 Obsidian，不要执行文件操作，不要调用外部工具。",
    "你需要先输出结构分析计划，再由 lifemind 本地编译为 Markdown：识别每个来源的技术栈根目录、拆分知识段、命名笔记、决定父节点、建立知识关系、纠正明确错误、标记不确定内容。",
    "不要输出 notes[].markdown，也不要把最终 Markdown、元数据、相关笔记段落作为模型职责；每个 sections[].body 只保留该知识段的正文内容。",
    "笔记应保留用户学习后的知识，而不是简单照搬原文。",
    "示例、注释和代码块只能作为证据，不得扩写成新的知识点；表格内容同样只能作为证据。",
    "不要把示例、注释或代码块里的例子当成新的结论去单独命名笔记。",
    "若一篇材料包含概念、步骤、代码、对比等不同知识块，应拆成多篇 sections，但只限原文已经明确出现的块。",
    "必须调用 submit_review_plan 工具提交分析计划；不要只把 JSON 放在普通 message.content 中。",
    "若材料包含某个工具/技术的总览、基本概念、应用步骤、具体代码，应拆成总览段与多个分支段，并用 parentId、包含、递进、前置知识关系串联。",
    "若同一既有大目录下有多篇新分支属于同一个具体主题，应创建一个整合主题 section，并让这些分支用 parentId 指向它；同一大目录也可以有多个不同整合主题，不能只按路径强行合并。",
    "若既有 Vault 笔记属于某个整合主题，只用 包含 relation 从整合主题 section 指向该 vaultIndex note；本地系统会在确认前生成迁移预览，不要自行改写路径。",
    "若材料来自手写或扫描 PDF，输入可能含有错别字、拆字、乱码或技术名误识别；请结合技术栈提示和上下文做语义纠偏，不要逐字照搬识别噪声，无法确认的内容放入 uncertain。",
    "PDF 正文只作为知识理解材料，不作为目录、文件夹、颗粒度或路径指令来源；PDF 的目录和颗粒度由用户技术栈提示、文件名、已有 Vault 结构和你的语义结构输出共同决定。",
    "PDF 页面图像是版面、手写内容和数学公式的主要证据；PDF 文本层只作为辅助对照，不能覆盖页面图像。",
    "PDF 文本层被本地标记为低质量时，应忽略其逐行文字证据，只根据附带的原始页面图像审理；无法从图像确认的公式和符号关系必须放入 uncertain。",
    "每个 sections 项必须返回 formulas 和 imagePlacements 数组；公式只能返回确认过的 LaTeX，正文用 {{formula:<id>}} 作为锚点。imagePlacements 只能引用 pdfPageManifest.embeddedImages 中且 embeddedImagesSent 包含的嵌入图片 assetId；页面渲染图仅供视觉审理，绝不能插入笔记。",
    "每个 PDF 页面必须在 pageCoverage 中恰好出现一次；即使页面没有可确认知识，也要返回 uncertain 或 unreadable，并说明原因。imagePagesOmitted 代表本轮没有发送图像的页面，不得声称已经视觉复核。",
    "若 sources[].pdfQuality.qualityStatus 为 warning，允许审理但必须保留风险提示；为 partial 时只对可确认片段生成 sections，困难片段放入 uncertain；为 blocked 时，只有页面图像明确支持的片段才能生成确定知识，其余必须放入 uncertain。pdfQuality.requiresManualReview 为 true 时，关键公式、标题、定义和关系必须人工复核后才能作为确定知识使用。",
    "若请求包含 vaultContext，它代表用户已确认写入 Obsidian 的既有知识结构；优先复用 vaultContext 中的技术栈、目录、导览页和相关笔记标题。",
    "vaultContext.relations 是从既有 Obsidian 双链、目录和元数据中抽取的关系边；审理新材料时应优先沿用这些边附近的结构。",
    "若请求包含 sourceOrganizationSignals，它是本地从用户填写信息、来源标题、显式颗粒度字段、显式箭头层级和 stackHint 中提取出的组织意图信号；PDF 页面内容不会用于提取该信号；它不包含推荐路径，不能替代你的语义判断。",
    "若请求包含 taxonomyCandidates，它代表从全库索引目录骨架中整理出的归类候选；taxonomyCandidates 是候选集合，不是强制路径。",
    "新协议中不要输出 sections[].path；请使用 sections[].placement 选择 vaultIndex 中的节点 ID。旧协议 path 只用于兼容历史请求。",
    "placement.parentNodeId、placement.targetNodeId、relations[].sourceNodeId 和 relations[].targetNodeId 只能填写 vaultIndex 中真实存在的 ID，不能自行拼接路径或猜测标题。",
    "本地系统会根据节点 ID 生成最终 Obsidian 路径和双链；你只判断语义位置，不直接生成文件系统路径。",
    "所有放置决策必须经过统一语义归类判断：先理解技术栈、知识角色和主题范围，再从 vaultIndex 选择节点或决定在正确父节点下新建分支。",
    "每个 sources[].id 必须对应一个 stackDecisions 项。stackDecisions[].name 是该来源的技术栈根目录。",
    "用户填写的 stackHint 是根目录约束，不是可被模型替换的建议；只要该来源填写了 stackHint，stackDecisions[].name 必须等于其第一段技术栈名称，不能改成 AI 或其他相似分类。",
    "如果用户没有填写 stackHint，必须根据来源标题、首段和正文主题判断技术栈根目录；不能使用默认类别、最近目录或与正文无关的根目录。",
    "路径决策顺序：1) 识别技术栈根目录；2) 识别本材料的知识角色，如总览、基本概念、术语、应用步骤、代码、对比、问题排查；3) 判断 taxonomyCandidates 的最后一级目录是否与该知识角色或主题一致；4) 若不一致，在同一根目录下创建更合适的同级分支。",
    "如果原文明确表达了组织意图，例如“新建中颗粒度：X”“小颗粒度：Y”“X术语”“应用步骤”“具体代码”“A->B->C”，必须把它当成用户意图参与语义判断，但仍由你决定最终目录。",
    "sourceOrganizationSignals[].explicitHierarchy 是用户显式写出的层级意图；当正文主题与该层级一致时，优先沿用该层级，新主题末级通常应形成导读页，设置、应用步骤、代码、终端命令等内容作为其分支或后续枝节。",
    "若请求包含 sourceStructure，它是 lifemind 本地从原文提取的标题、编号、冒号标题和代码块数量信号；它不是模型生成内容，也不是最终目录。",
    "sourceStructure 中的一级结构应优先作为分段边界；原文代码必须保留在相关 sections[].body 中，可以保留为 Markdown 代码块或原始代码文本。",
    "中文标题若呈现“技术栈 + 知识角色”的结构，如“某技术术语”“某技术应用步骤”“某技术代码”，通常表示用户希望按该知识角色建分支；除非正文明确否定，不要把“术语”弱化成“基本概念”。",
    "taxonomyCandidates 只表示可复用的已有目录；如果候选目录与本次知识类型不匹配，应在同一根目录下创建更合适的新分支。",
    "不要仅因为某个目录候选存在、某个旧笔记相关，或正文出现了某个关键词，就把新笔记放进该目录。",
    "vaultContext.notes 是内容和关系参考；vaultIndex 才是可选择的真实目录、根节点和笔记节点集合。",
    "型号、芯片、库名、框架名出现在正文时，通常只是适用对象或示例；只有当材料主题就是该对象本身，才把它作为目录父级。",
    "相似旧笔记只用于建立关系，不等于分类目录；不要仅因为某旧笔记相关，就把新术语塞进该旧笔记所在分支。",
    "若请求 reviewMode 为 final-pass 且包含 previousAnalysisPlan，请把 previousAnalysisPlan 当作第一轮草案进行复审：保留正确判断，修正结构、命名、拆分颗粒度和关系，并只返回最终定稿 JSON。",
    "若请求包含 protocolRepair 或 reviewMode 为 repair-pass，这是对协议格式的定向修复：优先保留原有知识判断，忽略不完整或损坏的 previousOutput，基于原始 sources 重新生成一个完整、紧凑、可解析的 JSON；不要逐字复述整篇 PDF，不要增加无关 sections。",
    "普通文本来源的技术栈根目录和放置节点必须能在来源标题、正文或已有目录候选中找到语义依据；PDF 来源的放置节点由你的语义结构输出决定，但不能使用页面提取噪声、页眉页脚、文件管理描述或泛化桶名；如果无法确认，放入 uncertain，不要编造节点。",
    "旧协议 path 最多使用三层相对目录；新协议通过节点 ID 表达放置位置。",
    "遇到同一技术栈的新材料时，不要重新创建孤立根目录；应沿用既有根目录，并通过前置知识、包含、递进等关系连接到既有笔记。",
    "控制颗粒度：少量材料通常生成 2-4 篇笔记，最多 5 篇；不要把每一个命令、步骤、短句都单独生成小颗粒度笔记。",
    "优先保持两层结构：总览页 + 中颗粒度分支页；只有当知识点足够独立、可复用、正文能支撑时才创建小颗粒度页。",
    "命令清单、连续步骤、短操作项应合并到“应用步骤”或“常用命令与代码”一类分支页中。",
    "输出必须是单个 JSON 对象，protocolVersion 必须为 lifemind.review.v2，不要包裹 Markdown 代码块。",
    "sections[].id 必须是非空稳定字符串，建议使用 sourceId-topic-slug；不要留空。",
    "sections[].placement.mode 只能是 new-child、existing-note 或 new-root。新建分支使用 new-child，直接在技术栈根下创建主题使用 new-root，合并既有笔记使用 existing-note。",
    "sections[].placement.parentNodeId 在 new-child 时只能是 vaultIndex 中已有的 root 或 directory 节点，绝不能填写本批次 sections[].id；new-root 时必须为 null；existing-note 时必须为 null。若当前技术栈在 vaultIndex 中没有已有根节点或目录，所有新分支都使用 new-root，再用 sections[].parentId 表达本批次内部父子关系。",
    "sections[].placement.branchName 是需要新建的分支名，没有新分支时为 null；不要把完整路径写入 branchName。",
    "sections[].placement.targetNodeId 只有 existing-note 时填写既有 note 节点 ID，其余模式必须为 null。",
    "sections[].parentId 只能引用本次 sections[].id；如果没有父节点就省略。",
    "sections[].body 只放该段正文，可使用 Markdown 代码块、列表和表格，但不要写文件标题、粒度、归类、上级主题、前置知识等由本地编译器生成的字段。",
    "所有 corrections[].sourceId、sections[].sourceId 和 stackDecisions[].sourceId 必须来自输入 sources[].id。",
    "新协议的 relations 必须使用 sourceNodeId 和 targetNodeId；它们只能引用本批次 sections[].id 或 vaultIndex 中的节点 ID。不要输出自由文本标题关系端点。",
    "没有明确错误时 corrections 必须是 []，不要输出 original/fixed/reason 为空的占位对象。",
    "没有可确认关系时 relations 必须是 []，不要输出 source/target 为空的占位对象。",
    "所有关系类型只能使用：依赖、包含、并列、递进、对比、应用于、容易混淆、前置知识。",
  ].join("\n");
}

export function createReviewAnalysisRequest(
  sources: IntakeSource[],
  vaultContext?: VaultKnowledgeContext | null,
  options: {
    reviewMode?: ReviewAnalysisRequest["reviewMode"];
    previousAnalysisPlan?: ReviewAnalysisPlan;
    protocolRepair?: ReviewAnalysisRequest["protocolRepair"];
  } = {},
): ReviewAnalysisRequest {
  const normalizedVaultContext = normalizeVaultContext(vaultContext);
  const sourceOrganizationSignals = extractSourceOrganizationSignals(sources, normalizedVaultContext);
  const sourceStructure = analyzeSourceStructures(sources).map(toSourceStructureSignal);
  const taxonomyCandidates = buildTaxonomyCandidates(normalizedVaultContext);
  const vaultIndex = buildVaultKnowledgeIndex(vaultContext);
  const pageImageCandidates = sources.flatMap((source) =>
    (source.pdfEvidence?.pages ?? [])
      .filter((page) => page.imageReviewRequired && isBoundedImageDataUrl(page.imageDataUrl))
      .map((page) => ({
        sourceId: source.id,
        page: page.page,
        assetId: getPdfPageAssetId(source.id, page.page),
        kind: "page" as const,
        imageDataUrl: page.imageDataUrl as string,
      })),
  );
  const embeddedImageCandidates = sources.flatMap((source) =>
    (source.pdfEvidence?.images ?? [])
      .filter((image) => isBoundedImageDataUrl(image.imageDataUrl))
      .map((image, index) => ({
        sourceId: source.id,
        page: image.page,
        assetId: image.assetId || `pdf-image-${source.id.replace(/[^a-zA-Z0-9_-]+/gu, "-")}-page-${image.page}-${index + 1}`,
        kind: "embedded" as const,
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
        imageDataUrl: image.imageDataUrl as string,
      })),
  );
  const pdfEvidenceImages = [
    ...pageImageCandidates.slice(0, 8),
    ...embeddedImageCandidates.slice(0, 8),
  ];
  const pdfPageManifest = sources.flatMap((source) => {
    if (source.type !== "pdf" || !source.pdfEvidence?.pages.length) return [];

    const pages = source.pdfEvidence.pages.map((page) => page.page);
    const imagePagesSent = pdfEvidenceImages
      .filter((image) => image.sourceId === source.id && image.kind === "page")
      .map((image) => image.page);
    const embeddedImages = (source.pdfEvidence.images ?? []).map((image, index) => ({
      assetId: image.assetId || `pdf-image-${source.id.replace(/[^a-zA-Z0-9_-]+/gu, "-")}-page-${image.page}-${index + 1}`,
      page: image.page,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    }));
    const embeddedImagesSent = pdfEvidenceImages
      .filter((image) => image.sourceId === source.id && image.kind === "embedded")
      .map((image) => image.assetId);

    return [
      {
        sourceId: source.id,
        totalPages: pages.length,
        pages,
        imagePagesSent,
        imagePagesOmitted: pages.filter((page) => !imagePagesSent.includes(page)),
        embeddedImages,
        embeddedImagesSent,
        embeddedImagesOmitted: embeddedImages
          .map((image) => image.assetId)
          .filter((assetId) => !embeddedImagesSent.includes(assetId)),
      },
    ];
  });
  const modelSources = sources.map((source) => ({
    ...source,
    ...(source.pdfEvidence
      ? {
          pdfEvidence: {
            ...source.pdfEvidence,
              pages: source.pdfEvidence.pages.map(({ imageDataUrl: _imageDataUrl, evidence, ...page }) => ({
                ...page,
                assetId: page.assetId ?? getPdfPageAssetId(source.id, page.page),
                evidence: evidence.filter((line) => line.source !== "vision-ocr"),
              })),
              images: source.pdfEvidence.images?.map(({ imageDataUrl: _imageDataUrl, ...image }) => image),
          },
        }
      : {}),
  }));

  return {
    protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
    task: "review_uploaded_knowledge",
    locale: "zh-CN",
    sources: modelSources,
    ...(pdfEvidenceImages.length > 0 ? { pdfEvidenceImages } : {}),
    ...(pdfPageManifest.length > 0 ? { pdfPageManifest } : {}),
    ...(normalizedVaultContext ? { vaultContext: normalizedVaultContext } : {}),
    ...(vaultIndex.length > 0 ? { vaultIndex } : {}),
    ...(sourceOrganizationSignals.length > 0 ? { sourceOrganizationSignals } : {}),
    ...(sourceStructure.length > 0 ? { sourceStructure } : {}),
    ...(taxonomyCandidates.length > 0 ? { taxonomyCandidates } : {}),
    constraints: [
      "只返回 JSON，不返回解释文字。",
      "必须调用 submit_review_plan 工具提交分析计划，不要只返回普通 message.content。",
      "这是结构分析协议，不要输出最终 notes[].markdown 或自由 path；输出 sections[].body 和 placement，由本地编译器生成最终 Markdown。",
      "示例、注释和代码块只能作为证据，不得扩写成新的知识点。",
      "不要把示例、注释或代码块里的例子当成新的结论去单独命名笔记。",
      "用户填写的技术栈是根目录约束，不是可被模型替换的建议",
      "若填写了 stackHint，必须原样使用其第一段名称。",
      "没有 stackHint 时也不能凭默认类别归类；根目录必须有来源标题、首段或正文主题依据。",
    "每个 sources[].id 必须有一个 stackDecisions 项；无法判断的内容放 uncertain，但不能用 AI 等无关类别替换明确技术栈。",
    "PDF 的 evidenceIds/evidenceId 必须精确引用对应页 sources[].pdfEvidence.pages[].evidence[].id；页面图像只有在 imagePagesSent 标记已发送时才能作为页面视觉证据。imagePlacements 只能使用 embeddedImagesSent 中本轮实际发送的 PDF 内嵌图片 assetId，不能使用整页渲染图 assetId。",
      "sourceOrganizationSignals 是用户组织意图信号，不是最终路径；PDF 页面内容不会被本地提取为目录/颗粒度信号；taxonomyCandidates 是候选集合，不是强制路径。",
      "sourceStructure 是本地从原文提取的结构信号",
      "sourceStructure 不是模型生成内容；一级结构优先作为分段边界，原文代码必须出现在相关 sections[].body 中。",
      "新协议不输出 sections[].path；使用 placement.parentNodeId、placement.branchName 和 placement.targetNodeId。路径由本地系统根据 vaultIndex 编译。parentNodeId 只引用已有 Vault 节点；本批次新笔记之间的父子关系只写 parentId。没有匹配的既有技术栈根目录时使用 new-root，不要把新 section id 填进 parentNodeId。",
      "relations 使用 sourceNodeId 和 targetNodeId，必须引用 sections[].id 或 vaultIndex 中的真实节点 ID。",
      "若同一既有大目录下有多篇新分支属于同一具体主题，应创建整合主题 section，并用 parentId 让这些分支挂到它下面；同一路径下不同主题必须拆成不同整合主题。",
      "若已有 Vault 笔记属于本次整合主题，只输出 包含 relation 从整合主题 section 指向该既有 note 节点；不要自行写移动路径。",
      "PDF 正文只用于理解知识内容，不要把正文里的“目录/文件夹/全部放一起”等普通文字或页面视觉噪声当成目录指令。",
      "既有 Vault 笔记只用于关系判断和复用，不要因为相似旧笔记就把新知识塞进错误分支。",
      "旧协议 path 只能是技术栈根目录下的相对目录数组；新协议不填写 path。不要把型号、芯片、模块名当作默认父目录。",
      "拆分依据是知识内容和用途，不是每个短句或命令；少量材料通常生成 2-4 个 sections，最多 5 个。",
      "优先生成总览段和有独立主题的分支段；使用 parentId 表达父子结构，使用 relations 表达额外语义关系。",
      "若 reviewMode 是 final-pass，必须基于原文、vaultContext 和 previousAnalysisPlan 重新审校，不要机械复读草案。",
      "旧协议 path 最多三层相对目录；新协议的 placement 必须选择 vaultIndex 节点，不能包含页面提取噪声或泛化桶名。",
      "若存在 protocolRepair，这是协议修复请求：优先保留上一次的知识判断，只修复列出的字段、类型和结构问题；如果 previousOutput 不完整或损坏，忽略其损坏部分并基于原始 sources 重新输出一个完整、紧凑的分析计划，不要逐字复述整篇 PDF。",
      "关系必须有 evidence 和 confidence；不确定的关系放 uncertain，不要编造。",
      ...buildPdfQualityConstraints(sources),
    ],
    outputShape: {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      analysisPlan: "ReviewAnalysisPlan",
    },
    ...(options.reviewMode ? { reviewMode: options.reviewMode } : {}),
    ...(options.previousAnalysisPlan ? { previousAnalysisPlan: options.previousAnalysisPlan } : {}),
    ...(options.protocolRepair ? { protocolRepair: options.protocolRepair } : {}),
  };
}

const MAX_PDF_IMAGE_DATA_URL_LENGTH = 6_000_000;

function isBoundedImageDataUrl(value: string | undefined): value is string {
  return Boolean(
    value &&
      value.length <= MAX_PDF_IMAGE_DATA_URL_LENGTH &&
      /^data:image\/(?:jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/u.test(value),
  );
}

function buildPdfQualityConstraints(sources: IntakeSource[]) {
  const qualitySources = sources.filter((source) => source.pdfQuality);

  if (qualitySources.length === 0) return [];

  return [
    "sources[].pdfQuality 是本地 PDF 抽取质量评估，不是模型可以修改的建议；必须按它限制确定知识的生成。",
    ...qualitySources.map((source) => {
      const quality = source.pdfQuality;
      const status = quality?.qualityStatus ?? "normal";
      const rule =
        status === "partial"
          ? "只允许对可确认片段生成 sections，困难片段放入 uncertain。"
          : status === "blocked"
            ? source.pdfEvidence?.pages.some((page) => page.imageReviewRequired && page.imageDataUrl)
              ? "先对对应页图像进行视觉复核；只有视觉证据明确确认的片段才能生成 sections，其余放入 uncertain。"
              : "不得生成确定知识。"
            : status === "warning"
              ? "允许审理但必须保留风险提示。"
              : "可按正常流程审理。";
      const visualReview = source.pdfEvidence?.pages.some((page) => page.imageReviewRequired && page.imageDataUrl);
      return `来源“${source.title}”的 PDF 困难文字占比约 ${Math.round((quality?.difficultyRatio ?? 0) * 100)}%，状态为 ${status}；${rule}${quality?.requiresManualReview ? "需要人工复核。" : ""}${visualReview ? "视觉复核证据已附在请求中。" : ""}`;
    }),
  ];
}

export function createReviewSkillRequest(
  sources: IntakeSource[],
  vaultContext?: VaultKnowledgeContext | null,
  options: {
    reviewMode?: ReviewSkillRequest["reviewMode"];
    previousOutput?: ReviewSkillOutput;
  } = {},
): ReviewSkillRequest {
  const normalizedVaultContext = normalizeVaultContext(vaultContext);
  const sourceOrganizationSignals = extractSourceOrganizationSignals(sources, normalizedVaultContext);
  const taxonomyCandidates = buildTaxonomyCandidates(normalizedVaultContext);
  const vaultIndex = buildVaultKnowledgeIndex(vaultContext);

  return {
    protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
    task: "review_uploaded_knowledge",
    locale: "zh-CN",
    ...(options.reviewMode ? { reviewMode: options.reviewMode } : {}),
    sources,
    ...(normalizedVaultContext ? { vaultContext: normalizedVaultContext } : {}),
    ...(vaultIndex.length > 0 ? { vaultIndex } : {}),
    ...(sourceOrganizationSignals.length > 0 ? { sourceOrganizationSignals } : {}),
    ...(taxonomyCandidates.length > 0 ? { taxonomyCandidates } : {}),
    ...(options.previousOutput ? { previousOutput: options.previousOutput } : {}),
    constraints: [
      "只返回 JSON，不返回解释文字。",
      "若 reviewMode 是 final-pass，必须基于原文、vaultContext 和 previousOutput 重新审校，不要机械复读第一轮。",
      "示例、注释和代码块只能作为证据，不得扩写成新的知识点。",
      "不要把示例、注释或代码块里的例子当成新的结论去单独命名笔记。",
      "sourceOrganizationSignals 是用户组织意图信号；它不提供最终路径；PDF 页面内容不会被本地提取为目录/颗粒度信号；当它与 taxonomyCandidates 冲突时，应优先解释用户意图再决定路径。",
      "新协议优先使用 notes[].placement 和 vaultIndex 节点 ID；不要让模型直接编写自由路径。",
      "PDF 正文只用于理解知识内容，不要把正文里的“目录/文件夹/全部放一起”等普通文字或页面视觉噪声当成目录指令。",
      "sourceOrganizationSignals[].explicitHierarchy 是用户显式写出的层级意图；如果正文主题与该层级一致，优先把本批次主题放入该层级，且不要被相似旧目录吞掉。",
      "生成 notes[].path 前必须先查看 taxonomyCandidates；taxonomyCandidates 是分类候选，vaultContext.notes 是相关旧知识，不要混用。",
      "vaultContext.notes[].path 只用于定位关系参考笔记，不用于推断新笔记目录。",
      "vaultIndex 中的节点 ID 是唯一有效的父节点和关系端点；模型不能自行创造路径或标题引用。",
      "taxonomyCandidates 只是可选候选；如果候选目录与本次知识类型不匹配，不要使用它。",
      "如果候选目录最后一级是型号、芯片、框架、模块、项目名，而本材料是跨该对象复用的术语/概念/步骤/代码，应优先创建与知识角色匹配的新分支。",
      "标题中的“术语/应用步骤/具体代码/问题排查”等知识角色词应参与路径决策，不能被相似旧目录或型号候选覆盖。",
      "用户原文里的分类描述只能作为语义判断材料，由你统一判断是否应创建新分支，不要机械照抄为目录。",
      "当 explicitHierarchy 的末级是新主题，且正文包含设置、编程、命令等多块内容时，倾向生成末级主题导读页，并把其他笔记作为该主题的分支或后续枝节。",
      "型号、芯片、库名、框架名出现在正文时不要自动成为目录父级；先判断它是主题、适用对象、示例还是上下文。",
      "相关旧笔记只能通过 relations 连接，不应直接吞掉新分支。",
      "不要总结成单篇大杂烩；同一上传内容包含多个知识块时拆成多篇笔记。",
      "若 vaultContext 中已有同一技术栈或上级目录，优先沿用既有目录与导览结构。",
      "若 vaultContext.relations 显示某旧笔记是本次知识的前置、上级或邻近主题，应把新笔记接到该关系网络中。",
      "若新笔记依赖 vaultContext 中已有笔记，用 relations 建立前置知识、包含、递进或应用于关系。",
      "不要因为本批次上传了新材料就重复创建 vaultContext 中已经存在的根目录或同名主题。",
      "少量输入不要过度拆分：2000 字以内通常 2-4 篇，最多 5 篇。",
      "不要把每一个命令、步骤、短句都单独生成小颗粒度笔记。",
      "示例、注释和代码块只能作为证据，不得扩写成新的知识点。",
      "不要把示例、注释或代码块里的例子当成新的结论去单独命名笔记。",
      "优先生成两层结构；小颗粒度只用于足够独立且可复用的知识点。",
      "notes[].title 使用中文或用户原文中的主流技术名命名。",
      "notes[].path 使用 技术栈 / 分支 / 子分支 的 Obsidian 目录逻辑。",
      "notes[].id 必须稳定且非空；同一输入重复审理时，同一知识点应得到相同 id。",
      "notes[].markdown 不要写 # 标题，不要写相关笔记/相关主题。",
      "正文前放 粒度/上级主题/归类/前置知识；正文后再放后续枝节。",
      "notes[].grain 只能是 大颗粒度、中颗粒度、小颗粒度。",
      "notes[].status 只能是 新建笔记 或 合并到旧笔记。",
      "corrections 只放明确错误，无法确定的内容放入 uncertain。",
      "relations 只表达本批次能确认的关系，不要编造不存在的外部关系。",
      "没有纠错或关系时必须返回空数组 []，不要返回空对象或空字符串字段。",
    ],
    outputShape: {
      protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
      corrections: "Correction[]",
      notes: "GeneratedNote[]",
      relations: "KnowledgeRelation[]",
      uncertain: "string[]",
    },
  };
}

export function extractSourceOrganizationSignals(
  sources: IntakeSource[],
  context: VaultKnowledgeContext | null,
): SourceOrganizationSignal[] {
  return sources.flatMap((source) => {
    const searchable = buildLocalOrganizationSearchable(source);
    const inferredRoot = inferOrganizationRoot(source, context, searchable);
    const explicitHierarchy = readExplicitHierarchy(searchable, "");
    const root = explicitHierarchy[0] ?? inferredRoot;
    const role =
      readFirstDirectiveValue(searchable, ["新建中颗粒度", "中颗粒度", "中等颗粒度", "中层", "二级目录", "目录", "文件夹"]) ||
      inferKnowledgeRoleFromTitle(source.title, root);
    const leaf = readFirstDirectiveValue(searchable, ["小颗粒度", "小知识点", "三级主题", "子主题"]) || explicitHierarchy.at(-1) || "";
    const evidence = [
      root ? `技术栈根：${root}` : "",
      explicitHierarchy.length > 0 ? `用户显式层级：${explicitHierarchy.join(" -> ")}` : "",
      role ? `知识角色：${role}` : "",
      leaf ? `细分主题：${leaf}` : "",
    ].filter(Boolean);

    if (!root && !role && !leaf && explicitHierarchy.length === 0) return [];

    return [
      {
        sourceId: source.id,
        ...(root ? { root } : {}),
        ...(role ? { knowledgeRole: role } : {}),
        ...(leaf ? { leaf } : {}),
        ...(explicitHierarchy.length > 0 ? { explicitHierarchy } : {}),
        evidence,
      },
    ];
  });
}

function buildLocalOrganizationSearchable(source: IntakeSource) {
  const userProvidedFields = `${source.title}\n${source.stackHint ?? ""}`;

  if (source.type === "pdf") return userProvidedFields;

  return `${userProvidedFields}\n${source.content}`;
}

function buildLocalOrganizationContent(source: IntakeSource) {
  if (source.type === "pdf") return "";

  return source.content;
}

function readExplicitHierarchy(searchable: string, rootHint: string) {
  const root = rootHint.trim();

  for (const line of searchable.split(/\r?\n/)) {
    const candidate = readHierarchyCandidateFromLine(line);

    if (!candidate) continue;

    const segments = candidate
      .split(/\s*(?:->|→|⇒|＞)\s*/u)
      .map(cleanHierarchySegment)
      .filter(Boolean);

    if (!isValidHierarchySegments(segments)) continue;

    // 普通正文中的流程图、指针链和推导式也会使用多个箭头。
    // 只有明确写成目录/归类意图，或以技术栈根开头并用括号包裹的层级表达，才可影响路径。
    if (!isExplicitOrganizationHierarchyLine(line, root, segments)) {
      continue;
    }

    const startsAtRoot = !root || normalizeSignalSegment(segments[0]) === normalizeSignalSegment(root);

    if (root && !startsAtRoot) {
      return [root, ...segments];
    }

    return segments;
  }

  return [];
}

function readHierarchyCandidateFromLine(line: string) {
  const trimmed = line.trim();

  if (!hasHierarchyArrow(trimmed)) return "";

  const parenthesized = trimmed.match(/[（(]([^（）()]*?(?:->|→|⇒|＞)[^（）()]*?(?:->|→|⇒|＞)[^（）()]*)[）)]/u)?.[1];

  if (parenthesized) return parenthesized;

  const afterColon = trimmed.split(/[：:]/).at(-1)?.trim() ?? "";

  if (hasHierarchyArrow(afterColon)) return afterColon;

  return trimmed;
}

function hasHierarchyArrow(value: string) {
  return (value.match(/(?:->|→|⇒|＞)/gu) ?? []).length >= 2;
}

function isExplicitOrganizationHierarchyLine(
  line: string,
  root = "",
  segments: string[] = [],
) {
  const trimmed = line.trim();

  if (/(?:技术栈|知识树|目录|路径|层级|分类|归类|父节点|根节点|主目录|文件夹|新建|创建)\s*[：:]/u.test(trimmed)) {
    return true;
  }

  const isParenthesizedChain =
    /[（(][^（）()]*?(?:->|→|⇒|＞)[^（）()]*?(?:->|→|⇒|＞)[^（）()]*?[）)]/u.test(trimmed);

  if (!isParenthesizedChain) return false;

  return !root || normalizeSignalSegment(segments[0] ?? "") === normalizeSignalSegment(root);
}

function cleanHierarchySegment(value: string) {
  return cleanOrganizationSegment(value)
    .replace(/^(新建|创建|归类到|归入|路径|目录|层级|分类)\s*/u, "")
    .replace(/^[：:\-—>\s]+|[。；;，,、\s]+$/gu, "")
    .trim();
}

function isValidHierarchySegments(segments: string[]) {
  if (segments.length < 2 || segments.length > 6) return false;

  return segments.every((segment) => {
    if (segment.length === 0 || segment.length > 40) return false;
    return !/[{};`"']/u.test(segment);
  });
}

function normalizeSignalSegment(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function inferOrganizationRoot(
  source: IntakeSource,
  context: VaultKnowledgeContext | null,
  searchable: string,
) {
  const stackHint = source.stackHint?.trim();

  if (stackHint) return stackHint.split(/[\\/]/)[0]?.trim() ?? "";

  const titleRoot = inferRootFromSourceTitle(source.title);
  const contentRoot = inferRootFromSourceContent(buildLocalOrganizationContent(source));

  if (titleRoot) return titleRoot;
  if (contentRoot) return contentRoot;

  const lowerSearchable = searchable.toLowerCase();
  const lowerTitle = source.title.toLowerCase();
  const matchedRoot = (context?.roots ?? [])
    .map((root) => root.name.trim())
    .filter(Boolean)
    .map((root) => ({
      root,
      score: scoreContextRootMention(root, lowerTitle, lowerSearchable),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.root.length - left.root.length)[0]?.root;

  return matchedRoot ?? "";
}

function scoreContextRootMention(root: string, title: string, content: string) {
  const normalizedRoot = root.toLowerCase();
  let score = 0;

  if (title.includes(normalizedRoot)) score += 100;

  const meaningfulLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isExtractionWrapperLine(line));
  const firstLines = meaningfulLines.slice(0, 8).join("\n");

  if (firstLines.includes(normalizedRoot)) score += 60;

  const occurrences = content.split(normalizedRoot).length - 1;

  if (occurrences >= 3) score += Math.min(45, occurrences * 8);
  if (occurrences >= 1 && root.length >= 3) score += 6;

  return score;
}

function inferKnowledgeRoleFromTitle(title: string, root: string) {
  const normalizedTitle = title.replace(/\s+/g, "").trim();
  const titleWithoutRoot = root ? normalizedTitle.replace(new RegExp(`^${escapeRegExp(root.replace(/\s+/g, ""))}`), "") : normalizedTitle;

  return (
    knownKnowledgeRoles.find(
      (role) => titleWithoutRoot === role || titleWithoutRoot.startsWith(role) || titleWithoutRoot.endsWith(role),
    ) ?? ""
  );
}

function readFirstDirectiveValue(searchable: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*[：:]\\s*([^\\n\\r，,；;]+)`, "i");
    const value = searchable.match(pattern)?.[1]?.trim();

    if (value) return cleanOrganizationSegment(value);
  }

  return "";
}

function cleanOrganizationSegment(value: string) {
  return value
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/。$/, "")
    .trim();
}

export function buildTaxonomyCandidates(context: VaultKnowledgeContext | null): VaultTaxonomyCandidate[] {
  const candidates: VaultTaxonomyCandidate[] = [];
  const seen = new Set<string>();

  for (const root of context?.roots ?? []) {
    const rootName = root.name.trim();

    if (!rootName) continue;

    for (const path of root.paths) {
      const normalizedPath = normalizeTaxonomyPath(path);

      if (!normalizedPath || normalizedPath === rootName) continue;

      pushTaxonomyCandidate(candidates, seen, {
        path: normalizedPath,
        root: rootName,
        kind: "existing-directory",
        evidence: "Vault 已有目录",
      });
    }
  }

  return candidates
    .sort((left, right) => taxonomyCandidateRank(right) - taxonomyCandidateRank(left) || left.path.localeCompare(right.path))
    .slice(0, 80);
}

export function buildVaultKnowledgeIndex(context: VaultKnowledgeContext | null | undefined): VaultKnowledgeNode[] {
  if (!context) return [];

  const nodes = new Map<string, VaultKnowledgeNode>();
  const rootNodeIdByName = new Map<string, string>();

  for (const root of context.roots) {
    const rootName = root.name.trim();

    if (!rootName) continue;

    const rootNode: VaultKnowledgeNode = {
      id: stableVaultNodeId("root", rootName),
      kind: "root",
      title: rootName,
      path: rootName,
      root: rootName,
    };

    nodes.set(rootNode.id, rootNode);
    rootNodeIdByName.set(normalizeComparableReference(rootName), rootNode.id);
  }

  const ensureDirectoryNode = (path: string, rootName: string) => {
    const segments = normalizeTaxonomyPath(path).split("/").filter(Boolean);

    if (segments.length === 0) return null;

    const normalizedRootName = normalizeComparableReference(rootName);
    const rootNodeId =
      rootNodeIdByName.get(normalizedRootName) ??
      stableVaultNodeId("root", segments[0]);
    let parentId = rootNodeId;

    if (!nodes.has(rootNodeId)) {
      nodes.set(rootNodeId, {
        id: rootNodeId,
        kind: "root",
        title: segments[0],
        path: segments[0],
        root: segments[0],
      });
      rootNodeIdByName.set(normalizedRootName, rootNodeId);
    }

    for (let index = 1; index < segments.length; index += 1) {
      const directoryPath = segments.slice(0, index + 1).join("/");
      const directoryId = stableVaultNodeId("directory", directoryPath);

      if (!nodes.has(directoryId)) {
        nodes.set(directoryId, {
          id: directoryId,
          kind: "directory",
          title: segments[index],
          path: directoryPath,
          root: segments[0],
          parentId,
        });
      }

      parentId = directoryId;
    }

    return {
      root: segments[0],
      parentId,
      directoryPath: segments.join("/"),
    };
  };

  for (const root of context.roots) {
    for (const path of root.paths) {
      ensureDirectoryNode(path, root.name);
    }
  }

  for (const note of context.notes) {
    const notePath = normalizeVaultIndexPath(note.path, note.root, note.title);
    const noteSegments = notePath.split("/").filter(Boolean);
    const noteFileName = noteSegments.at(-1) ?? note.title.trim();
    const noteRoot = note.root.trim() || noteSegments[0] || "未归类";
    const parentPath = noteSegments.slice(0, -1).join("/");
    const parent = ensureDirectoryNode(parentPath || noteRoot, noteRoot);
    const noteId = stableVaultNodeId("note", notePath);

    nodes.set(noteId, {
      id: noteId,
      kind: "note",
      title: note.title.trim() || stripMarkdownFileExtension(noteFileName) || "未命名旧笔记",
      path: notePath,
      root: noteRoot,
      ...(parent?.parentId ? { parentId: parent.parentId } : {}),
    });
  }

  return [...nodes.values()].sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
}

function normalizeVaultIndexPath(path: string, root: string, title: string) {
  const normalizedPath = normalizeTaxonomyPath(path);

  if (normalizedPath && normalizedPath.split("/").length > 1) return normalizedPath;

  const safeRoot = normalizeModelReferenceSegment(root || "已确认知识");
  const safeTitle = normalizeModelReferenceSegment(title || "未命名旧笔记");

  return `${safeRoot}/${safeTitle}.md`;
}

function stripMarkdownFileExtension(value: string) {
  return value.replace(/\.(?:md|markdown)$/iu, "").trim();
}

function stableVaultNodeId(kind: "root" | "directory" | "note", value: string) {
  const normalized = normalizeComparableReference(value) || "node";
  let hash = 2166136261;

  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `vault-${kind}-${Math.abs(hash >>> 0).toString(36)}`;
}

function pushTaxonomyCandidate(
  candidates: VaultTaxonomyCandidate[],
  seen: Set<string>,
  candidate: VaultTaxonomyCandidate,
) {
  if (!candidate.path || !candidate.root) return;

  const key = `${candidate.kind}:${candidate.path}`;

  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(candidate);
}

function taxonomyCandidateRank(candidate: VaultTaxonomyCandidate) {
  return candidate.path.split("/").length;
}

function normalizeTaxonomyPath(path: string) {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeVaultContext(context?: VaultKnowledgeContext | null): VaultKnowledgeContext | null {
  if (!context) return null;

  const roots = context.roots
    .map((root) => ({
      name: root.name.trim(),
      noteCount: Math.max(0, Math.floor(root.noteCount)),
      paths: root.paths.map((path) => path.trim()).filter(Boolean).slice(0, 12),
    }))
    .filter((root) => root.name.length > 0)
    .slice(0, 24);
  const notes = context.notes
    .map((note) => {
      const title = note.title.trim();
      const root = note.root.trim();

      return {
        title,
        path: buildRelationReferencePath(root, title),
        root,
        headings: note.headings.map((heading) => heading.trim()).filter(Boolean).slice(0, 8),
        snippet: note.snippet.trim().slice(0, 500),
        ...(typeof note.modifiedAt === "number" ? { modifiedAt: note.modifiedAt } : {}),
      };
    })
    .filter((note) => note.title.length > 0 && note.path.length > 0)
    .slice(0, 80);
  const relations = (context.relations ?? [])
    .map((relation) => ({
      type: relation.type.trim(),
      source: relation.source.trim(),
      target: relation.target.trim(),
      evidence: relation.evidence.trim().slice(0, 180),
    }))
    .filter((relation) => relation.type.length > 0 && relation.source.length > 0 && relation.target.length > 0)
    .slice(0, 160);

  if (roots.length === 0 && notes.length === 0 && relations.length === 0) return null;

  return { roots, notes, relations };
}

function buildRelationReferencePath(root: string, title: string) {
  const safeRoot = normalizeModelReferenceSegment(root || "已确认知识");
  const safeTitle = normalizeModelReferenceSegment(title || "未命名旧笔记");

  return `${safeRoot}/${safeTitle}.md`;
}

function normalizeModelReferenceSegment(value: string) {
  return value.replace(/[\\/]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseReviewSkillOutput(raw: string, sources: IntakeSource[]): ReviewSkillValidationResult {
  try {
    return validateReviewSkillOutput(JSON.parse(extractJsonObject(raw)), sources);
  } catch (error) {
    return {
      ok: false,
      output: null,
      errors: [
        {
          path: "$",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function parseReviewAnalysisPlan(
  raw: string,
  sources: IntakeSource[],
  options: ReviewAnalysisValidationOptions = {},
): ReviewAnalysisValidationResult {
  try {
    return validateReviewAnalysisPlan(JSON.parse(extractJsonObject(raw)), sources, options);
  } catch (error) {
    return {
      ok: false,
      output: null,
      errors: [
        {
          path: "$",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function validateReviewAnalysisPlan(
  candidate: unknown,
  sources: IntakeSource[],
  options: ReviewAnalysisValidationOptions = {},
): ReviewAnalysisValidationResult {
  const errors: ReviewSkillValidationError[] = [];
  const sourceIds = new Set(sources.map((source) => source.id));

  if (!isRecord(candidate)) return failAnalysis([{ path: "$", message: "分析计划必须是 JSON 对象。" }]);

  if (candidate.protocolVersion !== REVIEW_ANALYSIS_PROTOCOL_VERSION) {
    errors.push({
      path: "$.protocolVersion",
      message: `协议版本必须是 ${REVIEW_ANALYSIS_PROTOCOL_VERSION}。`,
    });
  }

  const stackDecisions = validateAnalysisStackDecisions(
    readRequiredArray(candidate, "stackDecisions", errors),
    sourceIds,
    errors,
  );
  const pageCoverage = validatePageCoverage(
    candidate.pageCoverage,
    sources,
    errors,
    options.allowedPdfImageEvidence ?? [],
  );
  const sections = validateAnalysisSections(
    readRequiredArray(candidate, "sections", errors),
    sourceIds,
    errors,
  );
  const normalizedSections = normalizeLegacyAnalysisPaths(
    normalizeBatchLocalPlacements(sections, stackDecisions, options),
    sources,
    stackDecisions,
    options,
  );
  const relations = validateAnalysisRelations(readRequiredArray(candidate, "relations", errors), errors);
  const corrections = validateCorrections(
    readRequiredArray(candidate, "corrections", errors),
    sourceIds,
    errors,
  );
  const uncertain = validateUncertain(readRequiredArray(candidate, "uncertain", errors), errors);

  validateAnalysisStructure(stackDecisions, normalizedSections, relations, sources, errors, options, pageCoverage);
  validateAnalysisGranularityPolicy(normalizedSections, sources, errors);
  validateAnalysisSemanticQuality(stackDecisions, normalizedSections, sources, errors, options);

  if (errors.length > 0) return failAnalysis(errors);

  return {
    ok: true,
    output: {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions,
      ...(pageCoverage ? { pageCoverage } : {}),
      sections: normalizedSections,
      relations,
      corrections,
      uncertain,
    },
    errors: [],
  };
}

function normalizeBatchLocalPlacements(
  sections: ReviewAnalysisSection[],
  stackDecisions: ReviewAnalysisStackDecision[],
  options: ReviewAnalysisValidationOptions,
) {
  const vaultIndex = options.vaultIndex ?? [];
  const sectionIds = new Set(sections.map((section) => section.id));
  const stackBySourceId = new Map(stackDecisions.map((decision) => [decision.sourceId, decision.name]));

  return sections.map((section) => {
    const placement = section.placement;

    if (!placement || placement.mode !== "new-child") return section;

    const stackName = stackBySourceId.get(section.sourceId) ?? "";
    const parentNode = placement.parentNodeId
      ? vaultIndex.find((node) => node.id === placement.parentNodeId)
      : undefined;
    const referencesBatchSection = Boolean(placement.parentNodeId && sectionIds.has(placement.parentNodeId));
    const hasStackRoot = Boolean(
      stackName &&
        vaultIndex.some(
          (node) => node.kind === "root" && normalizeComparableReference(node.root) === normalizeComparableReference(stackName),
        ),
    );

    // A new batch section is not a Vault node yet. Keep its hierarchy in parentId
    // and let the local compiler place the section under the current stack root.
    if (
      !placement.parentNodeId ||
      referencesBatchSection ||
      !hasStackRoot ||
      !parentNode ||
      (parentNode.kind !== "root" && parentNode.kind !== "directory")
    ) {
      return {
        ...section,
        placement: {
          ...placement,
          mode: "new-root" as const,
          parentNodeId: null,
          targetNodeId: null,
        },
      };
    }

    return section;
  });
}

function normalizeLegacyAnalysisPaths(
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  stackDecisions: ReviewAnalysisStackDecision[],
  options: ReviewAnalysisValidationOptions,
) {
  if (!options.allowLegacyPathCompatibility || options.allowTrustedDerivedPaths || !(options.taxonomyCandidates?.length ?? 0)) {
    return sections;
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const stackBySourceId = new Map(stackDecisions.map((decision) => [decision.sourceId, decision.name]));

  return sections.map((section) => {
    if (section.placement || !section.path) return section;

    const source = sourceById.get(section.sourceId);
    const root = stackBySourceId.get(section.sourceId) ?? "";
    if (!source || !root) return section;

    const path = section.path.filter((segment, index) => {
      if (index === 0 && normalizeComparableReference(segment) === normalizeComparableReference(root)) return true;
      if (hasNoisyPathSegment(segment) || isGenericOrganizationBucketSegment(segment)) return true;
      if (source.type === "pdf") return true;
      return isSupportedPathSegment(segment, section.title, buildLocalOrganizationSearchable(source), options.taxonomyCandidates ?? [], root);
    });

    return { ...section, path };
  });
}

function validateAnalysisStackDecisions(
  items: unknown[],
  sourceIds: Set<string>,
  errors: ReviewSkillValidationError[],
) {
  const seenSourceIds = new Set<string>();

  return items.flatMap((item, index) => {
    const path = `$.stackDecisions[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "技术栈判断必须是对象。" });
      return [];
    }

    const sourceId = readRequiredString(item, "sourceId", `${path}.sourceId`, errors);
    const name = readRequiredString(item, "name", `${path}.name`, errors);
    const confidence = readEnum(item, "confidence", ["高", "中", "低"] as const, `${path}.confidence`, errors);
    const evidence = readStringArray(item, "evidence", `${path}.evidence`, errors);

    if (sourceId && !sourceIds.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "sourceId 必须来自输入 sources。" });
    }

    if (sourceId && seenSourceIds.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "每个 sourceId 只能有一个技术栈判断。" });
    }

    if (sourceId) seenSourceIds.add(sourceId);
    if (!sourceId || !name || !confidence || !evidence) return [];

    return [{ sourceId, name, confidence, evidence }];
  });
}

function validatePageCoverage(
  value: unknown,
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
  allowedPdfImageEvidence: ReviewAnalysisValidationOptions["allowedPdfImageEvidence"] = [],
): ReviewAnalysisPageCoverage[] | undefined {
  if (value === undefined) {
    const requiresCoverage = sources.some((source) => source.type === "pdf" && (source.pdfEvidence?.pages.length ?? 0) > 0);
    if (requiresCoverage) {
      errors.push({ path: "$.pageCoverage", message: "包含页面证据的 PDF 必须返回每页 pageCoverage。" });
    }
    return undefined;
  }

  if (!Array.isArray(value)) {
    errors.push({ path: "$.pageCoverage", message: "字段必须是数组。" });
    return [];
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const coverage: ReviewAnalysisPageCoverage[] = [];

  value.forEach((item, index) => {
    const path = `$.pageCoverage[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path, message: "页面覆盖项必须是对象。" });
      return;
    }

    const sourceId = readRequiredString(item, "sourceId", `${path}.sourceId`, errors);
    const page = readRequiredInteger(item, "page", `${path}.page`, errors);
    const status = readEnum(item, "status", ["covered", "uncertain", "unreadable"] as const, `${path}.status`, errors);
    const sectionIds = readStringArray(item, "sectionIds", `${path}.sectionIds`, errors);
    const evidenceIds = readStringArray(item, "evidenceIds", `${path}.evidenceIds`, errors);
    const summary = readRequiredString(item, "summary", `${path}.summary`, errors);

    if (sourceId && !sourceById.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "sourceId 必须来自输入 sources。" });
    }

    const source = sourceById.get(sourceId);
    const pageKey = `${sourceId}:${page}`;
    if (sourceId && page > 0 && seen.has(pageKey)) {
      errors.push({ path: `${path}.page`, message: "同一来源的页面不能重复覆盖。" });
    }
    if (sourceId && page > 0) seen.add(pageKey);

    const sourcePage = source?.pdfEvidence?.pages.find((candidate) => candidate.page === page);
    if (source?.type === "pdf" && source.pdfEvidence?.pages.length && !sourcePage) {
      errors.push({ path: `${path}.page`, message: `页面 ${page} 不在该 PDF 的输入页面范围内。` });
    }

    if (sourcePage && evidenceIds) {
      const evidenceIdsInPage = new Set(sourcePage.evidence.map((line) => line.id));
      const allowedImageAssetIds = new Set(
        allowedPdfImageEvidence
          ?.filter((image) => image.sourceId === sourceId && image.page === page)
          .map((image) => image.assetId) ?? [],
      );
      evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIdsInPage.has(evidenceId) && !allowedImageAssetIds.has(evidenceId)) {
          errors.push({
            path: `${path}.evidenceIds[${evidenceIndex}]`,
            message: "evidenceId 必须来自对应 PDF 页面的证据。",
          });
        }
      });
    }

    if (sourceId && page > 0 && status && sectionIds && evidenceIds && summary) {
      coverage.push({ sourceId, page, status, sectionIds, evidenceIds, summary });
    }
  });

  for (const source of sources) {
    const pages = source.pdfEvidence?.pages ?? [];
    if (source.type !== "pdf" || pages.length === 0) continue;

    const coveredPages = new Set(coverage.filter((item) => item.sourceId === source.id).map((item) => item.page));
    for (const page of pages) {
      if (!coveredPages.has(page.page)) {
        errors.push({ path: "$.pageCoverage", message: `来源“${source.title}”缺少第 ${page.page} 页覆盖结果。` });
      }
    }
  }

  return coverage;
}

function validateAnalysisSections(
  items: unknown[],
  sourceIds: Set<string>,
  errors: ReviewSkillValidationError[],
) {
  const ids = new Set<string>();
  const inferredSingleSourceId = sourceIds.size === 1 ? [...sourceIds][0] : "";

  return items.flatMap((item, index) => {
    const path = `$.sections[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "知识分段必须是对象。" });
      return [];
    }

    const id = readRequiredString(item, "id", `${path}.id`, errors);
    const sourceId = readOptionalString(item, "sourceId") || inferredSingleSourceId;
    const title = readRequiredString(item, "title", `${path}.title`, errors);
    const role = readRequiredString(item, "role", `${path}.role`, errors);
    const grain = readEnum(item, "grain", allowedGrains, `${path}.grain`, errors);
    const sectionPath = readOptionalPathSegments(item, `${path}.path`, errors);
    const placement = readAnalysisPlacement(item, `${path}.placement`, errors);
    const parentId = readOptionalString(item, "parentId");
    const status = readEnum(item, "status", allowedStatuses, `${path}.status`, errors);
    const existingNoteTitle = readOptionalString(item, "existingNoteTitle");
    const body = readRequiredString(item, "body", `${path}.body`, errors);
    const formulas = readAnalysisFormulas(item, `${path}.formulas`, sourceId, body, errors);
    const imagePlacements = readAnalysisImagePlacements(
      item,
      `${path}.imagePlacements`,
      sourceId,
      body,
      errors,
    );
    const evidence = readStringArray(item, "evidence", `${path}.evidence`, errors);

    if (!sourceId) {
      errors.push({ path: `${path}.sourceId`, message: "字段必须是非空字符串。" });
    } else if (!sourceIds.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "sourceId 必须来自输入 sources。" });
    }

    if (id && ids.has(id)) {
      errors.push({ path: `${path}.id`, message: "知识分段 id 不能重复。" });
    }
    if (id) ids.add(id);
    if (!sectionPath && !placement) {
      errors.push({
        path: `${path}.placement`,
        message: "新协议必须提供 placement；兼容旧协议时必须提供合法 path。",
      });
    }
    if (
      !id ||
      !sourceId ||
      !title ||
      !role ||
      !grain ||
      (!sectionPath && !placement) ||
      !status ||
      !body ||
      !formulas ||
      !imagePlacements ||
      !evidence
    ) {
      return [];
    }

    return [
      {
        id,
        sourceId,
        title,
        role,
        grain,
        ...(sectionPath ? { path: sectionPath } : {}),
        ...(placement ? { placement } : {}),
        ...(parentId ? { parentId } : {}),
        status,
        ...(existingNoteTitle ? { existingNoteTitle } : {}),
        body,
        formulas,
        imagePlacements,
        evidence,
      },
    ];
  });
}

function readAnalysisFormulas(
  record: Record<string, unknown>,
  path: string,
  sourceId: string,
  body: string,
  errors: ReviewSkillValidationError[],
): ReviewAnalysisFormula[] | null {
  const value = record.formulas;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push({ path, message: "formulas 必须是数组。" });
    return null;
  }

  const seenIds = new Set<string>();
  const formulas: ReviewAnalysisFormula[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, message: "公式项必须是对象。" });
      return;
    }
    const id = readRequiredString(item, "id", `${itemPath}.id`, errors);
    const latex = readRequiredString(item, "latex", `${itemPath}.latex`, errors);
    const display = readEnum(item, "display", ["inline", "block"] as const, `${itemPath}.display`, errors);
    const sourcePage = readRequiredInteger(item, "sourcePage", `${itemPath}.sourcePage`, errors);
    const evidenceId = readOptionalString(item, "evidenceId");
    const anchor = readOptionalString(item, "anchor");
    const confidence = readEnum(item, "confidence", ["高", "中", "低"] as const, `${itemPath}.confidence`, errors);

    if (id && seenIds.has(id)) errors.push({ path: `${itemPath}.id`, message: "公式 id 不能重复。" });
    if (id) seenIds.add(id);
    if (latex && /(?:<\/?[a-z]|data:|javascript:)/iu.test(latex)) {
      errors.push({ path: `${itemPath}.latex`, message: "LaTeX 不能包含 HTML、data URL 或脚本内容。" });
    }
    const marker = `{{formula:${id}}}`;
    if (id && !body.includes(marker)) {
      errors.push({ path: `${itemPath}.id`, message: `正文必须包含公式锚点 ${marker}。` });
    }
    if (id && body.split(marker).length - 1 > 1) {
      errors.push({ path: `${itemPath}.id`, message: `公式锚点 ${marker} 只能出现一次。` });
    }
    if (id && latex && display && sourcePage > 0 && confidence) {
      formulas.push({
        id,
        latex,
        display,
        sourcePage,
        ...(evidenceId ? { evidenceId } : {}),
        ...(anchor ? { anchor } : {}),
        confidence,
      });
    }
  });

  return formulas;
}

function readAnalysisImagePlacements(
  record: Record<string, unknown>,
  path: string,
  _sourceId: string,
  body: string,
  errors: ReviewSkillValidationError[],
): ReviewAnalysisImagePlacement[] | null {
  const value = record.imagePlacements;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push({ path, message: "imagePlacements 必须是数组。" });
    return null;
  }

  const placements: ReviewAnalysisImagePlacement[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, message: "图片放置项必须是对象。" });
      return;
    }
    const assetId = readRequiredString(item, "assetId", `${itemPath}.assetId`, errors);
    const sourcePage = readRequiredInteger(item, "sourcePage", `${itemPath}.sourcePage`, errors);
    const placement = readEnum(
      item,
      "placement",
      ["before-section", "after-section", "inline"] as const,
      `${itemPath}.placement`,
      errors,
    );
    const anchor = readOptionalString(item, "anchor");
    const caption = readOptionalString(item, "caption");
    const alt = readOptionalString(item, "alt");
    const confidence = readEnum(item, "confidence", ["高", "中", "低"] as const, `${itemPath}.confidence`, errors);

    if (assetId && !assetId.startsWith("pdf-image-")) {
      errors.push({ path: `${itemPath}.assetId`, message: "图片放置只能引用从 PDF 内嵌提取的图片，不能引用整页渲染图。" });
    }
    if (placement === "inline") {
      if (!anchor) {
        errors.push({ path: `${itemPath}.anchor`, message: "inline 图片必须提供正文锚点。" });
      } else if (!body.includes(anchor)) {
        errors.push({ path: `${itemPath}.anchor`, message: "inline 图片锚点必须出现在正文中。" });
      } else if (body.split(anchor).length - 1 > 1) {
        errors.push({ path: `${itemPath}.anchor`, message: "inline 图片锚点只能出现一次。" });
      }
    }
    if (assetId && sourcePage > 0 && placement && confidence) {
      placements.push({
        assetId,
        sourcePage,
        placement,
        ...(anchor ? { anchor } : {}),
        ...(caption ? { caption } : {}),
        ...(alt ? { alt } : {}),
        confidence,
      });
    }
  });

  return placements;
}

function validateAnalysisRelations(items: unknown[], errors: ReviewSkillValidationError[]) {
  return items.flatMap((item, index) => {
    const path = `$.relations[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "关系项必须是对象。" });
      return [];
    }

    if (isBlankAnalysisRelationPlaceholder(item)) return [];

    const rawType = readOptionalString(item, "type");
    const type = normalizeRelationType(rawType);
    const sourceNodeId = readOptionalString(item, "sourceNodeId");
    const targetNodeId = readOptionalString(item, "targetNodeId");
    const source = sourceNodeId || readRequiredString(item, "source", `${path}.source`, errors);
    const target = targetNodeId || readRequiredString(item, "target", `${path}.target`, errors);
    const evidence = readRequiredString(item, "evidence", `${path}.evidence`, errors);
    const confidence = readEnum(item, "confidence", ["高", "中", "低"] as const, `${path}.confidence`, errors);

    if (!type) {
      errors.push({ path: `${path}.type`, message: `字段只能是：${allowedRelationTypes.join("、")}。` });
    }
    if (source && target && normalizeComparableReference(source) === normalizeComparableReference(target)) {
      errors.push({ path, message: "关系不能连接同一个节点。" });
    }
    if (!type || !source || !target || !evidence || !confidence) return [];

    return [
      {
        type,
        source,
        target,
        ...(sourceNodeId ? { sourceNodeId } : {}),
        ...(targetNodeId ? { targetNodeId } : {}),
        evidence,
        confidence,
      },
    ];
  });
}

function validateAnalysisStructure(
  stackDecisions: ReviewAnalysisStackDecision[],
  sections: ReviewAnalysisSection[],
  relations: ReviewAnalysisRelation[],
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
  options: ReviewAnalysisValidationOptions,
  pageCoverage?: ReviewAnalysisPageCoverage[],
) {
  const sourceIds = new Set(sources.map((source) => source.id));
  const decisionBySourceId = new Map(stackDecisions.map((decision) => [decision.sourceId, decision]));
  const sectionIds = new Set(sections.map((section) => section.id));
  const vaultNodeById = new Map((options.vaultIndex ?? []).map((node) => [node.id, node]));
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  for (const coverage of pageCoverage ?? []) {
    for (const sectionId of coverage.sectionIds) {
      const section = sectionById.get(sectionId);
      if (!section) {
        errors.push({
          path: `$.pageCoverage[${(pageCoverage ?? []).indexOf(coverage)}].sectionIds`,
          message: `sectionId “${sectionId}” 不存在。`,
        });
      } else if (section.sourceId !== coverage.sourceId) {
        errors.push({
          path: `$.pageCoverage[${(pageCoverage ?? []).indexOf(coverage)}].sectionIds`,
          message: `sectionId “${sectionId}” 不属于来源“${coverage.sourceId}”。`,
        });
      }
    }
  }

  for (const source of sources) {
    const decision = decisionBySourceId.get(source.id);

    if (!decision) {
      errors.push({ path: "$.stackDecisions", message: `缺少来源 ${source.id} 的技术栈判断。` });
      continue;
    }

    if (options.enforceStackHints && source.stackHint?.trim()) {
      const requiredRoot = source.stackHint.split(/[\\/]/)[0]?.trim() ?? "";

      if (requiredRoot && normalizeComparableReference(decision.name) !== normalizeComparableReference(requiredRoot)) {
        errors.push({
          path: `$.stackDecisions[${stackDecisions.indexOf(decision)}].name`,
          message: `技术栈根目录与用户填写的技术栈不一致：应为“${requiredRoot}”，模型返回“${decision.name}”。`,
        });
      }
    }
  }

  for (const section of sections) {
    validateSectionMediaReferences(section, sources, errors, options);
    if (section.placement) {
      const placementPath = `$.sections[${sections.indexOf(section)}].placement`;
      const { mode, parentNodeId, targetNodeId } = section.placement;

      if (mode === "new-root" && parentNodeId) {
        errors.push({
          path: `${placementPath}.parentNodeId`,
          message: "new-root 的 parentNodeId 必须为 null。",
        });
      }

      if (mode === "new-child") {
        if (!parentNodeId) {
          errors.push({
            path: `${placementPath}.parentNodeId`,
            message: "new-child 必须选择 Vault 根节点或目录节点。",
          });
        } else {
          const parentNode = vaultNodeById.get(parentNodeId);

          if (!parentNode) {
            errors.push({
              path: `${placementPath}.parentNodeId`,
              message: "placement.parentNodeId 必须引用 vaultIndex 中真实存在的根节点或目录节点。",
            });
          } else if (parentNode.kind !== "root" && parentNode.kind !== "directory") {
            errors.push({
              path: `${placementPath}.parentNodeId`,
              message: "新笔记不能直接挂在既有笔记节点下，必须选择根节点或目录节点。",
            });
          } else {
            const decision = decisionBySourceId.get(section.sourceId);

            if (
              decision &&
              normalizeComparableReference(parentNode.root) !== normalizeComparableReference(decision.name)
            ) {
              errors.push({
                path: `${placementPath}.parentNodeId`,
                message: `placement 父节点必须属于当前技术栈“${decision.name}”。`,
              });
            }
          }
        }
      }

      if (mode === "existing-note") {
        if (!targetNodeId) {
          errors.push({
            path: `${placementPath}.targetNodeId`,
            message: "existing-note 必须选择既有笔记节点。",
          });
        } else if (vaultNodeById.get(targetNodeId)?.kind !== "note") {
          errors.push({
            path: `${placementPath}.targetNodeId`,
            message: "placement.targetNodeId 必须引用 vaultIndex 中真实存在的笔记节点。",
          });
        } else {
          const decision = decisionBySourceId.get(section.sourceId);
          const targetNode = vaultNodeById.get(targetNodeId);

          if (
            decision &&
            targetNode &&
            normalizeComparableReference(targetNode.root) !== normalizeComparableReference(decision.name)
          ) {
            errors.push({
              path: `${placementPath}.targetNodeId`,
              message: `placement 目标笔记必须属于当前技术栈“${decision.name}”。`,
            });
          }
        }
      }

      if (mode !== "existing-note" && targetNodeId) {
        errors.push({
          path: `${placementPath}.targetNodeId`,
          message: "只有 existing-note 可以填写 targetNodeId。",
        });
      }

      if (!options.vaultIndex?.length && mode !== "new-root") {
        errors.push({
          path: placementPath,
          message: "该 placement 模式需要 Vault 节点索引。",
        });
      }
    }

    if (!sourceIds.has(section.sourceId)) continue;

    if (section.parentId && !sectionIds.has(section.parentId)) {
      errors.push({
        path: `$.sections[${sections.indexOf(section)}].parentId`,
        message: "parentId 必须引用本次 sections[].id。",
      });
    }

    if (section.parentId === section.id) {
      errors.push({
        path: `$.sections[${sections.indexOf(section)}].parentId`,
        message: "知识分段不能把自己作为父节点。",
      });
    }
  }

  const parentById = new Map(
    sections.filter((section) => section.parentId).map((section) => [section.id, section.parentId as string]),
  );

  for (const section of sections) {
    const visited = new Set<string>();
    let current = section.id;

    while (parentById.has(current)) {
      if (visited.has(current)) {
        errors.push({
          path: `$.sections[${sections.indexOf(section)}].parentId`,
          message: "父子结构不能形成循环。",
        });
        break;
      }

      visited.add(current);
      current = parentById.get(current) ?? "";
    }
  }

  const knownReferences = new Set(
    [
      ...sections.flatMap((section) => [section.id, section.title]),
      ...(options.vaultIndex ?? []).map((node) => node.id),
      ...sources.flatMap((source) => {
        const root = source.stackHint?.split(/[\\/]/)[0]?.trim();
        return root ? [root] : [];
      }),
      ...(options.externalReferenceTitles ?? []),
    ].map(normalizeComparableReference),
  );

  for (const [index, relation] of relations.entries()) {
    const usesNodeIds = Boolean(relation.sourceNodeId || relation.targetNodeId);

    for (const [endpoint, value] of [["source", relation.source], ["target", relation.target]] as const) {
      if (knownReferences.has(normalizeComparableReference(value))) continue;

      if (usesNodeIds) continue;

      errors.push({
        path: `$.relations[${index}].${endpoint}`,
        message: "关系端点必须引用本次知识分段或既有 Vault 笔记",
      });
    }
  }

}

function validateAnalysisSemanticQuality(
  stackDecisions: ReviewAnalysisStackDecision[],
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
  options: ReviewAnalysisValidationOptions,
) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const decisionBySourceId = new Map(stackDecisions.map((decision) => [decision.sourceId, decision]));
  const knownRootNames = options.knownRootNames ?? [];

  for (const source of sources) {
    const decision = decisionBySourceId.get(source.id);

    if (!decision) continue;

    if (hasUnsafeSemanticRoot(decision.name)) {
      const decisionIndex = stackDecisions.indexOf(decision);
      errors.push({
        path: `$.stackDecisions[${decisionIndex}].name`,
        message: "技术栈根目录不能包含路径分隔符、路径片段或明显噪声。",
      });
    }

    if (!source.stackHint?.trim()) {
      const inferredRoots = inferSourceRootCandidates(source, knownRootNames);
      const inferredRoot = inferredRoots[0] ?? "";

      if (inferredRoot && normalizeComparableReference(decision.name) !== normalizeComparableReference(inferredRoot)) {
        const decisionIndex = stackDecisions.indexOf(decision);
        errors.push({
          path: `$.stackDecisions[${decisionIndex}].name`,
          message: `技术栈根目录与来源中的明确根信号不一致：应优先判断为“${inferredRoot}”，模型返回“${decision.name}”。`,
        });
      }
    }

    const sourceSections = sections.filter((section) => section.sourceId === source.id);

    if (source.content.trim() && sourceSections.length === 0) {
      errors.push({
        path: "$.sections",
        message: `来源 ${source.id} 没有生成任何知识分段，不能把有效材料当作空结果写入 Vault。`,
      });
    }

    validateSourceCodeEvidence(source, sourceSections, errors);

    for (const section of sourceSections) {
      const sectionIndex = sections.indexOf(section);
      const sourceText = buildLocalOrganizationSearchable(source);
      const shouldTrustModelPdfPath = source.type === "pdf";

      const relativePath = (section.path ?? []).filter(
        (segment, index) => index !== 0 || normalizeComparableReference(segment) !== normalizeComparableReference(decision.name),
      );

      if (!section.placement && relativePath.length > 3) {
        errors.push({
          path: `$.sections[${sectionIndex}].path`,
          message: "目录最多保留三层相对目录，避免把多个知识词和 OCR 碎片串成路径。",
        });
      }

      if (hasNoisySemanticText(section.title) || hasNoisySemanticText(section.body)) {
        errors.push({
          path: `$.sections[${sectionIndex}]`,
          message: "知识分段包含明显 OCR/模型噪声，不能直接进入生成笔记。",
        });
      }

      const foreignRootSegments = relativePath.filter((segment) =>
        knownRootNames.some(
          (rootName) =>
            normalizeComparableReference(rootName) !== normalizeComparableReference(decision.name) &&
            normalizeComparableReference(rootName) === normalizeComparableReference(segment),
        ),
      );

      if (foreignRootSegments.length > 0) {
        errors.push({
          path: `$.sections[${sectionIndex}].path`,
          message: `目录不能把其他技术栈根目录混入“${decision.name}”：${foreignRootSegments.join("、")}。`,
        });
      }

      const unsupportedSegments = section.placement
        ? []
        : relativePath.filter((segment) => {
            if (options.allowTrustedDerivedPaths) return false;
            if (hasNoisyPathSegment(segment) || isGenericOrganizationBucketSegment(segment)) return true;
            if (options.allowLegacyPathCompatibility) return false;
            return shouldTrustModelPdfPath
              ? false
              : !isSupportedPathSegment(
                  segment,
                  section.title,
                  sourceText,
                  options.taxonomyCandidates ?? [],
                  decision.name,
                );
          });

      if (unsupportedSegments.length > 0) {
        errors.push({
          path: `$.sections[${sectionIndex}].path`,
          message: `目录中的分段缺少语义支撑或包含噪声：${unsupportedSegments.join(" / ")}。`,
        });
      }
    }
  }

  for (const [index, section] of sections.entries()) {
    if (hasNoisySemanticText(section.role)) {
      errors.push({
        path: `$.sections[${index}].role`,
        message: "知识角色包含明显 OCR/模型噪声。",
      });
    }
  }
}

function validateSectionMediaReferences(
  section: ReviewAnalysisSection,
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
  options: ReviewAnalysisValidationOptions,
) {
  const source = sources.find((candidate) => candidate.id === section.sourceId);
  if (!source || source.type !== "pdf" || !source.pdfEvidence) {
    if (section.formulas.length > 0 || section.imagePlacements.length > 0) {
      errors.push({
        path: `$.sections[${section.sourceId}]`,
        message: "公式和图片放置只能引用 PDF 来源。",
      });
    }
    return;
  }

  const pdfEvidence = source.pdfEvidence;
  const pageByNumber = new Map(pdfEvidence.pages.map((page) => [page.page, page]));
  section.formulas.forEach((formula, index) => {
    const page = pageByNumber.get(formula.sourcePage);
    if (!page) {
      errors.push({
        path: `$.sections[${section.id}].formulas[${index}].sourcePage`,
        message: "公式来源页不在 PDF 页面证据中。",
      });
      return;
    }
    const allowedImageAssetIds = new Set(
      options.allowedPdfImageEvidence
        ?.filter((image) => image.sourceId === section.sourceId && image.page === formula.sourcePage)
        .map((image) => image.assetId) ?? [],
    );
    if (
      formula.evidenceId &&
      !page.evidence.some((line) => line.id === formula.evidenceId) &&
      !allowedImageAssetIds.has(formula.evidenceId)
    ) {
      errors.push({
        path: `$.sections[${section.id}].formulas[${index}].evidenceId`,
        message: "公式 evidenceId 不属于对应 PDF 页面。",
      });
    }
  });

  section.imagePlacements.forEach((image, index) => {
    const page = pageByNumber.get(image.sourcePage);
    if (!page) {
      errors.push({
        path: `$.sections[${section.id}].imagePlacements[${index}].sourcePage`,
        message: "图片来源页不在 PDF 页面证据中。",
      });
      return;
    }
    const embeddedImage = pdfEvidence.images?.find((candidate) => candidate.assetId === image.assetId);
    if (!embeddedImage || embeddedImage.page !== image.sourcePage) {
      errors.push({
        path: `$.sections[${section.id}].imagePlacements[${index}].assetId`,
        message: "图片 assetId 必须对应该页实际提取的 PDF 内嵌图片。",
      });
    }
    if (!embeddedImage?.imageDataUrl || !options.allowedPdfImageEvidence?.some(
      (allowed) => allowed.sourceId === section.sourceId && allowed.page === image.sourcePage && allowed.assetId === image.assetId && allowed.kind === "embedded",
    )) {
      errors.push({
        path: `$.sections[${section.id}].imagePlacements[${index}]`,
        message: "图片放置只能引用本轮已发送的 PDF 内嵌图片资产。",
      });
    }
  });
}

function validateSourceCodeEvidence(
  source: IntakeSource,
  sourceSections: ReviewAnalysisSection[],
  errors: ReviewSkillValidationError[],
) {
  const structure = analyzeSourceStructures([source])[0];
  const uniqueCodeFingerprints = [
    ...new Set(
      (structure?.codeBlocks ?? [])
        .map((block) => block.fingerprint)
        .filter((fingerprint) => fingerprint.length > 0),
    ),
  ];

  if (uniqueCodeFingerprints.length === 0) return;

  const sectionBodyFingerprint = normalizeCodeForComparison(
    sourceSections.map((section) => section.body).join("\n"),
  );
  const missingCode = uniqueCodeFingerprints.filter(
    (fingerprint) => !sectionBodyFingerprint.includes(fingerprint),
  );

  if (missingCode.length === 0) return;

  errors.push({
    path: "$.sections",
    message: `来源 ${source.id} 的代码证据缺失：原文代码块未出现在任何 sections[].body。`,
  });
}

function inferSourceRootCandidates(source: IntakeSource, knownRootNames: string[]) {
  const hintedRoot = source.stackHint?.split(/[\\/]/)[0]?.trim() ?? "";

  if (hintedRoot) return [hintedRoot];

  const searchable = buildLocalOrganizationSearchable(source);
  const normalizedSearchable = normalizeComparableReference(searchable);
  const mentionedKnownRoots = knownRootNames
    .map((root) => root.trim())
    .filter(Boolean)
    .filter((root) => normalizedSearchable.includes(normalizeComparableReference(root)))
    .sort((left, right) => right.length - left.length);
  const titleRoot = inferRootFromSourceTitle(source.title);
  const contentRoot = inferRootFromSourceContent(buildLocalOrganizationContent(source));

  return uniqueSemanticLines([titleRoot, contentRoot, ...mentionedKnownRoots]);
}

function inferRootFromSourceTitle(title: string) {
  const normalizedTitle = title.replace(/^#+\s*/, "").trim();

  if (!normalizedTitle) return "";

  const latinPrefix = normalizedTitle.match(/^[A-Za-z][A-Za-z0-9+#.-]*/u)?.[0]?.trim() ?? "";
  const titleAfterLatinPrefix = normalizedTitle.slice(latinPrefix.length);

  if (
    latinPrefix &&
    !isGenericRootName(latinPrefix) &&
    (!titleAfterLatinPrefix || /^[\s:/\\|_-]/u.test(titleAfterLatinPrefix))
  ) {
    return latinPrefix;
  }

  const rolePrefix = normalizedTitle.match(/^(.+?)(?:术语|基本概念|应用步骤|具体代码|问题排查)(?:\s|$)/u)?.[1]?.trim();
  if (rolePrefix && rolePrefix.length >= 2 && !isGenericRootName(rolePrefix)) return rolePrefix;

  const beforeSeparator = normalizedTitle.split(/[：:|/\\]/u)[0]?.trim() ?? "";
  const candidate = beforeSeparator
    .replace(
      /\s*(?:学习记录|学习笔记|课程笔记|课程资料|笔记|记录|资料|文档|教程|导论|总览|原文|内容|术语|应用步骤|具体代码)$/u,
      "",
    )
    .trim();

  if (candidate.length < 2 || candidate.length > 24 || isGenericRootName(candidate)) return "";

  return candidate;
}

function inferRootFromSourceContent(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((line) => !isExtractionWrapperLine(line))
    .filter((line) => !hasHierarchyArrow(line))
    .slice(0, 40);

  for (const line of lines) {
    const beforeSeparator = line.split(/[：:]/u)[0]?.trim() ?? "";

    if (
      beforeSeparator.length >= 2 &&
      beforeSeparator.length <= 20 &&
      !/[，,。；;、()[\]{}<>]/u.test(beforeSeparator) &&
      !isGenericRootName(beforeSeparator)
    ) {
      return beforeSeparator;
    }
  }

  return "";
}

function isExtractionWrapperLine(line: string) {
  return (
    /^【(?:PDF|OCR|文件名|抽取|正文|提示|质量|原文)/u.test(line) ||
    /^[-*]\s*(?:这份|以下|审理时|不要逐字|无法确认)/u.test(line) ||
    /^PDF\s+抽取/u.test(line) ||
    /^来源(?:类型|文件名)?\s*[：:]/u.test(line)
  );
}

function isGenericRootName(value: string) {
  return new Set([
    "随笔",
    "笔记",
    "学习记录",
    "学习笔记",
    "资料",
    "文档",
    "原文",
    "内容",
    "未命名",
    "总览",
    "导览",
    "术语",
    "基本概念",
    "应用步骤",
    "具体代码",
  ]).has(normalizeComparableReference(value));
}

function isGenericOrganizationBucketSegment(value: string) {
  const normalized = normalizeComparableReference(value);

  if (!normalized) return true;

  const exactBuckets = new Set([
    "所有文件放一起",
    "全部文件放一起",
    "所有内容放一起",
    "全部内容放一起",
    "统一放一起",
    "放一起",
    "全部资料",
    "所有资料",
    "全部笔记",
    "所有笔记",
    "未分类",
    "待分类",
    "临时文件",
    "临时目录",
    "临时笔记",
  ]);

  if (exactBuckets.has(normalized)) return true;

  return (
    /(?:全部|所有|统一).{0,4}(?:文件|内容|资料|笔记).{0,4}(?:放一起|放到一起|合并|归并)/u.test(normalized) ||
    /(?:放一起|放到一起|都放)/u.test(normalized)
  );
}

function uniqueSemanticLines(values: string[]) {
  const seen = new Set<string>();

  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeComparableReference(value);

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hasUnsafeSemanticRoot(value: string) {
  return (
    /[\\/]/u.test(value) ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    hasNoisyPathSegment(value)
  );
}

function hasNoisySemanticText(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return true;
  // U+25A1 is commonly used as a handwritten-note checkbox or list marker.
  // Treat only the Unicode replacement character as an unconditional decode error.
  if (/\ufffd/u.test(trimmed)) return true;
  if (/\(cid:\d+\)/iu.test(trimmed)) return true;
  // Newlines, carriage returns, and tabs are valid Markdown whitespace.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)) return true;

  return false;
}

function hasNoisyPathSegment(value: string) {
  return hasNoisySemanticText(value) || /[<>]/u.test(value);
}

function isSupportedPathSegment(
  segment: string,
  sectionTitle: string,
  sourceText: string,
  taxonomyCandidates: VaultTaxonomyCandidate[],
  root: string,
) {
  const normalizedSegment = normalizeComparableReference(segment);

  if (knownKnowledgeRoles.some((role) => normalizeComparableReference(role) === normalizedSegment)) {
    return true;
  }

  const semanticSourceText = sourceText
    .split(/\r?\n/)
    .filter((line) => !isOrdinaryArrowChain(line))
    .join("\n");
  const semanticText = normalizeComparableReference(`${sectionTitle}\n${semanticSourceText}`);

  if (semanticText.includes(normalizedSegment)) {
    return true;
  }

  const titleBigrams = [...normalizeComparableReference(sectionTitle)]
    .slice(0, -1)
    .map((_, index, characters) => characters.slice(index, index + 2).join(""));
  if (titleBigrams.some((bigram) => bigram.length === 2 && normalizedSegment.includes(bigram))) {
    return true;
  }

  if (
    taxonomyCandidates.some((candidate) =>
      normalizeComparableReference(candidate.root) === normalizeComparableReference(root) &&
      candidate.path
        .split("/")
        .some((candidateSegment) => normalizeComparableReference(candidateSegment) === normalizedSegment),
    )
  ) {
    return true;
  }

  const semanticTokens = [
    ...(segment.match(/[A-Za-z0-9+#._-]{2,}/gu) ?? []),
    ...(segment.match(/[\u4e00-\u9fff]{2,}/gu) ?? []),
  ].filter((token) => token.length >= 2);

  if (semanticTokens.length === 0) return false;

  const supportedTokenCount = semanticTokens.filter((token) =>
    semanticText.includes(normalizeComparableReference(token)),
  ).length;

  if (supportedTokenCount >= Math.max(1, Math.ceil(semanticTokens.length / 2))) return true;

  const chineseRuns = segment.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const chineseBigrams = chineseRuns.flatMap((run) =>
    [...run].slice(0, -1).map((_, index) => run.slice(index, index + 2)),
  );
  const supportedBigrams = chineseBigrams.filter((token) =>
    semanticText.includes(normalizeComparableReference(token)),
  ).length;

  return chineseBigrams.length > 0 && supportedBigrams >= Math.max(1, Math.ceil(chineseBigrams.length / 2));
}

function isOrdinaryArrowChain(line: string) {
  return hasHierarchyArrow(line) && !isExplicitOrganizationHierarchyLine(line);
}

function validateAnalysisGranularityPolicy(
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
) {
  const totalContentLength = sources.reduce((sum, source) => sum + source.content.trim().length, 0);

  if (totalContentLength > 2000 || sections.length <= 5) return;

  errors.push({
    path: "$.sections",
    message: "少量输入不要过度拆分：2000 字以内最多生成 5 个知识分段。",
  });
}

export function validateReviewSkillOutput(
  candidate: unknown,
  sources: IntakeSource[],
): ReviewSkillValidationResult {
  const errors: ReviewSkillValidationError[] = [];
  const sourceIds = new Set(sources.map((source) => source.id));

  if (!isRecord(candidate)) {
    return fail([{ path: "$", message: "Skill 输出必须是 JSON 对象。" }]);
  }

  if (candidate.protocolVersion !== REVIEW_SKILL_PROTOCOL_VERSION) {
    errors.push({
      path: "$.protocolVersion",
      message: `协议版本必须是 ${REVIEW_SKILL_PROTOCOL_VERSION}。`,
    });
  }

  const corrections = readArray(candidate, "corrections", errors);
  const notes = readArray(candidate, "notes", errors);
  const relations = readArray(candidate, "relations", errors);
  const uncertain = readArray(candidate, "uncertain", errors);
  const normalizedCorrections = validateCorrections(corrections, sourceIds, errors);
  const normalizedNotes = validateNotes(notes, sourceIds, errors);
  const normalizedRelations = validateRelations(relations, errors);
  const normalizedUncertain = validateUncertain(uncertain, errors);

  validateNoteGranularityPolicy(normalizedNotes, sources, errors);

  if (errors.length > 0) return fail(errors);

  return {
    ok: true,
    output: {
      protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
      corrections: normalizedCorrections,
      notes: normalizedNotes,
      relations: normalizedRelations,
      uncertain: normalizedUncertain,
    },
    errors: [],
  };
}

function validateCorrections(items: unknown[], sourceIds: Set<string>, errors: ReviewSkillValidationError[]) {
  return items.flatMap((item, index) => {
    const path = `$.corrections[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "纠错项必须是对象。" });
      return [];
    }

    if (isBlankCorrectionPlaceholder(item)) return [];

    const sourceId = readRequiredString(item, "sourceId", `${path}.sourceId`, errors);
    const original = readRequiredString(item, "original", `${path}.original`, errors);
    const fixed = readRequiredString(item, "fixed", `${path}.fixed`, errors);
    const reason = readRequiredString(item, "reason", `${path}.reason`, errors);

    if (sourceId && !sourceIds.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "sourceId 必须来自输入 sources。" });
    }

    if (!sourceId || !original || !fixed || !reason) return [];

    return [{ sourceId, original, fixed, reason }];
  });
}

function validateNotes(items: unknown[], sourceIds: Set<string>, errors: ReviewSkillValidationError[]) {
  const ids = new Set<string>();
  const inferredSingleSourceId = sourceIds.size === 1 ? [...sourceIds][0] : "";

  return items.flatMap((item, index) => {
    const path = `$.notes[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "笔记项必须是对象。" });
      return [];
    }

    const rawId = readOptionalString(item, "id");
    const sourceId = readOptionalString(item, "sourceId") || inferredSingleSourceId;
    const title = readRequiredString(item, "title", `${path}.title`, errors);
    const grain = readEnum(item, "grain", allowedGrains, `${path}.grain`, errors);
    const notePath = readRequiredString(item, "path", `${path}.path`, errors);
    const status = readEnum(item, "status", allowedStatuses, `${path}.status`, errors);
    const markdown = readRequiredString(item, "markdown", `${path}.markdown`, errors);
    const id = rawId || createGeneratedNoteId(sourceId, index, ids);

    if (!sourceId) {
      errors.push({ path: `${path}.sourceId`, message: "字段必须是非空字符串。" });
    }

    if (id) {
      if (ids.has(id)) {
        errors.push({ path: `${path}.id`, message: "笔记 id 不能重复。" });
      }
      ids.add(id);
    }

    if (sourceId && !sourceIds.has(sourceId)) {
      errors.push({ path: `${path}.sourceId`, message: "sourceId 必须来自输入 sources。" });
    }

    if (notePath && hasUnsafePathSegment(notePath)) {
      errors.push({ path: `${path}.path`, message: "笔记路径不能包含绝对路径或 .. 跳出目录。" });
    }

    if (!id || !sourceId || !title || !grain || !notePath || !status || !markdown) return [];

    return [
      {
        id,
        sourceId,
        title,
        grain,
        path: notePath,
        status,
        markdown,
      },
    ];
  });
}

function validateNoteGranularityPolicy(
  notes: GeneratedNote[],
  sources: IntakeSource[],
  errors: ReviewSkillValidationError[],
) {
  const totalContentLength = sources.reduce((sum, source) => sum + source.content.trim().length, 0);

  if (totalContentLength > 2000 || notes.length <= 5) return;

  errors.push({
    path: "$.notes",
    message: "少量输入不要过度拆分：2000 字以内最多生成 5 篇笔记。",
  });
}

function validateRelations(items: unknown[], errors: ReviewSkillValidationError[]) {
  return items.flatMap((item, index) => {
    const path = `$.relations[${index}]`;

    if (!isRecord(item)) {
      errors.push({ path, message: "关系项必须是对象。" });
      return [];
    }

    if (isBlankRelationPlaceholder(item)) return [];

    const rawType = readOptionalString(item, "type");
    const type = normalizeRelationType(rawType);
    const source = readRequiredString(item, "source", `${path}.source`, errors);
    const target = readRequiredString(item, "target", `${path}.target`, errors);

    if (!type) {
      errors.push({ path: `${path}.type`, message: `字段只能是：${allowedRelationTypes.join("、")}。` });
    }

    if (!type || !source || !target) return [];

    return [{ type, source, target }];
  });
}

function normalizeRelationType(value: string): RelationType | "" {
  const compact = value.replace(/\s+/g, "");

  if ((allowedRelationTypes as readonly string[]).includes(compact)) return compact as RelationType;

  const aliases: Record<string, RelationType> = {
    依赖关系: "依赖",
    依赖于: "依赖",
    前置: "前置知识",
    前置依赖: "前置知识",
    前置关系: "前置知识",
    先修: "前置知识",
    先修知识: "前置知识",
    包含关系: "包含",
    包含于: "包含",
    组成: "包含",
    子主题: "包含",
    递进关系: "递进",
    进阶: "递进",
    对比关系: "对比",
    比较: "对比",
    应用: "应用于",
    用于: "应用于",
    应用关系: "应用于",
    混淆: "容易混淆",
    易混淆: "容易混淆",
    易混淆点: "容易混淆",
    相关: "并列",
    关联: "并列",
    相关联: "并列",
    并列关系: "并列",
    同级: "并列",
  };

  return aliases[compact] ?? "";
}

function validateUncertain(items: unknown[], errors: ReviewSkillValidationError[]) {
  return items.flatMap((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push({ path: `$.uncertain[${index}]`, message: "不确定项必须是非空字符串。" });
      return [];
    }

    return [item.trim()];
  });
}

function isBlankCorrectionPlaceholder(item: Record<string, unknown>) {
  return ["original", "fixed", "reason"].every((key) => isBlankValue(item[key]));
}

function isBlankRelationPlaceholder(item: Record<string, unknown>) {
  return isBlankValue(item.source) && isBlankValue(item.target);
}

function isBlankAnalysisRelationPlaceholder(item: Record<string, unknown>) {
  return (
    isBlankValue(item.source) &&
    isBlankValue(item.target) &&
    isBlankValue(item.sourceNodeId) &&
    isBlankValue(item.targetNodeId) &&
    isBlankValue(item.evidence)
  );
}

function isBlankValue(value: unknown) {
  return typeof value !== "string" || value.trim().length === 0;
}

function readArray(
  record: Record<string, unknown>,
  key: keyof ReviewSkillOutput,
  errors: ReviewSkillValidationError[],
) {
  const value = record[key];

  if (!Array.isArray(value)) {
    errors.push({ path: `$.${key}`, message: "字段必须是数组。" });
    return [];
  }

  return value;
}

function readRequiredArray(record: Record<string, unknown>, key: string, errors: ReviewSkillValidationError[]) {
  const value = record[key];

  if (!Array.isArray(value)) {
    errors.push({ path: `$.${key}`, message: "字段必须是数组。" });
    return [];
  }

  return value;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: ReviewSkillValidationError[],
) {
  const value = record[key];

  if (!Array.isArray(value)) {
    errors.push({ path, message: "字段必须是字符串数组。" });
    return null;
  }

  const strings: string[] = [];

  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push({ path: `${path}[${index}]`, message: "数组项必须是非空字符串。" });
      return;
    }

    strings.push(item.trim());
  });

  return strings;
}

function readPathSegments(record: Record<string, unknown>, path: string, errors: ReviewSkillValidationError[]) {
  const value = record.path;

  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ path, message: "path 必须是非空的相对目录数组。" });
    return null;
  }

  const segments: string[] = [];

  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push({ path: `${path}[${index}]`, message: "目录段必须是非空字符串。" });
      return;
    }

    const segment = item.trim();

    if (segment === "." || segment === ".." || /[\\/]/u.test(segment)) {
      errors.push({ path: `${path}[${index}]`, message: "目录段不能包含路径分隔符或 ..。" });
      return;
    }

    segments.push(segment);
  });

  return segments.length === value.length ? segments : null;
}

function readOptionalPathSegments(
  record: Record<string, unknown>,
  path: string,
  errors: ReviewSkillValidationError[],
) {
  if (!Object.prototype.hasOwnProperty.call(record, "path")) return undefined;

  return readPathSegments(record, path, errors) ?? null;
}

function readAnalysisPlacement(
  record: Record<string, unknown>,
  path: string,
  errors: ReviewSkillValidationError[],
): ReviewAnalysisPlacement | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, "placement")) return undefined;

  const value = record.placement;

  if (!isRecord(value)) {
    errors.push({ path, message: "placement 必须是对象。" });
    return undefined;
  }

  const mode = readEnum(
    value,
    "mode",
    ["new-child", "existing-note", "new-root"] as const,
    `${path}.mode`,
    errors,
  );
  const parentNodeId = readNullableString(value, "parentNodeId", `${path}.parentNodeId`, errors);
  const branchName = readNullableString(value, "branchName", `${path}.branchName`, errors);
  const targetNodeId = readNullableString(value, "targetNodeId", `${path}.targetNodeId`, errors);

  if (!mode || parentNodeId === undefined || branchName === undefined || targetNodeId === undefined) {
    return undefined;
  }

  return {
    mode,
    parentNodeId,
    branchName,
    targetNodeId,
  };
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: ReviewSkillValidationError[],
) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    errors.push({ path, message: "字段必须存在，可以是字符串或 null。" });
    return undefined;
  }

  const value = record[key];

  if (value === null) return null;

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "字段必须是非空字符串或 null。" });
    return undefined;
  }

  return value.trim();
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: ReviewSkillValidationError[],
) {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "字段必须是非空字符串。" });
    return "";
  }

  return value.trim();
}

function readRequiredInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: ReviewSkillValidationError[],
) {
  const value = record[key];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    errors.push({ path, message: "字段必须是大于 0 的整数。" });
    return 0;
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  return typeof value === "string" ? value.trim() : "";
}

function readEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
  path: string,
  errors: ReviewSkillValidationError[],
): T[number] | "" {
  const value = record[key];

  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push({ path, message: `字段只能是：${allowed.join("、")}。` });
    return "";
  }

  return value;
}

function createGeneratedNoteId(sourceId: string, index: number, usedIds: Set<string>) {
  const safeSource = (sourceId || "source").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  const base = `${safeSource || "source"}-note-${index + 1}`;
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeComparableReference(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fenced) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("没有找到可解析的 JSON 对象。");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function hasUnsafePathSegment(path: string) {
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return true;

  return path
    .split("/")
    .map((segment) => segment.trim())
    .some((segment) => segment === ".." || segment.length === 0);
}

function fail(errors: ReviewSkillValidationError[]): ReviewSkillValidationResult {
  return { ok: false, output: null, errors };
}

function failAnalysis(errors: ReviewSkillValidationError[]): ReviewAnalysisValidationResult {
  return { ok: false, output: null, errors };
}
