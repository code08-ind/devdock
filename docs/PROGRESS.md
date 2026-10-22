# DevDock — progress / step file

**Read this file first.** Update it at the end of every work session: tick steps, set
Current position, append to Session log. Never mark a step done without evidence (command
output or test name).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Contract docs: `docs/SPEC.md`, `docs/UI-THEMES.md`, `docs/BUILD-PROMPTS.md` (phases + Done criteria).

---

## Current position

| Field        | Value                                                         |
| ------------ | ------------------------------------------------------------- |
| Phase        | P1 — Repos and git actions (Phase 0 closed: all Done criteria met) |
| Next step    | Sub-phase **P1-B** — settings schema for repos, then repo registry (`P1.03`) |
| Blockers     | None                                                          |
| Last updated | 2026-10-22                                                    |

---

## Decisions already made (user, 2026-10-22)

- Code lives directly in this folder (`B-desktop-app`); git initialised; specs moved into `docs/`.
- One phase per session. Currently **Phase 0 only**, then stop for user review.
- Icons: `lucide-react`.
- CI: GitHub Actions, matrix macOS + Windows.
- React 18 pinned (per spec).

## Toolchain / version constraints

- Host: Node 22.20, npm 11, git 2.51, macOS arm64.
- electron 45.0.0 — binary needed manual `node node_modules/electron/install.js` after `npm install`.
- electron-vite 6 — use `build.externalizeDeps` option (`externalizeDepsPlugin` is deprecated).
- vite 8, @vitejs/plugin-react 6.
- typescript **6.0.3** (NOT 7 — typescript-eslint 8.72 requires TS < 6.1).
- eslint **9** (NOT 10 — eslint-plugin-jsx-a11y doesn't support 10).
- vitest 5, Playwright 1.64, zod 4, @tanstack/react-query 5.
- `msw` is a runtime **dependency** (not dev): demo mode ships in the packaged app.
- Vite 8 uses Rolldown: use `build.rolldownOptions` (`rollupOptions` is deprecated).
- Sandboxed preload is built as a single CJS file (`out/preload/index.cjs`, `externalizeDeps: false`).
- msw 3 — demo mode calls `getResponse(handlers, request)` from `'msw'` in-process, because
  MSW cannot intercept Electron `net.fetch`.

---

## Phase 0 — Scaffold, security, shell, settings, secrets, demo mode

Steps:

- [x] `P0.01` Repo init (git) + specs moved to `docs/`
- [x] `P0.02` Dependencies installed (incl. Electron binary via `install.js`)
- [x] `P0.03` Config files: `electron.vite.config.ts`, tsconfigs (node/web), ESLint flat config, Prettier, Vitest, Playwright, electron-builder
- [x] `P0.04` Main process entry + `security.ts` (window prefs, CSP, navigation/new-window block, `openExternal` guard)
- [x] `P0.05` Typed IPC registry (channel + zod req/res + handler, typed error on invalid payload) + preload `window.devdock`
- [x] `P0.06` Settings store (`userData/settings.json`, zod schema, migrations)
- [x] `P0.07` Secrets store (`safeStorage`, encrypted file, refuse plaintext + clear message when unavailable)
- [x] `P0.08` Rotating logger with redaction (`Authorization`, tokens, `token|key|secret|password` params) + "Open logs folder" (IPC `app:openLogsFolder`; Settings button is `P0.16`)
- [x] `P0.09` Notification service (history 200, per-type toggles, quiet hours, pause)
- [x] `P0.10` Tray (macOS template image, Windows ICO; Open / Pause notifications / Quit; close-to-tray configurable)
- [x] `P0.11` Global shortcut + conflict detection + palette window
- [x] `P0.12` Demo-mode HttpClient mechanism (switch real ↔ MSW `getResponse` handlers)
- [x] `P0.13` Design tokens + 5 themes + System, font size, density (apply live, persist)
- [x] `P0.14` UI components (design system primitives) — Table/Splitter/Tabs deferred (DECISIONS.md)
- [x] `P0.15` Nav rail (Today, Repos, Pull Requests, Builds, Tickets, Utilities, Settings) + empty states
- [x] `P0.16` Settings page (theme, font, density, demo mode, secrets, logs folder, notifications, shortcut)
- [x] `P0.17` Cmd/Ctrl+K command palette component
- [x] `P0.18` Contrast unit test (all themes, per UI-THEMES.md) — `tests/unit/contrast.test.ts`, 22 tests; Slate muted adjusted
- [x] `P0.19` Unit tests: redaction, `openExternal` guard, settings migrations, secrets file bytes — `logger`, `security`, `settings`, `secrets` test files (+ patch-schema regression)
- [x] `P0.20` e2e (Playwright `_electron`): security (no `require`/`process`, CSP blocks inline remote script, external nav blocked), each nav item, theme persists, palette via IPC test hook — `tests/e2e/{security,app,screenshots}.spec.ts`, 12 tests
- [x] `P0.21` Packaging config: dmg arm64 + x64, NSIS per-user, portable — CI run 39820085066 built `DevDock-0.1.0-arm64.dmg`, `DevDock-0.1.0-x64.dmg`, `DevDock-Setup-0.1.0.exe` (NSIS, perMachine=false), `DevDock-Portable-0.1.0.exe`; arm64 dmg also built + launched locally
- [x] `P0.22` GitHub Actions workflow (macOS + Windows matrix: lint, test, e2e, dist) — run #1 (39819333526): macOS green, Windows e2e failed 1 test (EBUSY reading locked Chromium cache) → fixed in 94cd7dc; run #2 (39820085066): **both green**, 11 e2e passed + 1 skipped on each OS
- [x] `P0.23` `docs/DECISIONS.md` (deps + version pins + demo-mode approach) — dependency tables, P0-B/C/D decisions
- [x] `P0.24` Run lint / test / e2e / dist and record real output here (2026-10-22, macOS arm64):
  - `npm run lint` → exit 0 (eslint, prettier, tsc for node/web/e2e projects)
  - `npm test` → 10 files, **111 passed**
  - `npm run e2e` → **11 passed, 1 skipped** (opt-in screenshots); `--repeat-each=3` → 33 passed
  - `npm run dist` → **exit 1**: `DevDock-0.1.0-arm64.dmg` (127 MB) built; x64 step failed with
    `Timeout awaiting 'request' for 600000ms` after downloading the x64 Electron zip (retried twice,
    same result). `electron-builder --mac dmg --arm64` alone → exit 0.
- [x] `P0.25` Screenshots: Today in Light + Dark — `docs/screenshots/today-{light,dark}.png` (from `screenshots.spec.ts`)

### Sub-phases (pause points)

- [x] **P0-A — Core main-process services + unit tests** (done 2026-10-22). Evidence: `npx vitest run`
  → 7 files, 66 tests passed; `tsc -p tsconfig.node.json` + `tsc -p tsconfig.web.json` clean;
  `eslint . --max-warnings 0` clean; `prettier --check .` clean.
- [x] **P0-B — Electron wiring** (done 2026-10-22). Evidence: `npm run lint` clean (eslint, prettier,
  both tsconfigs); `npm test` → 8 files, 76 tests passed; `npm run build` OK; `npm run dev` boots
  (log: `DevDock 0.1.0 started (demo mode: true)`); Playwright `_electron` smoke of the built app:
  900×600 main + 640×420 palette, `typeof require/process` = undefined, bad payload → `INVALID_PAYLOAD`,
  `file:` link → `NOT_ALLOWED`, external nav blocked, `demo:ping` → `pong (demo)`, Keychain available,
  `secrets.bin` has no plaintext, palette toggles via hook, reserved shortcut via `settings:update`
  reverted + logged. `code-review` (Standards + Spec) run; fixes applied. Scope was: `src/main/index.ts` (lifecycle, single-instance, main window
  900×600 with `WEB_PREFERENCES`, hide-to-tray on close), `src/main/handlers.ts` (implements every
  channel in `src/shared/ipc.ts` `contract` → `HandlerMap`), `src/main/tray.ts`, palette
  `BrowserWindow`, real `safeStorage`/`globalShortcut`/`Notification`/`net.fetch` adapters,
  `shell.openExternal` via `checkExternalUrl`, "Open logs folder", e2e hook
  `globalThis.__devdockTest` only when `DEVDOCK_E2E=1`. Prove: `npm run dev` boots.
- [x] **P0-C — Renderer** (done 2026-10-22). Evidence: `npm run lint` exit 0; `npm test` → 10 files,
  108 tests passed (new: contrast 22, palette 10); `npm run build` OK. Built app driven with Playwright:
  theme/font/density apply live (`data-font-size=18` → body 18px), Cmd+K palette → "jen" + Enter →
  Builds, Cmd+1..7 nav, palette window renders, Utilities action opens palette, Clear history asks
  first, Cmd+2 ignored behind a dialog, bad import JSON → inline error, Clear all data → no secrets,
  no history, theme back to System; zero console errors/warnings. Screenshots checked in Light, Dark,
  Paper, High contrast, Slate. `code-review` (Standards + Spec) run; fixes applied. Scope was: `src/renderer/index.html` + `palette.html`, tokens/themes CSS, components,
  nav rail + empty states, Settings page, Cmd/Ctrl+K palette, renderer client that unwraps
  envelopes (`src/renderer/lib/devdock.ts`), contrast test (`P0.18`).
- [x] **P0-D — Proof & ship** (done 2026-10-22): e2e, DECISIONS.md, workflow, screenshots; CI run #2
  green on macOS + Windows with all four packages. `code-review` run, fixes applied. Scope: e2e (`P0.20`), DECISIONS.md, GitHub Actions, `npm run dist`,
  screenshots, tick Done criteria.

### Notes for P0-D

- **Window order is not stable at launch**: `electronApp.firstWindow()` may return the palette
  window. Select the main window by URL (`…/index.html`).
- Test hook: `globalThis.__devdockTest` (`togglePalette`, `showView`, `isPaletteVisible`,
  `shortcutStatus`, `userData`); profile isolation via `DEVDOCK_USER_DATA` (needs `DEVDOCK_E2E=1`).
- Useful selectors: `nav[aria-label=Main]` buttons by name, `main[data-view]`, `h1`,
  `[data-testid=command-palette]`, `html[data-theme]`.
- `P0.D3` "persist" still needs a restart check (apply-live is verified).

### What exists after P0-C (additions)

- `src/renderer/ui/` — `tokens.css` (tokens + 5 themes + System), `components.css`, components
  (`Button`, `Field`, `Feedback`, `Dialog`, `Tooltip`, `Text`), `appearance.ts`.
- `src/renderer/lib/` — `devdock.ts` (unwrap, query client/keys, hooks), `actions.ts`,
  `useAction.ts`, `keyboard.ts`.
- `src/renderer/features/` — `shell/` (App, NavRail, Providers, views, shell.css), `settings/`
  (one file per section), `palette/` (`commands.ts` pure registry + filter, `CommandPalette`,
  `PaletteWindow`, `useCommands`).

### What exists after P0-B (additions)

- `src/main/index.ts` — lifecycle, single-instance, services + Electron adapters, close-to-tray,
  pause-expiry refresh, e2e hook. `src/main/handlers.ts` — `createHandlers(deps)` (Electron-free).
- `src/main/windows.ts` — main + palette windows, `showPalette`. `src/main/tray.ts` — pure
  `trayMenuTemplate` + `createTray`. `ShortcutService.active()` added.
- Unit tests: `tests/unit/handlers.test.ts` (handlers + tray menu).

### What exists after P0-A (file map)

- `src/shared/channels.ts` — invoke/event channel allow-list + `VIEWS` (zod-free, used by preload)
- `src/shared/ipc.ts` — zod `contract` per channel, `SECRET_KEYS`, error codes, `EventPayloads`
- `src/shared/settings.ts` — `SettingsSchema` (v1), `SettingsPatchSchema`, `defaultSettings()`
- `src/shared/api.ts` — `DevDockBridge` type (`devdock.ns.method()` → envelope)
- `src/preload/index.ts` — builds bridge from allow-list (CJS, sandboxed). **Not yet run.**
- `src/main/security.ts` — `WEB_PREFERENCES`, `CSP_PROD/DEV`, `checkExternalUrl`, `isAppUrl`,
  `hardenWebContents`, `installSecurity` (Electron parts not yet exercised)
- `src/main/ipc/registry.ts` — `dispatch()` (validated, tested) + `registerIpc()` (sender check)
- `src/main/services/` — `logger.ts`, `settings.ts`, `secrets.ts` (injectable `Cipher`),
  `notifications.ts` (injectable `NativeNotifier`), `shortcut.ts` (injectable `GlobalShortcutLike`),
  `http.ts` (Real/Demo/Switching clients)
- `src/main/demo/handlers.ts` — `DEMO_ORIGIN` + `/ping` fixture
- `scripts/gen-icons.mjs` → `build/icon.png|ico`, `build/tray/trayTemplate(@2x).png`, `tray.ico`
- `electron-builder.yml` (dmg arm64+x64, NSIS per-user, portable; unsigned) — not yet run
- `electron.vite.config.ts` — injects CSP `<meta>` (file:// ignores headers); renderer entries
  `index.html` + `palette.html` (**not created yet**)
- Unit tests: `tests/unit/{logger,security,settings,secrets,notifications,shortcut,ipc-and-http}.test.ts`

Done criteria:

- [x] `P0.D1` `npm run dev` runs on macOS — Evidence: 2026-10-22, electron-vite dev server on :5173, app log `DevDock 0.1.0 started (demo mode: true)`, no blocked/error lines
- [x] `P0.D2` `npm run dist` produces dmg here; Windows targets configured, CI result reported honestly — Evidence: arm64 dmg built here (x64 blocked locally by a download timeout, see `P0.24`); CI run #2 built both dmgs + NSIS + portable; run #1's Windows failure and its fix recorded in `P0.22`
- [x] `P0.D3` Theme, font and density persist and apply live — Evidence: e2e "theme, font size and density apply live and persist across restarts" (Settings UI clicks → `data-theme=dark`, body 18px, compact; relaunch with same profile keeps all three). This test found the patch-schema bug (fixed, see DECISIONS.md).
- [x] `P0.D4` Security tests pass — Evidence: `tests/e2e/security.spec.ts` 6/6 (no require/process/module; CSP blocks inline + remote script, asserted via `securitypolicyviolation` events; external navigation blocked, asserted by the main-process log line `blocked navigate: https://example.com/` and unchanged URL; window.open denied + logged, window count unchanged; openExternal rejects file:/javascript:/unlisted host; invalid payload → INVALID_PAYLOAD) + unit `security.test.ts`
- [x] `P0.D5` Secret saved via Settings not readable as plaintext in `userData` (byte test) — Evidence: e2e "a secret saved in Settings is encrypted on disk": types the token in the Settings UI, asserts `secrets.bin` exists and is non-empty, then scans **every file under userData recursively** (incl. Chromium Local Storage/leveldb and logs) for the plain bytes; + unit `secrets.test.ts`
- [x] `P0.D6` e2e launches app, opens each nav item, switches theme, opens palette (state: shortcut or IPC hook) — Evidence: `app.spec.ts`. In-window palette via a real Cmd/Ctrl+K keypress. Palette **window via the IPC test hook** (Playwright can't press OS global shortcuts); registration asserted `ok: true` locally (accelerator only on CI). `npx playwright test --repeat-each=3` → 33 passed, 3 skipped (opt-in screenshots).

---

## Phase 1 — Repos and git actions (SPEC 6.2)

- [x] `P1.01` Git `execFile` wrapper (cwd, timeout, output capture) + typed errors — `src/main/services/git/{exec,errors}.ts`: `GitRunner` (arg arrays, LC_ALL=C, prompts off, streaming, command log, destructive-command guard), 9 error kinds
- [x] `P1.02` Parsers: `status --porcelain=v2 --branch`, `rev-list --left-right --count`, `stash list` — `git/parse.ts` (+ `remote -v`); fixtures in `tests/unit/git-parse.test.ts`, real output in `tests/integration/git-runner.test.ts`
- [ ] `P1.03` Repo registry: folder picker, validate, detect remotes + base branch, edit settings
- [ ] `P1.04` Status polling (focus, 2 min, `.git/HEAD` watcher) in Repos + Today
- [ ] `P1.05` Action framework: commands disclosure, streamed activity log, result toast
- [ ] `P1.06` Fetch all + Sync base (ff without checkout when safe)
- [ ] `P1.07` Update my branch (merge/rebase, Stash & continue, conflict view, Abort)
- [ ] `P1.08` Sync fork (upstream; push confirmed; never force)
- [ ] `P1.09` New branch from template + slug function
- [ ] `P1.10` Push branch (protected patterns blocked in handler)
- [ ] `P1.11` Open in VS Code / terminal / file manager
- [ ] `P1.12` Dev server manager: spawn, URL/port detect, log panel, Stop, tree kill (win `taskkill /T`, mac pgroup)
- [ ] `P1.13` Baseline integration (`scripts/baseline.mjs`)

### Sub-phases (pause points)

- [x] **P1-A — Git core** (done 2026-10-22). Evidence: `npm run lint` exit 0; `npm test` → 13 files,
  221 passed (new: `git-parse` + `git-branches` unit, `tests/integration/git-runner` 10 against
  real temp repos — status/stash/rev-list parsing on real output, streaming, and each typed error
  produced by real git: not-a-repo, git missing, dirty tree (merge would overwrite), conflict,
  non-fast-forward push, auth (local HTTP 401 with prompts disabled, returns in < 10 s), timeout;
  deleted repo folder, user colour config ignored; unsafe command refused without spawning).
  `code-review` run; guard hardened (global options, aliases, abbreviated flags, mirror/prune,
  path checkouts, restore, branch overwrite), fixes applied. Files: `src/main/services/git/{exec,errors,parse,branches}.ts`, `tests/fixtures/git-repos.ts`.
- [ ] **P1-B — Repos & actions (main)**: settings schema for repos + git prefs, repo registry
  (validate, remotes, base detection), status service, actions (fetch all, sync base, update my
  branch + stash & continue + conflict/abort, sync fork, new branch, push with protected check,
  open in VS Code/terminal/file manager), IPC channels, integration tests for every `P1.D1` case,
  command-log grep (`P1.D4`).
- [ ] **P1-C — Renderer**: Repos view, Today repo status, action UI (commands disclosure, streamed
  activity log, result toast, conflict view), polling on focus / 2 min / `.git/HEAD` watcher,
  screenshots of Update → conflict → Abort (`P1.D5`).
- [ ] **P1-D — Dev server & baseline**: manager, port detection, log panel, tree kill, e2e (`P1.D3`).

Done criteria:

- [ ] `P1.D1` Integration tests with temp repos: non-ff refusal, dirty-tree + Stash round trip, merge conflict abort, rebase conflict abort, protected push rejected, sync-fork e2e — Evidence:
- [x] `P1.D2` Branch slug unit tests (unicode, punctuation, max length, collisions) — Evidence: `tests/unit/git-branches.test.ts` (accents/CJK/emoji, punctuation, ≤50 at word boundary, over-long word, `-2/-3` case-insensitive collisions, valid ref names, protected patterns)
- [ ] `P1.D3` Dev server e2e: start fixture, detect port, stop, port free — Evidence:
- [ ] `P1.D4` Command-log grep test: no `push --force` / `reset --hard` — Evidence:
- [ ] `P1.D5` Recording/screenshots: Update my branch → conflict → Abort — Evidence:

---

## Phase 2 — Jira (SPEC 6.5)

- [ ] `P2.01` Cloud adapter (REST v3, email + token) + ADF→Markdown
- [ ] `P2.02` Data Center adapter (REST v2, PAT Bearer) + wiki-markup conversion
- [ ] `P2.03` Normalised issue model + "Test connection" (reports user)
- [ ] `P2.04` Lists: My open issues (JQL), Sprint (board id), saved queries
- [ ] `P2.05` Issue detail drawer + Figma/Confluence link extraction
- [ ] `P2.06` Start work flow (branch, TICKET.md + `.gitignore` warning + location toggle, agent classification, clipboard, optional transition, open VS Code)
- [ ] `P2.07` Demo fixtures: 8 fake issues

Done criteria:

- [ ] `P2.D1` Adapter tests Cloud + DC incl. 401, 403, 429 `Retry-After`, proxy/cert errors — Evidence:
- [ ] `P2.D2` ADF→Markdown tests per node type — Evidence:
- [ ] `P2.D3` Start work e2e (branch, TICKET.md sections, clipboard for Bug + vague Story) — Evidence:
- [ ] `P2.D4` Transition never called unless setting on (test) — Evidence:
- [ ] `P2.D5` Generated TICKET.md from demo data attached — Evidence:

---

## Phase 3 — Bitbucket pull requests (SPEC 6.3)

- [ ] `P3.01` Cloud 2.0 + DC 1.0 adapters → one PR model; base-URL Detect probe
- [ ] `P3.02` PR link parser (both shapes, `/overview` `/diff`, query strings, project vs user repos)
- [ ] `P3.03` Lists: My PRs, Reviewing, Recently merged
- [ ] `P3.04` PR card + build status API
- [ ] `P3.05` Watch list (palette `watch <link>`, paste field), state-change detection, notifications, persisted state
- [ ] `P3.06` Scheduler: 60s fg / 3 min bg, backoff + jitter, `Retry-After`
- [ ] `P3.07` PR actions behind Settings switch (off default), merge needs typed target branch, handler re-checks
- [ ] `P3.08` Demo-mode Today view with PRs

Done criteria:

- [ ] `P3.D1` Adapter tests both flavours incl. pagination — Evidence:
- [ ] `P3.D2` Watcher snapshot tests: exact notifications, no duplicates on restart — Evidence:
- [ ] `P3.D3` Actions off → handler rejects approve/merge called directly (test) — Evidence:
- [ ] `P3.D4` Screenshot: Today with PRs in mixed states — Evidence:

---

## Phase 4 — Jenkins builds and watchers (SPEC 6.4)

- [ ] `P4.01` Jenkins client: Basic + API token, crumb handling (retry on 403)
- [ ] `P4.02` Job tree discovery (multibranch), last build per branch
- [ ] `P4.03` `wfapi/describe` stages + graceful fallback
- [ ] `P4.04` Console tail (progressive `start` offset, auto-scroll, search, copy)
- [ ] `P4.05` Watch build/job + notifications; Watch PR pipeline (PR → branch → job, no-match message)
- [ ] `P4.06` Triggers: off default, per-job allow-list, protected patterns blocked in handler, UI hides, confirmation
- [ ] `P4.07` Deploy watcher (read-only)
- [ ] `P4.08` Tray status dot from watched builds

Done criteria:

- [ ] `P4.D1` Tests: stage parsing, console offset, PR→job, protected patterns (case + folder paths), crumb retry — Evidence:
- [ ] `P4.D2` Demo e2e: running build → "passed" notification + green dot; failing → red — Evidence:

---

## Phase 5 — Utilities and standup (SPEC 6.6)

- [ ] `P5.01` Port scanner parsers: `lsof` (mac), `netstat -ano` + `tasklist /FO CSV` (win), IPv6, multi-PID
- [ ] `P5.02` Stop process with escalation confirmation
- [ ] `P5.03` Env profiles: encrypted store, switch with backup, masked reveal, key-only diff
- [ ] `P5.04` Clean caches (size preview + confirm)
- [ ] `P5.05` Quick links launcher (groups, search, palette entries, import/export)
- [ ] `P5.06` Standup: previous working day (Mon→Fri, holidays list), git log by author, PR/Jira activity, editable, copy text/MD

Done criteria:

- [ ] `P5.D1` Parser tests both OSes — Evidence:
- [ ] `P5.D2` Kill-by-port e2e on macOS; Windows via mocked `execFile` + README note — Evidence:
- [ ] `P5.D3` Env switch round trip byte-for-byte — Evidence:
- [ ] `P5.D4` Standup from demo data matches expected — Evidence:

---

## Phase 6 — Palette completeness, polish, packaging, docs

- [ ] `P6.01` Palette registry: title, keywords, arg parsers (`watch`, `branch`, `kill`, `open`), enabled reason, recents first
- [ ] `P6.02` Empty / loading / error states everywhere + "error with Details" pattern
- [ ] `P6.03` Font 12 + 18 in every theme; keyboard-only pass on every screen
- [ ] `P6.04` Diagnostics screen (versions, proxy, Test all connections, redacted export)
- [ ] `P6.05` Perf check: 5 repos + 10 watches in demo — idle CPU/memory
- [ ] `P6.06` Packaging: icons, version + CHANGELOG, unsigned-app README section
- [ ] `P6.07` README: features + demo screenshots, per-service setup + scopes, security model, shortcuts

Done criteria:

- [ ] `P6.D1` Full suite green — Evidence:
- [ ] `P6.D2` Packages built (which verified on which OS) — Evidence:
- [ ] `P6.D3` README verified step by step in demo mode — Evidence:
- [ ] `P6.D4` qa-tester agent run in demo mode: no Fail items — Evidence:

---

## Session log (append-only)

| Date       | Phase | Summary                                                                                                             | Next    |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| 2026-10-22 | P0    | Read specs, asked clarifying questions, git init, moved specs to docs/, installed deps, created PROGRESS.md | `P0.03` Config files |
| 2026-10-22 | P0-A  | Configs, shared IPC contract + settings schema, preload, security helpers, IPC registry, logger/settings/secrets/notifications/shortcut/http services, demo handlers, icons, 66 unit tests green, lint/typecheck clean. Paused at user request. | P0-B: `P0.04` `src/main/index.ts` |
| 2026-10-22 | P0-B  | index.ts lifecycle/single-instance/close-to-tray, handlers.ts for every channel, tray, main + palette windows, real safeStorage/globalShortcut/Notification/net.fetch adapters, e2e hook, placeholder renderer pages. `npm run dev` boots; built-app smoke via Playwright passes; 76 unit tests green; lint clean. code-review run → fixed shortcut-conflict bypass via settings:update, stale tray after pause expiry, unhandled openExternal rejection. DECISIONS.md started. | P0-C: `P0.13` tokens + themes |
| 2026-10-22 | P0-C  | Tokens/themes CSS (Slate muted fixed after contrast check), design-system components, nav rail + empty states, full Settings page (appearance, demo, general, notifications + history, credentials, links, import/export, danger zone incl. Clear all data), Cmd/Ctrl+K palette + palette window, contrast + palette unit tests (108 total). Verified in built app across 5 themes; code-review run and fixes applied (error Details in toasts, failed token save kept input, aria-keyshortcuts, confirmation on clear history, etc.). | P0-D: `P0.20` e2e |
| 2026-10-22 | P0-D  | Playwright e2e (security 6, app 5, opt-in screenshots) — found and fixed a P0-A bug: settings patch schema filled defaults so each change reset sibling fields (regression tests added). Dependency/decision tables in DECISIONS.md, GitHub Actions matrix, Today screenshots. Test mode gated to unpackaged builds. arm64 dmg built + packaged app verified; x64 dmg blocked by local network timeout. code-review run, fixes applied (stronger secret/navigation/shortcut assertions, profile cleanup, opt-in screenshots). | Push, read CI, close Phase 0 → user review |
| 2026-10-22 | P1-A  | User approved moving on. Git core: GitRunner (execFile, typed errors, command log, destructive-command guard), porcelain v2 / rev-list / stash / remote parsers, slug + template + collisions + protected patterns; temp-repo fixture; 69 unit + 10 integration tests. CI run #1: macOS all green (incl. dist); Windows failed 1 e2e (EBUSY on locked Chromium cache) → fixed, run #2 pending. | P1-B |
