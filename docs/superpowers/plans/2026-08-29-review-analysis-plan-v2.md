# Review Analysis Plan v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct model-authored Markdown with a validated semantic analysis plan and a deterministic local compiler, while preserving compatibility with existing v1 model responses.

**Architecture:** The external model returns `lifemind.review.v2` analysis data: one stack decision, structured sections, and evidence-backed relations. The local core validates that plan, enforces an explicitly supplied stack hint as a root constraint, then compiles sections into the existing `GeneratedNote` and Obsidian Markdown shapes. v1 responses remain readable through an adapter, but new requests use v2.

**Tech Stack:** TypeScript, Vitest, existing `lifemind-review-skill.ts`, `lifemind-core.ts`, `lifemind-review-runner.ts`, Tauri model bridge.

---

### Task 1: Define the v2 analysis contract

**Files:**
- Modify: `src/lib/lifemind-review-skill.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Write failing tests** for v2 request version, stack decision, section metadata, evidence-backed relations, and v1 compatibility parsing.
- [ ] **Step 2: Run `npm run test:core -- src/lib/lifemind-core.test.ts` and verify the new assertions fail because v2 types and fields do not exist.** Vitest did not produce output or exit in the current environment, so this RED check could not be observed.
- [x] **Step 3: Add `lifemind.review.v2`, `ReviewAnalysisPlan`, `ReviewAnalysisSection`, `ReviewAnalysisRelation`, and `ReviewSkillOutput` compatibility types. Make the v2 request output plan-oriented and keep the v1 parser available.
- [x] **Step 4: Add v2 validation for source ids, unique section ids, legal grains/roles, relation endpoints, empty placeholders, and stack decision shape.
- [ ] **Step 5: Run the focused tests and the existing core suite; keep all v1 tests green.** Vitest was started several times but did not produce output or exit in the current environment; equivalent core assertions were run through an esbuild/Deno harness.

### Task 2: Compile analysis plans into deterministic notes

**Files:**
- Modify: `src/lib/lifemind-core.ts`
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Write failing tests** for compiling a Git source into overview/concept/steps/code notes, compiling Port Segment under `TI嵌入式 / 术语` instead of GPIO, and refusing a model root that conflicts with an explicit stack hint.
- [ ] **Step 2: Run the focused tests and verify they fail against the current direct-Markdown path.** Vitest did not produce output or exit in the current environment; the same cases were verified with direct bundled assertions after implementation.
- [x] **Step 3: Add a compiler that maps plan sections to `GeneratedNote`, builds safe paths, preserves section content, and generates metadata/child links locally.
- [x] **Step 4: Remove semantic path mutation from the normal v2 path; retain only path safety normalization and collision handling.
- [x] **Step 5: Run equivalent focused checks through the bundled core module; full Vitest remains blocked by the environment hang.

### Task 3: Use v2 for every external review pass

**Files:**
- Modify: `src/lib/lifemind-review-runner.ts`
- Modify: `src-tauri/src/lib.rs` only if the model bridge assumes the v1 output shape
- Test: `src/lib/lifemind-core.test.ts`

- [x] **Step 1: Write failing tests** asserting draft and final requests use v2, final review receives the draft analysis plan, and a v2 model response becomes a normal `ReviewBatch`.
- [ ] **Step 2: Run the tests and verify request version assertions fail.** Vitest did not produce output or exit in the current environment; the request assertions were verified with a direct Deno runner harness after implementation.
- [x] **Step 3: Send v2 requests, parse v2 plans, compile them locally, and adapt legacy v1 output only when an older provider returns it.
- [x] **Step 4: Keep fallback behavior explicit: local fallback is used only after external failure and follows the same compiler interface.
- [ ] **Step 5: Run TypeScript, Rust, and full test suites.** TypeScript/Deno and UI contract checks passed; Vitest, Vite build, and Rust tests were interrupted after no output within the allowed window.

### Task 4: Regression verification and handoff

**Files:**
- Modify: `system/lifemind-review-skill.md`
- Test: `scripts/verify-ui-contract.mjs` only if protocol strings are asserted there

- [x] **Step 1: Add protocol documentation showing the v2 request/response path and the v1 compatibility rule.
- [ ] **Step 2: Run `npm run lint`, `npm run test:core`, `npm run test:ui-contract`, and `cargo test --manifest-path src-tauri/Cargo.toml`.** UI contract passed; the other long-running commands were interrupted after no output.
- [x] **Step 3: Report any remaining failures or behavior that must wait for the OCR/visual-relation phase.
