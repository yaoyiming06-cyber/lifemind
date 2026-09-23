import { describe, expect, it } from "vitest";
import {
  estimateDeepSeekCost,
  runReviewSkill,
  summarizeReviewUsage,
  type OpenAICompatibleModelRequest,
  type ReviewModelUsage,
} from "./lifemind-review-runner";

const source = {
  id: "cost-test-source",
  title: "Git 学习记录",
  type: "text" as const,
  stackHint: "Git",
  content: "Git 用于版本管理，分支用于隔离功能开发，提交用于保存阶段性成果。",
};

function createPlan() {
  return {
    protocolVersion: "lifemind.review.v2",
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

function responseFor(usage: Record<string, unknown>) {
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
                  arguments: JSON.stringify(createPlan()),
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
    expect(bodies[0].max_tokens).toBe(6000);
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
