import { describe, expect, it } from "vitest";
import { formatKnowledgeMarkdown } from "./lifemind-presentation";

describe("knowledge presentation formatter", () => {
  it("turns top-level arrow steps into a Mermaid flowchart and keeps parenthetical explanations below it", () => {
    const result = formatKnowledgeMarkdown(
      "编译（高级语言 → 机器语言的目标模块）→ 链接（打包目标模块）→ 装入内存。",
    );

    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart LR");
    expect(result).toContain("编译");
    expect(result).toContain("链接");
    expect(result).toContain("装入内存");
    expect(result).toContain("高级语言 → 机器语言的目标模块");
    expect(result).not.toContain("编译（高级语言 → 机器语言的目标模块）→");
  });

  it("leaves ambiguous arrow text unchanged", () => {
    const source = "结论 ->";

    expect(formatKnowledgeMarkdown(source)).toBe(source);
  });

  it("escapes Mermaid label delimiters", () => {
    const result = formatKnowledgeMarkdown("步骤[一] -> 步骤\"二\" -> 步骤三");

    expect(result).toContain("步骤&#91;一&#93;");
    expect(result).toContain("步骤&quot;二&quot;");
  });
});

describe("title-content bullets", () => {
  it("emphasizes the title before a Chinese colon", () => {
    const result = formatKnowledgeMarkdown("- 动态分区分配：按进程大小动态建立分区。");

    expect(result).toContain(
      '<span class="lifemind-label" style="font-size: 1.08em; font-weight: 700;">动态分区分配：</span>按进程大小动态建立分区。',
    );
  });

  it("preserves the original space after the colon", () => {
    const result = formatKnowledgeMarkdown("- 标题： 内容");

    expect(result).toContain(">标题：</span> 内容");
  });

  it("does not alter fenced code or ordinary colon prose", () => {
    const source = [
      "说明：这不是列表项。",
      "```text",
      "- 动态分区分配：不要改动代码示例。",
      "编译 → 链接 → 装入内存",
      "```",
      "~~~text",
      "- 固定分区分配：不要改动另一种代码围栏中的内容。",
      "编译 → 链接 → 装入内存",
      "~~~",
    ].join("\n");

    expect(formatKnowledgeMarkdown(source)).toBe(source);
  });
});
