# Shared UI & themes (DevLens extension and DevDock desktop app)

Both tools share one visual system so they feel like one toolkit. Put this file in each repo
at `docs/UI-THEMES.md`; the build prompts reference it.

## Principles
1. **Function first.** Every pixel serves reading or acting. No gradients, glows, glassmorphism,
   illustrations, or decorative animation.
2. **Readable.** Body 14px default (user-adjustable 12–18px), line-height 1.5, max ~90 characters
   per line in prose areas. Data tables use tabular numbers.
3. **Calm density.** Two densities: *Comfortable* (default) and *Compact* (for tables/logs).
4. **Predictable layout.** Left navigation rail with icon + label, a content area, and an
   optional detail pane. Same positions on every screen.
5. **Keyboard first.** Every action reachable by keyboard; `Ctrl/Cmd+K` command palette; visible
   focus ring everywhere; shortcuts shown in tooltips.
6. **Accessible.** WCAG 2.1 AA minimum in every theme (AAA in High Contrast). Status is never shown
   by colour alone — always icon + text. Respect `prefers-reduced-motion` and
   `prefers-color-scheme`.

## Typography
```css
--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, Menlo, monospace;
--fs-base: 14px;           /* user setting: 12 | 13 | 14 | 15 | 16 | 18 */
--fs-sm: calc(var(--fs-base) - 2px);
--fs-lg: calc(var(--fs-base) + 2px);
--fs-xl: calc(var(--fs-base) + 6px);
--lh: 1.5;
--fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;
```
Use system fonts only (no web-font downloads: works offline and behind corporate proxies,
renders natively on macOS and Windows).

## Spacing, shape, motion
```css
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
--radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; /* cards (DevDock) */
--border-w: 1px;
--focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus);
--motion: 120ms ease-out;   /* 0ms when prefers-reduced-motion */
```

## Theme tokens
Every component uses **only** these semantic tokens — never raw hex values in components.

| Token | Light | Dark | High Contrast | Paper | Slate |
|---|---|---|---|---|---|
| `--bg` | #FFFFFF | #1E1F22 | #000000 | #F7F3EA | #22272E |
| `--bg-subtle` | #F5F6F8 | #26282C | #000000 | #EFE9DC | #2D333B |
| `--surface` | #FFFFFF | #2B2D31 | #0A0A0A | #FBF8F1 | #2D333B |
| `--border` | #D8DBE0 | #3C3F45 | #FFFFFF | #D9CFBD | #444C56 |
| `--text` | #1F2328 | #E6E7EA | #FFFFFF | #2B2620 | #ADBAC7 |
| `--text-muted` | #59636E | #A4A8AF | #E0E0E0 | #5E5548 | #A6B1BC |
| `--accent` | #0B5CAD | #6CB0FF | #FFD400 | #8A4B08 | #6CB6FF |
| `--accent-contrast` | #FFFFFF | #0B1A2B | #000000 | #FFFFFF | #1C2128 |
| `--focus` | #0B5CAD | #6CB0FF | #FFD400 | #8A4B08 | #6CB6FF |
| `--success` | #1A7F37 | #57C27A | #7CFF7C | #2F6B2F | #6BC46D |
| `--warning` | #9A6700 | #E3B341 | #FFD400 | #8A5A00 | #D4A72C |
| `--danger` | #C21F3A | #FF7B8A | #FF6B6B | #A3222E | #FF7B72 |
| `--info` | #0B5CAD | #6CB0FF | #66CCFF | #2F5F8A | #6CB6FF |
| `--selection` | #DCEBFF | #2F4A6B | #333300 | #EADFC8 | #2E4A6B |

Theme options in Settings: **System (Light/Dark)**, Light, Dark, High Contrast, Paper (low-glare
warm), Slate (low-contrast dark for long sessions). Apply with `data-theme` on `<html>`;
persist the choice; switch instantly without reload.

**Phase 0 Done criterion for both apps:** an automated contrast test (e.g. compute WCAG contrast
ratios from the token table) asserts `--text` and `--text-muted` on `--bg`/`--surface` ≥ 4.5:1,
status colours ≥ 3:1 against `--bg`, and High Contrast ≥ 7:1 for text. Adjust hex values if a
check fails — the table above is a starting point, not a verified palette.

## Components (build once, reuse everywhere)
Button (primary / secondary / ghost / danger; sizes sm/md), IconButton (always with
`aria-label` + tooltip), Input, Textarea (mono option), Select, Checkbox, Toggle, Tabs,
SegmentedControl, Table (sortable, sticky header, resizable columns, virtualized > 200 rows),
CodeBlock (mono, wrap toggle, copy button, line numbers optional), KeyValue list, Badge/StatusPill
(icon + text), Toast (polite live region), EmptyState (one line + one action), Dialog (focus trap),
Splitter (resizable panes), CommandPalette, Tooltip, Kbd.

## Copy and feedback
- Plain verbs on buttons: "Copy as cURL", "Start recording", "Sync branch".
- Every async action shows progress, then a result toast with what happened.
- Errors say what failed, why (if known), and what to do next. Never show raw stack traces
  without a "Details" disclosure.
- Destructive or remote-changing actions ask for confirmation stating exactly what will happen.

## Surfaces (DevDock, owner's decision 2026-10-25)
DevDock uses a flat card look modelled on DevToys, in every theme: the page is `--bg`, content
sits in solid `--surface` cards with 10px corners (`--radius-lg`) and a subtle border, no
shadows or transparency; the nav rail marks the current view as a solid `--accent` pill with
`--accent-contrast` text; Home opens with a banner tinted from `--accent`. Styles live in
`src/renderer/ui/surfaces.css`. (A glass/soft-shadow look was tried and dropped.)
