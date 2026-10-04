# LifeMind Workspace Redesign Implementation Plan

**Goal:** Replace the existing visual interface with the user's confirmed white workspace, original multicolor identity, black Dynamic Island and workflow sidebar.

**Architecture:** Preserve the current review state and backend handlers. Isolate global navigation in a controlled component. Move transaction details and actions from the right panel into the main review workspace. Use the existing React, direct Lucide imports and local motion API.

**Tech Stack:** React 19, TypeScript, Vite, Tauri, CSS, Playwright.

- [x] Inspect the current workflow, reference screenshots and complete component attachment.
- [x] Confirm sidebar coexistence, fonts and island interaction with the user.
- [x] Create the original mark and verify font sources and embedding conditions.
- [x] Implement keyboard-accessible island navigation in src/components/ui/island-navigation.tsx.
- [x] Integrate the sidebar, editor, review details and transaction actions in src/app/page.tsx.
- [x] Replace the previous visual system in src/app/globals.css; cover responsive behavior and reduced motion.
- [x] Verify TypeScript, ESLint, core tests and existing UI contracts.
- [x] Inspect desktop/mobile renders and exercise navigation, intake and review interactions with Playwright.
- [x] Correct concrete findings, perform a fresh independent review and provide the running preview URL.

## Verification Notes

- `node scripts/verify-lifemind-redesign.mjs http://127.0.0.1:3001` passes across 1440x960, 1024x768, 390x844 and 360x740 with no browser errors.
- `npm run test:core`, `npm run test:ui-contract`, `npx tsc --noEmit`, `npm run build` and Impeccable detector pass.
- Maghfirea is wired as a local-font preference but is not bundled until an authorized font file is supplied; Noto Serif SC is bundled and loaded offline.
