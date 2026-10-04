# LifeMind

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

LifeMind turns uploaded learning materials into reviewed Obsidian notes. A user reviews the generated batch and explicitly confirms writing to a local Vault.

## Operating Context

The existing application uses React and TypeScript with Vite, packaged for macOS through Tauri. It accepts pasted text, Markdown, code, webpage URLs and desktop PDF paths. Model configuration and Vault validation are local application settings.

## Capabilities and Constraints

- Uploading queues files; extraction and AI review start through an explicit action.
- Generated notes, corrections, relations and Markdown previews remain available for review.
- Confirmation, overwrite inspection, batch transactions and rollback remain functional.
- Browser PDF extraction is not supported; desktop PDF extraction remains unchanged.
- OCR status must accurately reflect current support.
- The user permits necessary interface changes, which must be reported.

## Brand Commitments

The user confirmed an original multicolor line-based logo; a white workspace; a black Dynamic Island navigation with hover/focus label expansion and a click-open menu; a coexisting left workflow sidebar; Maghfirea for English and Noto Serif SC for Chinese. The old brand capsule and right inspection/operation panel are removed. The sidebar contains upload, AI review, Obsidian preview and settings, without an account block.

## Evidence on Hand

The user supplied current application screenshots, a sidebar reference and component text. Existing workflows are implemented in src/app/page.tsx and src-tauri/src/lib.rs.

## Product Principles

- Material stays local until an explicitly chosen review operation.
- Generated output remains a draft until user confirmation.
- A visual redesign preserves working intake, review, preview and transaction behavior.
