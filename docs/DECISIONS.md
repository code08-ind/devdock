# DevDock — decisions

Every new dependency, version pin or deviation from `docs/SPEC.md` / `docs/UI-THEMES.md`.
Dependency and version-pin entries are completed in P0-D (`P0.23`); see also the
"Toolchain / version constraints" list in `docs/PROGRESS.md`.

## Dependencies (Phase 0, 2026-10-22)

Versions are what `package-lock.json` resolved. "Pinned below" means a newer major exists and
was rejected on purpose.

### Runtime (`dependencies`, shipped in the app)

| Package | Version | Why |
| --- | --- | --- |
| react, react-dom | 18.3.1 | SPEC tech table; **React 18 pinned** per user decision. |
| @tanstack/react-query | 5.104.5 | Cache for IPC data; invalidated by main-process events. |
| zod | 4.6.7 | IPC payloads, settings, API responses (SPEC §4). Note: in zod 4 `.partial()` keeps inner `.default()`s — see `patchOf` in `src/shared/settings.ts`. |
| msw | 3.0.3 | Demo-mode fixtures. A runtime dependency because demo mode ships in the packaged app. Called in-process via `getResponse(handlers, request)`: MSW can't intercept Electron `net.fetch`. |
| lucide-react | 1.61.0 | Icons (user decision). Tree-shaken named imports. |

### Tooling (`devDependencies`)

| Package | Version | Why / constraint |
| --- | --- | --- |
| electron | 45.0.0 | Shell (SPEC §4). Binary sometimes needs `node node_modules/electron/install.js` after install (also in CI). |
| electron-vite | 6.0.0 | Build for main/preload/renderer. Uses `build.externalizeDeps` (plugin form deprecated). |
| vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 | Rolldown-based: `build.rolldownOptions`, not `rollupOptions`. |
| electron-builder | 26.15.3 | dmg (arm64 + x64), NSIS per-user, portable. Unsigned in v1. |
| typescript | 6.0.3 | **Pinned below 7**: typescript-eslint 8.72 supports TS < 6.1. |
| eslint, @eslint/js | 9.39.5 | **Pinned below 10**: eslint-plugin-jsx-a11y doesn't support 10 yet. |
| typescript-eslint | 8.72.0 | Flat config. |
| eslint-plugin-react-hooks | 7.1.1 | Includes the React Compiler rules (e.g. `set-state-in-effect`). |
| eslint-plugin-jsx-a11y | 6.10.2 | SPEC lint requirement. |
| eslint-config-prettier, prettier | 10.1.8, 3.9.10 | Formatting owned by Prettier. |
| globals | 17.13.0 | ESLint environment globals. |
| vitest | 5.0.5 | Unit tests (Node environment). |
| @playwright/test | 1.64.1 | e2e via `_electron` against the built app. |
| @types/node, @types/react, @types/react-dom | 22 / 18 | Match Node 22 and React 18. |

Not added: no state library (React Query + local state suffice), no CSS framework (tokens +
plain CSS per UI-THEMES), no router (seven fixed views), no electron-store (own zod-validated
store with migrations).

## P0-D — Proof and ship (2026-10-22)

| Decision | Why |
| --- | --- |
| e2e opens the palette window through the **IPC test hook**, not the real global shortcut; it asserts the shortcut registered. | The OS owns global shortcuts and Playwright can't press them (BUILD-PROMPTS allows the hook). |
| e2e has its own `tsconfig.e2e.json` (DOM + Node libs). | Test bodies run in Node, `evaluate` callbacks run in the renderer. |
| Screenshots come from `tests/e2e/screenshots.spec.ts` (demo mode, default 900×600 window = 900×568 content at 2×, transitions disabled) into `docs/screenshots/`. **Opt-in**: `npm run screenshots` (macOS/Linux shell syntax). | Reproducible on demand; ordinary e2e/CI runs skip it so tracked images don't change per platform. |
| **Fixed (found by e2e):** `SettingsPatchSchema` filled in defaults, so every one-field settings change reset the other fields of that section (theme reset font size, demo mode reset the palette shortcut). Patch sections are now built by `patchOf`, which strips `.default()`s. | Unit tests called `applyPatch` directly and skipped the IPC parse; regression tests now cover both the schema and a `settings:update` round trip. |
| Test mode (`DEVDOCK_E2E=1`: `__devdockTest` hook + `DEVDOCK_USER_DATA`) is **ignored when `app.isPackaged`**. | A shipped app can't be switched into test mode by an environment variable. e2e runs the unpackaged `out/` build. |
| `tsconfig.node.json` now covers `tests/unit/**` only; `tests/e2e/**` has `tsconfig.e2e.json`. | e2e needs DOM types for `evaluate` callbacks; unit tests must stay Node-only. |
| The global-shortcut registration assertion (`ok: true`) is skipped when `CI` is set. | Hosted runners may have no interactive session for OS shortcuts; the accelerator is still checked, and locally it must register. |
| Local `npm run dist`: **arm64 dmg built; x64 dmg not built here.** The x64 Electron zip downloads, then the next GitHub request times out after 600 s (twice). | Network on this machine, not config: the arm64 build uses the same config and succeeds. macOS CI builds both arches. |
| CI: GitHub Actions, macOS + Windows matrix: lint, unit, e2e, dist; uploads dmg/exe. Unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`). | User decision (CI on GitHub Actions); no signing certificates in v1. |

## P0-B — Electron wiring (2026-10-22)

| Decision | Why |
| --- | --- |
| Closing the main window with **close-to-tray off quits the app** (on both OSes). | BUILD-PROMPTS only says "Closing the window hides it to the tray (configurable)". The hidden palette window keeps Electron alive, so "off" needs an explicit meaning; quitting is the least surprising one. |
| `DEVDOCK_USER_DATA` overrides `userData`, **only when `DEVDOCK_E2E=1`** — and (since P0-D) only in unpackaged builds. | Each e2e run gets a throwaway profile and never touches the real settings, secrets or logs. Ignored in normal runs. |
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
