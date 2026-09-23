# Node ID Review Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek choose semantic placement and relationship node IDs while LifeMind locally compiles safe Obsidian paths and links.

**Architecture:** Keep the existing `lifemind.review.v2` compatibility parser, add an optional node-index-backed placement shape for new model responses, and let the local compiler derive paths from stable Vault node IDs. Existing v2 fixtures with model-authored `path` remain readable, while newly constructed requests and the DeepSeek tool schema use `placement`, `sourceNodeId`, and `targetNodeId`.

**Tech Stack:** TypeScript, Vitest, existing review skill/core/runner modules, Tauri forwarding of JSON request values.

---

### Task 1: Add the canonical Vault node index

**Files:**
- Modify: `src/lib/lifemind-review-skill.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Write and run the failing node-index placement tests.**
  - Verify a root node can be selected as the parent of a new branch.
  - Verify a note node can be selected as a relationship endpoint.
  - Expected current failure: the parser requires `sections[].path` and does not recognize `placement` or `sourceNodeId`.

- [x] **Step 2: Add stable node-index types and deterministic node IDs.**
  - Define root, directory, and note nodes with `id`, `title`, `kind`, `root`, `path`, and `parentId`.
  - Build root and directory nodes from `VaultKnowledgeRoot.paths`.
  - Build note nodes from the original Vault note paths.
  - Keep existing `vaultContext.notes[].path` normalization unchanged for compatibility; expose the canonical paths through the new index.

- [x] **Step 3: Attach the node index to model-facing requests.**
  - Add `vaultIndex?: VaultKnowledgeNode[]` to both request types.
  - Build it from the selected Vault context in `createReviewAnalysisRequest` and `createReviewSkillRequest`.
  - Tell the model that node IDs are the only valid parent and relation references.

- [ ] **Step 4: Run the focused TypeScript checks and the new test selection.**
  - Run `npx tsc --noEmit`.
  - Run `npx vitest run src/lib/lifemind-core.test.ts -t "node id" --reporter=verbose` with a 20-second process timeout.
  - Current result: syntax transpilation and the direct core runtime harness pass; `tsc` and Vitest start without output and are interrupted by the timeout.

### Task 2: Replace free-form placement in new model output

**Files:**
- Modify: `src/lib/lifemind-review-skill.ts`
- Modify: `src/lib/lifemind-review-runner.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Define the placement contract.**
  - Add `ReviewAnalysisPlacement` with `mode`, `parentNodeId`, `branchName`, and `targetNodeId`.
  - Accept legacy `path` and `source`/`target` only for compatibility.
  - Require either a valid placement or a legacy path for each section.

- [x] **Step 2: Validate node references.**
  - Accept section placement parent and target IDs only when they exist in `vaultIndex`.
  - Accept relation endpoints from current section IDs or `vaultIndex`.
  - Keep root stack-hint enforcement.
  - Return precise validation errors without interpreting arbitrary path strings.

- [x] **Step 3: Update the DeepSeek strict tool schema and prompts.**
  - Remove `path` from the new section schema.
  - Add the placement object with nullable fields where appropriate.
  - Require `sourceNodeId` and `targetNodeId` for new relations.
  - Explicitly forbid model-authored filesystem paths and title-based relation guesses.

- [x] **Step 4: Run runner request contract tests.**
  - Assert the tool schema exposes placement and node-ID relation fields.
  - Assert requests include `vaultIndex` when a Vault context exists.

### Task 3: Compile node placements locally

**Files:**
- Modify: `src/lib/lifemind-core.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Write the failing compiler assertions.**
  - A Port Segment placement under the TI embedded root produces `TI嵌入式/术语/Port Segment.md`.
  - The same plan cannot route through `MSPM0G3507` or `GPIO` unless the model selected those node IDs.
  - A node-ID relation becomes a title-based Obsidian relation only after local resolution.

- [x] **Step 2: Resolve placement IDs to directory segments.**
  - For `new-child`, use the selected node's canonical directory path and append `branchName` when present.
  - For `new-root`, use the enforced stack root and optional branch.
  - For `merge-existing`, use the selected existing note's parent directory and preserve the existing target title.
  - Keep legacy path compilation for old plans.

- [x] **Step 3: Remove path mutation from the new placement path.**
  - Do not run source-organization path overrides when a section contains valid placement.
  - Retain legacy alignment only for v1/v2 compatibility inputs without placement.
  - Keep collision handling and filename safety local.

- [x] **Step 4: Make relationship normalization node-aware.**
  - Resolve section IDs and Vault node IDs to titles.
  - Ignore or move unresolved optional relations to `uncertain` instead of aborting an otherwise valid batch.
  - Preserve existing relation output shape for `ReviewBatch`.

### Task 4: Regression verification and documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-deepseek-strict-review-design.md`
- Test: `src/lib/lifemind-core.test.ts`
- Test: `src/lib/lifemind-review-runner.test.ts`

- [x] **Step 1: Add regression coverage for the original failure.**
  - A model response with a slash inside a path segment is no longer accepted as the new protocol shape.
  - A relation with an invented title cannot terminate the batch when valid sections exist.
  - The Port Segment case remains under the selected TI embedded root.

- [x] **Step 2: Update the design documentation.**
  - Document node-index-backed placement and legacy compatibility.
  - Document that paths and Obsidian links are local compiler outputs.

- [ ] **Step 3: Run verification.**
  - Run `npx tsc --noEmit`.
  - Run `npm run lint`.
  - Run the focused Vitest tests with a timeout.
  - Run `npm run test:ui-contract`.
  - Run Rust tests only if the request forwarding types need changes.
  - Current result: frontend build, UI contract, syntax checks, and direct core/runner runtime checks pass; `tsc`, lint, and Vitest remain blocked by the no-output startup hang.
