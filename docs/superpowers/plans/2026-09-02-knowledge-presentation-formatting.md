# Knowledge Presentation Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative, local-only Markdown formatting for step diagrams and title-content bullets without changing the external audit protocol or validated knowledge data.

**Architecture:** Create one pure formatter module that transforms only recognized body lines. Call it from the existing local Markdown normalization path after managed audit sections are removed and before the final note string is assembled. Unsupported, malformed, or fenced-code content passes through unchanged.

**Tech Stack:** TypeScript, Vitest, existing Markdown output pipeline, Obsidian Mermaid rendering.

---

### Task 1: Add formatter behavior tests

**Files:**
- Create: `src/lib/lifemind-presentation.test.ts`
- Test only: `src/lib/lifemind-presentation.ts` (the import will initially fail)

- [ ] **Step 1: Write the failing tests for arrow diagrams.**

```ts
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
});
```

- [ ] **Step 2: Write the failing tests for title-content bullets and safety boundaries.**

```ts
describe("title-content bullets", () => {
  it("emphasizes the title before a Chinese colon", () => {
    const result = formatKnowledgeMarkdown("- 动态分区分配：按进程大小动态建立分区。");

    expect(result).toContain('<span class="lifemind-label">动态分区分配：</span>按进程大小动态建立分区。');
  });

  it("does not alter fenced code or ordinary colon prose", () => {
    const source = [
      "说明：这不是列表项。",
      "```text",
      "- 动态分区分配：不要改动代码示例。",
      "编译 → 链接 → 装入内存",
      "```",
    ].join("\n");

    expect(formatKnowledgeMarkdown(source)).toBe(source);
  });
});
```

- [ ] **Step 3: Run the focused test file and verify it fails because the formatter module does not exist.**

Run: `npx vitest run src/lib/lifemind-presentation.test.ts --reporter=verbose`

Expected: FAIL with a module-not-found error for `./lifemind-presentation`.

### Task 2: Implement the pure formatter

**Files:**
- Create: `src/lib/lifemind-presentation.ts`

- [ ] **Step 1: Implement line scanning with fenced-code protection.**

Export:

```ts
export function formatKnowledgeMarkdown(markdown: string): string;
```

Normalize only CRLF line endings, scan line by line, preserve fence lines and
all lines inside triple-backtick fences, and join the transformed lines with
the original newline style normalized to `\n`.

- [ ] **Step 2: Implement top-level arrow parsing.**

Recognize `→`, `➜`, `➡`, and `->` only when the line contains at least two
top-level separators. Track `（ ）`, `( )`, `【 】`, `[ ]`, and `{ }` depth so
arrows inside explanations are not treated as step separators. Trim a trailing
Chinese or ASCII full stop from the final step label, then render:

```md
```mermaid
flowchart LR
step1[编译] --> step2[链接] --> step3[装入内存]
```

注释：
- 编译：高级语言 → 机器语言的目标模块
- 链接：打包目标模块
```

Use stable local IDs (`step1`, `step2`, ...) and escape Mermaid label
characters. Return the original line when parsing is empty, unbalanced, or
does not produce at least two non-empty steps.

- [ ] **Step 3: Implement title-content bullet formatting.**

Match only a Markdown unordered-list prefix followed by exactly one first-level
colon (`：` or `:`) with non-empty text on both sides. Preserve indentation,
bullet marker, and any nested list marker. Render only the title as:

```html
<span class="lifemind-label">标题：</span>内容
```

Escape `&`, `<`, `>`, and `"` in the label. Leave code spans and non-list
lines unchanged.

- [ ] **Step 4: Run the formatter tests and verify they pass.**

Run: `npx vitest run src/lib/lifemind-presentation.test.ts --reporter=verbose`

Expected: all formatter tests PASS.

### Task 3: Connect formatting after local audit normalization

**Files:**
- Modify: `src/lib/lifemind-core.ts`
- Modify: `src/lib/lifemind-core.test.ts`

- [ ] **Step 1: Add a core regression test proving formatting is output-only.**

Construct a valid `ReviewAnalysisPlan` whose body contains the sample arrow
line and title-content bullets. Assert that `createReviewBatchFromAnalysisPlan`
returns the same title, path, relations, corrections, uncertain items, and
source data as before, while `batch.notes[0].markdown` contains the Mermaid
block and label span.

- [ ] **Step 2: Import the formatter into the core module.**

Add one import:

```ts
import { formatKnowledgeMarkdown } from "./lifemind-presentation";
```

- [ ] **Step 3: Apply it only to the normalized body.**

Change the existing local function so that the body is computed as:

```ts
const body = formatKnowledgeMarkdown(
  stripManagedMarkdownSections(stripLeadingTitle(note.markdown, note.title)),
);
```

Do not pass formatted Markdown into validation, model requests, relation
normalization, path handling, or source organization logic.

- [ ] **Step 4: Run focused core and formatter tests.**

Run: `npx vitest run src/lib/lifemind-presentation.test.ts src/lib/lifemind-core.test.ts --reporter=verbose`

Expected: formatter tests and all existing core tests PASS.

### Task 4: Full verification and review

**Files:**
- No additional source changes unless verification exposes a regression.

- [ ] **Step 1: Run TypeScript validation.**

Run: `npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 2: Run lint, UI contract, and frontend build checks.**

Run: `npm run lint`

Run: `npm run test:ui-contract`

Run: `npm run build`

Expected: each command exits 0.

- [ ] **Step 3: Inspect the final diff for audit-boundary changes.**

Run: `git diff -- src/lib/lifemind-core.ts src/lib/lifemind-presentation.ts src/lib/lifemind-core.test.ts src/lib/lifemind-presentation.test.ts`

Confirm the diff contains no changes to `lifemind.review.v2`, DeepSeek request
construction, response extraction, validation, path compilation, or relation
resolution.

- [ ] **Step 4: Request a code review for the completed change.**

Review the formatter for Markdown safety, Mermaid parsing edge cases, and
regressions in generated note output before declaring the task complete.
