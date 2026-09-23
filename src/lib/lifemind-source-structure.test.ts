import { describe, expect, it } from "vitest";
import {
  analyzeSourceStructure,
  effectiveSourceCharacterCount,
  toSourceStructureSignal,
} from "./lifemind-source-structure";

describe("source structure recognition", () => {
  it("recognizes Chinese, Arabic, circled, markdown, and colon headings without changing source text", () => {
    const content = [
      "一、基础：",
      "下拉选择框<select>：",
      "tsx：",
      "<select>...</select>",
      "",
      "二、语法：",
      "1. filter() —— 数组筛选器",
      "2、includes() —— 字符串判断",
      "（1）受控输入",
      "① value",
      "# 补充说明",
    ].join("\n");

    const structure = analyzeSourceStructure("source-1", content);

    expect(structure.lineCount).toBe(11);
    expect(structure.characterCount).toBe(content.length);
    expect(structure.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 1, label: "基础", kind: "chinese-section", line: 1 }),
        expect.objectContaining({ level: 2, label: "下拉选择框<select>", kind: "colon-heading", line: 2 }),
        expect.objectContaining({ level: 3, label: "tsx", kind: "code-label", line: 3 }),
        expect.objectContaining({ level: 1, label: "语法", kind: "chinese-section", line: 6 }),
        expect.objectContaining({ level: 2, label: "filter()", kind: "arabic-ordered", orderedIndex: 1 }),
        expect.objectContaining({ level: 2, label: "includes()", kind: "arabic-ordered", orderedIndex: 2 }),
        expect.objectContaining({ level: 2, label: "受控输入", kind: "arabic-parenthesized" }),
        expect.objectContaining({ level: 2, label: "value", kind: "circled" }),
        expect.objectContaining({ level: 1, label: "补充说明", kind: "markdown-heading" }),
      ]),
    );
    expect(structure.markerCounts).toMatchObject({
      chineseSection: 2,
      colonHeading: 1,
      codeLabel: 1,
      arabicOrdered: 2,
      arabicParenthesized: 1,
      circled: 1,
      markdownHeading: 1,
    });
  });

  it("counts fenced code blocks and removes duplicate code from effective length", () => {
    const content = [
      "## 代码",
      "```tsx",
      "const value = 1;",
      "```",
      "",
      "```tsx",
      "const value = 1;",
      "```",
      "说明文字",
    ].join("\n");

    const structure = analyzeSourceStructure("source-2", content);

    expect(structure.codeBlockCount).toBe(2);
    expect(structure.codeBlocks).toHaveLength(2);
    expect(new Set(structure.codeBlocks.map((block) => block.fingerprint)).size).toBe(1);
    expect(effectiveSourceCharacterCount(content)).toBeLessThan(content.length);
    expect(toSourceStructureSignal(structure)).toMatchObject({
      sourceId: "source-2",
      codeBlockCount: 2,
      lineCount: 9,
    });
    expect(toSourceStructureSignal(structure)).not.toHaveProperty("codeBlocks");
  });
});
