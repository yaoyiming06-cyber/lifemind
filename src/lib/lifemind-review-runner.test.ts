import { describe, expect, it } from "vitest";
import {
  deepSeekReviewTool,
  estimateDeepSeekCost,
  reviewModelProviderPresets,
  runReviewSkill,
  summarizeReviewUsage,
  type OpenAICompatibleModelRequest,
  type ReviewModelUsage,
} from "./lifemind-review-runner";
import type { IntakeSource } from "./lifemind-core";

const source = {
  id: "cost-test-source",
  title: "Git 学习记录",
  type: "text" as const,
  stackHint: "Git",
  content: "Git 用于版本管理，分支用于隔离功能开发，提交用于保存阶段性成果。",
};

describe("DeepSeek model defaults", () => {
  it("uses the current DeepSeek Flash model name", () => {
    expect(reviewModelProviderPresets[0]?.model).toBe("deepseek-flash");
  });
});

function createPlan(sourceOverride: { id: string; type: "text" | "pdf" } = source) {
  const pageCoverage =
    sourceOverride.type === "pdf"
      ? [
          {
            sourceId: sourceOverride.id,
            page: 2,
            status: "covered",
            sectionIds: [],
            evidenceIds: ["pdf-page-2-text-1"],
            summary: "第 2 页页面图像已发送并完成覆盖审理。",
          },
        ]
      : [];

  return {
    protocolVersion: "lifemind.review.v2",
    pageCoverage,
    stackDecisions: [
      {
        sourceId: source.id,
        name: "Git",
        confidence: "高",
        evidence: ["用户技术栈提示"],
      },
    ],
    sections: [
      {
        id: `${source.id}-overview`,
        sourceId: source.id,
        title: "Git 工具总览",
        role: "总览",
        grain: "大颗粒度",
        path: ["Git 工具"],
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: "Git 用于版本管理。",
        evidence: ["原文"],
      },
    ],
    relations: [],
    corrections: [],
    uncertain: [],
  };
}

function responseFor(
  usage: Record<string, unknown>,
  sourceOverride?: { id: string; type: "text" | "pdf" },
  planOverride?: unknown,
) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "submit_review_plan",
                  arguments: JSON.stringify(planOverride ?? createPlan(sourceOverride)),
                },
              },
            ],
          },
        },
      ],
      usage,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("review usage accounting", () => {
  it("accepts model placements for extracted PDF images and writes only that image", async () => {
    const source: IntakeSource = {
      id: "pdf-image-source",
      title: "信号处理讲义",
      type: "pdf",
      stackHint: "信号处理",
      content: "PDF 页面视觉证据",
      pdfEvidence: {
        pages: [{
          page: 1,
          imageWidth: 1200,
          imageHeight: 1600,
          imageReviewRequired: true,
          imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
          evidence: [],
        }],
        images: [{
          assetId: "pdf-image-pdf-image-source-page-1-1",
          page: 1,
          imageWidth: 320,
          imageHeight: 180,
          x: 0.125,
          y: 0.25,
          width: 0.5,
          height: 0.25,
          imageDataUrl: "data:image/png;base64,aW1hZ2U=",
        }],
      },
    };
    const plan = {
      protocolVersion: "lifemind.review.v2",
      pageCoverage: [{
        sourceId: source.id,
        page: 1,
        status: "covered",
        sectionIds: ["filter-response"],
        evidenceIds: [],
        summary: "第 1 页已审理。",
      }],
      stackDecisions: [{ sourceId: source.id, name: "信号处理", confidence: "高", evidence: ["用户技术栈提示"] }],
      sections: [{
        id: "filter-response",
        sourceId: source.id,
        title: "滤波器响应",
        role: "基本原理",
        grain: "中颗粒度",
        placement: { mode: "new-root", parentNodeId: null, branchName: "滤波器响应", targetNodeId: null },
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: "频率响应如下图所示。",
        formulas: [],
        imagePlacements: [{
          assetId: "pdf-image-pdf-image-source-page-1-1",
          sourcePage: 1,
          placement: "after-section",
          anchor: null,
          caption: "频率响应曲线",
          alt: "滤波器频率响应",
          confidence: "高",
        }],
        evidence: ["第 1 页图表"],
      }],
      relations: [],
      corrections: [],
      uncertain: [],
    };

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-flash",
      fallbackToLocal: false,
      modelInvoker: async () => JSON.stringify(plan),
    });

    expect(result.request.pdfEvidenceImages?.map((image) => image.kind)).toEqual(["page", "embedded"]);
    expect(result.batch.notes[0]?.markdown).toContain("![[附件/PDF图片/pdf-image-pdf-image-source-page-1-1.png]]");
    expect(result.batch.notes[0]?.markdown).not.toContain("附件/PDF页面");
  });

  it("sends PDF pages as image blocks without forwarding OCR text as model evidence", async () => {
    let requestBody: Record<string, unknown> | null = null;
    let requestCount = 0;
    const pdfSource = {
      ...source,
      type: "pdf" as const,
      pdfEvidence: {
        pages: [
          {
            page: 2,
            imageWidth: 1600,
            imageHeight: 2200,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [
              {
                id: "pdf-page-2-ocr-1",
                text: "E=mc^2",
                source: "vision-ocr",
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.05,
                confidence: 0.42,
                candidates: ["E=mc²"],
              },
              {
                id: "pdf-page-2-text-1",
                text: "第 2 页",
                source: "pdf-text",
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                confidence: 1,
                candidates: [],
              },
            ],
          },
        ],
      },
    };
    const pdfPlan = createPlan(pdfSource);
    pdfPlan.pageCoverage[0]!.evidenceIds = ["pdf-page-cost-test-source-page-2"];

    await runReviewSkill([pdfSource], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-flash",
      fallbackToLocal: false,
      fetcher: async (_input, init) => {
        requestCount += 1;
        requestBody = JSON.parse(String(init?.body ?? "{}"));
        return responseFor({}, pdfSource, pdfPlan);
      },
    });

    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    const userMessage = messages.find((message) => message.role === "user");
    const blocks = userMessage?.content as Array<Record<string, unknown>>;
    expect(blocks[0]?.type).toBe("text");
    expect(String(blocks[0]?.text)).toContain("pdf-page-2-text-1");
    expect(String(blocks[0]?.text)).not.toContain("pdf-page-2-ocr-1");
    expect(String(blocks[0]?.text)).not.toContain("vision-ocr");
    expect(String(blocks[0]?.text)).not.toContain("data:image/jpeg;base64");
    expect(String(blocks[0]?.text)).toContain("pdf-page-cost-test-source-page-2");
    expect(requestBody?.max_tokens).toBe(10_000);
    expect(requestCount).toBe(1);
    expect(blocks[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,aW1hZ2U=" },
    });
  });

  it("uses the Strict Tool Calling nullable schema form supported by DeepSeek", () => {
    const properties = deepSeekReviewTool.function.parameters.properties as Record<string, unknown>;
    const sections = properties.sections as { items: { properties: Record<string, unknown> } };
    const placement = sections.items.properties.placement as { properties: Record<string, unknown> };
    const parentNodeId = placement.properties.parentNodeId as Record<string, unknown>;

    expect(parentNodeId).toHaveProperty("anyOf", [
      { type: "string" },
      { type: "null" },
    ]);
  });

  it("exposes page coverage, formula, and image placement fields in the strict review schema", () => {
    const parameters = deepSeekReviewTool.function.parameters as {
      properties: {
        pageCoverage: unknown;
        sections: { items: { properties: Record<string, unknown> } };
      };
    };
    const sectionProperties = parameters.properties.sections.items.properties;

    expect(parameters.properties.pageCoverage).toBeTruthy();
    expect(sectionProperties.formulas).toBeTruthy();
    expect(sectionProperties.imagePlacements).toBeTruthy();
  });

  it("calculates DeepSeek V4 Pro cost from cache and completion usage", () => {
    const usage: ReviewModelUsage = {
      promptTokens: 100,
      completionTokens: 80,
      totalTokens: 180,
      promptCacheHitTokens: 40,
      promptCacheMissTokens: 60,
      reasoningTokens: 50,
    };

    expect(estimateDeepSeekCost("deepseek-v4-pro", usage, "off-peak")).toBeCloseTo(
      (40 * 0.15 + 60 * 4.5 + 80 * 13.5) / 1_000_000,
      12,
    );
  });

  it("returns aggregated usage and request count for a two-pass review", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const usages = [
      {
        prompt_tokens: 100,
        completion_tokens: 80,
        total_tokens: 180,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 80,
        completion_tokens_details: { reasoning_tokens: 50 },
      },
      {
        prompt_tokens: 120,
        completion_tokens: 90,
        total_tokens: 210,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 40,
        completion_tokens_details: { reasoning_tokens: 60 },
      },
    ];
    let callNumber = 0;

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-v4-pro",
      fallbackToLocal: false,
      qualityPasses: 2,
      fetcher: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        const response = responseFor(usages[callNumber]);
        callNumber += 1;
        return response;
      },
    });

    expect(result.usage).toMatchObject({
      requestCount: 2,
      promptTokens: 220,
      completionTokens: 170,
      totalTokens: 390,
      promptCacheHitTokens: 100,
      promptCacheMissTokens: 120,
      reasoningTokens: 110,
    });
    expect(result.usage?.estimatedCostCny).toBeGreaterThan(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].max_tokens).toBe(10_000);
    expect(bodies[1].max_tokens).toBe(10000);
    expect(bodies[0].thinking).toEqual({ type: "disabled" });
    expect(bodies[1].thinking).toEqual({ type: "disabled" });
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].reasoning_effort).toBeUndefined();
    for (const body of bodies) {
      expect(body.tool_choice).toEqual({
        type: "function",
        function: { name: "submit_review_plan" },
      });
      expect((body.tools as Array<{ function: { strict: boolean } }>)[0].function.strict).toBe(true);
    }
  });

  it("uses a compact repair pass after a truncated tool-call JSON response", async () => {
    const requests: Array<OpenAICompatibleModelRequest> = [];
    const truncatedOutput = `{"protocolVersion":"lifemind.review.v2","sections":[${"x".repeat(20_000)}`;

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-v4-pro",
      fallbackToLocal: false,
      qualityPasses: 2,
      modelInvoker: async (payload) => {
        requests.push(payload);

        if (requests.length === 1) {
          return truncatedOutput;
        }

        if (payload.request.protocolRepair) {
          expect(payload.request.reviewMode).toBe("repair-pass");
          expect(payload.request.protocolRepair.previousOutput.length).toBeLessThan(1_000);
          expect(payload.request.constraints.join("\n")).toContain("紧凑");
          return JSON.stringify(createPlan());
        }

        expect(payload.request.reviewMode).toBe("final-pass");
        return JSON.stringify(createPlan());
      },
    });

    expect(requests.map((request) => request.request.reviewMode)).toEqual([
      "draft-pass",
      "repair-pass",
      "final-pass",
    ]);
    expect(result.batch.notes[0].title).toBe("Git 工具总览");
  });

  it("accepts usage returned by the desktop model bridge", async () => {
    const usage: ReviewModelUsage = {
      promptTokens: 90,
      completionTokens: 70,
      totalTokens: 160,
      promptCacheHitTokens: 10,
      promptCacheMissTokens: 80,
      reasoningTokens: 40,
    };

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-v4-pro",
      fallbackToLocal: false,
      modelInvoker: async () => ({
        output: JSON.stringify(createPlan()),
        usage,
      }),
    });

    expect(result.usage).toMatchObject({
      requestCount: 1,
      promptTokens: 90,
      completionTokens: 70,
      reasoningTokens: 40,
    });
  });

  it("keeps actual request count when one attempt has no usage payload", () => {
    const usage: ReviewModelUsage = {
      promptTokens: 90,
      completionTokens: 70,
      totalTokens: 160,
      promptCacheHitTokens: 10,
      promptCacheMissTokens: 80,
      reasoningTokens: 40,
    };

    expect(
      summarizeReviewUsage("deepseek-v4-pro", [usage, undefined], new Date("2026-08-31T03:00:00+08:00")),
    ).toMatchObject({
      requestCount: 2,
      usageAvailable: false,
      totalTokens: 160,
    });
  });
});
