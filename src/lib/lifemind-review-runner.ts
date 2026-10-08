import {
  buildReviewSkillSystemPrompt,
  createReviewBatch,
  createReviewBatchFromAnalysisPlan,
  createReviewAnalysisRequest,
  parseReviewAnalysisPlan,
  selectVaultContextForSources,
  type IntakeSource,
  type ReviewBatch,
  type ReviewAnalysisPlan,
  type ReviewAnalysisRequest,
  type VaultKnowledgeContext,
} from "./lifemind-core";
import {
  buildLogicLinkSystemPrompt,
  createLogicLinkUpdateRequest,
  type LogicLinkUpdateDraft,
  type LogicLinkUpdateRequest,
} from "./lifemind-link-update";

export type ReviewSkillProvider =
  | "local"
  | "deepseek";

export type ReviewModelApiFormat = "deepseek-strict-tools";

export type ReviewModelProviderPreset = {
  provider: Exclude<ReviewSkillProvider, "local">;
  label: string;
  baseUrl: string;
  model: string;
  apiFormat: ReviewModelApiFormat;
};

export const reviewModelProviderPresets: ReviewModelProviderPreset[] = [
  {
    provider: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiFormat: "deepseek-strict-tools",
  },
];

export type ReviewSkillRunnerConfig = {
  provider: ReviewSkillProvider;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiFormat?: ReviewModelApiFormat;
  fallbackToLocal?: boolean;
  qualityPasses?: 1 | 2;
  maxOutputTokens?: number;
  vaultContext?: VaultKnowledgeContext | null;
  fetcher?: typeof fetch;
  modelInvoker?: (
    payload: OpenAICompatibleModelRequest<ReviewAnalysisRequest>,
  ) => Promise<string | ReviewModelInvocation>;
  diagnosticLogger?: (event: ReviewDiagnosticEvent) => void | Promise<void>;
};

export type ReviewModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  reasoningTokens: number;
};

export type ReviewModelInvocation = {
  output: string;
  usage?: ReviewModelUsage;
};

export type ReviewBillingPeriod = "peak" | "off-peak";

export type ReviewUsageSummary = ReviewModelUsage & {
  requestCount: number;
  estimatedCostCny: number;
  billingPeriod: ReviewBillingPeriod;
  usageAvailable: boolean;
};

export type OpenAICompatibleModelRequest<TRequest = ReviewAnalysisRequest> = {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: ReviewModelApiFormat;
  systemPrompt: string;
  request: TRequest;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "high";
  tool?: DeepSeekToolDefinition;
};

export function createDeepSeekLogicLinkModelRequest(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  draft: LogicLinkUpdateDraft;
}): OpenAICompatibleModelRequest<LogicLinkUpdateRequest> {
  return {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    apiFormat: "deepseek-strict-tools",
    systemPrompt: buildLogicLinkSystemPrompt(),
    request: createLogicLinkUpdateRequest(options.draft),
    tool: deepSeekLogicLinkTool,
  };
}

export type ReviewDiagnosticEvent = {
  provider: "deepseek";
  model: string;
  stage: "skill-validation";
  attempt: number;
  responseLength: number;
  requestSummary: {
    apiFormat: ReviewModelApiFormat;
    protocolVersion: string;
    reviewMode?: ReviewAnalysisRequest["reviewMode"];
    sourceCount: number;
    toolChoice: string;
    thinking: "disabled";
    sourceStructure: Array<{
      sourceId: string;
      lineCount: number;
      characterCount: number;
      codeBlockCount: number;
      markerCount: number;
      markerCounts: Record<string, number>;
      firstMarkers: Array<{
        level: number;
        kind: string;
        label: string;
        line: number;
      }>;
    }>;
  };
  rawOutputPreview: string;
  errors: Array<{
    path: string;
    message: string;
  }>;
};

export type DeepSeekToolDefinition = {
  type: "function";
  function: {
    name: "submit_review_plan" | "submit_logic_link_update";
    description: string;
    strict: true;
    parameters: Record<string, unknown>;
  };
};

export const deepSeekReviewTool: DeepSeekToolDefinition = {
  type: "function",
  function: {
    name: "submit_review_plan",
    description: "提交经过审理的 lifemind.review.v2 知识结构分析计划。",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        protocolVersion: { type: "string", enum: ["lifemind.review.v2"] },
        pageCoverage: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceId: { type: "string" },
              page: { type: "integer", minimum: 1 },
              status: { type: "string", enum: ["covered", "uncertain", "unreadable"] },
              sectionIds: { type: "array", items: { type: "string" } },
              evidenceIds: {
                type: "array",
                items: {
                  type: "string",
                  description: "引用本页 sources[].pdfEvidence.pages[].evidence[].id；若本页图像已在 imagePagesSent 中，可引用该页 assetId。",
                },
              },
              summary: { type: "string" },
            },
            required: ["sourceId", "page", "status", "sectionIds", "evidenceIds", "summary"],
          },
        },
        stackDecisions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceId: { type: "string" },
              name: { type: "string" },
              confidence: { type: "string", enum: ["高", "中", "低"] },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["sourceId", "name", "confidence", "evidence"],
          },
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              sourceId: { type: "string" },
              title: { type: "string" },
              role: { type: "string" },
              grain: { type: "string", enum: ["大颗粒度", "中颗粒度", "小颗粒度"] },
              placement: {
                type: "object",
                additionalProperties: false,
                properties: {
                  mode: { type: "string", enum: ["new-child", "existing-note", "new-root"] },
                  parentNodeId: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                    description:
                      "仅当 mode=new-child 时填写 vaultIndex 中已经存在的 root 或 directory 节点 ID；不能填写本批次 section id、mode 名称或路径。mode=new-root/existing-note 必须为 null。",
                  },
                  branchName: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                    description: "要新建的单个目录名；不要填写完整路径。没有新分支时为 null。",
                  },
                  targetNodeId: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                    description:
                      "仅当 mode=existing-note 时填写 vaultIndex 中已有 note 节点 ID；其他模式必须为 null。",
                  },
                },
                required: ["mode", "parentNodeId", "branchName", "targetNodeId"],
              },
              parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
              status: { type: "string", enum: ["新建笔记", "合并到旧笔记"] },
              existingNoteTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
              body: {
                type: "string",
                description: "知识段正文。每个 formulas 中的公式必须在此正文中恰好出现一次 {{formula:<id>}}；只填写公式的 anchor 字段不够。",
              },
              formulas: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    latex: { type: "string" },
                    display: { type: "string", enum: ["inline", "block"] },
                    sourcePage: {
                      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
                      description: "PDF 公式填写真实来源页码；粘贴文本、Markdown、网页、代码等非 PDF 来源填写 null。",
                    },
                    evidenceId: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                      description: "非 PDF 公式填写 null。PDF 公式填写对应页的文本 evidence id；若仅能从本轮已发送的页面图像确认，可填该页 assetId。",
                    },
                    anchor: { anyOf: [{ type: "string" }, { type: "null" }] },
                    confidence: { type: "string", enum: ["高", "中", "低"] },
                  },
                  required: ["id", "latex", "display", "sourcePage", "evidenceId", "anchor", "confidence"],
                },
              },
              imagePlacements: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    assetId: { type: "string" },
                    sourcePage: { type: "integer", minimum: 1 },
                    placement: { type: "string", enum: ["before-section", "after-section", "inline"] },
                    anchor: { anyOf: [{ type: "string" }, { type: "null" }] },
                    caption: { anyOf: [{ type: "string" }, { type: "null" }] },
                    alt: { anyOf: [{ type: "string" }, { type: "null" }] },
                    confidence: { type: "string", enum: ["高", "中", "低"] },
                  },
                  required: ["assetId", "sourcePage", "placement", "anchor", "caption", "alt", "confidence"],
                },
              },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: [
              "id",
              "sourceId",
              "title",
              "role",
              "grain",
              "placement",
              "parentId",
              "status",
              "existingNoteTitle",
              "body",
              "formulas",
              "imagePlacements",
              "evidence",
            ],
          },
        },
        relations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: {
                type: "string",
                enum: ["依赖", "包含", "并列", "递进", "对比", "应用于", "容易混淆", "前置知识"],
              },
              sourceNodeId: { type: "string" },
              targetNodeId: { type: "string" },
              evidence: { type: "string" },
              confidence: { type: "string", enum: ["高", "中", "低"] },
            },
            required: ["type", "sourceNodeId", "targetNodeId", "evidence", "confidence"],
          },
        },
        corrections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceId: { type: "string" },
              original: { type: "string" },
              fixed: { type: "string" },
              reason: { type: "string" },
            },
            required: ["sourceId", "original", "fixed", "reason"],
          },
        },
        uncertain: { type: "array", items: { type: "string" } },
      },
      required: ["protocolVersion", "pageCoverage", "stackDecisions", "sections", "relations", "corrections", "uncertain"],
    },
  },
};

export const deepSeekLogicLinkTool: DeepSeekToolDefinition = {
  type: "function",
  function: {
    name: "submit_logic_link_update",
    description: "提交经过复审的 LifeMind 全库后续枝节链接候选。",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        protocolVersion: { type: "string", enum: ["lifemind.logic-links.v1"] },
        accepted: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              candidateId: { type: "string" },
              reason: { type: "string" },
            },
            required: ["candidateId", "reason"],
          },
        },
      },
      required: ["protocolVersion", "accepted"],
    },
  },
};

export type ReviewSkillRunResult = {
  batch: ReviewBatch;
  provider: ReviewSkillProvider;
  usedFallback: boolean;
  request: ReviewAnalysisRequest;
  rawOutput?: string;
  usage: ReviewUsageSummary | null;
  message: string;
};

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    reasoning_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: {
    message?: string;
  };
};

const DEFAULT_DRAFT_MAX_OUTPUT_TOKENS = 10_000;
const DEFAULT_FINAL_MAX_OUTPUT_TOKENS = 10_000;
const DEFAULT_REPAIR_MAX_OUTPUT_TOKENS = 16_000;

export function estimateDeepSeekCost(
  model: string,
  usage: ReviewModelUsage,
  period: ReviewBillingPeriod,
) {
  const pricing = getDeepSeekPricing(model, period);

  return (
    (usage.promptCacheHitTokens * pricing.cacheHitInputCnyPerMillion +
      usage.promptCacheMissTokens * pricing.cacheMissInputCnyPerMillion +
      usage.completionTokens * pricing.outputCnyPerMillion) /
    1_000_000
  );
}

export function summarizeReviewUsage(
  model: string,
  usages: Array<ReviewModelUsage | undefined>,
  now = new Date(),
): ReviewUsageSummary | null {
  const availableUsages = usages.filter((usage): usage is ReviewModelUsage => Boolean(usage));

  if (availableUsages.length === 0) return null;

  const usage = availableUsages.reduce<ReviewModelUsage>(
    (total, current) => ({
      promptTokens: total.promptTokens + current.promptTokens,
      completionTokens: total.completionTokens + current.completionTokens,
      totalTokens: total.totalTokens + current.totalTokens,
      promptCacheHitTokens: total.promptCacheHitTokens + current.promptCacheHitTokens,
      promptCacheMissTokens: total.promptCacheMissTokens + current.promptCacheMissTokens,
      reasoningTokens: total.reasoningTokens + current.reasoningTokens,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
      reasoningTokens: 0,
    },
  );
  const billingPeriod = getDeepSeekBillingPeriod(now);

  return {
    ...usage,
    requestCount: usages.length,
    estimatedCostCny: estimateDeepSeekCost(model, usage, billingPeriod),
    billingPeriod,
    usageAvailable: availableUsages.length === usages.length,
  };
}

export async function runReviewSkill(
  sources: IntakeSource[],
  config: ReviewSkillRunnerConfig,
): Promise<ReviewSkillRunResult> {
  const selectedVaultContext = selectVaultContextForSources(config.vaultContext, sources);
  const qualityPasses = config.qualityPasses ?? 1;
  const request = createReviewAnalysisRequest(sources, selectedVaultContext, {
    reviewMode: qualityPasses === 2 ? "draft-pass" : "single-pass",
  });

  if (config.provider === "local") {
    return runLocalReviewSkill(
      sources,
      request,
      selectedVaultContext,
      "当前使用本地 fallback 审理，未调用外部模型。",
      false,
    );
  }

  try {
    const result =
      qualityPasses === 2
        ? await callExternalReviewSkillWithQualityPass(request, sources, selectedVaultContext, config)
        : await callExternalReviewSkillUntilValid(request, sources, config);

    return {
      batch: createReviewBatchFromAnalysisPlan(sources, result.output, {
        vaultContext: selectedVaultContext,
        allowedPdfImageEvidence: result.request.pdfEvidenceImages?.map(({ sourceId, page, assetId, kind }) => ({
          sourceId,
          page,
          assetId,
          kind,
        })) ?? [],
      }),
      provider: config.provider,
      usedFallback: false,
      request: result.request,
      rawOutput: result.rawOutput,
      usage: summarizeReviewUsage(
        (config.model || getReviewModelProviderPreset(config.provider)?.model || "").trim(),
        result.usages,
      ),
      message: buildExternalReviewMessage(result, qualityPasses),
    };
  } catch (error) {
    if (config.fallbackToLocal ?? true) {
      const reason = error instanceof Error ? error.message : String(error);
      return runLocalReviewSkill(
        sources,
        request,
        selectedVaultContext,
        `外部模型审理失败，已使用本地 fallback：${reason}`,
        true,
      );
    }

    throw error;
  }
}

export async function testReviewSkillConnection(config: ReviewSkillRunnerConfig): Promise<ReviewSkillRunResult> {
  if (config.provider === "local") {
    throw new Error("请选择一个外部模型供应商后再测试 API 连接。");
  }

  return runReviewSkill(
    [
      {
        id: "api-connection-test",
        title: "API 连接测试",
        type: "text",
        stackHint: "lifemind",
        content: "这是一条 lifemind API 连接测试材料。请只返回符合 lifemind.review.v2 的结构分析计划 JSON。",
      },
    ],
    {
      ...config,
      fallbackToLocal: false,
      maxOutputTokens: config.maxOutputTokens ?? 2_000,
    },
  );
}

async function callExternalReviewSkillUntilValid(
  request: ReviewAnalysisRequest,
  sources: IntakeSource[],
  config: ReviewSkillRunnerConfig,
): Promise<{
  output: ReviewAnalysisPlan;
  rawOutput: string;
  usages: Array<ReviewModelUsage | undefined>;
  retried: boolean;
  request: ReviewAnalysisRequest;
  qualityFallbackToDraft?: boolean;
  qualityFallbackReason?: string;
}> {
  const parseOptions = {
    enforceStackHints: true,
    externalReferenceTitles: [
      ...(request.vaultContext?.notes.map((note) => note.title) ?? []),
      ...(request.vaultContext?.roots.map((root) => root.name) ?? []),
    ],
    knownRootNames: request.vaultContext?.roots.map((root) => root.name) ?? [],
    taxonomyCandidates: request.taxonomyCandidates ?? [],
    vaultIndex: request.vaultIndex ?? [],
    allowLegacyPathCompatibility: true,
    allowedPdfImageEvidence: request.pdfEvidenceImages?.map(({ sourceId, page, assetId, kind }) => ({
      sourceId,
      page,
      assetId,
      kind,
    })) ?? [],
  };
  const firstResponse = await callExternalReviewSkill(request, config);
  const firstRawOutput = firstResponse.output;
  const firstParsed = parseReviewAnalysisPlan(firstRawOutput, sources, parseOptions);

  if (firstParsed.ok) {
    return {
      output: firstParsed.output,
      rawOutput: firstRawOutput,
      usages: [firstResponse.usage],
      retried: false,
      request,
    };
  }

  await reportReviewValidationFailure(config, request, firstParsed.errors, firstRawOutput, 1);

  const syntaxFailure = isJsonSyntaxValidationFailure(firstParsed.errors);
  const repairRequest = createReviewAnalysisRequest(sources, request.vaultContext, {
    reviewMode: syntaxFailure ? "repair-pass" : request.reviewMode,
    previousAnalysisPlan: request.previousAnalysisPlan,
    protocolRepair: {
      errors: firstParsed.errors,
      previousOutput: buildRepairPreviousOutput(firstRawOutput, syntaxFailure),
    },
  });
  const repairedResponse = await callExternalReviewSkill(
    repairRequest,
    syntaxFailure
      ? {
          ...config,
          maxOutputTokens:
            config.maxOutputTokens === undefined
              ? DEFAULT_REPAIR_MAX_OUTPUT_TOKENS
              : Math.max(config.maxOutputTokens, DEFAULT_REPAIR_MAX_OUTPUT_TOKENS),
        }
      : config,
  );
  const repairedRawOutput = repairedResponse.output;
  const repairedParsed = parseReviewAnalysisPlan(repairedRawOutput, sources, {
    enforceStackHints: true,
    externalReferenceTitles: [
      ...(repairRequest.vaultContext?.notes.map((note) => note.title) ?? []),
      ...(repairRequest.vaultContext?.roots.map((root) => root.name) ?? []),
    ],
    knownRootNames: repairRequest.vaultContext?.roots.map((root) => root.name) ?? [],
    taxonomyCandidates: repairRequest.taxonomyCandidates ?? [],
    vaultIndex: repairRequest.vaultIndex ?? [],
    allowLegacyPathCompatibility: true,
    allowedPdfImageEvidence: repairRequest.pdfEvidenceImages?.map(({ sourceId, page, assetId, kind }) => ({
      sourceId,
      page,
      assetId,
      kind,
    })) ?? [],
  });

  if (!repairedParsed.ok) {
    await reportReviewValidationFailure(config, repairRequest, repairedParsed.errors, repairedRawOutput, 2);
    const details = repairedParsed.errors.map((error) => `${error.path} ${error.message}`).join("；");
    throw new Error(`模型输出经一次协议修复仍未通过 Skill 校验：${details}`);
  }

  return {
    output: repairedParsed.output,
    rawOutput: repairedRawOutput,
    usages: [firstResponse.usage, repairedResponse.usage],
    retried: true,
    request: repairRequest,
  };
}

async function callExternalReviewSkillWithQualityPass(
  draftRequest: ReviewAnalysisRequest,
  sources: IntakeSource[],
  vaultContext: VaultKnowledgeContext | null,
  config: ReviewSkillRunnerConfig,
) {
  const draftResult = await callExternalReviewSkillUntilValid(draftRequest, sources, config);
  const finalRequest = createReviewAnalysisRequest(sources, vaultContext, {
    reviewMode: "final-pass",
    previousAnalysisPlan: draftResult.output,
  });

  try {
    const finalResult = await callExternalReviewSkillUntilValid(finalRequest, sources, config);

    return {
      ...finalResult,
      usages: [...draftResult.usages, ...finalResult.usages],
      retried: draftResult.retried || finalResult.retried,
    };
  } catch (error) {
    return {
      ...draftResult,
      qualityFallbackToDraft: true,
      qualityFallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildExternalReviewMessage(
  result: Awaited<ReturnType<typeof callExternalReviewSkillUntilValid>>,
  qualityPasses: 1 | 2,
) {
  if (qualityPasses === 2) {
    if (result.qualityFallbackToDraft) {
      return `外部模型第一轮审理完成，第二轮复审未通过协议校验，已保留第一轮有效结果：${result.qualityFallbackReason}`;
    }

    return result.retried
      ? "外部模型二轮复审完成，期间有输出未通过协议校验并已自动重试。"
      : "外部模型二轮复审完成，已采用第二轮定稿结果。";
  }

  return result.retried
    ? "外部模型第一次输出未通过协议校验，已自动重试并通过 lifemind.review.v2 校验。"
    : "外部模型审理完成，输出已通过 lifemind.review.v2 校验。";
}

function runLocalReviewSkill(
  sources: IntakeSource[],
  request: ReviewAnalysisRequest,
  vaultContext: VaultKnowledgeContext | null,
  message: string,
  usedFallback: boolean,
): ReviewSkillRunResult {
  return {
    batch: createReviewBatch(sources, {
      vaultContext,
    }),
    provider: "local",
    usedFallback,
    request,
    usage: null,
    message,
  };
}

async function callExternalReviewSkill(
  request: ReviewAnalysisRequest,
  config: ReviewSkillRunnerConfig,
) {
  const preset = getReviewModelProviderPreset(config.provider);
  const baseUrl = (config.baseUrl || preset?.baseUrl || "").trim();
  const apiKey = config.apiKey?.trim();
  const model = (config.model || preset?.model || "").trim();
  const apiFormat = config.apiFormat || preset?.apiFormat || "deepseek-strict-tools";

  if (!baseUrl) throw new Error("缺少模型 API base URL。");
  if (!apiKey) throw new Error("缺少模型 API Key。");
  if (!model) throw new Error("缺少模型名称。");

  const systemPrompt = buildReviewSkillSystemPrompt();

  if (config.modelInvoker) {
    return normalizeModelInvocation(
      await config.modelInvoker({
        baseUrl,
        apiKey,
        model,
        apiFormat,
        systemPrompt,
        request,
        maxOutputTokens: normalizeMaxOutputTokens(config.maxOutputTokens, request.reviewMode),
        tool: deepSeekReviewTool,
      }),
    );
  }

  if (apiFormat !== "deepseek-strict-tools") {
    throw new Error("当前仅支持 DeepSeek Strict Tool Call。");
  }

  const fetcher = config.fetcher ?? fetch;
  const maxOutputTokens = normalizeMaxOutputTokens(config.maxOutputTokens, request.reviewMode);
  const response = await fetcher(buildChatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      temperature: 0,
      tools: [deepSeekReviewTool],
      thinking: { type: "disabled" },
      tool_choice: {
        type: "function",
        function: { name: deepSeekReviewTool.function.name },
      },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: buildModelUserContent(request),
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => null)) as OpenAICompatibleResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `模型请求失败：HTTP ${response.status}`);
  }

  if (!payload) {
    throw new Error("模型响应不是合法 JSON。");
  }

  return {
    output: extractDeepSeekToolArguments(payload, deepSeekReviewTool.function.name),
    usage: normalizeOpenAICompatibleUsage(payload?.usage),
  };
}

function buildModelUserContent(request: ReviewAnalysisRequest) {
  const { pdfEvidenceImages, ...textRequest } = request;

  if (!pdfEvidenceImages?.length) return JSON.stringify(textRequest);

  const imageContext = pdfEvidenceImages
    .map((image) => {
      const kind = image.kind === "embedded" ? "PDF 内嵌图片" : "PDF 页面渲染图（仅供审理）";
      const position = image.kind === "embedded"
        ? `，位置 x=${image.x ?? 0}、y=${image.y ?? 0}、width=${image.width ?? 0}、height=${image.height ?? 0}`
        : "";
      return `${kind}：资产 ${image.assetId}，来源 ${image.sourceId}，第 ${image.page} 页${position}。`;
    })
    .join("\n");

  return [
    { type: "text", text: `${JSON.stringify(textRequest)}\n\n${imageContext}` },
    ...pdfEvidenceImages.map((image) => ({
      type: "image_url",
      image_url: { url: image.imageDataUrl },
    })),
  ];
}

export function getReviewModelProviderPreset(provider: ReviewSkillProvider) {
  return reviewModelProviderPresets.find((preset) => preset.provider === provider) ?? null;
}

function buildChatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const deepseekUrl = buildDeepSeekChatCompletionsUrl(trimmed);

  if (deepseekUrl) return deepseekUrl;
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;

  return `${trimmed}/v1/chat/completions`;
}

function buildDeepSeekChatCompletionsUrl(trimmedBaseUrl: string) {
  try {
    const url = new URL(trimmedBaseUrl);

    if (url.hostname !== "api.deepseek.com") return null;

    return `${url.origin}/beta/chat/completions`;
  } catch {
    return null;
  }
}

function normalizeMaxOutputTokens(value: number | undefined, reviewMode?: ReviewAnalysisRequest["reviewMode"]) {
  if (!Number.isFinite(value)) {
    if (reviewMode === "repair-pass") return DEFAULT_REPAIR_MAX_OUTPUT_TOKENS;
    return reviewMode === "draft-pass" ? DEFAULT_DRAFT_MAX_OUTPUT_TOKENS : DEFAULT_FINAL_MAX_OUTPUT_TOKENS;
  }

  return Math.min(384_000, Math.max(512, Math.floor(value as number)));
}

function isJsonSyntaxValidationFailure(errors: Array<{ path: string; message: string }>) {
  return errors.some(
    (error) =>
      error.path === "$" &&
      /(?:JSON|json|解析|parse|Expected|Unexpected|end of input|position)/u.test(error.message),
  );
}

function buildRepairPreviousOutput(rawOutput: string, syntaxFailure: boolean) {
  if (!syntaxFailure) return rawOutput;

  const compactPrefix = rawOutput.trim().slice(0, 360);
  const compactSuffix = rawOutput.trim().slice(-240);

  return [
    "上一轮工具调用参数无法解析，疑似在生成过程中被截断。",
    "不要修补、复述或延续这段损坏参数，请基于原始 sources 重新生成完整 JSON。",
    compactPrefix ? `损坏参数开头片段：${compactPrefix}` : "",
    compactSuffix && compactSuffix !== compactPrefix ? `损坏参数结尾片段：${compactSuffix}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeModelInvocation(value: string | ReviewModelInvocation): ReviewModelInvocation {
  if (typeof value === "string") return { output: value };

  if (!value || typeof value.output !== "string" || !value.output.trim()) {
    throw new Error("模型调用器返回了空的审理结果。");
  }

  return {
    output: value.output,
    usage: value.usage ? normalizeReviewModelUsage(value.usage) : undefined,
  };
}

function normalizeOpenAICompatibleUsage(
  usage: OpenAICompatibleResponse["usage"] | undefined,
): ReviewModelUsage | undefined {
  if (!usage) return undefined;

  return normalizeReviewModelUsage({
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    promptCacheHitTokens: usage.prompt_cache_hit_tokens ?? 0,
    promptCacheMissTokens: usage.prompt_cache_miss_tokens ?? 0,
    reasoningTokens: usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0,
  });
}

function normalizeReviewModelUsage(usage: ReviewModelUsage): ReviewModelUsage {
  const promptTokens = nonNegativeInteger(usage.promptTokens);
  const completionTokens = nonNegativeInteger(usage.completionTokens);
  const totalTokens = nonNegativeInteger(usage.totalTokens) || promptTokens + completionTokens;
  const promptCacheHitTokens = nonNegativeInteger(usage.promptCacheHitTokens);
  const explicitMissTokens = nonNegativeInteger(usage.promptCacheMissTokens);
  const promptCacheMissTokens =
    explicitMissTokens || (promptTokens > promptCacheHitTokens ? promptTokens - promptCacheHitTokens : 0);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
    reasoningTokens: nonNegativeInteger(usage.reasoningTokens),
  };
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getDeepSeekBillingPeriod(now = new Date()): ReviewBillingPeriod {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const workday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday ?? "");
  const peak = workday && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));

  return peak ? "peak" : "off-peak";
}

function getDeepSeekPricing(model: string, period: ReviewBillingPeriod) {
  const peak = period === "peak";
  const flash = /flash/i.test(model);

  if (flash) {
    return {
      cacheHitInputCnyPerMillion: peak ? 0.1 : 0.05,
      cacheMissInputCnyPerMillion: peak ? 3 : 1.5,
      outputCnyPerMillion: peak ? 9 : 4.5,
    };
  }

  return {
    cacheHitInputCnyPerMillion: peak ? 0.3 : 0.15,
    cacheMissInputCnyPerMillion: peak ? 9 : 4.5,
    outputCnyPerMillion: peak ? 27 : 13.5,
  };
}

function extractDeepSeekToolArguments(payload: OpenAICompatibleResponse, expectedToolName: string) {
  const toolCall = payload.choices?.[0]?.message?.tool_calls?.find(
    (candidate) => candidate.type === "function" && candidate.function?.name === expectedToolName,
  );
  const argumentsText = toolCall?.function?.arguments?.trim();

  if (!argumentsText) {
    throw new Error(`DeepSeek 响应缺少 ${expectedToolName} 工具调用参数，未接受普通 message.content。`);
  }

  return argumentsText;
}

async function reportReviewValidationFailure(
  config: ReviewSkillRunnerConfig,
  request: ReviewAnalysisRequest,
  errors: Array<{ path: string; message: string }>,
  rawOutput: string,
  attempt: number,
) {
  if (!config.diagnosticLogger) return;

  try {
    await config.diagnosticLogger({
      provider: "deepseek",
      model: (config.model || getReviewModelProviderPreset("deepseek")?.model || "").trim(),
      stage: "skill-validation",
      attempt,
      responseLength: rawOutput.length,
      requestSummary: buildReviewDiagnosticRequestSummary(config, request),
      rawOutputPreview: rawOutput.trim().slice(0, 800),
      errors,
    });
  } catch {
    // 诊断日志不可用时不能阻断模型修复和审理结果。
  }
}

function buildReviewDiagnosticRequestSummary(
  config: ReviewSkillRunnerConfig,
  request: ReviewAnalysisRequest,
): ReviewDiagnosticEvent["requestSummary"] {
  return {
    apiFormat: config.apiFormat ?? getReviewModelProviderPreset("deepseek")?.apiFormat ?? "deepseek-strict-tools",
    protocolVersion: request.protocolVersion,
    ...(request.reviewMode ? { reviewMode: request.reviewMode } : {}),
    sourceCount: request.sources.length,
    toolChoice: deepSeekReviewTool.function.name,
    thinking: "disabled",
    sourceStructure: (request.sourceStructure ?? []).map((structure) => ({
      sourceId: structure.sourceId,
      lineCount: structure.lineCount,
      characterCount: structure.characterCount,
      codeBlockCount: structure.codeBlockCount,
      markerCount: structure.markers.length,
      markerCounts: structure.markerCounts,
      firstMarkers: structure.markers.slice(0, 8).map((marker) => ({
        level: marker.level,
        kind: marker.kind,
        label: marker.label,
        line: marker.line,
      })),
    })),
  };
}
