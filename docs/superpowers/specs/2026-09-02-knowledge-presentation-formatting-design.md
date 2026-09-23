# Knowledge Presentation Formatting Design

## Goal

Improve the readability of generated Obsidian notes for two conservative,
presentation-only patterns:

1. Arrow-separated step text becomes a small Mermaid flowchart, with any
   parenthetical explanations rendered below the diagram.
2. Markdown bullet lines shaped like `标题：内容` render the title as a
   slightly larger inline label.

The generated note must remain useful when a pattern is not recognized.

## Scope and Safety Boundary

This change is limited to the local Markdown presentation layer after
`lifemind.review.v2` validation succeeds.

It must not change:

- DeepSeek requests or response extraction.
- `lifemind.review.v2` schemas, validation, categories, relations, paths, or
  uncertain items.
- The source text, corrections, or model-facing data.
- Vault write transaction behavior.

The only changed data is the final `GeneratedNote.markdown` string used for
preview and Vault output. If formatting cannot be recognized safely, the
original body text remains unchanged.

## Design

Add a small pure formatter module, `src/lib/lifemind-presentation.ts`.
`lifemind-core.ts` calls it only from the existing local Markdown normalization
path, after managed metadata and relation sections have been handled.

### Step diagrams

Recognize only a standalone non-code line containing at least two arrows:
`→`, `➜`, `➡`, or `->`.

Each arrow-separated segment becomes one Mermaid node. A single outer
parenthetical expression is treated as an explanation:

```text
编译（高级语言 → 机器语言的目标模块）→ 链接（打包目标模块）→ 装入内存
```

becomes a `flowchart LR` block followed by a Markdown explanation list. The
diagram uses generated local node IDs and escaped labels. Lines inside fenced
code blocks are never transformed.

If a segment is empty, the line has too few steps, or the syntax is ambiguous,
the line is emitted exactly as ordinary Markdown.

### Title-content lines

Recognize conservative Markdown list lines with one top-level colon:

```text
- 动态分区分配：不预先划分，进程装入时按大小动态建立分区。
```

The title is emitted as a small inline HTML label with a modest font-size
increase and stronger weight; the content remains ordinary Markdown text.
Only list items are transformed, which avoids changing metadata, URLs, code,
timestamps, and arbitrary prose containing colons.

## Data Flow

```text
validated analysis plan
  -> local GeneratedNote compilation
  -> existing metadata/relation normalization
  -> presentation-only body formatting
  -> preview files and Vault write files
```

No formatted Markdown is sent back to the external review model.

## Error Handling and Fallback

The formatter is a pure, non-throwing function for ordinary string input.
Malformed or unsupported lines pass through unchanged. Mermaid labels and HTML
labels are escaped so user text cannot break the generated Markdown block.

## Verification

Add focused unit tests for:

- Three-step arrow text producing a Mermaid flowchart and explanations.
- Unsupported or ambiguous arrow text remaining unchanged.
- Title-content bullets receiving the larger label.
- Fenced code blocks and non-list colon text remaining unchanged.
- Existing core tests confirming audit outputs, paths, relations, and fallback
  behavior remain valid.

Run the core tests, TypeScript check, lint, UI contract check, and frontend
build after implementation.
