import { describe, expect, it } from "vitest";
import { formatKnowledgeMarkdown } from "./lifemind-presentation";

describe("formula presentation", () => {
  it("wraps clear algebraic equations in Obsidian MathJax delimiters", () => {
    expect(formatKnowledgeMarkdown("核心公式：E = mc^2\n速度：v = s / t")).toBe(
      "核心公式：$E = mc^2$\n速度：$v = s / t$",
    );
  });

  it("does not rewrite fenced code, inline code, or ordinary explanatory text", () => {
    expect(
      formatKnowledgeMarkdown([
        "`x = y + 1` 是代码示例。",
        "```ts",
        "const x = y + 1;",
        "```",
        "函数会返回一个新的列表。",
      ].join("\n")),
    ).toBe([
      "`x = y + 1` 是代码示例。",
      "```ts",
      "const x = y + 1;",
      "```",
      "函数会返回一个新的列表。",
    ].join("\n"));
  });

  it("leaves existing MathJax and non-equation comparisons unchanged", () => {
    expect(formatKnowledgeMarkdown("$x^2$\na > b\nwhere count(*) > 3")).toBe(
      "$x^2$\na > b\nwhere count(*) > 3",
    );
  });

  it("wraps equations inside labeled bullets before applying the visual label", () => {
    const formatted = formatKnowledgeMarkdown(
      "- 对离散序列，令 z = e^{sT}，得到 X(z) = Σ x(n)z^{−n}。",
    );

    expect(formatted).toContain("$z = e^{sT}$");
    expect(formatted).toContain("$X(z) = \\sum x(n)z^{-n}$");
    expect(formatted).toContain("lifemind-label");
  });
});
