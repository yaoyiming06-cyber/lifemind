import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalLogicLinkUpdateDraft,
  createLogicLinkUpdateRequest,
  mergeLogicLinkModelOutput,
  type LogicLinkUpdateModelOutput,
} from "./lifemind-link-update";
import type { VaultKnowledgeContext } from "./lifemind-core";

const context: VaultKnowledgeContext = {
  roots: [
    {
      name: "TI嵌入式",
      noteCount: 4,
      paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/PWM"],
    },
  ],
  notes: [
    {
      title: "PWM",
      path: "TI嵌入式/MSPM0G3507/PWM/PWM.md",
      root: "TI嵌入式",
      headings: ["基本概念"],
      snippet: "PWM 用于通过占空比控制输出。",
      modifiedAt: 1_000,
    },
    {
      title: "PWM 计数模式",
      path: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md",
      root: "TI嵌入式",
      headings: ["边缘对齐", "中心对齐"],
      snippet: "PWM 支持边缘向上、边缘向下和中心对齐计数模式。",
      modifiedAt: 2_000,
    },
    {
      title: "PWM 占空比",
      path: "TI嵌入式/MSPM0G3507/PWM/PWM 占空比.md",
      root: "TI嵌入式",
      headings: ["定义"],
      snippet: "占空比表示高电平时间在周期中的比例。",
      modifiedAt: 3_000,
    },
    {
      title: "GPIO 接口",
      path: "TI嵌入式/MSPM0G3507/GPIO/GPIO 接口.md",
      root: "TI嵌入式",
      headings: ["基本概念"],
      snippet: "GPIO 用于通用输入输出。",
      modifiedAt: 900,
    },
  ],
  relations: [],
};

describe("lifemind logic link update", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates time-scoped child branch suggestions from local vault ordering", () => {
    const draft = createLocalLogicLinkUpdateDraft(context, {
      now: 3_500,
      range: { kind: "recent", seconds: 2_000 },
    });

    expect(draft.suggestions.map((item) => [item.parentTitle, item.childTitle])).toEqual([
      ["PWM", "PWM 计数模式"],
      ["PWM", "PWM 占空比"],
    ]);
    expect(draft.suggestions[0]).toMatchObject({
      relationType: "包含",
      parentPath: "TI嵌入式/MSPM0G3507/PWM/PWM.md",
      childPath: "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md",
      source: "time-script",
    });
  });

  it("skips suggestions already represented by existing contains relations", () => {
    const draft = createLocalLogicLinkUpdateDraft(
      {
        ...context,
        relations: [
          {
            type: "包含",
            source: "PWM",
            target: "PWM 计数模式",
            evidence: "后续枝节：[[PWM 计数模式]]",
          },
        ],
      },
      {
        now: 3_500,
        range: { kind: "recent", seconds: 2_000 },
      },
    );

    expect(draft.suggestions.map((item) => item.childTitle)).toEqual(["PWM 占空比"]);
  });

  it("lets model output reorder and filter only locally generated candidate links", () => {
    const draft = createLocalLogicLinkUpdateDraft(context, {
      now: 3_500,
      range: { kind: "recent", seconds: 2_000 },
    });
    const request = createLogicLinkUpdateRequest(draft);
    const modelOutput: LogicLinkUpdateModelOutput = {
      protocolVersion: "lifemind.logic-links.v1",
      accepted: [
        {
          candidateId: draft.suggestions[1].id,
          reason: "占空比通常先于具体计数模式理解，逻辑顺序更靠前。",
        },
        {
          candidateId: "not-a-real-candidate",
          reason: "模型不能新增不在候选集里的边。",
        },
      ],
    };

    const merged = mergeLogicLinkModelOutput(draft, modelOutput);

    expect(request.candidates).toHaveLength(2);
    expect(merged.suggestions.map((item) => item.childTitle)).toEqual(["PWM 占空比"]);
    expect(merged.suggestions[0].source).toBe("llm");
    expect(merged.suggestions[0].reason).toContain("占空比通常先于具体计数模式");
  });

  it("includes note semantic context in model review candidates", () => {
    const draft = createLocalLogicLinkUpdateDraft(context, {
      now: 3_500,
      range: { kind: "recent", seconds: 2_000 },
    });
    const request = createLogicLinkUpdateRequest(draft);

    expect(request.candidates[0]).toMatchObject({
      parentHeadings: ["基本概念"],
      childHeadings: ["边缘对齐", "中心对齐"],
      parentSnippet: "PWM 用于通过占空比控制输出。",
      childSnippet: "PWM 支持边缘向上、边缘向下和中心对齐计数模式。",
    });
  });

  it("creates distinct draft ids for repeated generations inside the same second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.120Z"));

    const first = createLocalLogicLinkUpdateDraft(context, {
      range: { kind: "recent", seconds: 2_000 },
    });

    vi.setSystemTime(new Date("2026-07-16T12:00:00.450Z"));

    const second = createLocalLogicLinkUpdateDraft(context, {
      range: { kind: "recent", seconds: 2_000 },
    });

    expect(first.id).not.toBe(second.id);
  });
});
