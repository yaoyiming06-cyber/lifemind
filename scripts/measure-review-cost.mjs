import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), "lifemind-cost-"));
const bundledRunner = join(tempRoot, "runner.mjs");

try {
  execFileSync(
    join(projectRoot, "node_modules/.bin/esbuild"),
    [
      join(projectRoot, "src/lib/lifemind-review-runner.ts"),
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${bundledRunner}`,
    ],
    { stdio: "inherit" },
  );

  const { runReviewSkill } = await import(pathToFileURL(bundledRunner).href);
  const report = [];

  await runScenario({
    label: "当前桌面正式审理：两轮质量审理，响应全部合格",
    qualityPasses: 2,
    sourceContent: buildSourceContent(1400),
    vaultContext: buildVaultContext(80),
    runReviewSkill,
    report,
  });

  await runScenario({
    label: "单轮审理对照组",
    qualityPasses: 1,
    sourceContent: buildSourceContent(1400),
    vaultContext: buildVaultContext(80),
    runReviewSkill,
    report,
  });

  await runScenario({
    label: "当前桌面正式审理：第一轮协议失败后自动修复",
    qualityPasses: 2,
    sourceContent: buildSourceContent(1400),
    vaultContext: buildVaultContext(80),
    invalidFirstResponse: true,
    runReviewSkill,
    report,
  });

  printReport(report);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runScenario(options) {
  const requests = [];
  let callNumber = 0;

  const fetcher = async (_input, init) => {
    callNumber += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const request = JSON.parse(body.messages?.[1]?.content ?? "{}");
    const systemPrompt = body.messages?.[0]?.content ?? "";
    const toolSchema = JSON.stringify(body.tools ?? []);
    const userRequest = body.messages?.[1]?.content ?? "";
    const invalid =
      options.invalidFirstResponse &&
      callNumber === 1;

    requests.push({
      number: callNumber,
      reviewMode: request.reviewMode ?? "未指定",
      systemChars: systemPrompt.length,
      toolChars: toolSchema.length,
      userChars: userRequest.length,
      bodyChars: JSON.stringify(body).length,
      roughInputTokens: roughTokenCount(`${systemPrompt}${toolSchema}${userRequest}`),
      sourceChars: request.sources?.reduce((sum, source) => sum + String(source.content ?? "").length, 0) ?? 0,
      vaultChars: JSON.stringify(request.vaultContext ?? null).length,
      previousPlanChars: JSON.stringify(request.previousAnalysisPlan ?? null).length,
      repairChars: JSON.stringify(request.protocolRepair ?? null).length,
      thinking: JSON.stringify(body.thinking ?? null),
      reasoningEffort: body.reasoning_effort ?? null,
      maxOutputTokens: body.max_tokens ?? null,
    });

    const output = invalid
      ? {
          protocolVersion: "lifemind.review.v2",
          stackDecisions: [],
          sections: [],
          relations: [],
          corrections: [],
          uncertain: [],
        }
      : buildValidPlan(request);

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
                    arguments: JSON.stringify(output),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: requests.at(-1).roughInputTokens,
          prompt_cache_hit_tokens: Math.floor(requests.at(-1).roughInputTokens * 0.7),
          prompt_cache_miss_tokens: Math.ceil(requests.at(-1).roughInputTokens * 0.3),
          completion_tokens: roughTokenCount(JSON.stringify(output)),
          total_tokens:
            requests.at(-1).roughInputTokens +
            roughTokenCount(JSON.stringify(output)),
          completion_tokens_details: {
            reasoning_tokens: 0,
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await options.runReviewSkill(
    [
      {
        id: "cost-repro-source",
        title: "Git 学习记录",
        type: "text",
        stackHint: "Git",
        content: options.sourceContent,
      },
    ],
    {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "redacted-test-key",
      model: "deepseek-v4-pro",
      fallbackToLocal: false,
      qualityPasses: options.qualityPasses,
      vaultContext: options.vaultContext,
      fetcher,
    },
  );

  options.report.push({
    label: options.label,
    calls: requests.length,
    requests,
    totalBodyChars: requests.reduce((sum, request) => sum + request.bodyChars, 0),
    totalRoughInputTokens: requests.reduce((sum, request) => sum + request.roughInputTokens, 0),
    totalSourceChars: requests.reduce((sum, request) => sum + request.sourceChars, 0),
    totalVaultChars: requests.reduce((sum, request) => sum + request.vaultChars, 0),
    totalPreviousPlanChars: requests.reduce((sum, request) => sum + request.previousPlanChars, 0),
    totalRepairChars: requests.reduce((sum, request) => sum + request.repairChars, 0),
    usage: result.usage,
  });
}

function buildValidPlan(request) {
  const source = request.sources?.[0];
  const sourceId = source?.id ?? "cost-repro-source";
  const stack = source?.stackHint?.split(/[\\/]/)[0]?.trim() || "Git";

  return {
    protocolVersion: "lifemind.review.v2",
    stackDecisions: [
      {
        sourceId,
        name: stack,
        confidence: "高",
        evidence: ["测试输入中的技术栈提示"],
      },
    ],
    sections: [
      {
        id: `${sourceId}-overview`,
        sourceId,
        title: "Git 工具总览",
        role: "总览",
        grain: "大颗粒度",
        path: ["Git 工具"],
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: "Git 用于管理版本和协作流程。",
        evidence: ["测试输入"],
      },
    ],
    relations: [],
    corrections: [],
    uncertain: [],
  };
}

function buildSourceContent(targetLength) {
  const paragraph =
    "Git 用于记录项目变化，分支用于隔离功能开发，提交用于保存阶段性成果，Pull Request 用于协作审查和合并。";
  return Array.from({ length: Math.ceil(targetLength / paragraph.length) }, () => paragraph)
    .join("\n")
    .slice(0, targetLength);
}

function buildVaultContext(noteCount) {
  const notes = Array.from({ length: noteCount }, (_, index) => ({
    title: `Git 知识 ${index + 1}`,
    path: `Git/Git 工具/知识 ${index + 1}.md`,
    root: "Git",
    headings: ["基本概念", "应用步骤"],
    snippet: "既有 Vault 中的 Git 知识摘要，用于判断新笔记与既有结构的关系。",
    modifiedAt: 1760000000 + index,
  }));

  return {
    roots: [
      {
        name: "Git",
        noteCount,
        paths: ["Git", "Git/Git 工具", "Git/Git 工具/基本概念", "Git/Git 工具/应用步骤"],
      },
    ],
    notes,
    relations: notes.slice(1).map((note) => ({
      type: "包含",
      source: "Git 工具总览",
      target: note.title,
      evidence: "测试 Vault 目录关系",
    })),
  };
}

function roughTokenCount(text) {
  let tokens = 0;

  for (const character of text) {
    if (/[\u4e00-\u9fff]/u.test(character)) {
      tokens += 0.6;
    } else if (/[A-Za-z0-9]/u.test(character)) {
      tokens += 0.3;
    } else {
      tokens += 0.6;
    }
  }

  return Math.ceil(tokens);
}

function printReport(report) {
  console.log("LifeMind 当前审理成本复现（本地 mock，不会访问真实 API）");
  console.log("=".repeat(72));

  for (const scenario of report) {
    console.log(`\n${scenario.label}`);
    console.log(`API 请求次数：${scenario.calls}`);
    console.log(`累计请求体字符数：${scenario.totalBodyChars}`);
    console.log(`粗略输入 token：${scenario.totalRoughInputTokens}`);
    console.log(`重复发送原文字符数：${scenario.totalSourceChars}`);
    console.log(`发送 Vault 上下文字符数：${scenario.totalVaultChars}`);
    console.log(`发送上一轮分析计划字符数：${scenario.totalPreviousPlanChars}`);
    console.log(`发送协议修复内容字符数：${scenario.totalRepairChars}`);
    console.log(
      `mock usage 汇总：${
        scenario.usage
          ? `${scenario.usage.requestCount} 次 / ${scenario.usage.totalTokens} tokens / 约 ¥${scenario.usage.estimatedCostCny.toFixed(4)}`
          : "当前响应未携带 usage"
      }`,
    );

    for (const request of scenario.requests) {
      console.log(
        [
          `  #${request.number}`,
          request.reviewMode,
          `body=${request.bodyChars} chars`,
          `input≈${request.roughInputTokens} tok`,
          `source=${request.sourceChars}`,
          `vault=${request.vaultChars}`,
          `previous=${request.previousPlanChars}`,
          `repair=${request.repairChars}`,
          `thinking=${request.thinking}`,
          `reasoning=${request.reasoningEffort ?? "none"}`,
          `max_tokens=${request.maxOutputTokens}`,
        ].join(" | "),
      );
    }
  }

  const twoPass = report[0];
  const onePass = report[1];
  const retryPass = report[2];

  console.log("\n关键结论");
  console.log(`两轮相对单轮的请求次数：${onePass.calls} -> ${twoPass.calls}，约增加 ${twoPass.calls / onePass.calls} 倍。`);
  console.log(
    `协议修复场景相对正常两轮：${twoPass.calls} -> ${retryPass.calls}，额外增加 ${retryPass.calls - twoPass.calls} 次请求。`,
  );
  console.log("mock usage 只是为了验证 runner 的汇总链路，不代表真实模型输出；真实计费以 DeepSeek API 返回的 usage 为准。");
}
