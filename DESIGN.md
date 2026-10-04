# LifeMind Design System

## Direction

LifeMind is a quiet, editorial workspace for turning learning material into reviewed Obsidian notes. The interface should feel like an open white page with a precise black navigation object and a small amount of color reserved for identity and state.

## Layout

- A 76px desktop chrome holds the sidebar toggle, centered Dynamic Island and upload status.
- The workflow sidebar and global island navigation coexist. The sidebar owns the intake, review, preview and settings sequence; the island owns global pages and the persistent navigation-text preference.
- The main panel is a white, scrollable work surface with generous vertical rhythm and a maximum reading measure on wide screens.
- Below 760px the sidebar becomes a modal drawer. Opening it traps focus; closing it restores focus to the toggle and removes the scrim.

## Type

- English display and interface copy use `Maghfirea` when an authorized local font is available.
- Chinese uses the bundled `Noto Serif SC` variable font.
- The current fallback for English is the same serif stack without an unlicensed embedded Maghfirea file. Add `public/fonts/maghfirea-regular.woff2` only after licensing is confirmed.
- Body text stays at a readable 14-16px with generous line-height; headings use weight and scale rather than tracking.

## Color

- Workspace: `#ffffff`.
- Navigation island and primary actions: `#151515` / `#202020`.
- Text: `#202020`; supporting text: `#737373`; dividers: `#eaeaea`.
- Focus and draft state: Google blue `#4285f4`.
- Confirmation state: green `#267b42`; errors: red `#c6382e`.
- The LifeMind mark uses four line colors: blue, red, yellow and green. It is the only saturated decorative element.

## Interaction

- The island is icon-first at rest, with a slightly generous hit target. It reveals the current label on hover/focus or when the preference is enabled, and opens a keyboard-navigable menu on click or ArrowDown.
- Hover/focus sends a short two-sided outward pulse; pointer press adds a small outward burst and restrained jolt. The animation is state feedback and is disabled under `prefers-reduced-motion`.
- `IslandNavigation` accepts an optional live `status` and `statusTone` so transient states such as “正在审理” can move into the island without changing the navigation contract.
- Island menu navigation supports ArrowUp/Down, Home/End, Escape and Shift+Tab focus recovery.
- Primary actions are at least 44px tall and retain visible focus rings.
- Motion uses short ease-out transitions and opacity/transform for animated feedback. `prefers-reduced-motion` renders the final state without decorative movement.

## Content States

- Uploading is an explicit queue action; selecting a file does not start review.
- AI output remains a draft until the user confirms the batch.
- Empty, loading, error, deletion and missing-Vault states include a visible recovery path.

## Quality Bar

- No horizontal overflow at 360px, 390px, tablet or desktop widths.
- Primary controls remain visible and reachable in the viewport.
- The old review capsule and right inspection panel stay removed.
- Each global page owns its own sidebar item set; cross-page entries remain available as explicit shortcuts while page-specific functions are added later.
- Local processing and Vault writes remain behind explicit user actions.
