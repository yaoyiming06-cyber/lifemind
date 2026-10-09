import { describe, expect, it } from "vitest";
import {
  buildVaultKnowledgeIndex,
  buildVaultWriteFiles,
  createReviewBatchFromAnalysisPlan,
  type IntakeSource,
  type ReviewAnalysisPlan,
  type ReviewAnalysisSection,
  type VaultKnowledgeContext,
} from "./lifemind-core";

function source(type: IntakeSource["type"] = "text", id = "source"): IntakeSource {
  return {
    id, type, title: "数据处理", stackHint: "Transformer",
    content: "一、样本统计\n计算阳性和阴性样本数。\n二、不确定标签处理\n选择不确定标签处理策略。",
    ...(type === "pdf" ? { pdfEvidence: { pages: [1, 2].map((page) => ({
      page, imageWidth: 0, imageHeight: 0, imageReviewRequired: false, evidence: [],
    })) } } : {}),
  };
}

function section(id = "statistics", sourceId = "source"): ReviewAnalysisSection {
  return {
    id, sourceId, title: "样本统计", role: "应用步骤", grain: "中颗粒度",
    placement: { mode: "new-root", parentNodeId: null, branchName: null, targetNodeId: null },
    status: "新建笔记", body: "计算阳性和阴性样本数。", formulas: [], imagePlacements: [],
    evidence: ["计算阳性和阴性样本数。"],
  };
}

function plan(sources: IntakeSource[], sections: ReviewAnalysisSection[]): ReviewAnalysisPlan {
  return {
    protocolVersion: "lifemind.review.v2",
    stackDecisions: sources.map((s) => ({ sourceId: s.id, name: "Transformer", confidence: "高", evidence: ["原文主题"] })),
    pageCoverage: sources.filter((s) => s.type === "pdf").flatMap((s) => [1, 2].map((page) => ({
      sourceId: s.id, page, status: "covered" as const,
      sectionIds: [sections.find((item) => item.sourceId === s.id && (page === 1 ? item.id.includes("statistics") : !item.id.includes("statistics")))?.id ?? sections[0].id],
      evidenceIds: [], summary: "对应页面已审理。",
    }))),
    sections, relations: [], corrections: [], uncertain: [],
  };
}

function existingContext(folder = "02-数据处理"): VaultKnowledgeContext {
  return {
    roots: [{ name: "Transformer", noteCount: 1, paths: ["Transformer", `Transformer/${folder}`] }],
    notes: [{ title: "2.3 样本统计基础", path: `Transformer/${folder}/2.3 样本统计基础.md`, root: "Transformer", headings: [], snippet: "样本统计" }],
    relations: [],
  };
}

describe("source organization parity", () => {
  it.each(["text", "markdown", "web", "code", "pdf"] as const)("numbers short %s input and its final write path", (type) => {
    const s = source(type);
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [section()]));
    expect(batch.notes[0]).toMatchObject({ title: "1.1 样本统计", path: "Transformer / 01-样本统计" });
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toEqual(["Transformer/01-样本统计/1.1 样本统计.md"]);
  });

  it.each(["text", "pdf"] as const)("orders reversed %s sections by source position", (type) => {
    const s = source(type);
    const second = { ...section("uncertain"), title: "不确定标签处理", body: "选择不确定标签处理策略。", evidence: ["选择不确定标签处理策略。"] };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [second, section()]));
    expect(batch.notes.map((note) => note.id)).toEqual(["statistics", "uncertain"]);
    expect(batch.notes.map((note) => note.title)).toEqual(["1.1 样本统计", "1.2 不确定标签处理"]);
    expect(batch.notes.map((note) => note.path)).toEqual(["Transformer / 01-样本统计", "Transformer / 02-不确定标签处理"]);
  });

  it("retains stable model order when evidence and headings cannot be located", () => {
    const s = source();
    const sections = ["甲主题", "乙主题"].map((title, i) => ({ ...section(`unknown-${i}`), title, evidence: ["语义归纳"] }));
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], sections));
    expect(batch.notes.map((note) => note.id)).toEqual(["unknown-0", "unknown-1"]);
  });

  it("groups a short parent and branches and updates title-based links", () => {
    const s = source();
    const parent = { ...section("parent"), title: "数据处理", grain: "大颗粒度" as const };
    const child = { ...section(), parentId: "parent" };
    const p = plan([s], [child, parent]);
    p.relations = [{ type: "包含", source: "数据处理", target: "样本统计", evidence: "原文", confidence: "高" }];
    const batch = createReviewBatchFromAnalysisPlan([s], p);
    expect(batch.notes.map((note) => note.id)).toEqual(["parent", "statistics"]);
    expect(batch.notes.map((note) => note.path)).toEqual(["Transformer / 01-数据处理", "Transformer / 01-数据处理"]);
    expect(batch.relations).toEqual([{ type: "包含", source: "1.1 数据处理", target: "1.2 样本统计" }]);
    expect(batch.notes[0].markdown).toContain("[[1.2 样本统计]]");
  });

  it("continues the selected numbered Vault directory without wrapping it again", () => {
    const s = { ...source(), title: "Transformer 数据处理", stackHint: undefined };
    const context = existingContext();
    const directory = buildVaultKnowledgeIndex(context).find((node) => node.path === "Transformer/02-数据处理");
    if (!directory) throw new Error("missing test directory");
    const next = { ...section(), title: "标签策略", placement: { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null } };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(batch.notes[0]).toMatchObject({ title: "2.4 标签策略", path: "Transformer / 02-数据处理" });
  });

  it("continues matching legacy topics and allocates folders after existing ones", () => {
    const s = source();
    const context = existingContext("数据处理");
    context.roots[0].paths.push("Transformer/05-历史主题");
    const next = { ...section(), path: ["数据处理"] };
    delete next.placement;
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(batch.notes[0]).toMatchObject({ title: "2.4 样本统计", path: "Transformer / 06-样本统计 / 数据处理" });
  });

  it("shares counters across sources in the same root", () => {
    const sources = [source("text", "first"), source("markdown", "second")];
    const sections = [section("statistics-first", "first"), section("statistics-second", "second")];
    const batch = createReviewBatchFromAnalysisPlan(sources, plan(sources, sections));
    expect(batch.notes.map((note) => note.title)).toEqual(["1.1 样本统计", "1.2 样本统计"]);
    expect(new Set(batch.notes.map((note) => note.path))).toEqual(new Set(["Transformer / 01-样本统计"]));
  });

  it("reuses the numbered topic directory across batches", () => {
    const s = source();
    const context = existingContext("04-样本统计");
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [section()]), { vaultContext: context });
    expect(batch.notes[0]).toMatchObject({ title: "2.4 样本统计", path: "Transformer / 04-样本统计" });
  });

  it("prioritizes the selected directory over a similar title elsewhere", () => {
    const s = source();
    const context = existingContext();
    context.notes[0] = { ...context.notes[0], title: "2.5 标签策略", path: "Transformer/02-数据处理/2.5 标签策略.md" };
    context.notes.unshift({ ...context.notes[0], title: "1.3 样本统计", path: "Transformer/01-历史统计/1.3 样本统计.md" });
    context.roots[0].paths.push("Transformer/01-历史统计");
    const directory = buildVaultKnowledgeIndex(context).find((node) => node.path === "Transformer/02-数据处理")!;
    const next = { ...section(), placement: { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null } };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(buildVaultWriteFiles(batch)[0].path).toBe("Transformer/02-数据处理/2.6 样本统计.md");
  });

  it("continues the chapter of a reused topic folder even when child titles differ", () => {
    const s = source();
    const context = existingContext("04-数据处理");
    const next = { ...section(), title: "数据处理" };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(buildVaultWriteFiles(batch)[0].path).toBe("Transformer/04-数据处理/2.4 数据处理.md");
  });

  it("orders a parent before its child across uploaded sources", () => {
    const sources = [source("text", "first"), source("markdown", "second")];
    const parent = { ...section("parent", "second"), title: "数据处理", grain: "大颗粒度" as const };
    const child = { ...section("child", "first"), parentId: "parent" };
    const batch = createReviewBatchFromAnalysisPlan(sources, plan(sources, [child, parent]));
    expect(batch.notes.map((note) => note.id)).toEqual(["parent", "child"]);
    expect(batch.notes.map((note) => note.title)).toEqual(["1.1 数据处理", "1.2 样本统计"]);
    expect(batch.relations).toContainEqual({ type: "包含", source: "1.1 数据处理", target: "1.2 样本统计" });
  });

  it.each([false, true])("coalesces duplicate merges into one write and retains relation IDs (multiple sources: %s)", (multipleSources) => {
    const sources = multipleSources ? [source("text", "first"), source("markdown", "second")] : [source()];
    const context = existingContext();
    const target = buildVaultKnowledgeIndex(context).find((node) => node.kind === "note")!;
    const placement = { mode: "existing-note" as const, parentNodeId: null, branchName: null, targetNodeId: target.id };
    const merged = sources.length === 1 ? [sources[0], sources[0]] : sources;
    const sections = merged.map((s, i) => ({ ...section(`merge-${i}`, s.id), placement, title: target.title,
      status: "合并到旧笔记" as const, existingNoteTitle: target.title, body: `第 ${i + 1} 段补充正文。` }));
    const parent = { ...section("parent", sources[0].id), title: "数据处理", grain: "大颗粒度" as const };
    const p = plan(sources, [parent, ...sections]);
    p.relations = sections.map((item) => ({ type: "包含", source: parent.id, target: item.id,
      sourceNodeId: parent.id, targetNodeId: item.id, evidence: "属于数据处理", confidence: "高" }));
    const batch = createReviewBatchFromAnalysisPlan(sources, p, { vaultContext: context });
    const files = buildVaultWriteFiles(batch).filter((file) => file.path === target.path);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain("第 1 段补充正文。");
    expect(files[0].content).toContain("第 2 段补充正文。");
    expect(batch.relations).toEqual([{ type: "包含", source: batch.notes[0].title, target: target.title }]);
    expect(batch.uncertain).toEqual([]);
  });

  it("keeps distinct existing merge files whose paths differ by spaces", () => {
    const s = source();
    const context = existingContext();
    context.notes = ["A B", "AB"].map((title) => ({ ...context.notes[0], title, path: `Transformer/02-数据处理/${title}.md` }));
    const targets = buildVaultKnowledgeIndex(context).filter((node) => node.kind === "note");
    const sections = targets.map((target, i) => ({ ...section(`merge-${i}`), title: target.title,
      existingNoteTitle: target.title, status: "合并到旧笔记" as const,
      placement: { mode: "existing-note" as const, parentNodeId: null, branchName: null, targetNodeId: target.id } }));
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], sections), { vaultContext: context });
    expect(buildVaultWriteFiles(batch).map((file) => file.path)).toEqual(context.notes.map((note) => note.path));
  });

  it("preserves explicit chapters before their children", () => {
    const s = source();
    const parent = { ...section("chapter"), title: "第二章 数据处理", grain: "大颗粒度" as const };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [{ ...section(), parentId: "chapter" }, parent]));
    expect(batch.notes.map((note) => note.title)).toEqual(["第二章 数据处理", "2.1 样本统计"]);
  });

  it("preserves the exact existing merge title and path", () => {
    const s = source();
    const context = existingContext();
    const target = buildVaultKnowledgeIndex(context).find((node) => node.kind === "note");
    if (!target) throw new Error("missing test target");
    const merged = {
      ...section(), title: target.title, status: "合并到旧笔记" as const, existingNoteTitle: target.title,
      placement: { mode: "existing-note" as const, parentNodeId: null, branchName: null, targetNodeId: target.id },
    };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [merged]), { vaultContext: context });
    expect(batch.notes[0]).toMatchObject({ title: "2.3 样本统计基础", path: "Transformer / 02-数据处理" });
    expect(buildVaultWriteFiles(batch)[0].path).toBe(context.notes[0].path);
  });

  it("preserves spaces in an existing merge destination", () => {
    const s = source();
    const context = existingContext("02-数据 处理");
    const target = buildVaultKnowledgeIndex(context).find((node) => node.kind === "note")!;
    const merged = { ...section(), title: target.title, existingNoteTitle: target.title, status: "合并到旧笔记" as const,
      placement: { mode: "existing-note" as const, parentNodeId: null, branchName: null, targetNodeId: target.id } };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [merged]), { vaultContext: context });
    expect(buildVaultWriteFiles(batch)[0].path).toBe(context.notes[0].path);
  });

  it("writes new notes inside the exact selected numbered directory", () => {
    const s = source();
    const context = existingContext("02-Data Processing");
    const directory = buildVaultKnowledgeIndex(context).find((node) => node.path === "Transformer/02-Data Processing")!;
    const next = { ...section(), title: "标签策略", placement: { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null } };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(buildVaultWriteFiles(batch)[0].path).toBe("Transformer/02-Data Processing/2.4 标签策略.md");
  });

  it("distinguishes selected directories whose names differ only by spaces", () => {
    const s = source();
    const context = existingContext("02-DataProcessing");
    context.notes[0] = { ...context.notes[0], title: "1.3 样本统计基础", path: "Transformer/02-DataProcessing/1.3 样本统计基础.md" };
    context.roots[0].paths.push("Transformer/02-Data Processing");
    context.notes.push({ ...context.notes[0], title: "2.5 标签策略", path: "Transformer/02-Data Processing/2.5 标签策略.md" });
    const directory = buildVaultKnowledgeIndex(context).find((node) => node.path === "Transformer/02-Data Processing")!;
    const next = { ...section(), placement: { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null } };
    const batch = createReviewBatchFromAnalysisPlan([s], plan([s], [next]), { vaultContext: context });
    expect(buildVaultWriteFiles(batch)[0].path).toBe("Transformer/02-Data Processing/2.6 样本统计.md");
  });

  it("moves an existing member into the final numbered parent folder", () => {
    const s = { ...source(), content: `${source().content}\n${"补充正文内容。".repeat(900)}` };
    const context: VaultKnowledgeContext = {
      roots: [{ name: "Transformer", noteCount: 1, paths: ["Transformer", "Transformer/基础"] }],
      notes: [{ title: "旧标签策略", path: "Transformer/基础/旧标签策略.md", root: "Transformer", headings: [], snippet: "标签策略" }],
    };
    const index = buildVaultKnowledgeIndex(context);
    const directory = index.find((node) => node.path === "Transformer/基础")!;
    const target = index.find((node) => node.kind === "note")!;
    const placement = { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null };
    const parent = { ...section("parent"), title: "数据处理", grain: "大颗粒度" as const, placement };
    const p = plan([s], [parent, { ...section(), parentId: "parent", placement }]);
    p.relations = [{ type: "包含", source: "parent", target: target.id, sourceNodeId: "parent", targetNodeId: target.id, evidence: "标签策略属于数据处理", confidence: "高" }];
    const batch = createReviewBatchFromAnalysisPlan([s], p, { vaultContext: context });
    expect(batch.moves.map((move) => move.toPath)).toEqual(["Transformer/01-数据处理/基础/旧标签策略.md"]);
    expect(batch.moves[0].toPath.split("/").slice(0, -1).join("/")).toBe(buildVaultWriteFiles(batch)[1].path.split("/").slice(0, -1).join("/"));
  });

  it("keeps a merge target in place when grouping also proposes moving it", () => {
    const s = { ...source(), content: `${source().content}\n${"补充正文内容。".repeat(900)}` };
    const context = existingContext("基础");
    const index = buildVaultKnowledgeIndex(context);
    const directory = index.find((node) => node.path === "Transformer/基础")!;
    const target = index.find((node) => node.kind === "note")!;
    const placement = { mode: "new-child" as const, parentNodeId: directory.id, branchName: null, targetNodeId: null };
    const parent = { ...section("parent"), title: "数据处理", grain: "大颗粒度" as const, placement };
    const merge = { ...section("merge"), title: target.title, existingNoteTitle: target.title, status: "合并到旧笔记" as const,
      placement: { mode: "existing-note" as const, parentNodeId: null, branchName: null, targetNodeId: target.id } };
    const p = plan([s], [parent, { ...section(), parentId: "parent", placement }, merge]);
    p.relations = [{ type: "包含", source: "parent", target: target.id, sourceNodeId: "parent", targetNodeId: target.id, evidence: "属于数据处理", confidence: "高" }];
    const batch = createReviewBatchFromAnalysisPlan([s], p, { vaultContext: context });
    expect(batch.moves).toEqual([]);
    expect(buildVaultWriteFiles(batch).filter((file) => file.path === target.path)).toHaveLength(1);
  });
});
