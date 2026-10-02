import { describe, expect, it } from "vitest";
import {
  REVIEW_ANALYSIS_PROTOCOL_VERSION,
  REVIEW_SKILL_PROTOCOL_VERSION,
  buildBatchPreviewRoot,
  buildPreviewFiles,
  buildVaultMoveFiles,
  buildVaultWriteFiles,
  buildReviewSkillSystemPrompt,
  buildVaultKnowledgeIndex,
  createReviewBatchFromSkillOutput,
  createReviewBatchFromAnalysisPlan,
  createReviewAnalysisRequest,
  createReviewSkillRequest,
  createReviewBatch,
  noteVaultPath,
  parseReviewSkillOutput,
  parseReviewAnalysisPlan,
  preparePdfExtractedContent,
  selectVaultContextForSources,
  type IntakeSource,
  type ReviewAnalysisRequest,
} from "./lifemind-core";
import {
  createDeepSeekLogicLinkModelRequest,
  deepSeekReviewTool,
  deepSeekLogicLinkTool,
  reviewModelProviderPresets,
  runReviewSkill,
  testReviewSkillConnection,
} from "./lifemind-review-runner";

const sampleSources: IntakeSource[] = [
  {
    id: "src-java",
    title: "Java 控制台输出原文",
    type: "text",
    stackHint: "Java",
    content: `System.out.print("Hello");
System.out.println("World");

print 会自动换行，println 主要用于不换行输出。`,
  },
  {
    id: "src-python",
    title: "Python 列表原文",
    type: "text",
    stackHint: "Python",
    content: `nums = [1, 2]
new_nums = nums.append(3)

append 会返回一个新的列表。`,
  },
  {
    id: "src-sql",
    title: "SQL 聚合查询原文",
    type: "text",
    stackHint: "数据库 / SQL",
    content: `select user_id, count(*) as total
from orders
where count(*) > 3
group by user_id;`,
  },
];

function deepSeekToolResponse(argumentsValue: unknown, toolName = "submit_review_plan") {
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
                  name: toolName,
                  arguments: JSON.stringify(argumentsValue),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("lifemind review core", () => {
  it("creates a review batch with corrections, classified notes, and relations", () => {
    const batch = createReviewBatch(sampleSources, {
      now: new Date(2026, 6, 10, 9, 30, 0),
    });

    expect(batch.id).toBe("batch-20260710-093000");
    expect(batch.createdAt).toBe("2026-07-10 09:30:00");
    expect(batch.status).toBe("draft");
    expect(batch.sources).toHaveLength(3);
    expect(batch.corrections.map((item) => item.original)).toEqual([
      "print 会自动换行，println 主要用于不换行输出。",
      "append 会返回一个新的列表。",
      "where count(*) > 3",
    ]);
    expect(batch.notes.map((note) => [note.title, note.grain, note.path])).toEqual([
      ["Java 控制台输出", "中颗粒度", "Java / Java 基础语法 / 输入与输出"],
      ["Python 列表 append", "小颗粒度", "Python / Python 基础语法 / 列表"],
      ["SQL WHERE 与 HAVING", "小颗粒度", "数据库 / SQL 查询 / 聚合查询"],
    ]);
    expect(batch.relations).toContainEqual({
      type: "前置知识",
      source: "Java 控制台输出",
      target: "Java 基础语法",
    });
  });

  it("builds Obsidian preview files for the source, review, overview, and generated notes", () => {
    const batch = createReviewBatch(sampleSources, {
      now: new Date(2026, 6, 10, 9, 30, 0),
    });
    const files = buildPreviewFiles(batch);

    expect(files.map((file) => file.path)).toContain("00-审理确认总览.md");
    expect(files.map((file) => file.path)).toContain("00-原始上传/src-java-Java 控制台输出原文.md");
    expect(files.map((file) => file.path)).toContain("10-审理结果/Java 控制台输出.md");
    expect(files.map((file) => file.path)).toContain("20-生成预览/Java/00-导览/00-Java 导览.md");
    expect(files.map((file) => file.path)).toContain("20-生成预览/Java/Java基础语法/输入与输出/Java 控制台输出.md");
    expect(files.find((file) => file.path === "00-审理确认总览.md")?.content).toContain(
      "[[20-生成预览/Java/Java基础语法/输入与输出/Java 控制台输出|Java 控制台输出]]",
    );
  });

  it("builds final vault write files without preview-only folders or batch-scoped root guides", () => {
    const batch = createReviewBatch(sampleSources, {
      now: new Date(2026, 6, 10, 9, 30, 0),
    });
    const files = buildVaultWriteFiles(batch);

    expect(files.map((file) => file.path)).toEqual([
      "Java/Java基础语法/输入与输出/Java 控制台输出.md",
      "Python/Python基础语法/列表/Python 列表 append.md",
      "数据库/SQL查询/聚合查询/SQL WHERE 与 HAVING.md",
    ]);
    expect(files.some((file) => /\/00-.*导览\.md$/.test(file.path))).toBe(false);
    expect(files[0].content).not.toContain("# Java 控制台输出");
    expect(files.every((file) => !file.path.startsWith("20-生成预览"))).toBe(true);
  });

  it("builds a batch-isolated Obsidian preview root", () => {
    expect(buildBatchPreviewRoot("/tmp/lifemind-review-test-vault", "batch-20260710-093000")).toBe(
      "/tmp/lifemind-review-test-vault/batch-20260710-093000",
    );
    expect(buildBatchPreviewRoot("/tmp/lifemind-review-test-vault/", "batch-20260710-093000")).toBe(
      "/tmp/lifemind-review-test-vault/batch-20260710-093000",
    );
  });

  it("creates a generic classified note when no built-in correction rule matches", () => {
    const batch = createReviewBatch(
      [
        {
          id: "src-cpp",
          title: "C++ vector 记录",
          type: "markdown",
          stackHint: "C++",
          content: "vector 可以动态存储同类型元素，常用 push_back 追加元素。",
        },
      ],
      { now: new Date(2026, 6, 10, 9, 30, 0) },
    );

    expect(batch.corrections).toEqual([]);
    expect(batch.notes).toHaveLength(1);
    expect(batch.notes[0]).toMatchObject({
      title: "C++ vector 记录",
      grain: "中颗粒度",
      path: "C++ / 待细分",
      status: "新建笔记",
    });
    expect(noteVaultPath(batch.notes[0])).toBe("C++/待细分/C++ vector 记录.md");
    expect(batch.notes[0].markdown).toContain("vector 可以动态存储同类型元素");
  });

  it("builds a v2 analysis request instead of asking the model for final Markdown", () => {
    const request = createReviewAnalysisRequest([
      {
        id: "src-os",
        title: "操作系统学习记录",
        type: "text",
        stackHint: "操作系统",
        content: "进程由操作系统调度，线程共享进程资源。",
      },
    ]);

    expect(request.protocolVersion).toBe(REVIEW_ANALYSIS_PROTOCOL_VERSION);
    expect(request.outputShape.analysisPlan).toBe("ReviewAnalysisPlan");
    expect(request.outputShape).not.toHaveProperty("notes");
    expect(request.constraints).toContain("用户填写的技术栈是根目录约束，不是可被模型替换的建议");
    expect(request.sourceStructure?.[0]).toMatchObject({
      sourceId: "src-os",
      lineCount: 1,
      codeBlockCount: 0,
    });
    expect(request.sourceStructure?.[0].markers).toEqual([]);
    expect(request.constraints).toContain("sourceStructure 是本地从原文提取的结构信号");
  });

  it("rejects an analysis plan when an original fenced code block is missing", () => {
    const source: IntakeSource = {
      id: "src-code-preservation",
      title: "React 下拉选择框代码",
      type: "text",
      stackHint: "React",
      content: [
        "下拉选择框的受控写法：",
        "```tsx",
        "<select value={value} onChange={handleChange}>",
        '  <option value="a">A</option>',
        "</select>",
        "```",
      ].join("\n"),
    };

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: source.id, name: "React", confidence: "高", evidence: ["用户技术栈提示"] }],
        sections: [
          {
            id: "react-select",
            sourceId: source.id,
            title: "下拉选择框",
            role: "具体代码",
            grain: "中颗粒度",
            path: ["代码"],
            status: "新建笔记",
            body: "下拉选择框通过 value 和 onChange 管理。",
            evidence: ["下拉选择框的受控写法"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected missing source code to be rejected");
    expect(parsed.errors.some((error) => /代码证据缺失/u.test(error.message))).toBe(true);
  });

  it("accepts original code when the model keeps the code tokens without a fence", () => {
    const source: IntakeSource = {
      id: "src-code-preservation-raw",
      title: "React 下拉选择框代码",
      type: "text",
      stackHint: "React",
      content: "```tsx\n<select value={value} onChange={handleChange}>\n</select>\n```",
    };

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: source.id, name: "React", confidence: "高", evidence: ["用户技术栈提示"] }],
        sections: [
          {
            id: "react-select-raw",
            sourceId: source.id,
            title: "下拉选择框",
            role: "具体代码",
            grain: "中颗粒度",
            path: ["代码"],
            status: "新建笔记",
            body: "<select value={value} onChange={handleChange}>\n</select>",
            evidence: ["原文代码块"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(true);
  });

  it("includes canonical Vault node ids in the model-facing request", () => {
    const request = createReviewAnalysisRequest(
      [
        {
          id: "src-node-index",
          title: "TI 嵌入式记录",
          type: "text",
          stackHint: "TI嵌入式",
          content: "Port Segment 是端口分组术语。",
        },
      ],
      {
        roots: [{ name: "TI嵌入式", noteCount: 1, paths: ["TI嵌入式", "TI嵌入式/GPIO"] }],
        notes: [
          {
            title: "GPIO 接口",
            path: "TI嵌入式/GPIO/GPIO 接口.md",
            root: "TI嵌入式",
            headings: ["基本概念"],
            snippet: "GPIO 配置引脚方向。",
          },
        ],
        relations: [],
      },
    );

    expect(request.vaultIndex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "root", title: "TI嵌入式" }),
        expect.objectContaining({ kind: "directory", title: "GPIO", path: "TI嵌入式/GPIO" }),
        expect.objectContaining({ kind: "note", title: "GPIO 接口", path: "TI嵌入式/GPIO/GPIO 接口.md" }),
      ]),
    );
    expect(request.constraints).toContain("relations 使用 sourceNodeId 和 targetNodeId，必须引用 sections[].id 或 vaultIndex 中的真实节点 ID。");
  });

  it("exposes placement and node-id relation fields in the strict DeepSeek tool", () => {
    const parameters = deepSeekReviewTool.function.parameters as {
      properties: {
        sections: { items: { properties: Record<string, unknown> } };
        relations: { items: { properties: Record<string, unknown> } };
      };
    };
    const sectionProperties = parameters.properties.sections.items.properties;
    const relationProperties = parameters.properties.relations.items.properties;

    expect(sectionProperties.placement).toBeTruthy();
    expect(sectionProperties.path).toBeUndefined();
    expect(relationProperties.sourceNodeId).toBeTruthy();
    expect(relationProperties.targetNodeId).toBeTruthy();
    expect(relationProperties.source).toBeUndefined();
    expect(relationProperties.target).toBeUndefined();
  });

  it("requires PDF page coverage and compiles verified formulas and page image placements", () => {
    const source: IntakeSource = {
      id: "src-dsp-pdf",
      title: "数字信号处理",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [
          {
            page: 1,
            assetId: "pdf-page-src-dsp-pdf-page-1",
            imageWidth: 1200,
            imageHeight: 1600,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [
              {
                id: "pdf-page-1-text-1",
                text: "x[n] = x[n-1]",
                source: "pdf-text",
                confidence: 1,
                candidates: [],
              },
            ],
          },
        ],
        images: [
          {
            assetId: "pdf-image-src-dsp-pdf-page-1-1",
            page: 1,
            imageWidth: 320,
            imageHeight: 180,
            x: 0.2,
            y: 0.3,
            width: 0.4,
            height: 0.2,
            imageDataUrl: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [
        {
          sourceId: source.id,
          page: 1,
          status: "covered",
          sectionIds: ["dsp-sequence"],
          evidenceIds: ["pdf-page-src-dsp-pdf-page-1"],
          summary: "第 1 页说明序列递推关系。",
        },
      ],
      stackDecisions: [
        { sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["用户技术栈提示"] },
      ],
      sections: [
        {
          id: "dsp-sequence",
          sourceId: source.id,
          title: "序列递推",
          role: "基本原理",
          grain: "中颗粒度",
          path: ["序列"],
          status: "新建笔记",
          existingNoteTitle: null,
          body: "序列递推关系见 {{formula:sequence-recursion}}。",
          formulas: [
            {
              id: "sequence-recursion",
              latex: "x[n] = x[n-1] + u[n]",
              display: "block",
              sourcePage: 1,
              evidenceId: "pdf-page-src-dsp-pdf-page-1",
              anchor: "{{formula:sequence-recursion}}",
              confidence: "高",
            },
          ],
          imagePlacements: [
            {
              assetId: "pdf-image-src-dsp-pdf-page-1-1",
              sourcePage: 1,
              placement: "after-section",
              caption: "序列递推示意图",
              alt: "序列递推示意图",
              confidence: "高",
            },
          ],
          evidence: ["第 1 页递推关系"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    };

    const parsedWithoutSentImage = parseReviewAnalysisPlan(JSON.stringify(plan), [source]);
    expect(parsedWithoutSentImage.ok).toBe(false);

    const parsed = parseReviewAnalysisPlan(JSON.stringify(plan), [source], {
      allowedPdfImageEvidence: [
        {
          sourceId: source.id,
          page: 1,
          assetId: "pdf-page-src-dsp-pdf-page-1",
          kind: "page",
        },
        {
          sourceId: source.id,
          page: 1,
          assetId: "pdf-image-src-dsp-pdf-page-1-1",
          kind: "embedded",
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected PDF analysis plan to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, {
      allowedPdfImageEvidence: [
        {
          sourceId: source.id,
          page: 1,
          assetId: "pdf-page-src-dsp-pdf-page-1",
          kind: "page",
        },
        {
          sourceId: source.id,
          page: 1,
          assetId: "pdf-image-src-dsp-pdf-page-1-1",
          kind: "embedded",
        },
      ],
    });
    expect(batch.notes[0]?.markdown).toContain("$$\nx[n] = x[n-1] + u[n]\n$$");
    expect(batch.notes[0]?.markdown).toContain("![[附件/PDF图片/pdf-image-src-dsp-pdf-page-1-1.png]]");
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toContain(
      "附件/PDF图片/pdf-image-src-dsp-pdf-page-1-1.png",
    );
    expect(buildPreviewFiles(batch).map((file) => file.path)).toContain(
      "附件/PDF图片/pdf-image-src-dsp-pdf-page-1-1.png",
    );
    expect(buildVaultWriteFiles(batch).some((file) => file.path.startsWith("附件/PDF页面/"))).toBe(false);
    expect(buildVaultWriteFiles(batch).find((file) => file.path.endsWith(".png"))?.binary).toBe(true);
  });

  it("compiles PDF formulas without inserting rendered page evidence when media fields are omitted", () => {
    const source: IntakeSource = {
      id: "src-dsp-fallback-media",
      title: "数字信号处理",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [
          {
            page: 1,
            imageWidth: 1200,
            imageHeight: 1600,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [],
          },
        ],
      },
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [
        {
          sourceId: source.id,
          page: 1,
          status: "covered",
          sectionIds: ["dsp-fallback-section"],
          evidenceIds: [],
          summary: "第 1 页已审理。",
        },
      ],
      stackDecisions: [
        { sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["用户技术栈提示"] },
      ],
      sections: [
        {
          id: "dsp-fallback-section",
          sourceId: source.id,
          title: "z 变换",
          role: "基本原理",
          grain: "中颗粒度",
          path: ["z 变换"],
          status: "新建笔记",
          existingNoteTitle: null,
          body: "- 双边变换：X(z) = Σ x(n)z^{−n}。",
          formulas: [],
          imagePlacements: [],
          evidence: ["第 1 页"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    };

    const parsed = parseReviewAnalysisPlan(JSON.stringify(plan), [source]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected fallback media plan to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output);
    expect(batch.notes[0]?.title).toBe("1.1 z 变换");
    expect(batch.notes[0]?.markdown).toContain("$X(z) = \\sum x(n)z^{-n}$");
    expect(batch.notes[0]?.markdown).not.toContain("附件/PDF页面");
    expect(buildVaultWriteFiles(batch).some((file) => file.path.startsWith("附件/PDF页面/"))).toBe(false);
  });

  it("never writes rendered PDF page evidence into notes or vault attachments", () => {
    const source: IntakeSource = {
      id: "src-no-page-evidence-attachments",
      title: "数字信号处理",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [
          {
            page: 1,
            imageWidth: 1200,
            imageHeight: 1600,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [],
          },
        ],
      },
    };
    const parsed = parseReviewAnalysisPlan(JSON.stringify({
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [{
        sourceId: source.id,
        page: 1,
        status: "covered",
        sectionIds: ["sequence-overview"],
        evidenceIds: [],
        summary: "第 1 页已审理。",
      }],
      stackDecisions: [{ sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["用户技术栈提示"] }],
      sections: [{
        id: "sequence-overview",
        sourceId: source.id,
        title: "序列运算",
        role: "基本原理",
        grain: "中颗粒度",
        placement: { mode: "new-root", parentNodeId: null, branchName: "序列运算", targetNodeId: null },
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: "序列运算按离散索引进行。",
        formulas: [],
        imagePlacements: [],
        evidence: ["第 1 页"],
      }],
      relations: [],
      corrections: [],
      uncertain: [],
    }), [source], {
      allowedPdfImageEvidence: [{
        sourceId: source.id,
        page: 1,
        assetId: "pdf-image-src-embedded-image-page-1-1",
        kind: "embedded",
      }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected PDF analysis plan to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, {
      allowedPdfImageEvidence: [{
        sourceId: source.id,
        page: 1,
        assetId: "pdf-image-src-embedded-image-page-1-1",
        kind: "embedded",
      }],
    });
    const files = buildVaultWriteFiles(batch);

    expect(batch.notes[0]?.markdown).not.toContain("附件/PDF页面");
    expect(files.some((file) => file.path.startsWith("附件/PDF页面/"))).toBe(false);
    expect(files.some((file) => file.binary)).toBe(false);
  });

  it("places every PDF note in a numbered topic folder ordered by first covered page", () => {
    const source: IntakeSource = {
      id: "src-numbered-pdf-folders",
      title: "数字信号处理",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [1, 2, 3].map((page) => ({
          page,
          imageWidth: 0,
          imageHeight: 0,
          imageReviewRequired: false,
          evidence: [],
        })),
      },
    };
    const sections = [
      { id: "z-transform", title: "Z 变换", branchName: "Z 变换", page: 3 },
      { id: "convolution", title: "序列的卷积和", branchName: "序列的卷积和", page: 2 },
      { id: "sequence", title: "序列的运算", branchName: "序列的运算", page: 1 },
    ];
    const parsed = parseReviewAnalysisPlan(JSON.stringify({
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: sections.map((section) => ({
        sourceId: source.id,
        page: section.page,
        status: "covered",
        sectionIds: [section.id],
        evidenceIds: [],
        summary: `第 ${section.page} 页已审理。`,
      })),
      stackDecisions: [{ sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["用户技术栈提示"] }],
      sections: sections.map((section) => ({
        id: section.id,
        sourceId: source.id,
        title: section.title,
        role: "基本原理",
        grain: "中颗粒度",
        placement: { mode: "new-root", parentNodeId: null, branchName: section.branchName, targetNodeId: null },
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: `${section.title}的正文。`,
        formulas: [],
        imagePlacements: [],
        evidence: [`第 ${section.page} 页`],
      })),
      relations: [],
      corrections: [],
      uncertain: [],
    }), [source]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected PDF analysis plan to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output);
    const foldersByTopic = Object.fromEntries(batch.notes.map((note) => [
      note.title.replace(/^\d+\.\d+\s+/u, ""),
      note.path.split(" / ")[1],
    ]));

    expect(foldersByTopic).toEqual({
      "Z 变换": "03-Z 变换",
      "序列的卷积和": "02-序列的卷积和",
      "序列的运算": "01-序列的运算",
    });
    expect(batch.notes.every((note) => note.path.split(" / ").length === 2)).toBe(true);
    expect(batch.notes.every((note) => /^\d{2}-/u.test(note.path.split(" / ")[1] ?? ""))).toBe(true);
  });

  it("writes only an extracted PDF image asset at the model-selected note location", () => {
    const source = {
      id: "src-embedded-image",
      title: "信号处理",
      type: "pdf",
      stackHint: "信号处理",
      content: "正文",
      pdfEvidence: {
        pages: [{ page: 1, imageWidth: 1000, imageHeight: 1400, imageReviewRequired: false, evidence: [] }],
        images: [{
          assetId: "pdf-image-src-embedded-image-page-1-1",
          page: 1,
          imageWidth: 320,
          imageHeight: 180,
          x: 0.2,
          y: 0.3,
          width: 0.4,
          height: 0.2,
          imageDataUrl: "data:image/png;base64,aW1hZ2U=",
        }],
      },
    } as unknown as IntakeSource;
    const parsed = parseReviewAnalysisPlan(JSON.stringify({
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [{ sourceId: source.id, page: 1, status: "covered", sectionIds: ["filter-response"], evidenceIds: [], summary: "第 1 页已审理。" }],
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
        body: "频率响应如下图所示。\n\n![[附件/PDF页面/pdf-page-src-embedded-image-page-1.jpg]]",
        formulas: [],
        imagePlacements: [{ assetId: "pdf-image-src-embedded-image-page-1-1", sourcePage: 1, placement: "after-section", anchor: null, caption: "频率响应曲线", alt: "滤波器频率响应", confidence: "高" }],
        evidence: ["第 1 页图表"],
      }],
      relations: [],
      corrections: [],
      uncertain: [],
    }), [source], {
      allowedPdfImageEvidence: [{
        sourceId: source.id,
        page: 1,
        assetId: "pdf-image-src-embedded-image-page-1-1",
        kind: "embedded",
      }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected extracted PDF image placement to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, {
      allowedPdfImageEvidence: [{
        sourceId: source.id,
        page: 1,
        assetId: "pdf-image-src-embedded-image-page-1-1",
        kind: "embedded",
      }],
    });
    const files = buildVaultWriteFiles(batch);

    expect(batch.notes[0]?.markdown).toContain("![[附件/PDF图片/pdf-image-src-embedded-image-page-1-1.png]]");
    expect(batch.notes[0]?.markdown).not.toContain("PDF页面");
    expect(batch.notes[0]?.markdown).not.toContain("pdf-page-src-embedded-image-page-1");
    expect(files.map((file) => file.path)).toContain("附件/PDF图片/pdf-image-src-embedded-image-page-1-1.png");
    expect(files.some((file) => file.path.startsWith("附件/PDF页面/"))).toBe(false);
  });

  it("numbers PDF sections in page order and keeps existing chapter numbers", () => {
    const source: IntakeSource = {
      id: "src-numbered-pdf",
      title: "信号与系统",
      type: "pdf",
      stackHint: "信号与系统",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [
          { page: 1, imageWidth: 100, imageHeight: 100, imageReviewRequired: true, imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=", evidence: [] },
          { page: 2, imageWidth: 100, imageHeight: 100, imageReviewRequired: true, imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=", evidence: [] },
        ],
      },
    };
    const parsed = parseReviewAnalysisPlan(JSON.stringify({
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [
        { sourceId: source.id, page: 1, status: "covered", sectionIds: ["sec-chapter", "sec-energy"], evidenceIds: [], summary: "第 1 页" },
        { sourceId: source.id, page: 2, status: "covered", sectionIds: ["sec-convolution"], evidenceIds: [], summary: "第 2 页" },
      ],
      stackDecisions: [{ sourceId: source.id, name: "信号与系统", confidence: "高", evidence: ["提示"] }],
      sections: [
        {
          id: "sec-chapter", sourceId: source.id, title: "第一章 序列", role: "总览", grain: "大颗粒度",
          path: ["序列"], status: "新建笔记", existingNoteTitle: null, body: "序列是离散时间信号。", formulas: [], imagePlacements: [], evidence: ["第 1 页"],
        },
        {
          id: "sec-energy", sourceId: source.id, title: "序列的能量", role: "基本原理", grain: "中颗粒度",
          path: ["序列"], parentId: "sec-chapter", status: "新建笔记", existingNoteTitle: null, body: "能量定义。", formulas: [], imagePlacements: [], evidence: ["第 1 页"],
        },
        {
          id: "sec-convolution", sourceId: source.id, title: "序列的卷积和", role: "基本原理", grain: "中颗粒度",
          path: ["序列"], parentId: "sec-chapter", status: "新建笔记", existingNoteTitle: null, body: "卷积定义。", formulas: [], imagePlacements: [], evidence: ["第 2 页"],
        },
      ],
      relations: [], corrections: [], uncertain: [],
    }), [source]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected numbered PDF plan to pass");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output);
    expect(batch.notes.map((note) => note.title)).toEqual([
      "第一章 序列",
      "1.1 序列的能量",
      "1.2 序列的卷积和",
    ]);
  });

  it("continues PDF numbering from existing Vault notes and starts a new chapter at the next number", () => {
    const source: IntakeSource = {
      id: "src-number-continuation",
      title: "数字信号处理续记",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [{ page: 1, imageWidth: 100, imageHeight: 100, imageReviewRequired: true, imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=", evidence: [] }],
      },
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      pageCoverage: [{ sourceId: source.id, page: 1, status: "covered", sectionIds: ["same", "new"], evidenceIds: [], summary: "第 1 页" }],
      stackDecisions: [{ sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["提示"] }],
      sections: [
        { id: "same", sourceId: source.id, title: "序列的周期性", role: "基本原理", grain: "中颗粒度", path: ["序列"], status: "新建笔记", existingNoteTitle: null, body: "周期。", formulas: [], imagePlacements: [], evidence: ["第 1 页"] },
        { id: "new", sourceId: source.id, title: "傅里叶变换", role: "基本原理", grain: "中颗粒度", path: ["变换"], status: "新建笔记", existingNoteTitle: null, body: "变换。", formulas: [], imagePlacements: [], evidence: ["第 1 页"] },
      ],
      relations: [], corrections: [], uncertain: [],
    };
    const vaultContext = {
      roots: [{ name: "数字信号处理", noteCount: 3, paths: ["数字信号处理", "数字信号处理/序列"] }],
      notes: [
        { title: "2.1 序列的能量", path: "数字信号处理/序列/2.1 序列的能量.md", root: "数字信号处理", headings: [], snippet: "" },
        { title: "2.2 序列的卷积和", path: "数字信号处理/序列/2.2 序列的卷积和.md", root: "数字信号处理", headings: [], snippet: "" },
        { title: "2.3 序列的相关", path: "数字信号处理/序列/2.3 序列的相关.md", root: "数字信号处理", headings: [], snippet: "" },
      ],
      relations: [],
    };
    const parsed = parseReviewAnalysisPlan(JSON.stringify(plan), [source]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected continuation plan to pass");
    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, { vaultContext });
    expect(batch.notes.map((note) => note.title)).toEqual(["2.4 序列的周期性", "3.1 傅里叶变换"]);
  });

  it("rejects a PDF analysis plan with an omitted page coverage entry", () => {
    const source: IntakeSource = {
      id: "src-dsp-coverage",
      title: "数字信号处理覆盖测试",
      type: "pdf",
      stackHint: "数字信号处理",
      content: "【PDF 页面视觉证据】",
      pdfEvidence: {
        pages: [
          {
            page: 1,
            imageWidth: 100,
            imageHeight: 100,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [],
          },
          {
            page: 2,
            imageWidth: 100,
            imageHeight: 100,
            imageReviewRequired: true,
            imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
            evidence: [],
          },
        ],
      },
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        pageCoverage: [
          {
            sourceId: source.id,
            page: 1,
            status: "covered",
            sectionIds: [],
            evidenceIds: [],
            summary: "第 1 页。",
          },
        ],
        stackDecisions: [{ sourceId: source.id, name: "数字信号处理", confidence: "高", evidence: ["提示"] }],
        sections: [],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected missing page coverage to fail");
    expect(parsed.errors.some((error) => /覆盖|第 2 页/u.test(error.message))).toBe(true);
  });

  it("compiles a v2 plan into structured notes without allowing a wrong model root", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-os",
        title: "操作系统学习记录",
        type: "text",
        stackHint: "操作系统",
        content: "进程由操作系统调度，线程共享进程资源。",
      },
    ];
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: "src-os", name: "AI", confidence: "高", evidence: ["模型误判"] },
        ],
        sections: [
          {
            id: "src-os-overview",
            sourceId: "src-os",
            title: "操作系统进程与线程",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["进程调度"],
            status: "新建笔记",
            body: "## 核心概念\n- 进程由操作系统调度，线程共享进程资源。",
            evidence: ["原文第一句"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid v2 analysis plan");

    expect(() =>
      createReviewBatchFromAnalysisPlan(sources, parsed.output, {
        now: new Date(2026, 6, 10, 9, 30, 0),
      }),
    ).toThrow("技术栈根目录与用户填写的技术栈不一致");
  });

  it("does not reject a valid multiline analysis body or square marker", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-pdf-square-marker",
        title: "操作系统手写笔记",
        type: "pdf",
        stackHint: "操作系统",
        content: "操作系统负责进程调度。",
      },
    ];
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          {
            sourceId: "src-pdf-square-marker",
            name: "操作系统",
            confidence: "高",
            evidence: ["用户技术栈提示"],
          },
        ],
        sections: [
          {
            id: "src-pdf-square-marker-overview",
            sourceId: "src-pdf-square-marker",
            title: "进程调度基础",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["进程调度"],
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "## 核心概念\n□ 就绪队列中的进程等待调度。",
            evidence: ["原文说明进程调度"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
  });

  it("keeps an explicit stack hint ahead of matching legacy vault roots", () => {
    const request = createReviewAnalysisRequest(
      [
        {
          id: "src-explicit-stack",
          title: "操作系统学习记录",
          type: "text",
          stackHint: "操作系统",
          content: "操作系统负责管理进程，AI 只是本段材料中的无关对照词。",
        },
      ],
      {
        roots: [
          { name: "AI", noteCount: 2, paths: ["AI"] },
          { name: "操作系统", noteCount: 0, paths: ["操作系统"] },
        ],
        notes: [],
        relations: [],
      },
    );

    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      root: "操作系统",
    });
  });

  it("does not extract PDF OCR body text as a local organization path signal", () => {
    const request = createReviewAnalysisRequest([
      {
        id: "src-pdf-local-signal",
        title: "操作系统手写笔记",
        type: "pdf",
        stackHint: "操作系统",
        content: [
          "【本地 Vision OCR 页面结构】",
          "## 第 1 页",
          "### 第 1 页视觉块 1",
          "- 目录：所有文件放一起",
          "- 文件夹：所有文件放一起",
          "- 技术栈：操作系统->所有文件放一起->临时文件",
          "- 进程调度、内存管理和文件管理是操作系统的核心内容。",
        ].join("\n"),
      },
    ]);

    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      root: "操作系统",
    });
    expect(request.sourceOrganizationSignals?.[0]?.knowledgeRole).not.toBe("所有文件放一起");
    expect(request.sourceOrganizationSignals?.[0]?.leaf).not.toBe("所有文件放一起");
    expect(request.sourceOrganizationSignals?.[0]).not.toHaveProperty("explicitHierarchy");
  });

  it("keeps model paths for PDF reviews instead of aligning every note to an OCR body directory phrase", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-pdf-path-preserve",
        title: "操作系统手写笔记",
        type: "pdf",
        stackHint: "操作系统",
        content: [
          "【本地 Vision OCR 页面结构】",
          "## 第 1 页",
          "### 第 1 页视觉块 1",
          "- 目录：所有文件放一起",
          "- 操作系统基本特征、进程与线程、处理机调度、内存管理、文件管理。",
        ].join("\n"),
      },
    ];
    const titles = ["操作系统基本特征", "进程与线程", "处理机调度", "内存管理", "文件管理"];
    const modelPaths = [["总览"], ["基本特征"], ["进程与线程"], ["处理机调度"], ["内存管理"]];
    const batch = createReviewBatchFromAnalysisPlan(sources, {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [
        {
          sourceId: "src-pdf-path-preserve",
          name: "操作系统",
          confidence: "高",
          evidence: ["用户技术栈提示"],
        },
      ],
      sections: titles.map((title, index) => ({
        id: `src-pdf-path-preserve-${index}`,
        sourceId: "src-pdf-path-preserve",
        title,
        role: index === 0 ? "总览" : "基本概念",
        grain: index === 0 ? "大颗粒度" : "中颗粒度",
        path: modelPaths[index],
        parentId: null,
        status: "新建笔记",
        existingNoteTitle: null,
        body: `${title} 是操作系统知识中的一个分支。`,
        evidence: ["原文"],
      })),
      relations: [],
      corrections: [],
      uncertain: [],
    });

    expect(batch.notes.every((note) => note.path.startsWith("操作系统 / "))).toBe(true);
    expect(batch.notes.map((note) => note.path.split(" / ")[1])).toEqual([
      "01-操作系统基本特征",
      "02-进程与线程",
      "03-处理机调度",
      "04-内存管理",
      "05-文件管理",
    ]);
    expect(batch.notes.every((note) => !note.path.includes("所有文件放一起"))).toBe(true);
  });

  it("rejects generic PDF organization bucket names returned as model paths", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-pdf-bucket-path",
        title: "操作系统手写笔记",
        type: "pdf",
        stackHint: "操作系统",
        content: "目录：所有文件放一起\n进程调度、内存管理和文件管理是操作系统的核心内容。",
      },
    ];

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          {
            sourceId: "src-pdf-bucket-path",
            name: "操作系统",
            confidence: "高",
            evidence: ["用户技术栈提示"],
          },
        ],
        sections: [
          {
            id: "src-pdf-bucket-path-overview",
            sourceId: "src-pdf-bucket-path",
            title: "操作系统核心内容",
            role: "总览",
            grain: "中颗粒度",
            path: ["所有文件放一起"],
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "操作系统包括进程调度、内存管理和文件管理。",
            evidence: ["原文"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected generic bucket path to be rejected");
    expect(parsed.errors.map((error) => error.message).join("\n")).toContain("目录中的分段缺少语义支撑或包含噪声");
  });

  it("rejects semantically unsupported roots and noisy generated paths", () => {
    const source: IntakeSource = {
      id: "src-os-semantic-quality",
      title: "操作系统学习记录",
      type: "text",
      content: "操作系统负责进程调度、内存管理和文件管理。",
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: source.id, name: "AI", confidence: "高", evidence: ["模型误判"] },
        ],
        sections: [
          {
            id: "src-os-semantic-quality-overview",
            sourceId: source.id,
            title: "操作系统总览",
            role: "总览",
            grain: "大颗粒度",
            path: ["就绪队列指针", "FCB 5", "PBL 1< 跌", "底"],
            parentId: null,
            status: "新建笔记",
            body: "## 核心概念\n- 操作系统负责进程调度、内存管理和文件管理。",
            evidence: ["原文"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected semantically invalid analysis plan");

    expect(parsed.errors.map((error) => error.message).join("；")).toContain("技术栈根目录");
    expect(parsed.errors.map((error) => error.message).join("；")).toContain("目录");
  });

  it("repairs a structurally valid but semantically invalid model result", async () => {
    const source: IntakeSource = {
      id: "src-os-semantic-repair",
      title: "操作系统学习记录",
      type: "text",
      content: "操作系统负责进程调度、内存管理和文件管理。",
    };
    const requests: ReviewAnalysisRequest[] = [];

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "test-key",
      model: "test-model",
      fallbackToLocal: false,
      modelInvoker: async (payload) => {
        requests.push(payload.request);

        if (requests.length === 1) {
          return JSON.stringify({
            protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
            stackDecisions: [
              { sourceId: source.id, name: "AI", confidence: "高", evidence: ["模型误判"] },
            ],
            sections: [
              {
                id: "src-os-semantic-repair-overview",
                sourceId: source.id,
                title: "操作系统总览",
                role: "总览",
                grain: "大颗粒度",
                path: ["就绪队列指针", "FCB 5", "PBL 1< 跌", "底"],
                parentId: null,
                status: "新建笔记",
                body: "## 核心概念\n- 操作系统负责进程调度、内存管理和文件管理。",
                evidence: ["原文"],
              },
            ],
            relations: [],
            corrections: [],
            uncertain: [],
          });
        }

        expect(payload.request.protocolRepair?.errors.length).toBeGreaterThan(0);

        return JSON.stringify({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            { sourceId: source.id, name: "操作系统", confidence: "高", evidence: ["标题和正文明确说明操作系统"] },
          ],
          sections: [
            {
              id: "src-os-semantic-repair-overview",
              sourceId: source.id,
              title: "操作系统总览",
              role: "总览",
              grain: "大颗粒度",
              path: ["总览"],
              parentId: null,
              status: "新建笔记",
              body: "## 核心概念\n- 操作系统负责进程调度、内存管理和文件管理。",
              evidence: ["原文"],
            },
          ],
          relations: [],
          corrections: [],
          uncertain: [],
        });
      },
    });

    expect(requests).toHaveLength(2);
    expect(result.usedFallback).toBe(false);
    expect(result.batch.notes[0].path).toBe("操作系统 / 总览");
    expect(result.message).toContain("自动重试");
  });

  it("compiles a two-level Port Segment plan under the selected stack instead of GPIO", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-port-segment-v2",
        title: "TI嵌入式术语",
        type: "text",
        stackHint: "TI嵌入式",
        content: "Port Segment 把 32 个引脚端口分成 Lower 和 Upper 两段。",
      },
    ];
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: "src-port-segment-v2", name: "TI嵌入式", confidence: "高", evidence: ["用户技术栈提示"] },
        ],
        sections: [
          {
            id: "src-port-segment-v2-guide",
            sourceId: "src-port-segment-v2",
            title: "Port Segment",
            role: "术语",
            grain: "中颗粒度",
            path: ["术语"],
            status: "新建笔记",
            body: "## 核心概念\n- Port Segment 把 32 个引脚端口分成 Lower 和 Upper 两段。",
            evidence: ["原文主题"]
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid v2 analysis plan");

    const batch = createReviewBatchFromAnalysisPlan(sources, parsed.output, {
      now: new Date(2026, 6, 10, 9, 30, 0),
    });

    expect(batch.notes[0].path).toBe("TI嵌入式 / 术语");
    expect(noteVaultPath(batch.notes[0])).toBe("TI嵌入式/术语/Port Segment.md");
    expect(batch.notes[0].path).not.toContain("GPIO");
    expect(batch.notes[0].markdown).toContain("归类：[[TI嵌入式]]");
  });

  it("compiles a placement plan from a vault node id instead of trusting a model-authored path", () => {
    const source: IntakeSource = {
      id: "src-port-segment-node-placement",
      title: "TI嵌入式术语",
      type: "text",
      stackHint: "TI嵌入式",
      content: "Port Segment 把 32 个引脚端口分成 Lower 和 Upper 两段。",
    };
    const vaultContext = {
      roots: [
        {
          name: "TI嵌入式",
          noteCount: 2,
          paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
        },
      ],
      notes: [],
      relations: [],
    };
    const rootNode = buildVaultKnowledgeIndex(vaultContext).find(
      (node) => node.kind === "root" && node.title === "TI嵌入式",
    );

    expect(rootNode).toBeTruthy();
    if (!rootNode) throw new Error("expected TI嵌入式 root node");

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: source.id, name: "TI嵌入式", confidence: "高", evidence: ["用户技术栈提示"] },
        ],
        sections: [
          {
            id: "port-segment",
            sourceId: source.id,
            title: "Port Segment",
            role: "术语",
            grain: "小颗粒度",
            placement: {
              mode: "new-child",
              parentNodeId: rootNode.id,
              branchName: "术语",
              targetNodeId: null,
            },
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "Port Segment 把 32 个引脚端口分成 Lower 和 Upper 两段。",
            evidence: ["原文主题"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
      {
        enforceStackHints: true,
        knownRootNames: ["TI嵌入式"],
        vaultIndex: buildVaultKnowledgeIndex(vaultContext),
      },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected node placement plan to be valid");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, { vaultContext });

    expect(batch.notes[0].path).toBe("TI嵌入式 / 术语");
    expect(noteVaultPath(batch.notes[0])).toBe("TI嵌入式/术语/Port Segment.md");
    expect(batch.notes[0].path).not.toContain("MSPM0G3507");
    expect(batch.notes[0].path).not.toContain("GPIO");
  });

  it("treats batch-local placement parents as new stack branches when the vault has no matching root", () => {
    const source: IntakeSource = {
      id: "src-batch-local-placement",
      title: "操作系统笔记",
      type: "text",
      stackHint: "操作系统",
      content: "操作系统包含进程管理和内存管理。",
    };

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: source.id, name: "操作系统", confidence: "高", evidence: ["用户技术栈提示"] },
        ],
        sections: [
          {
            id: "os-overview",
            sourceId: source.id,
            title: "操作系统总览",
            role: "总览",
            grain: "大颗粒度",
            placement: {
              mode: "new-child",
              parentNodeId: "new-child",
              branchName: "操作系统基础",
              targetNodeId: null,
            },
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "操作系统负责管理进程和内存。",
            evidence: ["原文主题"],
          },
          {
            id: "os-process",
            sourceId: source.id,
            title: "进程管理",
            role: "基本概念",
            grain: "中颗粒度",
            placement: {
              mode: "new-child",
              parentNodeId: "os-overview",
              branchName: "进程管理",
              targetNodeId: null,
            },
            parentId: "os-overview",
            status: "新建笔记",
            existingNoteTitle: null,
            body: "进程管理负责调度和管理正在运行的程序。",
            evidence: ["原文主题"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
      { enforceStackHints: true, knownRootNames: [] },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected batch-local placement to be normalized");

    expect(parsed.output.sections.map((section) => section.placement?.mode)).toEqual(["new-root", "new-root"]);
    expect(parsed.output.sections[1].parentId).toBe("os-overview");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output);

    expect(batch.notes.map((note) => note.path)).toEqual([
      "操作系统 / 操作系统基础",
      "操作系统 / 进程管理",
    ]);
    expect(batch.relations).toContainEqual({
      type: "包含",
      source: "操作系统总览",
      target: "进程管理",
    });
  });

  it("resolves relation endpoints through vault node ids", () => {
    const source: IntakeSource = {
      id: "src-node-relation",
      title: "UART 记录",
      type: "text",
      stackHint: "TI嵌入式",
      content: "UART 接收字符需要 GPIO 引脚配置。",
    };
    const vaultContext = {
      roots: [{ name: "TI嵌入式", noteCount: 1, paths: ["TI嵌入式", "TI嵌入式/GPIO"] }],
      notes: [
        {
          title: "GPIO 接口",
          path: "TI嵌入式/GPIO/GPIO 接口.md",
          root: "TI嵌入式",
          headings: ["基本概念"],
          snippet: "GPIO 配置引脚方向。",
        },
      ],
      relations: [],
    };
    const gpioNode = buildVaultKnowledgeIndex(vaultContext).find(
      (node) => node.kind === "note" && node.title === "GPIO 接口",
    );

    expect(gpioNode).toBeTruthy();
    if (!gpioNode) throw new Error("expected GPIO note node");

    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [
          { sourceId: source.id, name: "TI嵌入式", confidence: "高", evidence: ["用户技术栈提示"] },
        ],
        sections: [
          {
            id: "uart",
            sourceId: source.id,
            title: "UART 串口",
            role: "基本概念",
            grain: "中颗粒度",
            placement: {
              mode: "new-root",
              parentNodeId: null,
              branchName: "UART串口",
              targetNodeId: null,
            },
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "UART 用于串行通信。",
            evidence: ["原文"],
          },
        ],
        relations: [
          {
            type: "前置知识",
            sourceNodeId: "uart",
            targetNodeId: gpioNode.id,
            evidence: "UART 接收字符需要 GPIO 引脚配置。",
            confidence: "高",
          },
        ],
        corrections: [],
        uncertain: [],
      }),
      [source],
      {
        enforceStackHints: true,
        knownRootNames: ["TI嵌入式"],
        vaultIndex: buildVaultKnowledgeIndex(vaultContext),
      },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected node relation plan to be valid");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, { vaultContext });

    expect(batch.relations).toContainEqual({
      type: "前置知识",
      source: "UART 串口",
      target: "GPIO 接口",
    });
  });

  it("keeps valid notes when a node-id relation cannot be resolved", () => {
    const source: IntakeSource = {
      id: "src-unresolved-node-relation",
      title: "Git 记录",
      type: "text",
      stackHint: "Git",
      content: "Git 用于管理版本。",
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: source.id, name: "Git", confidence: "高", evidence: ["提示"] }],
        sections: [
          {
            id: "git-overview",
            sourceId: source.id,
            title: "Git 工具总览",
            role: "总览",
            grain: "大颗粒度",
            placement: {
              mode: "new-root",
              parentNodeId: null,
              branchName: "Git 工具",
              targetNodeId: null,
            },
            parentId: null,
            status: "新建笔记",
            existingNoteTitle: null,
            body: "Git 用于管理版本。",
            evidence: ["原文"],
          },
        ],
        relations: [
          {
            type: "前置知识",
            sourceNodeId: "git-overview",
            targetNodeId: "vault-note-does-not-exist",
            evidence: "模型返回了失效节点 ID。",
            confidence: "中",
          },
        ],
        corrections: [],
        uncertain: [],
      }),
      [source],
      { enforceStackHints: true, knownRootNames: ["Git"], vaultIndex: [] },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected unresolved node relation to be isolated");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output);

    expect(batch.notes).toHaveLength(1);
    expect(batch.relations).toEqual([]);
    expect(batch.uncertain).toContain("关系未能连接到已知节点（target=vault-note-does-not-exist），已暂不写入。");
  });

  it("compiles parent sections into overview-to-branch relations", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-git-v2",
        title: "Git 团队协作",
        type: "text",
        stackHint: "Git",
        content: "Git 包含概念、步骤和代码。",
      },
    ];
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: "src-git-v2", name: "Git", confidence: "高", evidence: ["用户提示"] }],
        sections: [
          {
            id: "overview",
            sourceId: "src-git-v2",
            title: "Git 工具总览",
            role: "总览",
            grain: "大颗粒度",
            path: ["Git 工具"],
            status: "新建笔记",
            body: "## 简要说明\n- Git 用于版本协作。",
            evidence: ["原文主题"],
          },
          {
            id: "concepts",
            sourceId: "src-git-v2",
            title: "Git 工具基本概念",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["Git 工具", "基本概念"],
            parentId: "overview",
            status: "新建笔记",
            body: "## 核心概念\n- 分支隔离功能开发。",
            evidence: ["原文概念段"],
          },
          {
            id: "steps",
            sourceId: "src-git-v2",
            title: "Git 工具应用步骤",
            role: "应用步骤",
            grain: "中颗粒度",
            path: ["Git 工具", "应用步骤"],
            parentId: "overview",
            status: "新建笔记",
            body: "## 操作流程\n1. 创建仓库。",
            evidence: ["原文步骤段"],
          },
          {
            id: "code",
            sourceId: "src-git-v2",
            title: "Git 常用命令与代码",
            role: "具体代码",
            grain: "小颗粒度",
            path: ["Git 工具", "命令与代码"],
            parentId: "overview",
            status: "新建笔记",
            body: "## 命令代码\n```bash\ngit clone demo\n```",
            evidence: ["原文代码段"],
          },
        ],
        relations: [{ type: "前置知识", source: "steps", target: "concepts", evidence: "先理解概念再执行步骤", confidence: "高" }],
        corrections: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid v2 analysis plan");
    const batch = createReviewBatchFromAnalysisPlan(sources, parsed.output);

    expect(batch.notes.map((note) => note.title)).toEqual([
      "Git 工具总览",
      "Git 工具基本概念",
      "Git 工具应用步骤",
      "Git 常用命令与代码",
    ]);
    expect(batch.relations).toContainEqual({ type: "包含", source: "Git 工具总览", target: "Git 工具基本概念" });
    expect(batch.relations).toContainEqual({ type: "包含", source: "Git 工具总览", target: "Git 工具应用步骤" });
    expect(batch.relations).toContainEqual({ type: "包含", source: "Git 工具总览", target: "Git 常用命令与代码" });
    expect(batch.relations).toContainEqual({ type: "前置知识", source: "Git 工具应用步骤", target: "Git 工具基本概念" });
  });

  it("places child sections inside separate integration folders under the same vault directory", () => {
    const source: IntakeSource = {
      id: "src-react-list-and-form",
      title: "React 列表和表单记录",
      type: "text",
      stackHint: "React",
      content: [
        "CardProps 配合 .map 渲染数据列表，key 需要稳定唯一。表单输入可以用 value 和 onChange 管理。",
        "这份材料还详细记录了列表渲染的数据准备、props 传递、key 的复用风险、表单输入状态更新和提交处理。",
        "列表和表单主题都包含多个可独立复用的小知识点，因此允许拆成超过五个知识分段。",
      ].join("").repeat(40),
    };
    const vaultContext = {
      roots: [{ name: "React", noteCount: 0, paths: ["React", "React/基础"] }],
      notes: [],
      relations: [],
    };
    const reactBaseId = buildVaultKnowledgeIndex(vaultContext).find((node) => node.path === "React/基础")?.id ?? "";
    const basePlacement = {
      mode: "new-child",
      parentNodeId: reactBaseId,
      branchName: null,
      targetNodeId: null,
    };

    const batch = createReviewBatchFromAnalysisPlan([source], {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [{ sourceId: source.id, name: "React", confidence: "高", evidence: ["用户提示"] }],
      sections: [
        {
          id: "data-to-page",
          sourceId: source.id,
          title: "数据投放到网页上方法",
          role: "总览",
          grain: "中颗粒度",
          placement: basePlacement,
          parentId: null,
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 简要说明\n- 数据列表可以通过 props 输入，再用 .map 渲染到页面。",
          evidence: ["CardProps 配合 .map 渲染数据列表"],
        },
        {
          id: "card-props-map",
          sourceId: source.id,
          title: "CardProps + .map 渲染数据列表",
          role: "具体代码",
          grain: "小颗粒度",
          placement: basePlacement,
          parentId: "data-to-page",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 代码模式\n- 用 CardProps 描述数据结构，再通过 .map 输出列表元素。",
          evidence: ["CardProps 配合 .map 渲染数据列表"],
        },
        {
          id: "react-key",
          sourceId: source.id,
          title: "React key：稳定唯一的列表身份标识",
          role: "基本概念",
          grain: "小颗粒度",
          placement: basePlacement,
          parentId: "data-to-page",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 核心概念\n- key 用来帮助 React 识别列表项身份，应该稳定且唯一。",
          evidence: ["key 需要稳定唯一"],
        },
        {
          id: "form-state",
          sourceId: source.id,
          title: "表单输入状态管理",
          role: "总览",
          grain: "中颗粒度",
          placement: basePlacement,
          parentId: null,
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 简要说明\n- 表单输入可以交给 React state 管理。",
          evidence: ["表单输入可以用 value 和 onChange 管理"],
        },
        {
          id: "controlled-input",
          sourceId: source.id,
          title: "受控组件 value 与 onChange",
          role: "基本概念",
          grain: "小颗粒度",
          placement: basePlacement,
          parentId: "form-state",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 核心概念\n- value 绑定状态，onChange 更新状态。",
          evidence: ["value 和 onChange"],
        },
        {
          id: "form-submit",
          sourceId: source.id,
          title: "表单提交 preventDefault",
          role: "应用步骤",
          grain: "小颗粒度",
          placement: basePlacement,
          parentId: "form-state",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 操作流程\n- 提交事件中阻止默认刷新，再处理数据。",
          evidence: ["表单输入"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    }, { vaultContext });

    expect(batch.notes.map((note) => [note.title, note.path])).toEqual([
      ["数据投放到网页上方法", "React / 基础"],
      ["CardProps + .map 渲染数据列表", "React / 基础 / 数据投放到网页上方法"],
      ["React key：稳定唯一的列表身份标识", "React / 基础 / 数据投放到网页上方法"],
      ["表单输入状态管理", "React / 基础"],
      ["受控组件 value 与 onChange", "React / 基础 / 表单输入状态管理"],
      ["表单提交 preventDefault", "React / 基础 / 表单输入状态管理"],
    ]);
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toContain(
      "React/基础/数据投放到网页上方法/CardProps + .map 渲染数据列表.md",
    );
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toContain(
      "React/基础/表单输入状态管理/受控组件 value 与 onChange.md",
    );
  });

  it("proposes moving related existing notes into the generated integration folder", () => {
    const source: IntakeSource = {
      id: "src-react-list-existing",
      title: "React 列表渲染补充",
      type: "text",
      stackHint: "React",
      content: [
        "CardProps 配合 .map 渲染数据列表，相关旧笔记是 React key。",
        "这份材料系统整理数据准备、props 传递、列表渲染、key 稳定性、组件复用、状态更新与页面展示之间的关系。",
        "同一主题下包含多项可以独立复用的知识点，因此适合在已有 React/基础 目录下形成一个整合主题文件夹。",
      ].join("").repeat(40),
    };
    const vaultContext = {
      roots: [{ name: "React", noteCount: 1, paths: ["React", "React/基础"] }],
      notes: [
        {
          title: "React key：稳定唯一的列表身份标识",
          path: "React/基础/React key：稳定唯一的列表身份标识.md",
          root: "React",
          headings: ["核心概念"],
          snippet: "key 用来帮助 React 识别列表项身份。",
        },
      ],
      relations: [],
    };
    const vaultIndex = buildVaultKnowledgeIndex(vaultContext);
    const reactBaseId = vaultIndex.find((node) => node.path === "React/基础")?.id ?? "";
    const keyNoteId = vaultIndex.find((node) => node.title === "React key：稳定唯一的列表身份标识")?.id ?? "";

    const batch = createReviewBatchFromAnalysisPlan([source], {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [{ sourceId: source.id, name: "React", confidence: "高", evidence: ["用户提示"] }],
      sections: [
        {
          id: "data-to-page",
          sourceId: source.id,
          title: "数据投放到网页上方法",
          role: "总览",
          grain: "中颗粒度",
          placement: { mode: "new-child", parentNodeId: reactBaseId, branchName: null, targetNodeId: null },
          parentId: null,
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 简要说明\n- 数据列表可以通过 props 输入，再用 .map 渲染到页面。",
          evidence: ["CardProps 配合 .map 渲染数据列表"],
        },
        {
          id: "card-props-map",
          sourceId: source.id,
          title: "CardProps + .map 渲染数据列表",
          role: "具体代码",
          grain: "小颗粒度",
          placement: { mode: "new-child", parentNodeId: reactBaseId, branchName: null, targetNodeId: null },
          parentId: "data-to-page",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "## 代码模式\n- 用 CardProps 描述数据结构，再通过 .map 输出列表元素。",
          evidence: ["CardProps 配合 .map 渲染数据列表"],
        },
      ],
      relations: [
        {
          type: "包含",
          sourceNodeId: "data-to-page",
          targetNodeId: keyNoteId,
          evidence: "旧笔记说明列表 key，是本次列表渲染主题的组成部分",
          confidence: "高",
        },
      ],
      corrections: [],
      uncertain: [],
    }, { vaultContext });

    expect(batch.notes.find((note) => note.id === "card-props-map")?.path).toBe(
      "React / 基础 / 数据投放到网页上方法",
    );
    expect(buildVaultMoveFiles(batch)).toEqual([
      {
        fromPath: "React/基础/React key：稳定唯一的列表身份标识.md",
        toPath: "React/基础/数据投放到网页上方法/React key：稳定唯一的列表身份标识.md",
        noteId: "group-existing-topic-react-key",
        title: "React key：稳定唯一的列表身份标识",
        reason: "既有笔记“React key：稳定唯一的列表身份标识”属于整合主题“数据投放到网页上方法”，确认后迁移到对应整合文件夹。",
      },
    ]);
  });

  it("does not turn short parent-child analysis into an integration folder", () => {
    const source: IntakeSource = {
      id: "src-react-short-list",
      title: "React 列表渲染简短补充",
      type: "text",
      stackHint: "React",
      content: "CardProps 配合 .map 渲染数据列表，key 需要稳定唯一。",
    };
    const vaultContext = {
      roots: [{ name: "React", noteCount: 0, paths: ["React", "React/基础"] }],
      notes: [],
      relations: [],
    };
    const reactBaseId = buildVaultKnowledgeIndex(vaultContext).find((node) => node.path === "React/基础")?.id ?? "";

    const batch = createReviewBatchFromAnalysisPlan([source], {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [{ sourceId: source.id, name: "React", confidence: "高", evidence: ["用户提示"] }],
      sections: [
        {
          id: "data-to-page-short",
          sourceId: source.id,
          title: "数据投放到网页上方法",
          role: "总览",
          grain: "中颗粒度",
          placement: { mode: "new-child", parentNodeId: reactBaseId, branchName: null, targetNodeId: null },
          parentId: null,
          status: "新建笔记",
          existingNoteTitle: null,
          body: "数据列表可以通过 props 输入，再用 .map 渲染到页面。",
          evidence: ["CardProps 配合 .map 渲染数据列表"],
        },
        {
          id: "react-key-short",
          sourceId: source.id,
          title: "React key：稳定唯一的列表身份标识",
          role: "基本概念",
          grain: "小颗粒度",
          placement: { mode: "new-child", parentNodeId: reactBaseId, branchName: null, targetNodeId: null },
          parentId: "data-to-page-short",
          status: "新建笔记",
          existingNoteTitle: null,
          body: "key 用来帮助 React 识别列表项身份，应该稳定且唯一。",
          evidence: ["key 需要稳定唯一"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    }, { vaultContext });

    expect(batch.notes.find((note) => note.id === "react-key-short")?.path).toBe("React / 基础");
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toContain(
      "React/基础/React key：稳定唯一的列表身份标识.md",
    );
    expect(buildVaultMoveFiles(batch)).toEqual([]);
  });

  it("runs every external review pass through the v2 analysis plan", async () => {
    const sources: IntakeSource[] = [
      {
        id: "src-v2-runner",
        title: "操作系统进程",
        type: "text",
        stackHint: "操作系统",
        content: "进程是操作系统进行资源分配的基本单位。",
      },
    ];

    const result = await runReviewSkill(sources, {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "test-key",
      model: "test-model",
      fallbackToLocal: false,
      modelInvoker: async (payload) => {
        expect(payload.request.protocolVersion).toBe(REVIEW_ANALYSIS_PROTOCOL_VERSION);
        expect(payload.request.outputShape.analysisPlan).toBe("ReviewAnalysisPlan");

        return JSON.stringify({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [{ sourceId: "src-v2-runner", name: "操作系统", confidence: "高", evidence: ["用户提示"] }],
          sections: [
            {
              id: "src-v2-runner-process",
              sourceId: "src-v2-runner",
              title: "操作系统进程",
              role: "基本概念",
              grain: "中颗粒度",
              path: ["进程与线程"],
              status: "新建笔记",
              body: "## 核心概念\n- 进程是操作系统进行资源分配的基本单位。",
              evidence: ["原文"]
            }
          ],
          relations: [],
          corrections: [],
          uncertain: []
        });
      },
    });

    expect(result.usedFallback).toBe(false);
    expect(result.batch.notes[0].path).toBe("操作系统 / 进程与线程");
    expect(result.batch.notes[0].markdown).toContain("进程是操作系统进行资源分配的基本单位");
  });

  it("rejects cyclic parent structure in a v2 analysis plan", () => {
    const source: IntakeSource = {
      id: "src-cycle",
      title: "循环结构",
      type: "text",
      stackHint: "测试技术栈",
      content: "两个知识段互相作为父节点。",
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: "src-cycle", name: "测试技术栈", confidence: "高", evidence: ["提示"] }],
        sections: [
          {
            id: "a",
            sourceId: "src-cycle",
            title: "节点 A",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["结构"],
            parentId: "b",
            status: "新建笔记",
            body: "正文 A",
            evidence: ["原文"],
          },
          {
            id: "b",
            sourceId: "src-cycle",
            title: "节点 B",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["结构"],
            parentId: "a",
            status: "新建笔记",
            body: "正文 B",
            evidence: ["原文"],
          },
        ],
        relations: [],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected cyclic parent structure to be rejected");
    expect(parsed.errors.map((error) => error.message)).toContain("父子结构不能形成循环。");
  });

  it("rejects v2 relations whose endpoints are not current sections or known vault notes", () => {
    const source: IntakeSource = {
      id: "src-relation-endpoint",
      title: "UART 记录",
      type: "text",
      stackHint: "TI嵌入式",
      content: "UART 接收字符需要 GPIO 引脚配置。",
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: "src-relation-endpoint", name: "TI嵌入式", confidence: "高", evidence: ["提示"] }],
        sections: [
          {
            id: "uart",
            sourceId: "src-relation-endpoint",
            title: "UART 串口",
            role: "基本概念",
            grain: "中颗粒度",
            path: ["UART 串口"],
            status: "新建笔记",
            body: "UART 用于串行通信。",
            evidence: ["原文"],
          },
        ],
        relations: [
          {
            type: "前置知识",
            source: "UART 串口",
            target: "不存在的节点",
            evidence: "模型误生成的关系",
            confidence: "高",
          },
        ],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected unknown relation endpoint to be rejected");
    expect(parsed.errors.map((error) => error.message)).toContain("关系端点必须引用本次知识分段或既有 Vault 笔记");
  });

  it("allows an existing vault note as a v2 relation endpoint and preserves the relation during compilation", () => {
    const source: IntakeSource = {
      id: "src-existing-relation",
      title: "UART 记录",
      type: "text",
      stackHint: "TI嵌入式",
      content: "UART 接收字符需要 GPIO 引脚配置。",
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [{ sourceId: "src-existing-relation", name: "TI嵌入式", confidence: "高", evidence: ["提示"] }],
      sections: [
        {
          id: "uart",
          sourceId: "src-existing-relation",
          title: "UART 串口",
          role: "基本概念",
          grain: "中颗粒度",
          path: ["UART 串口"],
          status: "新建笔记",
          body: "UART 用于串行通信。",
          evidence: ["原文"],
        },
      ],
      relations: [
        {
          type: "前置知识",
          source: "UART 串口",
          target: "GPIO 接口",
          evidence: "UART 接收字符需要 GPIO 引脚配置。",
          confidence: "高",
        },
      ],
      corrections: [],
      uncertain: [],
    };
    const vaultContext = {
      roots: [{ name: "TI嵌入式", noteCount: 1, paths: ["TI嵌入式/GPIO"] }],
      notes: [
        {
          title: "GPIO 接口",
          path: "TI嵌入式/GPIO/GPIO 接口.md",
          root: "TI嵌入式",
          headings: ["基本概念"],
          snippet: "GPIO 配置引脚方向。",
        },
      ],
      relations: [],
    };
    const parsed = parseReviewAnalysisPlan(JSON.stringify(plan), [source], {
      enforceStackHints: true,
      externalReferenceTitles: ["GPIO 接口"],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected known vault relation endpoint to be accepted");

    const batch = createReviewBatchFromAnalysisPlan([source], parsed.output, { vaultContext });

    expect(batch.relations).toContainEqual({
      type: "前置知识",
      source: "UART 串口",
      target: "GPIO 接口",
    });
    expect(batch.notes[0].markdown).toContain("前置知识：[[GPIO 接口]]");
  });

  it("allows a stack hint root as a v2 relation endpoint without a vault index", () => {
    const source: IntakeSource = {
      id: "src-root-relation",
      title: "Python Web 记录",
      type: "text",
      stackHint: "Python",
      content: "Python 是 Python Web 的前置技术。",
    };
    const parsed = parseReviewAnalysisPlan(
      JSON.stringify({
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        stackDecisions: [{ sourceId: "src-root-relation", name: "Python", confidence: "高", evidence: ["提示"] }],
        sections: [
          {
            id: "python-web",
            sourceId: "src-root-relation",
            title: "Python Web",
            role: "技术栈",
            grain: "中颗粒度",
            path: ["Python Web"],
            status: "新建笔记",
            body: "Python Web 依赖 Python。",
            evidence: ["原文"],
          },
        ],
        relations: [{ type: "前置知识", source: "Python Web", target: "Python", evidence: "原文", confidence: "高" }],
        corrections: [],
        uncertain: [],
      }),
      [source],
    );

    expect(parsed.ok).toBe(true);
  });

  it("marks noisy handwritten PDF extraction before it reaches the review skill", () => {
    const prepared = preparePdfExtractedContent(
      "STM32",
      [
        "STM 2B → 基于 ARMcortexM ⾁ 核",
        "串叫 VABT 1 下载, MCV → 开发板",
        "GPIO = 通⽤输⼊输出端⼝",
        "Syntax Error (cid:15482) ⼜ ⽇ ⼝",
      ].join("\n"),
    );

    expect(prepared.content).toContain("PDF 抽取质量提示");
    expect(prepared.content).toContain("手写或扫描笔记");
    expect(prepared.content).toContain("不要逐字照搬识别噪声");
    expect(prepared.warnings[0]).toContain("手写或扫描笔记");
  });

  it("keeps clean PDF extraction unchanged", () => {
    const content = "PID 是一种闭环控制算法，通过 P、I、D 三项根据误差调整输出。";
    const prepared = preparePdfExtractedContent("PID", content);

    expect(prepared.content).toBe(content);
    expect(prepared.warnings).toEqual([]);
  });

  it("keeps PDF review in normal mode when difficult text is at most 20 percent", () => {
    const prepared = preparePdfExtractedContent("正常 PDF", `${"a".repeat(80)}${"�".repeat(20)}`);

    expect(prepared.quality.qualityStatus).toBe("normal");
    expect(prepared.quality.difficultyRatio).toBeCloseTo(0.2, 5);
    expect(prepared.quality.requiresManualReview).toBe(false);
  });

  it("warns when difficult PDF text is between 20 and 30 percent", () => {
    const prepared = preparePdfExtractedContent("风险 PDF", `${"a".repeat(75)}${"�".repeat(25)}`);

    expect(prepared.quality.qualityStatus).toBe("warning");
    expect(prepared.quality.difficultyRatio).toBeCloseTo(0.25, 5);
    expect(prepared.warnings.join(" ")).toContain("20%～30%");
  });

  it("limits PDF review to confirmed portions when difficult text is between 30 and 50 percent", () => {
    const prepared = preparePdfExtractedContent("部分 PDF", `${"a".repeat(60)}${"�".repeat(40)}`);

    expect(prepared.quality.qualityStatus).toBe("partial");
    expect(prepared.quality.difficultyRatio).toBeCloseTo(0.4, 5);
    expect(prepared.content).toContain("只允许对可确认内容进行部分审理");
  });

  it("blocks definite PDF knowledge when difficult text exceeds 50 percent", () => {
    const prepared = preparePdfExtractedContent("阻断 PDF", `${"a".repeat(40)}${"�".repeat(60)}`);

    expect(prepared.quality.qualityStatus).toBe("blocked");
    expect(prepared.quality.difficultyRatio).toBeCloseTo(0.6, 5);
    expect(prepared.quality.requiresManualReview).toBe(true);
    expect(prepared.content).toContain("禁止生成确定知识");
  });

  it("requires review when a difficult character appears in a critical formula line", () => {
    const prepared = preparePdfExtractedContent("公式 PDF", "1. 核心公式：� = x / y\n普通说明文字");

    expect(prepared.quality.qualityStatus).toBe("normal");
    expect(prepared.quality.requiresManualReview).toBe(true);
    expect(prepared.quality.criticalUnresolved).toContain("1. 核心公式：� = x / y");
  });

  it("passes PDF quality metadata and constraints into the analysis request", () => {
    const prepared = preparePdfExtractedContent("部分 PDF", `${"a".repeat(60)}${"�".repeat(40)}`);
    const request = createReviewAnalysisRequest([
      {
        id: "pdf-quality-source",
        title: "部分 PDF",
        type: "pdf",
        stackHint: "嵌入式",
        content: prepared.content,
        pdfQuality: prepared.quality,
      },
    ]);

    expect(request.sources[0]?.pdfQuality).toEqual(prepared.quality);
    expect(request.constraints.join("\n")).toContain("只允许对可确认片段生成 sections");
    expect(request.constraints.join("\n")).toContain("部分 PDF");
  });

  it("passes normalized PDF page evidence and difficulty metrics into the model request", () => {
    const request = createReviewAnalysisRequest([
      {
        id: "pdf-evidence-source",
        title: "公式扫描件",
        type: "pdf",
        content: "第 2 页：E=mc^2",
        pdfEvidence: {
          pages: [
            {
              page: 2,
              imageWidth: 1200,
              imageHeight: 1600,
              imageReviewRequired: true,
              imageDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
              evidence: [
                {
                  id: "pdf-page-2-text-1",
                  text: "E=mc^2",
                  source: "pdf-text",
                  x: 0.1,
                  y: 0.2,
                  width: 0.3,
                  height: 0.05,
                  confidence: 1,
                  candidates: [],
                },
              ],
            },
          ],
          images: [{
            assetId: "pdf-image-pdf-evidence-source-page-2-1",
            page: 2,
            imageWidth: 320,
            imageHeight: 180,
            x: 0.125,
            y: 0.25,
            width: 0.5,
            height: 0.25,
            imageDataUrl: "data:image/png;base64,aW1hZ2U=",
          }],
        },
        pdfQuality: {
          qualityStatus: "warning",
          difficultyRatio: 0.25,
          difficultCharacterCount: 25,
          totalCharacterCount: 100,
          requiresManualReview: true,
          criticalUnresolved: ["公式：� = x / y"],
        },
      },
    ]);

    expect(request.sources[0]?.pdfEvidence?.pages[0]).toMatchObject({
      page: 2,
      imageReviewRequired: true,
      evidence: [{ id: "pdf-page-2-text-1", x: 0.1, y: 0.2, confidence: 1 }],
    });
    expect(request.sources[0]?.pdfEvidence?.pages[0]?.imageDataUrl).toBeUndefined();
    expect(request.pdfPageManifest?.[0]).toMatchObject({
      imagePagesSent: [2],
      embeddedImages: [{
        assetId: "pdf-image-pdf-evidence-source-page-2-1",
        page: 2,
        x: 0.125,
        y: 0.25,
        width: 0.5,
        height: 0.25,
      }],
      embeddedImagesSent: ["pdf-image-pdf-evidence-source-page-2-1"],
      embeddedImagesOmitted: [],
    });
    expect(request.pdfEvidenceImages).toContainEqual(expect.objectContaining({
      sourceId: "pdf-evidence-source",
      page: 2,
      assetId: "pdf-image-pdf-evidence-source-page-2-1",
      kind: "embedded",
      x: 0.125,
      y: 0.25,
    }));
    expect(request.constraints.join("\n")).toContain("视觉复核");
    expect(request.pdfPageManifest?.[0]?.imagePagesSent).toEqual([2]);
    expect(request.constraints.join("\n")).toContain("assetId");
  });

  it("assesses the original PDF text layer even when the model body uses a visual placeholder", () => {
    const prepared = preparePdfExtractedContent(
      "数字信号处理",
      "【PDF 页面视觉证据】\nPDF 文本层质量不足，已从模型正文中移除。",
      undefined,
      "E[xiu) = Ʃ| xuP\nPEx(n)=□x(n) / N",
      true,
    );

    expect(prepared.quality.qualityStatus).toBe("warning");
    expect(prepared.quality.requiresManualReview).toBe(true);
    expect(prepared.quality.textLayerLowQuality).toBe(true);
    expect(prepared.content).not.toContain("E[xiu)");
    expect(prepared.content).toContain("页面视觉证据");
  });

  it("instructs the review skill to repair handwritten PDF extraction noise semantically", () => {
    const prompt = buildReviewSkillSystemPrompt();

    expect(prompt).toContain("手写");
    expect(prompt).toContain("扫描 PDF");
    expect(prompt).toContain("PDF 页面图像是版面、手写内容和数学公式的主要证据");
    expect(prompt).toContain("忽略其逐行文字证据");
    expect(prompt).not.toContain("OCR");
    expect(prompt).not.toContain("优先以本地 Vision OCR 页面结构");
    expect(prompt).toContain("不要逐字照搬");
  });

  it("keeps example code and comments as evidence only in strict audit prompts", () => {
    const source: IntakeSource = {
      id: "src-hallucination-guard",
      title: "可空字段示例",
      type: "text",
      stackHint: "React",
      content: [
        "React:语法",
        "新建一个 interface 类型的数组来储存数据：",
        "{ title: 'Analog FAE', mjCode: 'MJ000839' },",
        "{ title: 'TSE 技术销售工程师', mjCode: null },",
        "// 没编号 -> null",
      ].join("\n"),
    };
    const request = createReviewAnalysisRequest([source]);
    const prompt = buildReviewSkillSystemPrompt();

    expect(prompt).toContain("示例、注释和代码块只能作为证据");
    expect(prompt).toContain("不要把示例、注释或代码块里的例子当成新的结论");
    expect(request.constraints).toContain("示例、注释和代码块只能作为证据，不得扩写成新的知识点。");
    expect(request.constraints).toContain("不要把示例、注释或代码块里的例子当成新的结论去单独命名笔记。");
  });

  it("splits a Git workflow source into overview, concepts, steps, and command notes", () => {
    const batch = createReviewBatch(
      [
        {
          id: "src-git",
          title: "Git 团队协作",
          type: "text",
          stackHint: "Git",
          content: `作用：团队多人管理项目版本，分流开发

一、基础概念
main分支：主分支，存放始终可运行的稳定代码。
功能分支（feature/xxx）：每个人开发时使用的临时分支。
Pull Request（简称PR）：请求将某个分支合并到另一个分支的操作。
本地仓库：你电脑上的代码文件夹。
远程仓库：GitHub云端上的代码仓库。

2.1 创建团队仓库
登录 GitHub 网站，点击 New repository。

2.2 克隆并创建功能分支
git clone git@github.com:team/demo.git
git checkout -b feature/login`,
        },
      ],
      { now: new Date(2026, 6, 10, 9, 30, 0) },
    );

    expect(batch.notes.map((note) => [note.title, note.grain, note.path])).toEqual([
      ["Git 工具总览", "大颗粒度", "Git / Git 工具"],
      ["Git 工具基本概念", "中颗粒度", "Git / Git 工具 / 基本概念"],
      ["Git 工具应用步骤", "中颗粒度", "Git / Git 工具 / 应用步骤"],
      ["Git 常用命令与代码", "小颗粒度", "Git / Git 工具 / 命令与代码"],
    ]);
    expect(batch.notes[1].markdown).toContain("Pull Request");
    expect(batch.notes[2].markdown).toContain("创建团队仓库");
    expect(batch.notes[3].markdown).toContain("git checkout -b feature/login");
    expect(batch.relations).toContainEqual({
      type: "包含",
      source: "Git 工具总览",
      target: "Git 工具基本概念",
    });
    expect(batch.relations).toContainEqual({
      type: "递进",
      source: "Git 工具基本概念",
      target: "Git 工具应用步骤",
    });
  });

  it("creates a review batch from a validated model skill output", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-model",
        title: "Docker 镜像记录",
        type: "text",
        stackHint: "Docker",
        content: "Docker 镜像是容器运行的只读模板。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-model-docker-image",
            sourceId: "src-model",
            title: "Docker 镜像",
            grain: "中颗粒度",
            path: "Docker / 容器基础 / 镜像",
            status: "新建笔记",
            markdown: "# Docker 镜像\n\n粒度：中颗粒度\n归类：[[Docker]]\n\n## 核心结论\n- Docker 镜像是容器运行的只读模板。",
          },
        ],
        relations: [{ type: "包含", source: "Docker", target: "Docker 镜像" }],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid parsed skill output");

    const batch = createReviewBatchFromSkillOutput(sources, parsed.output, {
      now: new Date(2026, 6, 10, 9, 30, 0),
    });

    expect(batch.notes[0]).toMatchObject({
      title: "Docker 镜像",
      path: "Docker / 容器基础 / 镜像",
    });
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toEqual(["Docker/容器基础/镜像/Docker 镜像.md"]);
  });

  it("normalizes model Markdown into Obsidian file-title friendly notes", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-model-git",
        title: "Git 团队协作",
        type: "text",
        stackHint: "Git",
        content: "Git 笔记包含概念、步骤和命令。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "",
            sourceId: "src-model-git",
            title: "Git 工具应用步骤",
            grain: "中颗粒度",
            path: "Git / Git 工具 / 应用步骤",
            status: "新建笔记",
            markdown:
              "# Git 工具应用步骤\n\n## 正文\n- 先创建仓库，再创建分支。\n\n## 相关笔记\n- [[Git 工具基本概念]]\n- [[Git 常用命令与代码]]",
          },
          {
            id: "src-model-git-commands",
            sourceId: "src-model-git",
            title: "Git 常用命令与代码",
            grain: "小颗粒度",
            path: "Git / Git 工具 / 命令与代码",
            status: "新建笔记",
            markdown: "# Git 常用命令与代码\n\n## 正文\n```bash\ngit checkout -b feature/login\n```",
          },
        ],
        relations: [
          { type: "包含", source: "Git 工具总览", target: "Git 工具应用步骤" },
          { type: "前置知识", source: "Git 工具应用步骤", target: "Git 工具基本概念" },
          { type: "包含", source: "Git 工具应用步骤", target: "Git 常用命令与代码" },
        ],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected missing internal id to be repaired");

    const batch = createReviewBatchFromSkillOutput(sources, parsed.output, {
      now: new Date("2026-07-10T09:30:00.000Z"),
    });
    const note = batch.notes.find((item) => item.title === "Git 工具应用步骤");

    expect(note?.id).toBe("src-model-git-note-1");
    expect(note?.markdown.startsWith("# Git 工具应用步骤")).toBe(false);
    expect(note?.markdown).not.toContain("相关笔记");
    expect(note?.markdown).toContain(
      "粒度：中颗粒度\n上级主题：[[Git 工具总览]]\n前置知识：[[Git 工具基本概念]]",
    );
    expect(note?.markdown.trim().endsWith("## 后续枝节\n- [[Git 常用命令与代码]]")).toBe(true);
  });

  it("repairs blank model note sourceIds when the upload has one source", () => {
    const sources: IntakeSource[] = [
      {
        id: "pasted-1",
        title: "Git 工具",
        type: "text",
        stackHint: "Git工具",
        content: "Git 工具进行版本控制。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "git-overview",
            sourceId: "",
            title: "Git 工具总览",
            grain: "大颗粒度",
            path: "Git / Git 工具",
            status: "新建笔记",
            markdown: "粒度：大颗粒度\n归类：[[Git]]\n\n## 正文\n- Git 用于版本控制。",
          },
          {
            id: "git-concepts",
            sourceId: "   ",
            title: "Git 工具基本概念",
            grain: "中颗粒度",
            path: "Git / Git 工具 / 基本概念",
            status: "新建笔记",
            markdown: "粒度：中颗粒度\n上级主题：[[Git 工具总览]]",
          },
        ],
        relations: [{ type: "包含", source: "Git 工具总览", target: "Git 工具基本概念" }],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected blank note sourceIds to be repaired");
    expect(parsed.output.notes.map((note) => note.sourceId)).toEqual(["pasted-1", "pasted-1"]);
  });

  it("ignores blank model placeholder corrections and relations while preserving strict validation", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-git-placeholder",
        title: "Git 工具记录",
        type: "text",
        stackHint: "Git",
        content: "Git 用于团队版本管理。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [
          { sourceId: "src-git-placeholder", original: "", fixed: "", reason: "" },
          { sourceId: "src-git-placeholder", original: "   ", fixed: "   ", reason: "   " },
        ],
        notes: [
          {
            id: "src-git-placeholder-overview",
            sourceId: "src-git-placeholder",
            title: "Git 工具总览",
            grain: "大颗粒度",
            path: "Git / Git 工具",
            status: "新建笔记",
            markdown: "# Git 工具总览\n\n粒度：大颗粒度\n\n## 核心结论\n- Git 用于团队版本管理。",
          },
        ],
        relations: [
          { type: "包含", source: "", target: "" },
          { type: "递进", source: "   ", target: "   " },
        ],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected blank placeholders to be ignored");
    expect(parsed.output.corrections).toEqual([]);
    expect(parsed.output.relations).toEqual([]);
    expect(parsed.output.notes[0].title).toBe("Git 工具总览");
  });

  it("still rejects partially filled corrections and relations", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-partial",
        title: "部分字段记录",
        type: "text",
        stackHint: "Git",
        content: "Git 用于团队版本管理。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [{ sourceId: "src-partial", original: "错误", fixed: "", reason: "缺少修正内容" }],
        notes: [
          {
            id: "src-partial-note",
            sourceId: "src-partial",
            title: "Git 工具总览",
            grain: "大颗粒度",
            path: "Git / Git 工具",
            status: "新建笔记",
            markdown: "# Git 工具总览",
          },
        ],
        relations: [{ type: "包含", source: "Git 工具总览", target: "" }],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected partial items to stay invalid");
    expect(parsed.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(["$.corrections[0].fixed", "$.relations[0].target"]),
    );
  });

  it("rejects over-split model outputs for short uploaded material", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-short-git",
        title: "Git 简短记录",
        type: "text",
        stackHint: "Git",
        content: "Git 团队协作包含基本概念、应用步骤和常用命令。",
      },
    ];
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: Array.from({ length: 6 }, (_, index) => ({
          id: `src-short-git-note-${index + 1}`,
          sourceId: "src-short-git",
          title: `Git 短材料拆分 ${index + 1}`,
          grain: index === 0 ? "大颗粒度" : "小颗粒度",
          path: `Git / Git 工具 / 过细拆分 ${index + 1}`,
          status: "新建笔记",
          markdown: `粒度：小颗粒度\n\n## 正文\n- 第 ${index + 1} 条。`,
        })),
        relations: [],
        uncertain: [],
      }),
      sources,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected over-split output to be rejected");
    expect(parsed.errors.map((error) => error.path)).toContain("$.notes");
  });

  it("rejects unsafe or malformed skill outputs before creating notes", () => {
    const invalid = {
      protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
      corrections: [],
      notes: [
        {
          id: "bad-note",
          sourceId: "missing-source",
          title: "越界笔记",
          grain: "中颗粒度",
          path: "../真实Vault",
          status: "新建笔记",
          markdown: "# 不应写入",
        },
      ],
      relations: [],
      uncertain: [],
    };

    expect(() => createReviewBatchFromSkillOutput(sampleSources, invalid)).toThrow("知识库 Skill 输出无效");
  });

  it("normalizes common model relation type aliases before validation", () => {
    const parsed = parseReviewSkillOutput(
      JSON.stringify({
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-java-overview",
            sourceId: "src-java",
            title: "Java 输入输出",
            grain: "中颗粒度",
            path: "Java / Java 基础语法 / 输入与输出",
            status: "新建笔记",
            markdown: "粒度：中颗粒度\n归类：[[Java]]\n\n## 正文\n- Java 输入输出。",
          },
        ],
        relations: [
          { type: "前置依赖", source: "Java 输入输出", target: "Java 基础语法" },
          { type: "应用", source: "Java 输入输出", target: "控制台程序" },
          { type: "相关", source: "Java 输入输出", target: "格式化输出" },
        ],
        uncertain: [],
      }),
      sampleSources,
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output?.relations).toEqual([
      { type: "前置知识", source: "Java 输入输出", target: "Java 基础语法" },
      { type: "应用于", source: "Java 输入输出", target: "控制台程序" },
      { type: "并列", source: "Java 输入输出", target: "格式化输出" },
    ]);
  });

  it("normalizes model paths that accidentally use an existing markdown note as a directory", () => {
    const batch = createReviewBatchFromSkillOutput(
      [
        {
          id: "src-task",
          title: "Recurring Task",
          type: "text",
          stackHint: "Obsidian Tasks",
          content: "Recurring task 用于周期性任务。",
        },
      ],
      {
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-task-recurring",
            sourceId: "src-task",
            title: "Recurring Task",
            grain: "小颗粒度",
            path: "ObsidianTasks / RecurringTask.md",
            status: "新建笔记",
            markdown: "粒度：小颗粒度\n归类：[[Obsidian Tasks]]\n\n## 正文\n- 周期任务。",
          },
        ],
        relations: [],
        uncertain: [],
      },
    );

    expect(batch.notes[0].path).toBe("ObsidianTasks");
    expect(noteVaultPath(batch.notes[0])).toBe("ObsidianTasks/Recurring Task.md");
  });

  it("builds a model-facing skill request without granting file write authority", () => {
    const request = createReviewSkillRequest(sampleSources.slice(0, 1), {
      roots: [{ name: "嵌入式", noteCount: 2, paths: ["嵌入式", "嵌入式/GPIO"] }],
      notes: [
        {
          title: "GPIO 接口",
          path: "嵌入式/GPIO/GPIO 接口.md",
          root: "嵌入式",
          headings: ["基本概念", "寄存器配置"],
          snippet: "GPIO 用于通用输入输出。",
        },
      ],
    });
    const prompt = buildReviewSkillSystemPrompt();

    expect(request.protocolVersion).toBe(REVIEW_SKILL_PROTOCOL_VERSION);
    expect(request.outputShape.notes).toBe("GeneratedNote[]");
    expect(request.vaultContext?.roots[0].name).toBe("嵌入式");
    expect(request.vaultContext?.notes[0].title).toBe("GPIO 接口");
    expect(prompt).toContain("不要直接写入 Obsidian");
    expect(prompt).toContain("只负责审理用户上传的学习材料");
    expect(prompt).toContain("优先复用 vaultContext");
    expect(prompt).toContain("少量材料通常生成 2-4 篇笔记");
    expect(request.constraints).toContain("若 vaultContext 中已有同一技术栈或上级目录，优先沿用既有目录与导览结构。");
    expect(request.constraints).toContain("少量输入不要过度拆分：2000 字以内通常 2-4 篇，最多 5 篇。");
    expect(request.constraints).toContain("不要把每一个命令、步骤、短句都单独生成小颗粒度笔记。");
  });

  it("builds model-facing taxonomy candidates without local semantic path overrides", () => {
    const request = createReviewSkillRequest(
      [
        {
          id: "src-port-segment",
          title: "TI嵌入式术语",
          type: "text",
          content: [
            "TI嵌入式",
            "新建中颗粒度：术语",
            "小颗粒度：Port Segment",
            "MSPM0 芯片的 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
          ].join("\n"),
        },
      ],
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 2,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
          },
        ],
        notes: [
          {
            title: "GPIO 接口",
            path: "TI嵌入式/MSPM0G3507/GPIO/GPIO 接口.md",
            root: "TI嵌入式",
            headings: ["基本概念"],
            snippet: "GPIO 端口和引脚配置。",
          },
        ],
        relations: [{ type: "包含", source: "TI嵌入式", target: "GPIO 接口", evidence: "目录结构" }],
      },
    );
    const prompt = buildReviewSkillSystemPrompt();

    expect(request).not.toHaveProperty("classificationHints");
    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      sourceId: "src-port-segment",
      root: "TI嵌入式",
      knowledgeRole: "术语",
      leaf: "Port Segment",
    });
    expect(request.sourceOrganizationSignals?.[0]).not.toHaveProperty("recommendedPathPrefix");
    expect(request.vaultContext?.notes[0].path).toBe("TI嵌入式/GPIO 接口.md");
    expect(request.taxonomyCandidates).toEqual(
      expect.arrayContaining([
        {
          path: "TI嵌入式/MSPM0G3507",
          root: "TI嵌入式",
          kind: "existing-directory",
          evidence: "Vault 已有目录",
        },
        {
          path: "TI嵌入式/MSPM0G3507/GPIO",
          root: "TI嵌入式",
          kind: "existing-directory",
          evidence: "Vault 已有目录",
        },
      ]),
    );
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).not.toContain("TI嵌入式/术语");
    expect(prompt).not.toContain("classificationHints");
    expect(prompt).toContain("统一语义归类判断");
    expect(prompt).toContain("路径决策顺序");
    expect(prompt).toContain("taxonomyCandidates 的最后一级目录是否与该知识角色或主题一致");
    expect(prompt).toContain("taxonomyCandidates");
  });

  it("keeps matched device directories as candidates without adding unrelated child directories", () => {
    const selected = selectVaultContextForSources(
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 40,
            paths: [
              "TI嵌入式",
              ...Array.from({ length: 24 }, (_value, index) => `TI嵌入式/其他目录${String(index).padStart(2, "0")}`),
              "TI嵌入式/MSPM0G3507",
              "TI嵌入式/MSPM0G3507/GPIO",
            ],
          },
        ],
        notes: [],
        relations: [],
      },
      [
        {
          id: "src-port-segment-fuzzy",
          title: "TI嵌入式术语",
          type: "text",
          content: [
            "TI嵌入式",
            "新建中颗粒度：术语",
            "小颗粒度：Port Segment",
            "MSPM0 芯片的 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
          ].join("\n"),
        },
      ],
    );
    const request = createReviewSkillRequest(
      [
        {
          id: "src-port-segment-fuzzy",
          title: "TI嵌入式术语",
          type: "text",
          content: [
            "TI嵌入式",
            "新建中颗粒度：术语",
            "小颗粒度：Port Segment",
            "MSPM0 芯片的 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
          ].join("\n"),
        },
      ],
      selected,
    );

    expect(selected?.roots[0].paths).toContain("TI嵌入式/MSPM0G3507");
    expect(selected?.roots[0].paths).not.toContain("TI嵌入式/MSPM0G3507/GPIO");
    expect(request).not.toHaveProperty("classificationHints");
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).toContain("TI嵌入式/MSPM0G3507");
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).not.toContain("TI嵌入式/MSPM0G3507/GPIO");
    expect((request.taxonomyCandidates ?? []).map((candidate) => candidate.path)).not.toContain("TI嵌入式/术语");
  });

  it("does not synthesize a new term branch from local parsing", () => {
    const request = createReviewSkillRequest(
      [
        {
          id: "src-port-segment-sibling",
          title: "TI嵌入式术语",
          type: "text",
          content: [
            "TI嵌入式",
            "新建中颗粒度：术语",
            "小颗粒度：Port Segment",
            "MSPM0 芯片的 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
          ].join("\n"),
        },
      ],
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 2,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507/GPIO"],
          },
        ],
        notes: [],
        relations: [],
      },
    );

    expect(request).not.toHaveProperty("classificationHints");
    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      root: "TI嵌入式",
      knowledgeRole: "术语",
      leaf: "Port Segment",
    });
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).not.toContain("TI嵌入式/术语");
    expect(request.taxonomyCandidates?.every((candidate) => candidate.kind === "existing-directory")).toBe(true);
  });

  it("extracts a title organization signal without creating a candidate branch", () => {
    const request = createReviewSkillRequest(
      [
        {
          id: "src-lower-upper",
          title: "TI嵌入式术语 Lower Upper",
          type: "text",
          content: "Lower/Upper 表示端口 0 到 15 与 16 到 31 的两个分段。",
        },
      ],
      {
        roots: [{ name: "TI嵌入式", noteCount: 1, paths: ["TI嵌入式"] }],
        notes: [],
        relations: [],
      },
    );

    expect(request).not.toHaveProperty("classificationHints");
    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      root: "TI嵌入式",
      knowledgeRole: "术语",
    });
    expect(request.sourceOrganizationSignals?.[0]).not.toHaveProperty("recommendedPathPrefix");
    expect((request.taxonomyCandidates ?? []).map((candidate) => candidate.path)).not.toContain("TI嵌入式/术语");
  });

  it("extracts explicit arrow hierarchy signals without requiring the word new", () => {
    const request = createReviewSkillRequest(
      [
        {
          id: "src-uart",
          title: "UART串口",
          type: "text",
          content: [
            "TI嵌入式：(TI嵌入式->MSPM0G3507->UART串口）",
            "UART串口",
            "ccs设置：确认引脚 设置接收中断",
            "发送单个字符 DL_UART_transmitData(UART_0_INST, 'a');",
            "终端：screen /dev/cu.usbmodemNOserial1 9600",
          ].join("\n"),
        },
      ],
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 3,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
          },
        ],
        notes: [
          {
            title: "GPIO 接口",
            path: "TI嵌入式/MSPM0G3507/GPIO/GPIO 接口.md",
            root: "TI嵌入式",
            headings: ["基本概念"],
            snippet: "GPIO 引脚配置。",
          },
        ],
        relations: [],
      },
    );
    const prompt = buildReviewSkillSystemPrompt();

    expect(request.sourceOrganizationSignals?.[0]).toMatchObject({
      sourceId: "src-uart",
      root: "TI嵌入式",
      leaf: "UART串口",
      explicitHierarchy: ["TI嵌入式", "MSPM0G3507", "UART串口"],
    });
    expect(request.sourceOrganizationSignals?.[0].evidence).toContain(
      "用户显式层级：TI嵌入式 -> MSPM0G3507 -> UART串口",
    );
    expect(request.sourceOrganizationSignals?.[0]).not.toHaveProperty("recommendedPathPrefix");
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).toContain("TI嵌入式/MSPM0G3507/GPIO");
    expect(prompt).toContain("explicitHierarchy");
    expect(prompt).toContain("用户显式写出的层级意图");
  });

  it("does not treat an OCR arrow chain in ordinary content as an explicit directory hierarchy", () => {
    const source: IntakeSource = {
      id: "src-os-ocr-arrow",
      title: "随笔",
      type: "pdf",
      stackHint: "操作系统",
      content: [
        "操作系统",
        "操作系统负责进程调度、内存管理和文件管理。",
        "就绪队列指针→ FCB 5→ PBL 1< 跃→ 底",
        "进程队列指针链接的是进程控制块 PCB。",
      ].join("\n"),
    };
    const request = createReviewAnalysisRequest([source]);
    const signal = request.sourceOrganizationSignals?.[0];

    expect(signal?.root).toBe("操作系统");
    expect(signal).not.toHaveProperty("explicitHierarchy");

    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [
        {
          sourceId: source.id,
          name: "操作系统",
          confidence: "高",
          evidence: ["用户填写技术栈提示"],
        },
      ],
      sections: [
        {
          id: "src-os-ocr-arrow-overview",
          sourceId: source.id,
          title: "操作系统核心概念总览",
          role: "总览",
          grain: "大颗粒度",
          path: ["总览"],
          parentId: null,
          status: "新建笔记",
          body: "操作系统负责进程调度、内存管理和文件管理。",
          evidence: ["原文主题"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    };
    const batch = createReviewBatchFromAnalysisPlan([source], plan);

    expect(batch.notes[0].path).toMatch(/^操作系统 \/ 01-.+ \/ 总览$/u);
    expect(batch.notes[0].path).not.toContain("就绪队列指针");
    expect(batch.notes[0].path).not.toContain("FCB");
  });

  it("formats validated note bodies without changing audit structure or placement", () => {
    const source: IntakeSource = {
      id: "src-presentation",
      title: "内存管理学习记录",
      type: "text",
      stackHint: "操作系统",
      content: [
        "操作系统的内存管理包括编译、链接、装入内存和分区分配。",
        "内存管理",
      ].join("\n"),
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [
        {
          sourceId: source.id,
          name: "操作系统",
          confidence: "高",
          evidence: ["用户填写技术栈提示"],
        },
      ],
      sections: [
        {
          id: "src-presentation-memory",
          sourceId: source.id,
          title: "内存管理",
          role: "基本概念",
          grain: "中颗粒度",
          path: ["内存管理"],
          parentId: null,
          status: "新建笔记",
          body: [
            "编译（高级语言 → 机器语言的目标模块）→ 链接（打包目标模块）→ 装入内存。",
            "",
            "- 单一连续分配：内存分为系统区和用户区。",
            "- 固定分区分配：预先划分分区。",
            "- 动态分区分配：按进程大小动态建立分区。",
          ].join("\n"),
          evidence: ["用户原文"],
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    };

    const batch = createReviewBatchFromAnalysisPlan([source], plan, {
      now: new Date(2026, 8, 2, 9, 30, 0),
    });

    expect(batch.sources).toEqual([source]);
    expect(batch.corrections).toEqual([]);
    expect(batch.relations).toEqual([]);
    expect(batch.uncertain).toEqual([]);
    expect(batch.notes[0]).toMatchObject({
      title: "内存管理",
      path: "操作系统",
      status: "新建笔记",
    });
    expect(noteVaultPath(batch.notes[0])).toBe("操作系统/内存管理.md");
    expect(batch.notes[0].markdown).toContain("```mermaid");
    expect(batch.notes[0].markdown).toContain(
      '<span class="lifemind-label" style="font-size: 1.08em; font-weight: 700;">单一连续分配：</span>内存分为系统区和用户区。',
    );
  });

  it("aligns model paths with explicit user organization signals without local recommended-path hints", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-port-segment",
        title: "TI嵌入式术语",
        type: "text",
        content: [
          "TI嵌入式",
          "新建中颗粒度：术语",
          "小颗粒度：Port Segment",
          "MSPM0 芯片的 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
        ].join("\n"),
      },
    ];

    const batch = createReviewBatchFromSkillOutput(
      sources,
      {
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-port-segment-term",
            sourceId: "src-port-segment",
            title: "Port Segment",
            grain: "小颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / GPIO / Port Segment",
            status: "新建笔记",
            markdown: "粒度：小颗粒度\n归类：[[GPIO]]\n\n## 核心概念\n- Port Segment 将 32 个引脚端口分成 Lower 和 Upper。",
          },
        ],
        relations: [{ type: "应用于", source: "Port Segment", target: "GPIO" }],
        uncertain: [],
      },
      {
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 2,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
            },
          ],
          notes: [],
          relations: [],
        },
      },
    );

    expect(batch.notes[0].path).toBe("TI嵌入式 / 术语");
    expect(noteVaultPath(batch.notes[0])).toBe("TI嵌入式/术语/Port Segment.md");
    expect(batch.notes[0].markdown).toContain("归类：[[TI嵌入式]]");
  });

  it("aligns model paths with explicit hierarchy when a related old branch swallows the new topic", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-uart",
        title: "UART串口",
        type: "text",
        content: [
          "TI嵌入式：(TI嵌入式->MSPM0G3507->UART串口）",
          "ccs设置：确认引脚 设置接收中断",
          "发送单个字符 DL_UART_transmitData(UART_0_INST, 'a');",
          "终端：screen /dev/cu.usbmodemNOserial1 9600",
        ].join("\n"),
      },
    ];

    const batch = createReviewBatchFromSkillOutput(
      sources,
      {
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-uart-guide",
            sourceId: "src-uart",
            title: "UART串口",
            grain: "中颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / GPIO / UART串口",
            status: "新建笔记",
            markdown: "粒度：中颗粒度\n归类：[[GPIO]]\n\n## 正文\n- UART 串口用于串口通信。",
          },
          {
            id: "src-uart-code",
            sourceId: "src-uart",
            title: "UART串口发送与接收代码",
            grain: "小颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / GPIO / 具体代码",
            status: "新建笔记",
            markdown: "粒度：小颗粒度\n归类：[[GPIO]]\n\n## 正文\n- 使用 DL_UART_transmitDataBlocking 发送字符。",
          },
        ],
        relations: [{ type: "包含", source: "UART串口", target: "UART串口发送与接收代码" }],
        uncertain: [],
      },
      {
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 3,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
            },
          ],
          notes: [],
          relations: [],
        },
      },
    );

    expect(batch.notes.map((note) => note.path)).toEqual([
      "TI嵌入式 / MSPM0G3507",
      "TI嵌入式 / MSPM0G3507 / UART串口",
    ]);
    expect(noteVaultPath(batch.notes[0])).toBe("TI嵌入式/MSPM0G3507/UART串口.md");
    expect(noteVaultPath(batch.notes[1])).toBe("TI嵌入式/MSPM0G3507/UART串口/UART串口发送与接收代码.md");
    expect(batch.notes[0].markdown).toContain("归类：[[TI嵌入式]]");
    expect(batch.notes[1].markdown).toContain("上级主题：[[UART串口]]");
  });

  it("promotes an existing single topic note into a folder when new notes are its child branches", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-pwm-modes",
        title: "PWM 模式",
        type: "text",
        content: [
          "TI嵌入式（MSPM0G3507->ADC）",
          "PWM模式",
          "边缘向下对齐 Edge-aligned Down Counting",
          "边缘向上对齐 Edge-aligned UP Counting",
          "中心对齐模式 Center aligned",
        ].join("\n"),
      },
    ];

    const batch = createReviewBatchFromSkillOutput(
      sources,
      {
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-pwm-modes-counting",
            sourceId: "src-pwm-modes",
            title: "PWM 计数模式",
            grain: "小颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / ADC",
            status: "新建笔记",
            markdown: "粒度：小颗粒度\n归类：[[ADC]]\n\n## 正文\n- PWM 支持边缘对齐与中心对齐计数模式。",
          },
        ],
        relations: [],
        uncertain: [],
      },
      {
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 1,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507"],
            },
          ],
          notes: [
            {
              title: "PWM",
              path: "TI嵌入式/MSPM0G3507/PWM.md",
              root: "TI嵌入式",
              headings: ["基本概念"],
              snippet: "PWM 用于通过占空比控制输出。",
            },
          ],
          relations: [],
        },
      },
    );

    expect(batch.notes[0].path).toBe("TI嵌入式 / MSPM0G3507 / PWM");
    expect(batch.notes[0].markdown).toContain("上级主题：[[PWM]]");
    expect(buildVaultMoveFiles(batch)).toEqual([
      {
        fromPath: "TI嵌入式/MSPM0G3507/PWM.md",
        toPath: "TI嵌入式/MSPM0G3507/PWM/PWM.md",
        noteId: "promote-existing-topic-pwm",
        title: "PWM",
        reason: "新笔记“PWM 计数模式”是既有主题“PWM”的下级分支，需把单篇旧笔记升级为主题文件夹。",
      },
    ]);
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toContain(
      "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md",
    );
  });

  it("renames a generated same-title guide so it does not overwrite the promoted existing topic note", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-pwm-guide-and-modes",
        title: "PWM 模式",
        type: "text",
        content: "TI嵌入式 MSPM0G3507 PWM模式包含边缘向上、边缘向下和中心对齐。",
      },
    ];

    const batch = createReviewBatchFromSkillOutput(
      sources,
      {
        protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
        corrections: [],
        notes: [
          {
            id: "src-pwm-guide",
            sourceId: "src-pwm-guide-and-modes",
            title: "PWM",
            grain: "中颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / PWM",
            status: "新建笔记",
            markdown: "# PWM\n\n## 正文\n- PWM 是脉宽调制主题导读。",
          },
          {
            id: "src-pwm-counting",
            sourceId: "src-pwm-guide-and-modes",
            title: "PWM 计数模式",
            grain: "小颗粒度",
            path: "TI嵌入式 / MSPM0G3507 / PWM",
            status: "新建笔记",
            markdown: "## 正文\n- PWM 支持边缘对齐与中心对齐计数模式。",
          },
        ],
        relations: [{ type: "包含", source: "PWM", target: "PWM 计数模式" }],
        uncertain: [],
      },
      {
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 1,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507"],
            },
          ],
          notes: [
            {
              title: "PWM",
              path: "TI嵌入式/MSPM0G3507/PWM.md",
              root: "TI嵌入式",
              headings: ["基本概念"],
              snippet: "PWM 用于通过占空比控制输出。",
            },
          ],
          relations: [],
        },
      },
    );

    expect(buildVaultMoveFiles(batch)[0]?.toPath).toBe("TI嵌入式/MSPM0G3507/PWM/PWM.md");
    expect(batch.notes.map((note) => note.title)).toEqual(["PWM 补充说明", "PWM 计数模式"]);
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toEqual([
      "TI嵌入式/MSPM0G3507/PWM/PWM 补充说明.md",
      "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md",
    ]);
  });

  it("applies existing topic promotion to v2 model plans before vault write", () => {
    const source: IntakeSource = {
      id: "src-v2-pwm-child",
      title: "PWM 模式扩展",
      type: "text",
      stackHint: "TI嵌入式",
      content: "PWM 计数模式是 PWM 的下级知识。",
    };
    const plan = {
      protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
      stackDecisions: [{ sourceId: source.id, name: "TI嵌入式", confidence: "高", evidence: ["用户提示"] }],
      sections: [
        {
          id: "pwm-counting",
          sourceId: source.id,
          title: "PWM 计数模式",
          role: "基本概念",
          grain: "小颗粒度",
          path: ["MSPM0G3507", "GPIO"],
          status: "新建笔记",
          body: "## 核心概念\n- PWM 支持多种计数模式。",
          evidence: ["原文"]
        },
      ],
      relations: [],
      corrections: [],
      uncertain: [],
    };
    const batch = createReviewBatchFromAnalysisPlan([source], plan, {
      vaultContext: {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 1,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507"],
          },
        ],
        notes: [
          {
            title: "PWM",
            path: "TI嵌入式/MSPM0G3507/PWM.md",
            root: "TI嵌入式",
            headings: ["基本概念"],
            snippet: "PWM 用于输出占空比控制。",
          },
        ],
        relations: [],
      },
    });

    expect(batch.notes[0].path).toBe("TI嵌入式 / MSPM0G3507 / PWM");
    expect(batch.relations).toContainEqual({ type: "包含", source: "PWM", target: "PWM 计数模式" });
    expect(batch.moves).toEqual([
      {
        fromPath: "TI嵌入式/MSPM0G3507/PWM.md",
        toPath: "TI嵌入式/MSPM0G3507/PWM/PWM.md",
        noteId: "promote-existing-topic-pwm",
        title: "PWM",
        reason: "新笔记“PWM 计数模式”是既有主题“PWM”的下级分支，需把单篇旧笔记升级为主题文件夹。",
      },
    ]);
  });

  it("renames duplicate generated notes in the same folder so one batch cannot overwrite itself", () => {
    const sources: IntakeSource[] = [
      {
        id: "src-duplicate-pwm",
        title: "PWM 模式",
        type: "text",
        content: "PWM 模式包含边缘对齐和中心对齐。",
      },
    ];

    const batch = createReviewBatchFromSkillOutput(sources, {
      protocolVersion: REVIEW_SKILL_PROTOCOL_VERSION,
      corrections: [],
      notes: [
        {
          id: "src-duplicate-pwm-edge",
          sourceId: "src-duplicate-pwm",
          title: "PWM 计数模式",
          grain: "小颗粒度",
          path: "TI嵌入式 / MSPM0G3507 / PWM",
          status: "新建笔记",
          markdown: "## 正文\n- 边缘对齐按周期边界计数。",
        },
        {
          id: "src-duplicate-pwm-center",
          sourceId: "src-duplicate-pwm",
          title: "PWM 计数模式",
          grain: "小颗粒度",
          path: "TI嵌入式 / MSPM0G3507 / PWM",
          status: "新建笔记",
          markdown: "## 正文\n- 中心对齐围绕周期中心计数。",
        },
      ],
      relations: [
        { type: "并列", source: "src-duplicate-pwm-edge", target: "src-duplicate-pwm-center" },
      ],
      uncertain: [],
    });

    expect(batch.notes.map((note) => note.title)).toEqual(["PWM 计数模式", "PWM 计数模式 2"]);
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toEqual([
      "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式.md",
      "TI嵌入式/MSPM0G3507/PWM/PWM 计数模式 2.md",
    ]);
    expect(batch.relations).toContainEqual({
      type: "并列",
      source: "PWM 计数模式",
      target: "PWM 计数模式 2",
    });
  });

  it("keeps real vault paths for topic promotion when the local fallback runner is used", async () => {
    const result = await runReviewSkill(
      [
        {
          id: "src-local-pwm",
          title: "PWM 模式",
          type: "text",
          content: "TI嵌入式 MSPM0G3507 PWM模式包含边缘向上、边缘向下和中心对齐。",
        },
      ],
      {
        provider: "local",
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 1,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507"],
            },
          ],
          notes: [
            {
              title: "PWM",
              path: "TI嵌入式/MSPM0G3507/PWM.md",
              root: "TI嵌入式",
              headings: ["基本概念"],
              snippet: "PWM 用于输出占空比控制。",
            },
          ],
          relations: [],
        },
      },
    );

    expect(buildVaultMoveFiles(result.batch)[0]?.fromPath).toBe("TI嵌入式/MSPM0G3507/PWM.md");
    expect(buildVaultMoveFiles(result.batch)[0]?.toPath).toBe("TI嵌入式/MSPM0G3507/PWM/PWM.md");
  });

  it("uses the second quality review pass as the final external model result", async () => {
    const reviewModes: Array<string | undefined> = [];
    const sources: IntakeSource[] = [
      {
        id: "src-quality-pass",
        title: "Git 学习记录",
        type: "text",
        stackHint: "Git",
        content: "Git 分支用于把功能开发和 main 稳定分支隔离，提交后通过 Pull Request 合并。",
      },
    ];

    const result = await runReviewSkill(sources, {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "test-key",
      model: "test-model",
      qualityPasses: 2,
      modelInvoker: async (payload) => {
        reviewModes.push(payload.request.reviewMode);

        if (payload.request.reviewMode === "draft-pass") {
          expect(payload.request.previousAnalysisPlan).toBeUndefined();

          return JSON.stringify({
            protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
            stackDecisions: [
              {
                sourceId: "src-quality-pass",
                name: "Git",
                confidence: "高",
                evidence: ["原文明确说明 Git 分支用于协作"],
              },
            ],
            sections: [
              {
                id: "src-quality-pass-git-rough",
                sourceId: "src-quality-pass",
                title: "Git 笔记",
                role: "总览",
                grain: "大颗粒度",
                path: ["Git 工具"],
                parentId: null,
                status: "新建笔记",
                existingNoteTitle: null,
                body: "Git 可以管理分支。",
                evidence: ["原文"],
              },
            ],
            corrections: [],
            relations: [],
            uncertain: [],
          });
        }

        expect(payload.request.reviewMode).toBe("final-pass");
        expect(payload.request.previousAnalysisPlan?.sections[0].title).toBe("Git 笔记");

        return JSON.stringify({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            {
              sourceId: "src-quality-pass",
              name: "Git",
              confidence: "高",
              evidence: ["原文明确说明 Git 分支用于协作"],
            },
          ],
          sections: [
            {
              id: "src-quality-pass-git-overview",
              sourceId: "src-quality-pass",
              title: "Git 分支协作总览",
              role: "总览",
              grain: "大颗粒度",
              path: ["Git 工具"],
              parentId: null,
              status: "新建笔记",
              existingNoteTitle: null,
              body: "Git 分支用于隔离功能开发与稳定主线。",
              evidence: ["原文"],
            },
          ],
            corrections: [],
          relations: [],
          uncertain: [],
        });
      },
    });

    expect(reviewModes).toEqual(["draft-pass", "final-pass"]);
    expect(result.batch.notes[0].title).toBe("Git 分支协作总览");
    expect(result.message).toContain("二轮复审");
  });

  it("passes existing vault knowledge context to the review model", async () => {
    const result = await runReviewSkill(
      [
        {
          id: "src-delay",
          title: "系统延时",
          type: "text",
          stackHint: "嵌入式",
          content: "系统延时用于在 GPIO 操作之间等待外设状态稳定。",
        },
      ],
      {
        provider: "deepseek",
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        model: "test-model",
        vaultContext: {
          roots: [{ name: "嵌入式", noteCount: 1, paths: ["嵌入式", "嵌入式/GPIO"] }],
          notes: [
            {
              title: "GPIO 接口",
              path: "嵌入式/GPIO/GPIO 接口.md",
              root: "嵌入式",
              headings: ["基本概念"],
              snippet: "GPIO 用于通用输入输出。",
            },
          ],
        },
        modelInvoker: async (payload) => {
          expect(payload.request.vaultContext?.roots[0].name).toBe("嵌入式");
          expect(payload.request.vaultContext?.notes[0].title).toBe("GPIO 接口");

          return JSON.stringify({
            protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
            stackDecisions: [
              {
                sourceId: "src-delay",
                name: "嵌入式",
                confidence: "高",
                evidence: ["用户填写技术栈提示"],
              },
            ],
            sections: [
              {
                id: "src-delay-system-delay",
                sourceId: "src-delay",
                title: "系统延时",
                role: "应用步骤",
                grain: "中颗粒度",
                path: ["系统时序", "延时"],
                parentId: null,
                status: "新建笔记",
                existingNoteTitle: null,
                body: "系统延时用于等待外设状态稳定。",
                evidence: ["原文"],
              },
            ],
            relations: [
              {
                type: "前置知识",
                source: "系统延时",
                target: "GPIO 接口",
                evidence: "系统延时用于等待 GPIO 状态稳定。",
                confidence: "高",
              },
            ],
            corrections: [],
            uncertain: [],
          });
        },
      },
    );

    expect(result.batch.notes[0].path).toBe("嵌入式 / 系统时序 / 延时");
    expect(result.batch.notes[0].markdown).toContain("前置知识：[[GPIO 接口]]");
  });

  it("selects a relevant vault relationship subgraph for uploaded sources", () => {
    const context = {
      roots: [
        { name: "嵌入式", noteCount: 3, paths: ["嵌入式", "嵌入式/GPIO", "嵌入式/系统时序"] },
        { name: "React", noteCount: 1, paths: ["React"] },
      ],
      notes: [
        {
          title: "GPIO 接口",
          path: "嵌入式/GPIO/GPIO 接口.md",
          root: "嵌入式",
          headings: ["基本概念"],
          snippet: "GPIO 用于通用输入输出。",
        },
        {
          title: "系统延时",
          path: "嵌入式/系统时序/系统延时.md",
          root: "嵌入式",
          headings: ["应用场景"],
          snippet: "系统延时用于等待外设状态稳定。",
        },
        {
          title: "React 组件",
          path: "React/组件.md",
          root: "React",
          headings: ["组件"],
          snippet: "React 组件用于复用 UI。",
        },
      ],
      relations: [
        { type: "前置知识", source: "系统延时", target: "GPIO 接口", evidence: "前置知识：[[GPIO 接口]]" },
        { type: "双链", source: "GPIO 接口", target: "系统延时", evidence: "[[系统延时]]" },
        { type: "包含", source: "React", target: "React 组件", evidence: "目录结构" },
      ],
    };

    const selected = selectVaultContextForSources(context, [
      {
        id: "src-delay",
        title: "系统延时",
        type: "text",
        stackHint: "嵌入式",
        content: "GPIO 翻转后可以用系统延时等待外设状态稳定。",
      },
    ]);

    expect(selected?.roots.map((root) => root.name)).toEqual(["嵌入式"]);
    expect(selected?.notes.map((note) => note.title)).toEqual(["GPIO 接口", "系统延时"]);
    expect(selected?.relations).toEqual([
      { type: "前置知识", source: "系统延时", target: "GPIO 接口", evidence: "前置知识：[[GPIO 接口]]" },
      { type: "双链", source: "GPIO 接口", target: "系统延时", evidence: "[[系统延时]]" },
    ]);
  });

  it("selects a vault taxonomy root when uploaded text matches an indexed directory path", () => {
    const selected = selectVaultContextForSources(
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 3,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
          },
          { name: "React", noteCount: 1, paths: ["React"] },
        ],
        notes: [],
        relations: [],
      },
      [
        {
          id: "src-port-segment",
          title: "Port Segment",
          type: "text",
          content: "MSPM0G3507 Port Segment 将 32 个引脚端口分成 Lower 和 Upper 两段。",
        },
      ],
    );
    const request = createReviewSkillRequest(
      [
        {
          id: "src-port-segment",
          title: "Port Segment",
          type: "text",
          content: "MSPM0G3507 Port Segment 将 32 个引脚端口分成 Lower 和 Upper 两段。",
        },
      ],
      selected,
    );

    expect(selected?.roots.map((root) => root.name)).toEqual(["TI嵌入式"]);
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).toContain("TI嵌入式/MSPM0G3507");
    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).not.toContain("TI嵌入式/MSPM0G3507/GPIO");
  });

  it("keeps a child taxonomy path only when the child directory itself matches the upload", () => {
    const selected = selectVaultContextForSources(
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 3,
            paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
          },
        ],
        notes: [],
        relations: [],
      },
      [
        {
          id: "src-gpio",
          title: "MSPM0G3507 GPIO",
          type: "text",
          content: "MSPM0G3507 的 GPIO 引脚配置需要设置端口方向。",
        },
      ],
    );
    const request = createReviewSkillRequest(
      [
        {
          id: "src-gpio",
          title: "MSPM0G3507 GPIO",
          type: "text",
          content: "MSPM0G3507 的 GPIO 引脚配置需要设置端口方向。",
        },
      ],
      selected,
    );

    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).toContain("TI嵌入式/MSPM0G3507/GPIO");
  });

  it("keeps the matched taxonomy path when a root has many indexed directories", () => {
    const selected = selectVaultContextForSources(
      {
        roots: [
          {
            name: "TI嵌入式",
            noteCount: 30,
            paths: [
              "TI嵌入式",
              ...Array.from({ length: 18 }, (_value, index) => `TI嵌入式/其他目录${String(index).padStart(2, "0")}`),
              "TI嵌入式/MSPM0G3507",
              "TI嵌入式/MSPM0G3507/GPIO",
            ],
          },
        ],
        notes: [],
        relations: [],
      },
      [
        {
          id: "src-mspm0-term",
          title: "MSPM0G3507 Port Segment",
          type: "text",
          content: "Port Segment 是 MSPM0G3507 里的端口分段术语。",
        },
      ],
    );
    const request = createReviewSkillRequest(
      [
        {
          id: "src-mspm0-term",
          title: "MSPM0G3507 Port Segment",
          type: "text",
          content: "Port Segment 是 MSPM0G3507 里的端口分段术语。",
        },
      ],
      selected,
    );

    expect(request.taxonomyCandidates?.map((candidate) => candidate.path)).toContain("TI嵌入式/MSPM0G3507");
  });

  it("exposes DeepSeek as the only external model provider", () => {
    expect(reviewModelProviderPresets.map((preset) => preset.provider)).toEqual(["deepseek"]);
    expect(reviewModelProviderPresets[0]).toMatchObject({
      label: "DeepSeek",
      apiFormat: "deepseek-strict-tools",
    });
  });

  it("uses disabled thinking and a fixed tool choice for DeepSeek V4 review calls", async () => {
    const sources: IntakeSource[] = [
      {
        id: "src-deepseek-tool-call",
        title: "Git 工具记录",
        type: "text",
        stackHint: "Git",
        content: "Git 用于管理版本。",
      },
    ];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/beta/chat/completions");
      const body = JSON.parse(String(init?.body));

      expect(body.tools[0].function.name).toBe("submit_review_plan");
      expect(body.tools[0].function.strict).toBe(true);
      expect(body.tool_choice).toEqual({
        type: "function",
        function: { name: "submit_review_plan" },
      });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.temperature).toBe(0);
      expect(body.messages[1].content).toContain("src-deepseek-tool-call");

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
                      arguments: JSON.stringify({
                        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
                        stackDecisions: [
                          {
                            sourceId: "src-deepseek-tool-call",
                            name: "Git",
                            confidence: "高",
                            evidence: ["原文明确说明 Git 用于版本管理"],
                          },
                        ],
                        sections: [
                          {
                            id: "src-deepseek-tool-call-git-overview",
                            sourceId: "src-deepseek-tool-call",
                            title: "Git 工具总览",
                            role: "总览",
                            grain: "大颗粒度",
                            path: ["Git 工具"],
                            parentId: null,
                            status: "新建笔记",
                            existingNoteTitle: null,
                            body: "Git 用于管理版本。",
                            evidence: ["原文明确说明 Git 用于版本管理"],
                          },
                        ],
                        relations: [],
                        corrections: [],
                        uncertain: [],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await runReviewSkill(sources, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      fallbackToLocal: false,
      fetcher,
    });

    expect(result.usedFallback).toBe(false);
    expect(result.batch.notes[0].title).toBe("Git 工具总览");
  });

  it("rejects a normal message.content response without a DeepSeek tool call", async () => {
    await expect(
      runReviewSkill(
        [
          {
            id: "src-deepseek-content-only",
            title: "Git 工具记录",
            type: "text",
            stackHint: "Git",
            content: "Git 用于管理版本。",
          },
        ],
        {
          provider: "deepseek",
          apiKey: "test-key",
          fallbackToLocal: false,
          fetcher: async () =>
            new Response(
              JSON.stringify({
                choices: [{ message: { content: "{\"protocolVersion\":\"lifemind.review.v2\"}" } }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        },
      ),
    ).rejects.toThrow("未接受普通 message.content");
  });

  it("normalizes an explicitly configured DeepSeek beta base URL", async () => {
    let requestedUrl = "";

    await expect(
      runReviewSkill(
        [
          {
            id: "src-deepseek-beta-url",
            title: "Git 工具记录",
            type: "text",
            stackHint: "Git",
            content: "Git 用于管理版本。",
          },
        ],
        {
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com/beta",
          apiKey: "test-key",
          model: "deepseek-v4-pro",
          fallbackToLocal: false,
          fetcher: async (input) => {
            requestedUrl = String(input);
            return new Response(
              JSON.stringify({ choices: [{ message: { content: null, tool_calls: [] } }] }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          },
        },
      ),
    ).rejects.toThrow("缺少 submit_review_plan 工具调用参数");

    expect(requestedUrl).toBe("https://api.deepseek.com/beta/chat/completions");
  });

  it("sends protocol validation details in the single repair request", async () => {
    const requests: Array<ReviewAnalysisRequest> = [];
    const sources: IntakeSource[] = [
      {
        id: "src-deepseek-repair",
        title: "Git 记录",
        type: "text",
        stackHint: "Git",
        content: "Git 用于管理版本。",
      },
    ];

    const result = await runReviewSkill(sources, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fallbackToLocal: false,
      modelInvoker: async (payload) => {
        requests.push(payload.request);

        if (requests.length === 1) {
          return JSON.stringify({
            protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
            stackDecisions: [],
            sections: [],
            relations: [],
            corrections: [],
            uncertain: [],
          });
        }

        expect(payload.request.protocolRepair?.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "$.stackDecisions",
            }),
          ]),
        );
        expect(payload.request.protocolRepair?.previousOutput).toContain("stackDecisions");

        return JSON.stringify({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            {
              sourceId: "src-deepseek-repair",
              name: "Git",
              confidence: "高",
              evidence: ["原文明确说明 Git 用于版本管理"],
            },
          ],
          sections: [
            {
              id: "src-deepseek-repair-git",
              sourceId: "src-deepseek-repair",
              title: "Git 工具总览",
              role: "总览",
              grain: "大颗粒度",
              path: ["Git 工具"],
              parentId: null,
              status: "新建笔记",
              existingNoteTitle: null,
              body: "Git 用于管理版本。",
              evidence: ["原文明确说明 Git 用于版本管理"],
            },
          ],
          relations: [],
          corrections: [],
          uncertain: [],
        });
      },
    });

    expect(requests).toHaveLength(2);
    expect(result.batch.notes[0].title).toBe("Git 工具总览");
  });

  it("builds a strict DeepSeek tool request for logic-link review", () => {
    const payload = createDeepSeekLogicLinkModelRequest({
      baseUrl: "https://api.deepseek.com/beta",
      apiKey: "test-key",
      model: "deepseek-chat",
      draft: {
        id: "logic-link-test",
        createdAt: "2026-08-29 09:00:00",
        rangeLabel: "最近 7 天",
        scannedNoteCount: 2,
        selectedNoteCount: 1,
        suggestions: [],
      },
    });

    expect(payload.apiFormat).toBe("deepseek-strict-tools");
    expect(payload.tool).toEqual(deepSeekLogicLinkTool);
    expect(payload.request.protocolVersion).toBe("lifemind.logic-links.v1");
    expect(payload.request.task).toBe("review_logic_link_candidates");
  });

  it("does not let a failing diagnostic logger interrupt protocol repair", async () => {
    const attempts: ReviewAnalysisRequest[] = [];
    const result = await runReviewSkill(
      [
        {
          id: "src-diagnostic-logger",
          title: "Git 记录",
          type: "text",
          stackHint: "Git",
          content: "Git 用于管理版本。",
        },
      ],
      {
        provider: "deepseek",
        apiKey: "test-key",
        fallbackToLocal: false,
        diagnosticLogger: async () => {
          throw new Error("本地日志目录暂时不可写");
        },
        modelInvoker: async (payload) => {
          attempts.push(payload.request);

          if (attempts.length === 1) {
            return JSON.stringify({
              protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
              stackDecisions: [],
              sections: [],
              relations: [],
              corrections: [],
              uncertain: [],
            });
          }

          return JSON.stringify({
            protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
            stackDecisions: [
              {
                sourceId: "src-diagnostic-logger",
                name: "Git",
                confidence: "高",
                evidence: ["原文明确说明 Git 用于版本管理"],
              },
            ],
            sections: [
              {
                id: "src-diagnostic-logger-git",
                sourceId: "src-diagnostic-logger",
                title: "Git 工具总览",
                role: "总览",
                grain: "大颗粒度",
                path: ["Git 工具"],
                parentId: null,
                status: "新建笔记",
                existingNoteTitle: null,
                body: "Git 用于管理版本。",
                evidence: ["原文明确说明 Git 用于版本管理"],
              },
            ],
            relations: [],
            corrections: [],
            uncertain: [],
          });
        },
      },
    );

    expect(attempts).toHaveLength(2);
    expect(result.usedFallback).toBe(false);
    expect(result.batch.notes[0].title).toBe("Git 工具总览");
  });

  it("includes request shape and source structure in diagnostic events", async () => {
    const events: unknown[] = [];
    const source: IntakeSource = {
      id: "src-diagnostic-shape",
      title: "React 请求诊断",
      type: "text",
      stackHint: "React",
      content: ["一、基础", "1. 下拉选择框", "```tsx", "<select value={value}></select>", "```"].join("\n"),
    };

    const result = await runReviewSkill([source], {
      provider: "deepseek",
      apiKey: "test-key",
      fallbackToLocal: false,
      diagnosticLogger: async (event) => {
        events.push(event);
      },
      modelInvoker: async () => {
        if (events.length === 0) {
          return JSON.stringify({
            protocolVersion: "wrong",
            stackDecisions: [],
            sections: [],
            relations: [],
            corrections: [],
            uncertain: [],
          });
        }

        return JSON.stringify({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            {
              sourceId: source.id,
              name: "React",
              confidence: "高",
              evidence: ["用户技术栈提示"],
            },
          ],
          sections: [
            {
              id: "react-select-diagnostic",
              sourceId: source.id,
              title: "React 下拉选择框",
              role: "具体代码",
              grain: "中颗粒度",
              path: ["基础"],
              parentId: null,
              status: "新建笔记",
              existingNoteTitle: null,
              body: "下拉选择框示例：\n```tsx\n<select value={value}></select>\n```",
              evidence: ["原文代码块"],
            },
          ],
          relations: [],
          corrections: [],
          uncertain: [],
        });
      },
    });

    expect(result.usedFallback).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestSummary: {
        apiFormat: "deepseek-strict-tools",
        protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
        sourceCount: 1,
        toolChoice: "submit_review_plan",
        thinking: "disabled",
        sourceStructure: [
          {
            sourceId: source.id,
            codeBlockCount: 1,
            markerCount: 2,
          },
        ],
      },
    });
    expect(JSON.stringify(events[0])).toContain("chinese-section");
    expect(JSON.stringify(events[0])).toContain("arabic-ordered");
    expect(JSON.stringify(events[0])).toContain("wrong");
  });

  it("automatically retries once when the first model output fails protocol validation", async () => {
    let attempts = 0;
    const sources: IntakeSource[] = [
      {
        id: "src-retry",
        title: "Git 记录",
        type: "text",
        stackHint: "Git",
        content: "Git 用于团队版本管理。",
      },
    ];

    const result = await runReviewSkill(sources, {
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "test-key",
      model: "test-model",
      fallbackToLocal: false,
      fetcher: async () => {
        attempts += 1;

        if (attempts === 1) {
          return deepSeekToolResponse({
            protocolVersion: "wrong",
            stackDecisions: [],
            sections: [],
            relations: [],
            corrections: [],
            uncertain: [],
          });
        }

        return deepSeekToolResponse({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            {
              sourceId: "src-retry",
              name: "Git",
              confidence: "高",
              evidence: ["原文明确说明 Git 用于团队版本管理"],
            },
          ],
          sections: [
            {
              id: "src-retry-git",
              sourceId: "src-retry",
              title: "Git 工具总览",
              role: "总览",
              grain: "大颗粒度",
              path: ["Git 工具"],
              parentId: null,
              status: "新建笔记",
              existingNoteTitle: null,
              body: "Git 用于团队版本管理。",
              evidence: ["原文"],
            },
          ],
          relations: [],
          corrections: [],
          uncertain: [],
        });
      },
    });

    expect(attempts).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.message).toContain("自动重试");
    expect(result.batch.notes[0].title).toBe("Git 工具总览");
  });

  it("falls back to local review when model output fails validation", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"protocolVersion\":\"wrong\",\"corrections\":[],\"notes\":[],\"relations\":[],\"uncertain\":[]}" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const result = await runReviewSkill(sampleSources.slice(0, 1), {
      provider: "deepseek",
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetcher,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.provider).toBe("local");
    expect(result.batch.notes[0].title).toBe("Java 控制台输出");
  });

  it("keeps the selected vault context when external review falls back to local", async () => {
    const result = await runReviewSkill(
      [
        {
          id: "src-fallback-term",
          title: "TI嵌入式术语",
          type: "text",
          content: [
            "TI嵌入式",
            "新建中颗粒度：术语",
            "小颗粒度：Port Segment",
            "MSPM0G3507 Port Segment 用于把 32 个引脚端口分成 Lower 和 Upper 两段。",
          ].join("\n"),
        },
      ],
      {
        provider: "deepseek",
        baseUrl: "https://api.example.test",
        apiKey: "test-key",
        model: "test-model",
        vaultContext: {
          roots: [
            {
              name: "TI嵌入式",
              noteCount: 2,
              paths: ["TI嵌入式", "TI嵌入式/MSPM0G3507", "TI嵌入式/MSPM0G3507/GPIO"],
            },
          ],
          notes: [],
          relations: [],
        },
        fetcher: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      protocolVersion: "wrong",
                      corrections: [],
                      notes: [],
                      relations: [],
                      uncertain: [],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.request.taxonomyCandidates?.map((candidate) => candidate.path)).not.toContain("TI嵌入式/术语");
    expect(result.batch.notes[0].path).toBeTruthy();
  });

  it("throws model errors when fallback is disabled", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      runReviewSkill(sampleSources.slice(0, 1), {
        provider: "deepseek",
        baseUrl: "https://api.example.test/v1",
        apiKey: "bad-key",
        model: "test-model",
        fallbackToLocal: false,
        fetcher,
      }),
    ).rejects.toThrow("bad key");
  });

  it("tests external review connection with fallback disabled and protocol validation enabled", async () => {
    const result = await testReviewSkillConnection({
      provider: "deepseek",
      baseUrl: "https://api.example.test",
      apiKey: "test-key",
      model: "test-model",
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        const request = JSON.parse(body.messages[1].content);

        expect(request.protocolVersion).toBe(REVIEW_ANALYSIS_PROTOCOL_VERSION);
        expect(request.sources[0].id).toBe("api-connection-test");
        expect(body.tools[0].function.name).toBe("submit_review_plan");
        expect(body.tool_choice.function.name).toBe("submit_review_plan");

        return deepSeekToolResponse({
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [
            {
              sourceId: "api-connection-test",
              name: "lifemind",
              confidence: "高",
              evidence: ["连接测试材料明确使用 lifemind 技术栈"],
            },
          ],
          sections: [
            {
              id: "api-connection-test-note",
              sourceId: "api-connection-test",
              title: "API 连接测试",
              role: "总览",
              grain: "小颗粒度",
              path: ["lifemind", "API 连接测试"],
              parentId: null,
              status: "新建笔记",
              existingNoteTitle: null,
              body: "外部模型已按协议返回。",
              evidence: ["连接测试材料"],
            },
          ],
          relations: [],
          corrections: [],
          uncertain: [],
        });
      },
    });

    expect(result.usedFallback).toBe(false);
    expect(result.batch.notes[0].title).toBe("API 连接测试");
  });

  it("keeps the shared request prefix stable across draft and final passes", () => {
    const sources = [sampleSources[0]];
    const vaultContext = {
      roots: [{ name: "Git", noteCount: 1, paths: ["Git", "Git/基本概念"] }],
      notes: [
        {
          title: "Git 基本概念",
          path: "Git/基本概念/Git 基本概念.md",
          root: "Git",
          headings: ["概念"],
          snippet: "Git 是分布式版本控制工具。",
        },
      ],
      relations: [],
    };
    const draft = JSON.stringify(createReviewAnalysisRequest(sources, vaultContext, { reviewMode: "draft-pass" }));
    const final = JSON.stringify(
      createReviewAnalysisRequest(sources, vaultContext, {
        reviewMode: "final-pass",
        previousAnalysisPlan: {
          protocolVersion: REVIEW_ANALYSIS_PROTOCOL_VERSION,
          stackDecisions: [],
          sections: [],
          relations: [],
          corrections: [],
          uncertain: [],
        },
      }),
    );
    const firstDifferentIndex = [...draft].findIndex((character, index) => character !== final[index]);

    expect(firstDifferentIndex).toBeGreaterThan(draft.indexOf('"sources"'));
    expect(draft.indexOf('"reviewMode"')).toBeGreaterThan(draft.indexOf('"outputShape"'));
  });

  it("limits the model-facing vault references to the most relevant notes", () => {
    const selected = selectVaultContextForSources(
      {
        roots: [{ name: "嵌入式", noteCount: 40, paths: ["嵌入式", "嵌入式/外设"] }],
        notes: Array.from({ length: 40 }, (_value, index) => ({
          title: `嵌入式笔记 ${index + 1}`,
          path: `嵌入式/外设/嵌入式笔记 ${index + 1}.md`,
          root: "嵌入式",
          headings: ["外设"],
          snippet: "GPIO 外设配置与中断。",
        })),
        relations: [],
      },
      [
        {
          id: "src-gpio",
          title: "GPIO 学习记录",
          type: "text",
          stackHint: "嵌入式",
          content: "GPIO 外设配置与中断。",
        },
      ],
    );

    expect(selected?.notes.length).toBeLessThanOrEqual(12);
  });
});
