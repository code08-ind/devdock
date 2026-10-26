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
| Phase        | **Phase 7, resumed 2026-10-26.** P7-E done on `main` except the human VoiceOver/NVDA pass. P7-A/B/D agents resuming on their branches (p7-terminal, p7-providers, p7-website, in .claude/worktrees/). |
| Next step    | (1) P7-A and P7-B agents running on their branches; (2) review/merge P7-A, P7-B (watch ci.yml/release.yml conflicts with P7-D); (3) start P7-C; (4) after B+C merge, update website copy (GitHub/GitLab, opt-in AI) |
| Blockers     | None                                                          |
| Last updated | 2026-10-26                                                    |

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
- [x] `P1.03` Repo registry: folder picker, validate, detect remotes + base branch, edit settings — main/IPC: `RepoService` + `repos:pickFolder/add/update/remove/list`; settings UI is P1-C
- [x] `P1.04` Status polling (focus, 2 min, `.git/HEAD` watcher) in Repos + Today — `lib/repos.ts` (interval + focusManager), `services/repo-watcher.ts` (integration-tested with real checkouts)
- [x] `P1.05` Action framework: commands disclosure, streamed activity log, result toast — `features/repos/ActionDialog.tsx`; e2e `tests/e2e/repos.spec.ts`
- [x] `P1.06` Fetch all + Sync base (ff without checkout when safe) — main/IPC; UI is P1-C
- [x] `P1.07` Update my branch (merge/rebase, Stash & continue, conflict view, Abort) — main/IPC + UI (dirty → Stash & continue, conflict view with Open in VS Code / Abort); e2e covers the whole flow
- [x] `P1.08` Sync fork (upstream; push confirmed; never force) — main/IPC
- [x] `P1.09` New branch from template + slug function
- [x] `P1.10` Push branch (protected patterns blocked in handler)
- [x] `P1.11` Open in VS Code / terminal / file manager — buttons on each repo card + palette; command building unit-tested; **not launched in e2e** (would open real apps on the test machine)
- [x] `P1.12` Dev server manager: spawn, URL/port detect, log panel, Stop, tree kill (win `taskkill /T`, mac pgroup) — `services/process/{devserver,detect,shell-path}.ts`, `DevServerPanel.tsx`; shell-free dev command allow-list; quit waits for `stopAll()`. Windows path (cmd.exe shim, `taskkill /T /F`) verified on Windows CI: e2e start → port → stop → port free + quit, run 39901019363
- [x] `P1.13` Baseline integration (`scripts/baseline.mjs`) — offered only when the file exists (`RepoStatus.hasBaseline`), runs under Electron's Node; integration test detects its port, e2e checks the row appears

### Sub-phases (pause points)

- [x] **P1-A — Git core** (done 2026-10-22). Evidence: `npm run lint` exit 0; `npm test` → 13 files,
  221 passed (new: `git-parse` + `git-branches` unit, `tests/integration/git-runner` 10 against
  real temp repos — status/stash/rev-list parsing on real output, streaming, and each typed error
  produced by real git: not-a-repo, git missing, dirty tree (merge would overwrite), conflict,
  non-fast-forward push, auth (local HTTP 401 with prompts disabled, returns in < 10 s), timeout;
  deleted repo folder, user colour config ignored; unsafe command refused without spawning).
  `code-review` run; guard hardened (global options, aliases, abbreviated flags, mirror/prune,
  path checkouts, restore, branch overwrite), fixes applied. Files: `src/main/services/git/{exec,errors,parse,branches}.ts`, `tests/fixtures/git-repos.ts`.
- [x] **P1-B — Repos & actions (main)** (done 2026-10-22). Evidence: `npm run lint` exit 0; `npm test` →
  16 files, 260 passed; `npm run e2e` → 11 passed, 1 skipped. `code-review` run; fixes: option injection
  via base branch, editor path allow-list, Windows cmd.exe quoting (folder as cwd), stash restored after
  non-conflict failures, pushBase needs upstream, per-repo lock, abort pops only DevDock's stash (by
  commit id), plan/run share checks, closed-window events; mutation-checked protected push + stash
  restore. **Note for P1-C:** pass `settings.git.updateStrategy` as the default strategy. Scope was: settings schema for repos + git prefs, repo registry
  (validate, remotes, base detection), status service, actions (fetch all, sync base, update my
  branch + stash & continue + conflict/abort, sync fork, new branch, push with protected check,
  open in VS Code/terminal/file manager), IPC channels, integration tests for every `P1.D1` case,
  command-log grep (`P1.D4`).
- [x] **P1-C — Renderer** (done 2026-10-22). Evidence: `npm run lint` exit 0; `npm test` → 17 files,
  265 passed; `npm run e2e` → 16 passed, 1 skipped (new `repos.spec.ts`: update → stash & continue →
  conflict → abort restores HEAD/files/stash; protected push refused in UI; palette (both windows) opens
  the action dialog; Today status). `code-review` run; fixes: palette actions now go through the dialog,
  ahead vs base shown, focus refresh wired for Electron, Escape blocked mid-run, error toasts, run output
  freed, watcher sync serialised, log keyboard-reachable. Scope was: Repos view, Today repo status, action UI (commands disclosure, streamed
  activity log, result toast, conflict view), polling on focus / 2 min / `.git/HEAD` watcher,
  screenshots of Update → conflict → Abort (`P1.D5`).
- [x] **P1-D — Dev server & baseline** (done 2026-10-23). Evidence: `npm run lint` exit 0; `npm test` →
  19 files, 296 passed; `npm run e2e` → 18 passed, 1 skipped; `devserver.spec.ts --repeat-each=3` → 6 passed.
  `npm run dist` **not run** this sub-phase (no packaging changes). `code-review` run; fixes: concurrent
  starts could orphan a process, stop/quit could hang when exit never fires (capped wait), leftover group
  killed when npm exits on its own, stale renderer log after restart, URL scan only on new output,
  fish-safe PATH read, Windows `./script` → `.\script`, `[::1]` allowed, shared `BASELINE_SCRIPT`/`isActive`/
  `ServerRefSchema`. Also fixed a load regression: the strict dev-command check had made `SettingsSchema`
  reject P1-C-saved commands → **all settings reset**; stored schema is lenient again (regression test,
  mutation-checked). Deferred (DECISIONS.md): palette/tray Start dev server → P6.01.
  **CI:** Windows had been red since P1-B (runs 39824158167, 39827617040 — not noticed then): no git
  identity on the runner ("Committer identity unknown") and EBUSY deleting temp folders. Fixed in test
  fixtures (identity in the isolated test gitconfig; best-effort `removeTempDir` on Windows). Run
  **39901019363: macOS + Windows green**, lint/unit/e2e (18 passed, 1 skipped) and dist on both.
  Known gap (P1-A): on Windows a timed-out git doesn't kill processes git started (hooks/aliases).

Done criteria:

- [x] `P1.D1` Integration tests with temp repos: non-ff refusal, dirty-tree + Stash round trip, merge conflict abort, rebase conflict abort, protected push rejected, sync-fork e2e — Evidence: `tests/integration/git-actions.test.ts` (25) + `repos-ipc.test.ts` (10): each case asserts the outcome **and** repo state (HEAD/refs unchanged, files restored, stash list empty, origin untouched, no push in the command log); protected push rejected through the IPC handler → `NOT_ALLOWED`
- [x] `P1.D2` Branch slug unit tests (unicode, punctuation, max length, collisions) — Evidence: `tests/unit/git-branches.test.ts` (accents/CJK/emoji, punctuation, ≤50 at word boundary, over-long word, `-2/-3` case-insensitive collisions, valid ref names, protected patterns)
- [x] `P1.D3` Dev server e2e: start fixture, detect port, stop, port free — Evidence: `tests/e2e/devserver.spec.ts` drives the UI: Start → "Running on port N" → port listening → Stop → port free; the port is held by a SIGTERM-ignoring grandchild, so only a tree kill frees it. Second test: quitting the app frees the port. Screenshot `docs/screenshots/p1-devserver.png`. Integration (`tests/integration/devserver.test.ts`, 8): same on real processes + stopAll, baseline, concurrent start, leader-exit group kill, kill never hangs
- [x] `P1.D4` Command-log grep test: no `push --force` / `reset --hard` — Evidence: `afterAll` in `git-actions.test.ts` and `repos-ipc.test.ts` checks every logged command with `unsafeReason` + regex; the guard itself refuses them before spawning (unit-tested, incl. global options/aliases/abbreviations)
- [x] `P1.D5` Recording/screenshots: Update my branch → conflict → Abort — Evidence: `docs/screenshots/p1-repos.png`, `p1-update-plan.png`, `p1-update-conflict.png`, `p1-abort-done.png` (from the e2e flow via `npm run screenshots`)

---

## Phase 2 — Jira (SPEC 6.5)

- [x] `P2.01` Cloud adapter (REST v3, email + token) + ADF→Markdown — `services/jira/{client,cloud,adf}.ts`
- [x] `P2.02` Data Center adapter (REST v2, PAT Bearer) + wiki-markup conversion — `services/jira/{datacenter,wiki}.ts`
- [x] `P2.03` Normalised issue model + "Test connection" (reports user) — `shared/jira.ts`, `services/jira/model.ts`, IPC `jira:testConnection` (status + user; failures carry hints). Settings UI is P2-C
- [x] `P2.04` Lists: My open issues (JQL), Sprint (board id), saved queries — `jira:list` + Tickets view list switcher; saved queries managed in Settings → Jira (e2e)
- [x] `P2.05` Issue detail drawer + Figma/Confluence link extraction — detail pane (`IssuePane.tsx`) with Open in Jira, Figma/Confluence links, facts, description, criteria, comments (e2e)
- [x] `P2.06` Start work flow (branch, TICKET.md + `.gitignore` warning + location toggle, agent classification, clipboard, optional transition, open VS Code) — `services/startwork.ts`, `jira/brief.ts`, `startwork:plan/run`, `StartWorkDialog.tsx`
- [x] `P2.07` Demo fixtures: 8 fake issues — `src/main/demo/jira.ts` (`DD-101…108`: 3 bugs, 3 stories incl. vague `DD-103`, task without AC `DD-104`, AC in custom field `DD-106`)

### Sub-phases (pause points)

- [x] **P2-A — Jira core (main)** (done 2026-10-23). Evidence: `npm run lint` exit 0; `npm test` → 24 files,
  389 passed (new: jira-adf 16, jira-wiki 11, jira-model 13, jira-client 49, jira-service 11 + settings);
  `npm run e2e` → 18 passed, 1 skipped. `code-review` (Standards + Spec) run; fixes: newest comments via
  `/comment?orderBy=-created`, 407 → proxy hint, Kanban/unknown board messages, per-flavour auth hints,
  redacted error details, base URL rejects `?`/`#`, wiki table cells keep links with `|`, ADF code span
  with edge backticks, Confluence `/display/` anchored, demo links openable, shared JSON/table helpers,
  demo config injected. All 8 fixes mutation-checked (each test fails without its fix).
- [x] **P2-B — Start work (main)** (done 2026-10-23). Evidence: `npm run lint` exit 0; `npm test` → 26 files,
  425 passed, 1 skipped (opt-in samples); `npm run e2e` → 18 passed, 1 skipped. New: `jira-brief` unit (19),
  `tests/integration/startwork.test.ts` (16, real temp repos + demo Jira): Bug → bugfix branch from
  origin/develop + TICKET.md sections + bug-fixer message; vague Story → spec-writer; Figma in message;
  `.gitignore`/info-exclude/already-tracked warning; DevDock-data location; transition off/declined/done/
  already/unavailable; editor failure = warning; collision suffix; IPC. `code-review` run; fixes: server key
  validated (path traversal), transition needs setting **and** confirmation, run refuses a ticket that changed
  since the preview, typed error after the branch exists, SPEC-literal classification, smells. Fixes
  mutation-checked (one check proved redundant and was removed).
- [x] **P2-C — Renderer** (done 2026-10-23). Evidence: `npm run lint` exit 0; `npm test` → 26 files, 425 passed,
  1 skipped; `npm run e2e` → 23 tests; `npx playwright test --repeat-each=3` → 63 passed, 3 skipped (opt-in
  screenshots). New `tickets.spec.ts` (3). `code-review` run; fixes: selected-row contrast, honest clipboard
  copy (preview + toast), Start button states the transition, stale settings drafts, board id validation,
  saved-query loss on failure, run-output leak, focus jump on list switch, removed-repo fallback, shared
  `ui/Run.tsx`; also fixed a pre-existing flaky palette e2e. UI fixes mutation-checked via e2e.
  `npm run dist` not run (no packaging changes). Deferred (DECISIONS): palette commands for tickets → P6.01.

Done criteria:

- [x] `P2.D1` Adapter tests Cloud + DC incl. 401, 403, 429 `Retry-After`, proxy/cert errors — Evidence: `tests/unit/jira-client.test.ts` (recorded-style payloads in `tests/fixtures/jira.ts`): both flavours via `describe.each` — 401, 403, 404, 407, 429 (seconds, HTTP date, none), 5xx, non-JSON 200, Electron `net::ERR_*` proxy/tunnel/cert/DNS/refused/timeout, Node cert cause + timeout abort; redaction of details; + `jira-service.test.ts` (IPC codes `SERVICE_AUTH`, `RATE_LIMITED`, `INVALID_PAYLOAD`)
- [x] `P2.D2` ADF→Markdown tests per node type — Evidence: `tests/unit/jira-adf.test.ts` (paragraph, marks, hard break, heading, bullet/nested/ordered/task lists, code block, mention/emoji/card/status/date, table with/without header, blockquote/panel/rule/expand/media, unknown nodes, empty input) + `jira-wiki.test.ts` for Data Center
- [x] `P2.D3` Start work e2e (branch, TICKET.md sections, clipboard for Bug + vague Story) — Evidence: `tests/e2e/tickets.spec.ts` in demo mode on a real temp repo, through the UI: Bug DD-101 and vague Story DD-103 each → branch checked with `git rev-parse`, TICKET.md read from disk with all sections, exact clipboard text (read via Electron's clipboard; the user's clipboard is restored); plus Story DD-102 with the Figma suffix. Screenshots `docs/screenshots/p2-{tickets,startwork-preview,startwork-done}.png`
- [x] `P2.D4` Transition never called unless setting on (test) — Evidence: `tests/integration/startwork.test.ts` "P2.D4: transition is never called while the setting is off" (spy on every Jira request: no `/transitions` call even with `confirmTransition: true`); also "setting on but not confirmed → declined, nothing sent"; mutation-checked
- [x] `P2.D5` Generated TICKET.md from demo data attached — Evidence: `docs/samples/DD-101-TICKET.md` (Bug), `DD-102-TICKET.md` (Story + Figma/Confluence + table), `DD-103-TICKET.md` (vague Story) and `clipboard-messages.txt`, written by the real Start work run (`DEVDOCK_WRITE_SAMPLES=1 npx vitest run tests/integration/startwork.test.ts -t P2.D5`)

---

## Phase 3 — Bitbucket pull requests (SPEC 6.3)

- [x] `P3.01` Cloud 2.0 + DC 1.0 adapters → one PR model; base-URL Detect probe — `services/bitbucket/{adapter,client,cloud,datacenter,detect,service}.ts`, `shared/bitbucket.ts`, IPC `bitbucket:detect`/`testConnection`; Settings UI is P3-C
- [x] `P3.02` PR link parser (both shapes, `/overview` `/diff`, query strings, project vs user repos) — `shared/prlink.ts` (`tests/unit/prlink.test.ts`, 43 cases incl. context path, port, `~user`, rejects)
- [x] `P3.03` Lists: My PRs, Reviewing, Recently merged — `bitbucket:list` (Cloud: per registered repo BBQL; DC: dashboard); UI is P3-C
- [x] `P3.04` PR card + build status API — model + build statuses (`bitbucket:list`/`bitbucket:pr`); card = `features/prs/PrRow.tsx` (+ `PrBits.tsx`)
- [x] `P3.05` Watch list (palette `watch <link>`, paste field), state-change detection, notifications, persisted state — Watch field + palette `watch <link>` / pasted link (P3-C); main: `services/bitbucket/watcher.ts`, IPC `watch:list/add/remove` + `watch:changed`, `userData/watches.json`, new type `pr-closed`; palette + Watch field are P3-C
- [x] `P3.06` Scheduler: 60s fg / 3 min bg, backoff + jitter, `Retry-After` — `services/scheduler.ts`, wired in `index.ts` (focus via `browser-window-focus/blur`, Settings → polling); `tests/unit/scheduler.test.ts` (8)
- [x] `P3.07` PR actions behind Settings switch (off default), merge needs typed target branch, handler re-checks — UI: switch behind a warning, `PrActionDialog` (typed merge); main: IPC `bitbucket:action` (switch checked in the handler, `confirmed: true`, typed target re-checked on a fresh read, DC merge vetoes/version, server words verbatim); confirmation dialogs + switch UI are P3-C
- [x] `P3.08` Demo-mode Today view with PRs — `features/today/TodayPage.tsx` (my PRs, watched, in-progress tickets, repos) on the DC demo fixtures (4 mine in mixed states, 2 reviewing, 2 merged)

### Sub-phases (pause points)

- [x] **P3-A — Bitbucket core (main)** (done 2026-10-24). Evidence: `npm run lint` exit 0; `npm test` → 29 files,
  520 passed, 1 skipped; `npm run e2e` → 21 passed, 1 skipped. New: `prlink` (43), `bitbucket-client` (41),
  `bitbucket-service` (11). Jira moved onto shared `services/rest.ts` + `services/json.ts` (Jira tests unchanged,
  passing). `code-review` (Standards + Spec) run; fixes: server-sent refs validated before URL use, lower-case
  `prKey` (DC `~JDOE` vs `/users/jdoe`), Detect treats 401/403 as DC, `:` refused in Cloud user name, DC user
  lookup only hides 403/404, shared build/state/vote mappers + one Cloud-host definition, `RepoRef`, remotes
  helper in `git/repo.ts`, unused `method` option dropped. 6 fixes mutation-checked (each test fails without
  its fix). Known limits recorded in DECISIONS (Cloud lists scan registered repos; access tokens act as a bot).
- [x] **P3-B — Watcher, scheduler, PR actions (main)** (done 2026-10-24). Evidence: `npm run lint` exit 0; `npm test` →
  32 files, 558 passed, 1 skipped; `npm run e2e` → 21 passed, 1 skipped. New: `pr-watcher` (12), `scheduler` (8),
  `bitbucket-actions` (17), settings `pr-closed` fill-in (1). 20 mutations each caught by a failing test (one
  more showed a redundant `redact` call, removed). `code-review` (Standards + Spec) run; fixed: own-vote-only
  acknowledge + in-flight-poll race, manual poll inside `Retry-After`/after stop, DC merge target re-checked on
  the versioned read, server-sent DC slug/name checked before URL use, unused `hasLive`, `linkHosts` moved to
  `security.ts`, `prWatcher` naming. Limits in DECISIONS P3-B. Original scope: `P3.05` watch list (add by link, persisted state,
  change detection → notifications), `P3.06` scheduler (60 s / 3 min focus-aware, backoff + jitter,
  `Retry-After` from `ServiceError.retryAfterSec`), `P3.07` approve / needs-work / merge behind
  `features.prActions`, handler re-checks, merge needs the typed target branch. Done: `P3.D2`, `P3.D3`.
- [x] **P3-C — Renderer** (done 2026-10-25). Evidence: `npm run lint` exit 0; `npm test` → 32 files, 561 passed,
  1 skipped; `npm run e2e` → 26 passed, 1 skipped (new `tests/e2e/prs.spec.ts`, 5); `npm run dist` exit 0 (arm64 +
  x64 dmg). `code-review` (Standards + Spec) run; fixed: Watched actions by role, "N comments in all" for list
  totals, Watch-field server errors with Details, `watch <not a link>` hint, watch toggle double-submit +
  `useRemoveWatch`, no live region on stored watch errors, one `ACTION_COPY` map, shared `isNotConfigured` /
  `useWatchedKeys`, toast when PR actions turn off; Watched-role fix mutation-checked in e2e. Deferred items in
  DECISIONS P3-C. Original scope: PRs view (3 lists, cards), Today with PRs, Settings → Bitbucket (flavor, URL, Detect,
  user name, Test connection, PR-actions switch + warning), palette `watch <link>` + Watch field, action
  confirmations. Done: `P3.D4` screenshot.

Done criteria:

- [x] `P3.D1` Adapter tests both flavours incl. pagination — Evidence: `tests/unit/bitbucket-client.test.ts`: Cloud (Basic/Bearer auth, BBQL per list, `next` followed only on the API origin, 10-page cap, per-repo 403/404 skip vs 401 fail, unresolved threads, SUPERSEDED, no builds) and DC (`X-AUSERNAME`, dashboard params, `start=nextPageStart` until `isLastPage`, 7-day merged cut, `threadResolved`, `~user` repos, 401/403/500/429 `Retry-After`/HTML page), Detect (Cloud host, DC probe without credentials, login-protected DC, not-Bitbucket, certificate); payloads in `tests/fixtures/bitbucket.ts`
- [x] `P3.D2` Watcher snapshot tests: exact notifications, no duplicates on restart — Evidence: `tests/unit/pr-watcher.test.ts` "a sequence of snapshots produces exactly the expected notifications" (8 polls: build pass/fail incl. new commit between polls, approvals/needs-work by name, comments up/down, merged; nothing on unchanged polls; merged → no more polling), "no duplicates after a restart" (new `PrWatcher` on the same file), "saves the new snapshot before notifying"; demo: `bitbucket-actions.test.ts` running build on #88 passes → exactly one notification
- [x] `P3.D3` Actions off → handler rejects approve/merge called directly (test) — Evidence: `tests/unit/bitbucket-actions.test.ts` "with PR actions off, the handler rejects approve, needs work and merge called directly" (`dispatch('bitbucket:action')` → `NOT_ALLOWED`, zero requests reach the demo server); mutation-checked
- [x] `P3.D4` Screenshot: Today with PRs in mixed states — Evidence: `docs/screenshots/p3-today.png`, `p3-today-dark.png` (passing/2 approvals, failing/needs work, building/conflicts, no builds), `p3-merge-confirm.png`; written by `DEVDOCK_SCREENSHOTS=1 npx playwright test prs`; asserted in `prs.spec.ts` "P3.D4: Today shows my PRs in mixed states" 

---

## Phase 4 — Jenkins builds and watchers (SPEC 6.4)

- [x] `P4.01` Jenkins client: Basic + API token, crumb handling (retry on 403) — `services/jenkins/client.ts` (crumb cached, 403 → fresh crumb, one retry; no issuer → none; JSESSIONID forwarded), IPC `jenkins:testConnection`; `tests/unit/jenkins-client.test.ts`
- [x] `P4.02` Job tree discovery (multibranch), last build per branch — `JenkinsClient.branches` (folders/org folders 2 deep, `PR-{n}` jobs), "My branches" filter `jenkins/resolve.ts` `myBuilds` + `jenkins/mine.ts`, IPC `jenkins:branches`; UI is P4-C
- [x] `P4.03` `wfapi/describe` stages + graceful fallback — `jenkins/wfapi.ts` `parseStages` (404/non-JSON → null = "stages unavailable"), IPC `jenkins:build`
- [x] `P4.04` Console tail (progressive `start` offset, auto-scroll, search, copy) — UI `features/builds/ConsoleTail.tsx` (P4-C); main side: `jenkins/console.ts` (byte offsets, reset, split UTF-8 held back, ANSI stripped), IPC `jenkins:console`; auto-scroll/search/copy UI is P4-C
- [x] `P4.05` Watch build/job + notifications; Watch PR pipeline (PR → branch → job, no-match message) — UI: Builds view eye buttons, pipeline field, palette `pipeline <link>` (P4-C); main: `services/jenkins/watcher.ts` `BuildWatcher` (build / job / deploy, persisted, save-before-notify, `job-finished`), IPC `buildwatch:list/add/addPr/remove/clearFinished` + `buildwatch:changed`; `tests/unit/build-watcher.test.ts`, `jenkins-triggers.test.ts` "Watch PR pipeline (demo)"; watch buttons/palette are P4-C
- [x] `P4.06` Triggers: off default, per-job allow-list, protected patterns blocked in handler, UI hides, confirmation — UI: `TriggerDialog` + Settings → Jenkins switch/allow-list (P4-C), e2e "triggers: hidden by default …"; handler: `jenkins:trigger` (protected → off → not allow-listed, all `NOT_ALLOWED` before any request; `confirmed: true`), `jenkins:parameters`; `tests/unit/jenkins-triggers.test.ts`; hidden button + confirmation dialog are P4-C
- [x] `P4.07` Deploy watcher (read-only) — `BuildWatcher` kind `deploy` (Settings → Jenkins → deploy job, my branch by parameter value); "deploy watcher: follows only the deploy job’s builds for my branch"; UI entry point is P4-C
- [x] `P4.08` Tray status dot from watched builds — `src/main/tray.ts` (`trayStatus`, `watchedForTray`, `paintDot` onto the icon bitmap, watched items in the menu, tooltip); `tests/unit/tray.test.ts`, `tests/e2e/builds.spec.ts` (real tray: grey, watched PR pipeline listed as running)

### Sub-phases (pause points)

- [x] **P4-A — Jenkins core (main)** (done 2026-10-25). Evidence: `npm run lint` exit 0; `npm test` → 37 files,
  630 passed, 1 skipped; `npm run e2e` → 26 passed, 1 skipped. New: `jenkins-client` (19), `jenkins-parse` (14),
  `jenkins-resolve` (21), `jenkins-service` (12), `jenkins-ipc` (3); 19 + 10 mutations, each caught by a failing
  test (one survivor got a new test). `code-review` (Standards + Spec) run; fixed: protected patterns accept
  `prod|production` and `*` (a literal entry matched nothing → job unprotected), PR jobs match by id when no job
  is named after the repo (My branches + resolution), console holds back a UTF-8 character split at the offset,
  unchecked build `number`, `skipped` in Settings order, `mapLimit` → `services/async.ts`, `num` guard →
  `services/json.ts`. Not fixed: Spec reviewer's "no trigger switch / allow-list" (they exist as
  `features.jobTriggers` / `allowedJobs`). DECISIONS P4-A written.
- [x] **P4-B — Watchers, triggers, deploy watcher, tray dot (main)** (done 2026-10-25). Evidence: `npm run lint`
  exit 0; `npm test` → 40 files, 662 passed, 1 skipped; `npm run e2e` → 27 passed, 1 skipped (new
  `tests/e2e/builds.spec.ts`: real tray grey, watched PR pipeline listed as running). New: `build-watcher` (15),
  `jenkins-triggers` (9), `tray` (7), +1 `jenkins-client`. 16 + 9 mutations, each caught by a failing test (two
  survivors got stricter tests). `code-review` (Standards + Spec) run; fixed: Watch PR pipeline falls back to the
  job's next build when the linked build already finished, folder/multibranch jobs refused as watches, finished
  builds stop colouring the dot after 8 h (grey when idle), PR listed once in the tray, job-finished
  notifications open the Builds view, grey dot stays a macOS template, premultiplied glyph pixels, stale poll
  after remove + re-add, 50-limit race, `WatchError`/`prRefFromLink` → `services/watch.ts`, `JobPathSchema` on
  stored watches, one `jobLabel`. Not changed (recorded in DECISIONS P4-B): green while others still run; a deploy
  that finished just before the watch was added.
- [x] **P4-C — Renderer + demo e2e** (done 2026-10-25). Evidence: `npm run lint` exit 0; `npm test` → 41 files,
  670 passed, 1 skipped; `npm run e2e` → 30 passed, 1 skipped (`builds.spec.ts`: 4); `npm run dist` exit 0
  (arm64 + x64 dmg). New: Builds view (My branches, Watched, pipeline field, build dialog with stages + console
  tail, trigger confirmation), Settings → Jenkins, Today watched builds, palette `pipeline <link>`, demo clock
  speed for e2e, `builds-ui` unit tests (5). `code-review` (Standards + Spec) run; fixed: a failed watch could make
  a trigger retry queue a second build, the post-trigger watch could follow an older running build (`next`),
  password-only jobs POSTed `build` (400), duplicate `KeyValue` keys, live region on a stored setting, silently
  trimmed console, endless retries on a deleted build, Builds opening on the wrong tab from a notification /
  palette, duplicated watch-row head; the two main-side fixes mutation-checked. Recorded instead: stages in
  the dialog, palette completeness (P6.01), one unexplained e2e view switch (DECISIONS P4-C).

Done criteria:

- [x] `P4.D1` Tests: stage parsing, console offset, PR→job, protected patterns (case + folder paths), crumb retry — Evidence: `tests/unit/jenkins-parse.test.ts` ("wfapi stage parsing", "progressive console offsets" incl. reset, bytes, split character, chunk-by-chunk rebuild), `jenkins-resolve.test.ts` ("Watch PR pipeline: PR → job resolution", "protected jobs": `apps/deploy-prod`, `apps/Deploy-PROD`, full-width, encoded, `prod|production`, `*`), `jenkins-client.test.ts` ("a 403 fetches a fresh crumb and retries once", "a second 403 is the answer")
- [x] `P4.D2` Demo e2e: running build → "passed" notification + green dot; failing → red — Evidence: `tests/e2e/builds.spec.ts` "P4.D2: watching a running PR pipeline ends in a \"passed\" notification and a green dot" (through the UI: pipeline field → Watched → `Passed · design-system #88 pipeline #12` in the notification history → tray `green`; then the console dialog) and "P4.D2: a failing watched build ends in a \"failed\" notification and a red dot" (eye button on `chore/bump-tooling` → `Failed · …` → tray `red`); screenshots `docs/screenshots/p4-builds.png`, `p4-build-console.png`

---

## Phase 5 — Utilities and standup (SPEC 6.6)

- [x] `P5.01` Port scanner parsers: `lsof` (mac), `netstat -ano` + `tasklist /FO CSV` (win), IPv6, multi-PID — `services/process/ports-parse.ts` (+ `ps` for command lines, `-p tcpv6`), `tests/unit/ports.test.ts` on `tests/fixtures/port-outputs.ts` (incl. German netstat)
- [x] `P5.02` Stop process with escalation confirmation — UI: `features/utilities/PortsPanel.tsx` (Stop → Force stop as a second confirmation, `NOT_STOPPED`), palette `kill <port>`; main: `PortService.stop` (re-scan, own/system PIDs refused, `force` needs `forceConfirmed`), IPC `ports:list`/`ports:stop`; confirmation dialogs are P5-C
- [x] `P5.03` Env profiles: encrypted store, switch with backup, masked reveal, key-only diff — UI: `EnvPanel.tsx`; main: `services/envprofiles.ts`, IPC `envprofiles:*`; UI is P5-C
- [x] `P5.04` Clean caches (size preview + confirm) — UI: `CachesPanel.tsx` (paths + sizes, node_modules second confirmation); main: `services/caches.ts` (sized plan, symlinks never followed, `node_modules` needs `nodeModulesConfirmed`, `CacheError` on partial removal), IPC `caches:plan`/`caches:clean`; dialogs are P5-C
- [x] `P5.05` Quick links launcher (groups, search, palette entries, import/export) — UI: `LinksPanel.tsx`, palette "Open <name>"; model: `settings.quickLinks`, `shared/links.ts`; UI + palette are P5-C
- [x] `P5.06` Standup: previous working day (Mon→Fri, holidays list), git log by author, PR/Jira activity, editable, copy text/MD — UI: `StandupPanel.tsx` + Settings → Standup; main: `shared/standup.ts`, `services/standup.ts`, IPC `standup:draft`, settings `standup`; editable UI + copy are P5-C

### Sub-phases (pause points)

- [x] **P5-A — Ports + clean caches (main)** (done 2026-10-25). Evidence: `npm run lint` exit 0; `npm test` → 44 files,
  700 passed, 1 skipped; `npm run e2e` → 30 passed, 1 skipped. New: `ports` (22, Windows via mocked `execFile`),
  `caches` (7, temp folders incl. symlinks and a read-only folder), integration `ports` (real fixture server found by
  `lsof` and stopped by port on macOS). 16 + 5 mutations, each caught (one survivor got a stricter test).
  `code-review` (Standards + Spec) run; fixed: cache removal errors typed with what was removed, taskkill non-zero
  re-checked by scan, `failed`/`not-stopped` kinds, timeouts, second confirmations as `forceConfirmed` /
  `nodeModulesConfirmed` request flags, bounded repo id. Limits in DECISIONS P5-A.
- [x] **P5-B — Env profiles, quick links, standup (main)** (done 2026-10-25). Evidence: `npm run lint` exit 0;
  `npm test` → 49 files, 727 passed, 1 skipped; `npm run e2e` → 30 passed, 1 skipped. New: `envprofiles` (10), `links` (5),
  `standup` (8), `standup-demo` (2), integration `standup` (2, real repo: author by fixed string, merges and
  others' commits left out). 14 + 5 + 6 mutations; survivors got stricter tests (non-UTF-8 byte, dot-email
  lookalike, a merge commit) except the crash-only temp name. `code-review` (Standards + Spec) run; fixed:
  symlinked `.env.local` refused, file mode kept, ignorable temp name, restore keeps what it replaces, quoted
  value + inline comment, confirmations on delete/clear-all, typed clear-all errors, "Opened and merged". Limits
  in DECISIONS P5-B.
- [x] **P5-C — Utilities UI, palette, e2e, README** (done 2026-10-25). Evidence: `npm run lint` exit 0; `npm test` →
  50 files, 734 passed, 1 skipped; `npm run e2e` → 36 passed, 1 skipped (`utilities.spec.ts`: 7); `npm run dist`
  exit 0 (arm64 + x64 dmg). New: Utilities view (5 tabs), Settings → Standup, palette `kill <port>` + utility +
  quick-link commands (both windows), Clear all data covers env profiles, README. `code-review` (Standards + Spec)
  run; fixed: Force stop offered only for `NOT_STOPPED`, `kill` waits for a fresh scan and says none/several,
  revealed values dropped on change/hide, diff sentinel can't be a profile name, failed Collect again keeps the
  draft, import dedupe + Details + deferred revoke, link form closes only on success, Clear all data names a
  failed part, one shared tab list, full lsof names (`+c 0`). Found by e2e: settings patch with a top-level list.
  Screenshots `docs/screenshots/p5-stop-port.png`, `p5-env-profiles.png`, `p5-standup.png`.

Done criteria:

- [x] `P5.D1` Parser tests both OSes — Evidence: `tests/unit/ports.test.ts` "port parsers: macOS (lsof + ps)" (IPv6, scoped `fe80::1%lo0`, `\x20` names, two PIDs on one port) and "port parsers: Windows (netstat + tasklist)" (tcp + tcpv6, established rows skipped, translated State column, quoted CSV)
- [x] `P5.D2` Kill-by-port e2e on macOS; Windows via mocked `execFile` + README note — Evidence: `tests/e2e/utilities.spec.ts` "P5.D2: kill a process by port (palette `kill <port>` and the Ports list)" (fixture server → dialog via palette, nothing stopped yet → Stop from the list → `isListening` false) + "global palette window: `kill <port>` …"; Windows: `tests/unit/ports.test.ts` "stopping a process on Windows (mocked execFile)"; `README.md` "Checking 'stop a process by port' on Windows"
- [x] `P5.D3` Env switch round trip byte-for-byte — Evidence: `tests/unit/envprofiles.test.ts` "P5.D3: switch away and back restores the original file byte-for-byte" (BOM, CRLF, non-UTF-8 byte, unicode, no final newline; `Buffer.equals` after switch → switch → restore); mutation-checked (a UTF-8 decode/encode fails it)
- [x] `P5.D4` Standup from demo data matches expected — Evidence: `tests/unit/standup-demo.test.ts` "P5.D4: standup from demo data" (Monday 09:00 → Friday window: 3 demo commits, opened #412/#415/#419, opened-and-merged #401, DD-106/DD-107 moves, Today DD-101/DD-106/DD-108; exact draft) + holiday Friday → Thursday

---

## Phase 6 — Palette completeness, polish, packaging, docs

### Sub-phases (pause points)

- [x] **P6-A — Home, look, UI audit** — Home launcher, flat DevToys-style cards in every theme, window 1240×820, switch/select fixes, audit fixes, only the content pane scrolls, views use the full width (DECISIONS P6-A). code-review run (Standards + Spec); fixes applied. Evidence: `npm run lint` exit 0; `npm test` → 51 files, 736 passed, 1 skipped; `npm run e2e` → 40 passed, 2 skipped (opt-in audit and screenshot specs); audit screenshots (14 screens × 7 looks) reviewed.
- [x] **P6-B — Palette completeness** (P6.01) — code-review run (Standards + Spec); fixes applied. Evidence: `npm run lint` exit 0; `npm test` → 55 files, 768 passed, 1 skipped; `npm run e2e` → 45 passed, 2 skipped.
- [x] **P6-C — Diagnostics + performance** (P6.04, P6.05) — code-review run (Standards + Spec); fixes applied (incl. the SPEC 5 manual proxy override). Evidence: `npm run lint` exit 0; `npm test` → 56 files, 774 passed, 1 skipped (one run had 2 real-git flakes, DECISIONS P6-C); `npm run e2e` → 46 passed, 3 skipped (opt-in audit, screenshots, perf).
- [x] **P6-E — Menu-bar / tray panel** (owner request 2026-10-25; P6.08–P6.10) — code-review run (Standards + Spec); fixes applied. Evidence: `npm run lint` exit 0; `npm test` → 52 files, 744 passed, 1 skipped; `npm run e2e` → 42 passed, 2 skipped (opt-in audit and screenshot specs); panel screenshots in every look reviewed.
- [x] **P6-F — Agent lessons + workflow options** (owner request 2026-10-25; P6.11–P6.13) — code-review run (Standards + Spec); fixes applied. Evidence: `npm run lint` exit 0; `npm test` → 55 files, 760 passed, 1 skipped; `npm run e2e` → 43 passed, 2 skipped; Lessons tab screenshots reviewed.
- [x] **P6-D — Packaging (small), CHANGELOG, README, QA** (P6.06, P6.07, P6.14, Done) — small packages, licenses notice, README + screenshots, CHANGELOG; code-review run, fixes applied; QA run in demo mode: no Fail items. Open for the owner: launch the Windows installers on a Windows PC.

- [x] `P6.01` Palette registry: title, keywords, arg parsers (`watch`, `branch`, `kill`, `open`), enabled reason, recents first — Evidence: `tests/unit/palette.test.ts` (disabled reasons, ranking, `branch`/`open` parsers, recents, dev server confirm, PR/build commands), `tests/e2e/palette.spec.ts` (recents, `open`, `branch` in both windows, disabled reason announced). Not yet: build trigger/deploy, baseline server, PR actions from the palette window (DECISIONS P6-B).
- [x] `P6.02` Empty / loading / error states everywhere + "error with Details" pattern — sweep of every view and panel; repo status errors and the allowed-hosts field gained Details (shared `ErrorDetails`). Evidence: `tests/renderer/feedback-ui.test.ts` (fails with Details removed).
- [x] `P6.03` Font 12 + 18 in every theme; keyboard-only pass on every screen — Evidence: `tests/e2e/a11y.spec.ts`: 5 themes × 12/18px × 8 views (no sideways overflow, window never scrolls); Tab round on 8 views + PRs Reviewing, 4 Utilities tabs, Tickets details, palette and Start work dialog — every stop visible with the theme's focus colour, focus trapped in dialogs, Escape closes and returns focus (fails with the ring removed or recoloured).
- [x] `P6.04` Diagnostics screen (versions, proxy, Test all connections, redacted export) — Evidence: `tests/unit/diagnostics.test.ts` (redaction everywhere, Windows/UNC paths, short names, proxy rules, recorded tests, credentials yes/no), `tests/e2e/diagnostics.spec.ts` (versions, Test all connections in demo, manual proxy changes the route, export without home path, includes the tests).
- [x] `P6.05` Perf check: 5 repos + 10 watches in demo — idle CPU/memory — Evidence: `DEVDOCK_PERF=1 npx playwright test perf` → CPU avg 0.34 % (max 1.3 %), memory 614 MB summed working sets (per-process in DECISIONS P6-C); panel window now lazy (was 753 MB).
- [x] `P6.06` Packaging: icons, version + CHANGELOG, unsigned-app README section — Evidence: icons in build/ (icon.png 1024 px, icon.ico, tray), version 0.1.0, CHANGELOG.md, README "Unsigned app warnings".
- [x] `P6.07` README: features + demo screenshots, per-service setup + scopes, security model, shortcuts — Evidence: README.md (install, warnings, demo mode, features with 10 demo-mode screenshots from `npm run screenshots`, per-service tokens and permissions, security, shortcuts); claims checked against the code by code-review (Spec).
- [x] `P6.08` Panel window: left-click on the menu-bar (macOS) / tray (Windows) icon opens a small frameless panel anchored to the icon (below the menu bar on macOS, above the taskbar on Windows, kept on screen), hides on blur or Escape; right-click keeps the native menu; Open DevDock at the bottom — Evidence: `tests/unit/panel-position.test.ts` (8: macOS menu bar, Windows bottom/top/left/right taskbars, second display, auto-hide, no bounds, tiny screen); `tests/e2e/panel.spec.ts` (Escape hides; reopens).
- [x] `P6.09` Panel content, one click each: search (palette commands), Today at a glance (my PRs + watch/open, watched builds + open, in-progress tickets + Start work), repos (branch/status + Sync base, Update my branch, Push, dev server start/stop), utilities (kill port, copy standup, quick links, pause notifications); anything that changes a remote or kills a process confirms inline in the panel (SPEC 7); deep work hands off to the main window — Evidence: `tests/e2e/panel.spec.ts`: watch a PR in one click, tickets in progress on Today, Sync base dialog in the panel (Escape closes the dialog, not the panel), Start work dialog, copy standup, ports, search, `kill <port>` handled in the panel, Open DevDock hides it and shows Home.
- [x] `P6.10` Panel tests: positioning (unit, both OSes' tray geometry), e2e open → act → hide, keyboard + themes — Evidence: `tests/e2e/a11y.spec.ts` covers the panel: 5 themes × 12/18px × 4 tabs (no sideways overflow, only the body scrolls) and a keyboard round on each tab with the theme's focus ring; `audit.spec.ts` screenshots the panel tabs in 7 looks.
- [x] `P6.11` Lessons file per repo (`docs/ai/LESSONS.md`, path configurable): DevDock gathers review comments on my PRs (Bitbucket), groups them, and lets me tick which become lessons before anything is written; never written without review — Evidence: `tests/unit/lessons.test.ts` (file format, de-dupe, grouping, comment → lesson, path rules), `tests/unit/lessons-service.test.ts` (create/append, links out refused, no temp file, no absolute paths), `tests/integration/lessons.test.ts` (demo comments: not mine, not LGTM; IPC writes; NOT_FOUND; Cloud/DC shapes), `tests/e2e/lessons.spec.ts`.
- [x] `P6.12` Agent kickoff uses the lessons: the Start work brief links LESSONS.md and the agent message asks the agent to read it and append what it learned (no AI calls by DevDock — SPEC non-goal kept, owner's choice) — Evidence: `tests/integration/startwork.test.ts` (message + TICKET.md "Before you start"; per-run ticks win; both off), `tests/e2e/tickets.spec.ts`, `tests/e2e/lessons.spec.ts` (preview follows the ticks).
- [~] `P6.13` Workflow options as checkboxes (Settings → Workflow, and in Start work / the panel): e.g. include lessons in the brief, ask the agent to update lessons, watch the PR build after push, move the ticket on PR, run a check command before push, start the dev server after switching branch — Partial — built: read lessons, add lessons, open VS Code, start dev server after Start work (Settings → Workflow + Start work dialog, also from the panel). Not built (DECISIONS P6-F): watch build after push, move ticket on PR, check command before push, dev server after any branch switch.
- [x] `P6.14` Small packages: everything bundled by electron-vite (no runtime node_modules), English-only Electron locales, maximum compression, no source maps, per-arch builds; size measured before/after and recorded — Evidence: unpacked app 303 → 246 MB, app.asar 50 → 1.9 MB, DMG arm64 121.5 → 103.5 MB, x64 125.6 → 106.2 MB (`npm run dist` exit 0); packaged arm64 app launched (log: started).

Done criteria:

- [x] `P6.D1` Full suite green — Evidence: `npm run lint` exit 0; `npm test` → 56 files, 774 passed, 1 skipped; `npm run e2e` → 46 passed, 4 skipped (opt-in); CI 40221500313 green on macOS and Windows.
- [x] `P6.D2` Packages built (which verified on which OS) — Evidence: macOS arm64 app built and launched on macOS (log "started"); DMGs arm64 103.5 MB + x64 106.2 MB built by `npm run dist` (x64 not launched); Windows NSIS Setup 98.2 MB + Portable 98.0 MB built by CI on windows-latest (not launched — needs a Windows PC).
- [x] `P6.D3` README verified step by step in demo mode — Evidence: QA agent followed README.md step by step in demo mode (first run, every feature, palette arguments, panel, Settings, Diagnostics, shortcuts): all Pass; not checkable here: install/unsigned-warning steps, connecting real services, the OS-level global shortcut.
- [x] `P6.D4` qa-tester agent run in demo mode: no Fail items — Evidence: QA agent run in demo mode (general-purpose agent; no "qa-tester" agent exists here — owner approved): 0 Fail items, `launched.errors` empty, no overflow at 14px Light/Dark; 6 minor observations, 3 fixed (disabled-button reason, Diagnostics alignment and Node "v", lessons tick wording), 3 noted in DECISIONS.

---

## Phase 7 — Terminal, more integrations, AI agents, website (owner request 2026-10-26)

Owner: "In-built terminal … fully functional … in the theme of oh my zsh with proper colour
highlights"; "integration with GitHub Actions, GitLab CI/CD etc … features used in big MNCs";
"integrate multiple AI agents and service providers along with Copilot such as Claude, Gemini,
Codex"; "a landing website … download for Windows and Mac … as a full-fledged application".
Tracks run in parallel in separate git worktrees (one agent each) and are merged one at a time
after review. Decisions in DECISIONS.md "Phase 7".

### Where each track stopped (2026-10-26, paused by the owner)

Each branch has its own worktree under `.claude/worktrees/` and its own PROGRESS notes with the
exact resume steps. Nothing pushed.

| Track | Branch @ commit | State | Resume with |
| --- | --- | --- | --- |
| P7-A Terminal | `p7-terminal` @ `577277b` | Main process (PTY manager, shell + DevDock prompt, batching, IPC), renderer (xterm view, tabs, palette, repo buttons) and packaging config written; node-pty 1.1.0 proven to spawn a real PTY here (postinstall fixes its macOS `spawn-helper` permission). Not yet built, run or tested. | Fix palette test context and view counts, Settings → Terminal, build + launch (CSP style shim, WebGL fallback), tests, docs, lint/test/e2e/dist, code-review |
| P7-B Providers | `p7-providers` @ `9280edb` | Provider model, PR hub, GitHub + GitLab clients (PRs/MRs, Actions/pipelines, logs, re-run), rate limits + ETag cache, run watcher, settings/IPC/keychain written. Unwired, not type-checked or tested; GitHub demo data only. | Typecheck, handlers + index wiring, GitLab demo data, unit tests, renderer, e2e, docs, code-review |
| P7-D Website | `p7-website` @ `07d377e` | Site built (Vite + TS), OS-aware downloads + install dialog, release + Pages workflows (not run); build, 21 unit + 9 browser tests, root lint/test pass; Lighthouse 99–100. | DECISIONS rows, code-review, tick P7.10/P7.11 |
| P7-C AI agents | — | Not started (after P7-A merges). | — |
| P7-E Accessibility | `main` | P7.12 automated part + P7.13 done; lint, 785 unit, 51 e2e green (2026-10-26). | Manual VoiceOver/NVDA pass (owner); Slate muted/text hierarchy question |

**Owner decisions waiting:** website hosting (GitHub Pages proposed) and domain; installer file names without the version vs a `releases.json`; when to tag `v0.1.0` (makes a draft release); a licence (none yet — the site's FAQ says "free"); GitHub/GitLab "CI actions" switch (off by default) on top of confirmations; GitHub/GitLab off by default until set up.

### Tracks (pause points)

- [ ] **P7-A — In-app terminal** (branch `p7-terminal`)
  - [ ] `P7.01` Terminal view + panel: real PTY (`node-pty`) running the user's login shell (zsh/bash/fish; PowerShell/cmd on Windows), xterm.js with fit, links, search, copy/paste, resize, tabs; opens in a repo's folder from Repos/palette
  - [ ] `P7.02` Looks: an ANSI palette per DevDock theme (oh-my-zsh-friendly colours), font/size from Settings; optional DevDock prompt (robbyrussell-style, git branch and status) for people without oh-my-zsh; the user's own `.zshrc`/oh-my-zsh untouched and used when present
  - [ ] `P7.03` Safety + packaging: PTY only in main, input/output over IPC, sessions killed on quit; native module packaged per arch (asarUnpack), Windows ConPTY; tests (unit, e2e typing a command and reading its output)
- [ ] **P7-B — CI / Git provider integrations** (branch `p7-providers`)
  - [ ] `P7.04` Provider model: repos and CI behind adapters (Bitbucket + Jenkins today); a repo's remote decides its provider
  - [ ] `P7.05` GitHub: pull requests (mine, reviewing, merged, watch, actions behind the same confirmations) and GitHub Actions (workflow runs for my branches/PRs, jobs/steps, logs, watch, re-run behind confirmation); github.com and GitHub Enterprise
  - [ ] `P7.06` GitLab: merge requests and GitLab CI/CD pipelines (jobs, logs, watch, retry behind confirmation); gitlab.com and self-managed
  - [ ] `P7.07` Settings, demo data, Today/panel/palette/Diagnostics cover the new providers; tests
- [ ] **P7-C — AI agents and providers** (branch `p7-agents`, after P7-A merges)
  - [ ] `P7.08` Agent launcher: detect installed agent CLIs (Claude Code, Codex, Gemini CLI, GitHub Copilot CLI) and start one in the terminal in the repo with the ticket brief/lessons; Start work offers "Start <agent> now"
  - [ ] `P7.09` Optional AI providers with your own key (Anthropic Claude, OpenAI, Google Gemini) in the keychain; first features: PR summary, review-comment → lesson wording, standup polish — off until a key is added, every call shown and confirmable
- [ ] **P7-E — Accessibility** (owner request 2026-10-26: "add accessibility in the software")
  - [~] `P7.12` Audit against WCAG 2.2 AA — automated part done: `tests/e2e/axe.spec.ts` (3 tests) pass; `contrast.test.ts` 32/32 incl. new 4.5:1 status-text and banner-tint checks (fail on old Slate); `a11y.spec.ts` keyboard rounds + 12/18px pass. Still open: a real VoiceOver + NVDA listening pass (needs a person). Audit: screen-reader names/roles/live regions on every view, the panel and dialogs (VoiceOver + NVDA pass), focus order and return, reduced motion, contrast in all five themes (extend tests/unit/contrast.test.ts), target sizes
  - [x] `P7.13` Settings → Accessibility — e2e `Settings → Accessibility: each switch changes the app` (targets ≥ 44px on all 8 views, motion token 0ms, ring after click, live-region text; fails with the announcer blanked); unit `settings.test.ts` defaults. Settings → Accessibility: reduce motion (follow system or on), larger click targets, underline links, always-visible focus ring, screen-reader announcements for background events (build finished, PR changed); automated axe checks in e2e
- [x] **P7-D — Landing website** (folder `website/`, branch `p7-website`) — built and reviewed; not merged, hosted or released (owner)
  - [x] `P7.10` Static site: hero, features with real screenshots, download section that detects macOS (Apple silicon / Intel) or Windows and offers the right installer, unsigned-app help, privacy, FAQ; light/dark; accessible; fast
  - [x] `P7.11` Downloads wired to GitHub Releases (latest); a release workflow building and attaching the installers on a version tag — publishing and hosting only after the owner confirms
  - Status (p7-website, done 2026-10-26, not merged): merged `main` (owner decisions). Vercel (`website/vercel.json`, Root Directory `website`, `npm run build:site`) replaces the Pages workflow (deleted); versionless names → links always `/releases/latest/download/<name>` (unit test checks `electron-builder.yml`); `releases.json` written at build time (version + sizes only, never fails the build); release workflow: lint + unit tests, versionless names, draft only; footer MIT; CI `website` job; Slate tokens synced to UI-THEMES + drift test; axe WCAG 2.2 AA e2e (5 themes, coming-soon, dialog); macOS 15 Gatekeeper copy; DECISIONS "P7-D". code-review (Standards + Spec) run, fixes applied. Evidence: website Vitest 27/27 (5 files); website Playwright (Chrome) 16 passed, 4 skipped (opt-in screenshots) incl. `axe.spec.ts` 7/7 (mutation: Slate muted #555b62 fails it); root `npm run lint` exit 0; root `npm test` 785 passed/1 skipped. Root e2e not run (no app code changed on this branch). Lighthouse (earlier, before this session): mobile 99/100/100/100, desktop 100. OWNER: connect Vercel (Root Directory `website`), publish the draft release after tagging, then redeploy on Vercel. FOLLOW-UP after P7-B/C merge: update site copy (GitHub/GitLab, opt-in AI providers; it now says Jira/Bitbucket/Jenkins and "no AI service").

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
| 2026-10-22 | P1-B  | Settings `repos` + `git`; RepoService (add/validate/detect base, symlink-safe duplicates); repoStatus; GitActions (fetch all, sync base, update branch merge/rebase + stash & continue + conflict outcome + abort, sync fork + confirmed pushBase, new branch, push branch with protected block), shared plan/run checks, per-repo lock; repos:* IPC + git error codes; open in editor/terminal/files. 35 action/IPC integration tests on real repos; code-review fixes (injection, Windows quoting, stash safety). | P1-C |
| 2026-10-22 | P1-C  | `.git/HEAD` watcher + repos:changed; renderer repo hooks (2-min poll, focus refresh via focusManager); Repos page (cards, status line, per-repo settings, add/remove), ActionDialog (plan → disclosure → run → streamed log → toast; Stash & continue; conflict view + Abort; confirmed push after Sync fork); Today repo status; Settings → Git; palette repo commands routed to the dialog (both windows). e2e for P1.D5 + screenshots. Review fixes applied. | P1-D |
| 2026-10-23 | P1-D  | Resumed: P1-D code existed uncommitted and green (lint, 289 tests, 18 e2e). Found + fixed settings-load regression (strict devCommand reset all settings). Wrote DECISIONS P1-D. code-review (Standards + Spec) run; fixed double-start race, unbounded kill wait, leftover process group, stale renderer log, fish PATH, Windows `./script`; 7 new tests. Phase 1 Done criteria all met. | User review + commit; CI; Phase 2 |
| 2026-10-23 | P1 close | Committed P1-D (a257c9b), pushed. CI showed Windows red since P1-B: missing git identity in tests + EBUSY temp cleanup; also a host-dependent spawn test. Fixed (07b49c4, a268dab), CI run 39901019363 green on both OSes, incl. dev-server e2e on Windows. Phase 1 closed. | Phase 2 — P2-A |
| 2026-10-23 | P2-A  | Jira core: shared model + settings `jira`, ServiceError (HTTP/proxy/cert/429 hints), JiraClient with Cloud (v3, Basic, ADF) / DC (v2, Bearer, wiki) flavours, field discovery, sprint via Agile API, AC + link extraction, JiraService (config/demo), IPC `jira:testConnection/list/issue`, 8 demo issues. 108 new tests. code-review run; 10 fixes, mutation-checked. | P2-B |
| 2026-10-23 | P2-B  | Committed P2-A (a46166b, local). Start work in main: StartWorkService plan/run (GitActions newBranch, TICKET.md + check-ignore warning, repo/DevDock-data location, classification, clipboard, confirmed optional transition, VS Code), brief.ts, JiraClient POST + transition, demo transitions, IPC `startwork:plan/run`, docs/samples. code-review run; 8 fixes. | P2-C |
| 2026-10-23 | P2-C  | Committed P2-B (45bde8b, local). Tickets view (lists, detail pane), Start work dialog, Settings → Jira (Test connection, JQL, board, saved queries, switches), `lib/jira.ts`, e2e for P2.D3 + screenshots. code-review run; 14 fixes. Found and fixed a flaky P1-C palette e2e. Phase 2 Done criteria all met. | User review → commit/push/CI → Phase 3 |
| 2026-10-23 | P2 close | Committed P2-C (8a19f13) and pushed P2-A/B/C. CI run 39908837385: macOS + Windows green — lint, unit/integration (startwork incl.), e2e 21 passed + 1 skipped on each (tickets.spec Start work ran on Windows), dist. Phase 2 closed; user paused before Phase 3. | Phase 3 (`P3.01`) |
| 2026-10-24 | P3-A  | Split Phase 3 into P3-A/B/C. Bitbucket core: Cloud 2.0 + DC 1.0 adapters, one PR model with build statuses, Detect, link parser, 3 lists, settings `bitbucket`, IPC `bitbucket:*`, DC demo fixtures; Jira moved onto shared `rest.ts`. code-review run; 9 fixes (6 mutation-checked). lint/test/e2e green. Not committed. | User review → commit → P3-B |
| 2026-10-24 | P3-B  | Committed P3-A (4b83a2c, local) after re-running lint/test. Watcher (persisted snapshots → notifications, new `pr-closed` type with old settings files filled in), focus-aware Scheduler (jitter, exponential backoff, `Retry-After`), PR actions behind `features.prActions` (handler check, typed merge target, DC vetoes/version, server words verbatim), 409 `conflict` kind, stateful demo, IPC `watch:*` + `bitbucket:action`, notification clicks use the full link allowlist. code-review run; 7 fixes, all mutation-checked. lint/test/e2e green. Not committed. | User review → commit → P3-C |
| 2026-10-25 | P3-C  | Committed P3-B (25f5999, local) on the user's go-ahead. Renderer: PRs view (4 lists, PR rows, Watch field), action dialogs (typed merge, server words), Settings → Bitbucket (Detect, Test connection, PR-actions switch behind a warning; shared ServiceBits), Today (my PRs, watched, in-progress tickets, repos), palette `watch <link>` in both windows (`watch:request` hand-off). code-review run; 11 fixes. lint/test/e2e/dist green. Phase 3 Done criteria all met. Not committed. | User review → commit/push/CI → Phase 4 |
| 2026-10-25 | P3 close | Committed P3-C (ca32b02), pushed P3-A/B/C. CI run 40121991825: macOS + Windows green — lint/format/typecheck, unit, e2e (incl. prs.spec), package. Phase 3 closed; user paused before Phase 4. | Phase 4 |
| 2026-10-25 | P4-A  | Split Phase 4 into P4-A/B/C. Jenkins core: shared job-path model + `jobFromUrl` + `isProtectedJob`, client (Basic, crumb + 403 retry, tree walk, last build, wfapi stages + fallback, progressive console, trigger), My branches matching, PR→job resolution, settings `jenkins`, demo Jenkins (running builds pass/fail on a clock), IPC `jenkins:testConnection/branches/build/console`; `rest.ts` exposes `send`/`readJson`. code-review run; 7 fixes, mutation-checked. lint/test/e2e green. Not committed. | User review → commit → P4-B |
| 2026-10-25 | P4-B  | Committed P4-A (dc4ef43) on the user's "sure". Build watcher (build / job / deploy-for-my-branch, persisted, one `job-finished` notification each, failed stage named), Watch PR pipeline, trigger handler (protected → switch → allow-list, before any request), `jenkins:parameters`, second scheduler, tray dot painted on the icon + watched items in the menu, shared watch-list file helper, demo triggers + deploy build. lint/test/e2e green; 16 mutations checked. code-review then run (after agents first failed to launch); 11 fixes, mutation-checked; lint/test/e2e green (e2e 27). Not committed. | User review → commit → P4-C |
| 2026-10-25 | P4-C  | Committed P4-B (43efc86) on the user's "Sure". Builds view, console tail, trigger dialog, Settings → Jenkins, Today watched builds, palette `pipeline <link>`, demo speed for e2e, P4.D2 e2e (green + red). code-review run; 9 fixes. lint/test/e2e/dist green. Phase 4 Done criteria all met. Not committed. | User review → commit/push/CI → Phase 5 |
| 2026-10-25 | P4 close | Committed P4-C (0d06d55), pushed P4-A/B/C. CI run 40172300911: macOS + Windows green — lint/format/typecheck, unit (41 files), e2e 30 passed on each (incl. builds.spec P4.D2), package. Phase 4 closed. | Phase 5 |
| 2026-10-25 | P5-A  | Phase 4 closed (CI 40172300911). Split Phase 5 into P5-A/B/C. Ports: lsof+ps / netstat tcp+tcpv6+tasklist parsers on captured outputs (incl. German netstat), PortService stop with re-scan, own/system PID refusal, /F or SIGKILL only with `forceConfirmed`; real kill-by-port integration test on macOS. Clean caches: sized plan, fixed paths, symlinks never followed, CacheError on partial removal. IPC `ports:*`, `caches:*`. code-review run; fixes applied and tested (5 mutations caught); DECISIONS P5-A written. lint/test/e2e green. Not committed. | User review → commit → P5-B |
| 2026-10-25 | P5-B  | Committed P5-A (da4976f) on the user's "sure". Env profiles (encrypted per repo, byte-exact switch with backup + swapping restore, key-only state/diff, per-value reveal), quick links (settings + import/export/search/group helpers, hosts allowed), standup (working-day window with holidays, git log by author, PRs opened/merged, Jira status changes, Today from in-progress; demo commits), IPC `envprofiles:*`, `standup:draft`. code-review run; 8 fixes, mutation-checked. Not committed. | User review → commit → P5-C |
| 2026-10-25 | P5-C  | Committed P5-B (fc65716) on the user's "Sure". Utilities view (ports, caches, env profiles, quick links, standup), Settings → Standup, palette `kill <port>`/utilities/links in both windows, Clear all data + env profiles, README with the Windows check, utilities e2e incl. P5.D2. code-review run; 12 fixes. lint/test/e2e/dist green. Phase 5 Done criteria all met. Not committed. | User review → commit/push/CI → Phase 6 |
| 2026-10-25 | P5 close | Committed P5-C (b551481), pushed. CI run 40181751867: macOS + Windows green — macOS unit 50 files, e2e 36 passed; Windows unit 49 files + 1 skipped (real-process ports test), e2e 30 passed (utilities.spec skipped there by design; Windows stop path covered by mocked unit tests). Phase 5 closed. | Phase 6 |
| 2026-10-25 | P6-A (partial) | Phase 5 closed (CI 40181751867). Split Phase 6 (P6-A–D); owner added a Home launcher and a cosmetic audit. Home (DevToys-style: logo, welcome, tool cards), flat card look in every theme (a glass/soft-shadow look was built, shown and dropped at the owner's request), window 1240×820, switch + select redesign, audit fixes across screens (row actions, refresh placement, labels, Ports text, repo picker…). lint/test green; e2e green bar one teardown timeout. Not committed. | Owner review of the look → finish P6-A |
| 2026-10-25 | P6-A (partial) | Fixed the whole window scrolling on Settings (hidden radio inputs positioned against the window; `.content` now the containing block) with a regression e2e that fails without the fix; removed the content width caps so views use the 1240px window, Settings sections laid out title-left/controls-right on wide windows. lint, test (734 passed), e2e (38 passed, 2 skipped) green; audit screenshots reviewed. Not committed. | Owner review → P6.02 states, P6.03 keyboard pass, code-review |
| 2026-10-25 | P6-A done | P6.02 states sweep (repo status + allowed hosts errors get Details via shared `ErrorDetails`), P6.03 e2e (12/18px every theme; keyboard round on every screen, palette and a dialog). code-review: Standards (radius/bold tokens into tokens.css, rail + Settings card rules folded into shell.css, dead CSS removed, shared `RefreshButton`, Home ids fixed, names) and Spec (keyboard test widened and made strict) fixes applied. Renderer component tests live in `tests/renderer/` (web tsconfig). lint/test/e2e green. Not committed. | Owner review → commit → P6-B |
| 2026-10-25 | P6-A close / plan | Committed P6-A (f3becab) and pushed; CI 40197538370 green on macOS (5m31s) and Windows (8m13s). Owner asked for a menu-bar/tray panel (one-click actions, open the app only for depth), agents that learn from PR comments with workflow checkboxes (kept: no AI calls by DevDock — owner chose "prep for my agent"), and small packages. Planned as P6-E, P6-F and P6.14 in P6-D. | P6-E |
| 2026-10-25 | P6-E | Menu-bar / tray panel: left click opens a panel by the icon (macOS below the menu bar, Windows by the taskbar, kept on screen), right click the menu; tabs Today / Repos / Tickets / Tools and search, all one click, confirmations in the same dialogs as the main window, Open DevDock for depth. code-review run; fixes (shared RepoActionButton/SetUp/WatchedBuildRow, Show in Builds, tickets on Today, `kill <port>` in the panel, copy wording, card styles in surfaces.css, per-tab files). lint/test/e2e green. Not committed. | Owner review → commit → P6-F |
| 2026-10-25 | P6-E close | Committed P6-E (7e5b560) and pushed; CI 40199248525 green on macOS (6m46s) and Windows (9m53s). | P6-F |
| 2026-10-25 | P6-F | Agent lessons: Utilities → Lessons gathers reviewers' comments on my PRs (grouped, this repo first), I tick/edit, DevDock appends to docs/ai/LESSONS.md (safe write, no links out). Start work's message and TICKET.md point the agent there and ask it to add what it learned (per-run ticks, defaults in Settings → Workflow); dev server / VS Code follow-ups. code-review run; fixes applied. Not built yet: watch build after push, move ticket on PR, pre-push check. lint/test/e2e green. Not committed. | Owner review → commit → P6-B |
| 2026-10-25 | P6-F close | Committed P6-F (35e07d1) and pushed; CI 40200926773 green on macOS (5m35s) and Windows (9m45s). | P6-B |
| 2026-10-25 | P6-B | Palette: disabled reasons (shown, announced, ranked last), recents first, `branch <KEY>` (Start work preview, both windows), `open <name>`, dev server start/stop (stop confirms), Start work per issue, stop watching PRs/builds, clear finished, PR actions via their dialog. Fixed a ⌘K/Esc/⌘K close race. code-review run; fixes applied. lint/test/e2e green. Not committed. | Owner review → commit → P6-C |
| 2026-10-25 | P6-B close | Committed P6-B (50c2411) and pushed; CI 40202281625 green on macOS and Windows. | P6-C |
| 2026-10-25 | P6-C | Settings → Diagnostics: versions, proxy in use, manual proxy override (SPEC 5), Test all connections, redacted export (+ Save as file). Perf check: CPU 0.34 % avg, 614 MB summed working sets; panel window lazy (−130 MB). code-review run; fixes applied. lint/test/e2e green (one flaky unit run noted). Not committed. | Owner review → commit → P6-D |
| 2026-10-25 | P6-C close | Committed P6-C (8a071d7) and pushed; CI 40203873707 green on macOS (6m02s) and Windows (10m16s). | P6-D |
| 2026-10-25 | P6-D | Small packages (no runtime node_modules, English-only locales, max compression: DMG 121.5 → 103.5 MB arm64, asar 50 → 1.9 MB), THIRD_PARTY_NOTICES, README rewrite with demo screenshots, CHANGELOG, login-item noise fix. Packaged arm64 app launched. code-review run (both reviewers hit a usage limit once and were resumed); fixes applied. Not committed. | Owner review → commit → D3/D4 |
| 2026-10-26 | P7 plan | Owner asked for an in-app terminal (oh-my-zsh look), GitHub/GitLab CI and more providers, multiple AI agents/providers (Claude, Gemini, Codex, Copilot), and a landing website with downloads. Planned Phase 7 tracks P7-A (terminal), P7-B (providers), P7-C (AI agents, after P7-A), P7-D (website); A, B, D started in parallel worktrees. Phase 6 D3/D4 QA run and P6-D CI in progress. | Merge tracks after review |
| 2026-10-26 | P6 close | Committed P6-D (2b8cfff); CI 40221500313 green (Windows Setup 98.2 MB, Portable 98.0 MB). QA agent: README walk-through + full demo QA, 0 Fail. Fixed 3 QA observations; .claude/worktrees ignored by lint/prettier/git. Phase 6 closed (Windows installers still to launch by hand). | Phase 7 merges |
| 2026-10-26 | Pause | Palette now closes on a press outside it (bug from owner; e2e `a click outside the palette closes it`, fails without the fix). Owner asked for accessibility → planned P7-E. Owner paused all agents until tomorrow: each committed WIP on its branch. | Resume per Next step |
| 2026-10-26 | P7 decisions, P7-E | Asked the owner's 5 pending decisions: Vercel hosting, versionless installer names (`npm run dist` → `DevDock-arm64.dmg`, `DevDock-x64.dmg`), tag v0.1.0 after Phase 7, MIT licence (LICENSE added), CI actions behind a switch + confirm. P7-E: added axe e2e; fixed Slate contrast (3.44–4.47 → ≥ 5:1) and the diagnostics report's keyboard reach. | P7.13 |
| 2026-10-26 | P7.13 | Settings → Accessibility (reduce motion, larger targets, underline links, focus ring always, read out events). Fixed the palette click-outside e2e (clicked below the page). Checks: lint ok; unit 785 passed; e2e 51 passed, 4 skipped (opt-in). | code-review P7-E |
| 2026-10-26 | P7-E review, pause | code-review (Standards + Spec): fixed DECISIONS installer names, SPEC §6.7 + UI-THEMES motion note, announcer also in the menu-bar panel, axe on panel + palette window in all 5 themes, computed underline check, shared e2e helpers in fixtures.ts, MOTION_MODES + label map, `--target-min` token. Open: Slate muted vs text hierarchy (asked owner). Checks: lint ok; vitest 785 passed; e2e 51 passed, 4 skipped. Owner paused. | Resume per Next step |
| 2026-10-26 | Resume | Owner: Slate `--text` lightened #ADBAC7 → #CDD9E5 so it stays brighter than the AA muted #A6B1BC (UI-THEMES, DECISIONS). lint ok; vitest 785 passed, 1 skipped (contrast 32). | Resume P7-A/B/D agents |
| 2026-10-26 | P7-D | WIP on branch p7-website: website/ scaffold (Vite + plain TS), all sections, download config/detection/dialog; builds. | Tests, workflows, review |
| 2026-10-26 | P7-D pause | Website, tests, release + Pages workflows done and committed on p7-website (not pushed/deployed). Paused by owner before DECISIONS rows and code-review. | DECISIONS P7-D → code-review → tick P7.10/P7.11 |
| 2026-10-26 | P7-D done | Resumed on p7-website: merged main; Vercel config replaces the Pages workflow; versionless `/releases/latest/download/` links; build-time releases.json; MIT footer; CI website job; Slate token sync + drift test; axe e2e (new dev dep @axe-core/playwright 4.13.0 in website/); macOS 15 Gatekeeper copy; DECISIONS P7-D. code-review run, fixes applied. Checks: website vitest 27, Playwright 16 passed/4 skipped; root lint ok, test 785 passed/1 skipped. Not pushed, deployed or tagged. | Owner review → merge p7-website; connect Vercel |
| 2026-10-26 | P7-D merge | Merged `p7-website` (8f1d179): Vercel config, versionless installer links, draft-only release workflow, website axe tests. Root lint exit 0; vitest 785 passed, 1 skipped; website vitest 27 passed. Owner to do: Vercel import (Root Directory `website`), later tag v0.1.0. | Merge P7-A, P7-B |
| 2026-10-26 | Website redesign | Owner: chainyourmac-style look, Light/Dark toggle, hero shows only the panel (larger), Mac/Windows logo buttons, Terminal tab (drawn until P7-A screenshot). Root lint 0; website vitest 24 passed; playwright site+axe 13 passed, 4 skipped. P7-A agent stopped with review fixes left (see p7-terminal PROGRESS). | Resume P7-A; P7-B running |
