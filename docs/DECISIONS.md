# DevDock — decisions

Every new dependency, version pin or deviation from `docs/SPEC.md` / `docs/UI-THEMES.md`.
Dependency and version-pin entries are completed in P0-D (`P0.23`); see also the
"Toolchain / version constraints" list in `docs/PROGRESS.md`.

## P0-B — Electron wiring (2026-10-22)

| Decision | Why |
| --- | --- |
| Closing the main window with **close-to-tray off quits the app** (on both OSes). | BUILD-PROMPTS only says "Closing the window hides it to the tray (configurable)". The hidden palette window keeps Electron alive, so "off" needs an explicit meaning; quitting is the least surprising one. |
| `DEVDOCK_USER_DATA` overrides `userData`, **only when `DEVDOCK_E2E=1`**. | Each e2e run gets a throwaway profile and never touches the real settings, secrets or logs. Ignored in normal runs. |
| E2E hook `globalThis.__devdockTest` (togglePalette, showView, isPaletteVisible, shortcutStatus, userData), only when `DEVDOCK_E2E=1`. | Global shortcuts can't be pressed reliably from Playwright/CI; the BUILD-PROMPTS Done criteria allow an IPC test hook. |
| A palette shortcut arriving via `settings:update` / `import` / `reset` that fails to register is **written back to the last working shortcut** and logged. | Keeps conflict detection (SPEC §6.1) on every path, and the settings file always matches what the OS has registered. |
| Palette window: frameless, always on top, hides on blur, centred on the display under the cursor (all workspaces on macOS). | Spotlight-style UX; not specified. |
| Launch at login is only applied to the OS in **packaged** builds. | In dev it would register the bare Electron binary as a login item. |
| `openExternal` checks `links.allowedHosts` only. | SPEC §5 also allows "hosts from configured services"; no service settings exist yet. Add Bitbucket/Jira/Jenkins hosts to the check in P2–P4. |
| Renderer `index.html` / `palette.html` are placeholders (show `app:info`). | Lets P0-B prove the preload bridge and IPC round trip; replaced in P0-C. |

## P0-C — Renderer (2026-10-22)

| Decision | Why |
| --- | --- |
| **Slate `--text-muted` is `#96A0AA`**, not `#8B949E`. | The UI-THEMES value is 4.14:1 on Slate `--surface`; the Phase 0 contrast criterion needs ≥ 4.5:1 (now 4.80:1). UI-THEMES says to adjust hex values that fail. `tests/unit/contrast.test.ts` reads `tokens.css` directly, so the CSS is the single source of truth. |
| Muted text is never used on `--selection`; selected rows switch muted text to `--text`. | Muted on selection is < 4.5:1 in Dark (3.80) and Slate. Changing `--selection` would alter the agreed palette; the test asserts `--text` on `--selection` instead. |
| Theme / font size / density are `data-theme`, `data-font-size`, `data-density` on `<html>`, with one CSS rule per size. | No inline style attributes under the strict CSP; switching is a single attribute write. |
| **Deferred components: Table (sortable/resizable/virtualized), Splitter, Tabs.** Built now: Button, IconButton, Input, Textarea, Select, Checkbox, Toggle, SegmentedControl, CodeBlock, KeyValue, StatusPill, Toast, EmptyState, ErrorNotice, Dialog/ConfirmDialog, CommandPalette, Tooltip, Kbd. | No Phase 0 screen uses them; they arrive with the first screen that does (Repos/Builds/Utilities). Building them blind would be speculative. CodeBlock line numbers ("optional") also deferred. |
| Event channel **`palette:toggle` removed** from the IPC contract. | Nothing sent it. The in-window palette (Cmd/Ctrl+K) is renderer-only; the palette window uses `palette:shown`. |
| CSP `<meta>` omits `frame-ancestors`. | Chromium ignores it in a meta tag and logs a warning. The header CSP (dev server) still carries it; `file://` pages can't be framed by remote origins anyway. |
| Error toasts stay until dismissed and carry a "Details" disclosure; success toasts auto-hide after 5 s. | UI-THEMES: errors with Details; there must be time to read them. |
| Settings additions beyond §6.7: link allowlist editor, notification history, test notification, Reset settings. | Allowlist backs SPEC §5 `openExternal` ("user-editable allowlist"); history backs §6.1 ("history is kept"); test notification lets the user check OS permission. |
| "Clear all data" = clear credentials + notification history + reset settings; **logs are kept**. | So problems can still be reported after a wipe. |
| Settings → Services / Repos sections are not in P0. | Their data models arrive with P1 (repos) and P2–P4 (services, Test connection). |
