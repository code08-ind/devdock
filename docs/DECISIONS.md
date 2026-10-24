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

## P1-A — Git core (2026-10-22)

| Decision | Why |
| --- | --- |
| `GitRunner` refuses destructive commands **before spawning git**, after skipping global options (`-c`, `-C`, …) and rejecting command-line `alias.*` overrides: force push (any `--force*` incl. abbreviations like `--forc`, `-f` in short-flag groups, `+refspec`), `push --mirror/--prune`, remote delete (`-d`, `--delete`, `:ref`), `reset --hard/--merge/--keep`, `clean`, `restore`, `checkout -- <paths>`, `checkout/switch --force`, `checkout -B`/`switch -C`, `branch -d/-D/-f`, `stash drop/clear`. Error kind `unsafe`. | BUILD-PROMPTS P1 Done: never `push --force` / `reset --hard`. A guard at the single exec point holds even if an action has a bug. `push origin :` (matching refspec) is blocked too, deliberately. |
| Git runs with `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`/`SSH_ASKPASS`, `GIT_EDITOR=true`, and always `-c color.ui=false -c core.quotePath=false`. SSH `BatchMode` is **not** forced (it would override the user's `core.sshCommand`); a GUI-launched app has no TTY to prompt on anyway. | English output so failures can be classified; a missing credential fails fast instead of hanging on an invisible prompt. Credential helpers (osxkeychain, Git Credential Manager) still run. |
| Extra error kinds beyond the six in BUILD-PROMPTS: `timeout`, `unsafe`, `failed` (unclassified). | Every failure maps to a kind, so the UI can always explain it. |
| Protected patterns: `*` matches **within one path segment** (`release/*` blocks `release/1.4`, not `release/1.4/hotfix`); `**` spans segments; matching is **case-insensitive**. | Glob convention; case-insensitive because refs on default macOS/Windows file systems are, so `MAIN` must not slip past `main`. |
| Branch-name collisions get `-2`, `-3`, … on the slug, shortening the slug so it stays ≤ 50 characters. | SPEC 6.2 slug limit. |
| Integration tests (`tests/integration/`, real git + temp repos) run inside `npm test`, with an empty global git config, no system config, and `GIT_CEILING_DIRECTORIES` at the temp dir. | One command for CI; results don't depend on the developer's git setup. |

## P1-B — Repos & git actions (2026-10-22)

| Decision | Why |
| --- | --- |
| Repos live in `settings.repos` (per repo: base branch, protected patterns, branch templates, dev command) and are changed only through `repos:add/update/remove`, not `settings:update`. Global `settings.git`: update strategy (merge/rebase) and editor path. | SPEC 6.7 lists these per repo; the update strategy is "the user's saved default". A dedicated channel validates the folder before saving. |
| `RepoPatchSchema` is built from default-free field schemas (`RepoFields`). | Same zod-4 `.partial()`/`.default()` trap as the settings patch; a regression test checks an update changes only the sent field. |
| Base branch detection: `develop`, then `main`, then `master` on origin; else `origin/HEAD`; else the first local branch. | SPEC 6.2 "default develop, falling back to main". |
| Sync base off the base branch uses `git fetch origin <base>:<base>`; **on** the base branch it uses `git fetch origin <base>` + `git merge --ff-only origin/<base>`. | git refuses `fetch <base>:<base>` into the checked-out branch; `--ff-only` keeps the same "fast-forward or refuse" guarantee. |
| Stash & continue stashes with `--include-untracked`. DevDock remembers the stash **commit id**; Abort re-applies only that stash. If fetch/merge fails for a non-conflict reason after stashing, the stash is popped before the error is reported (or the error says where the changes are). | Re-apply "afterwards" (SPEC) also after an abort, so the user ends where they started; the exact-message check avoids popping someone else's stash. |
| Conflicts are an **outcome** (`status: 'conflict'`, files, operation), not an error; while a merge/rebase is in progress every action except Abort refuses. | The UI must show the conflict view; nothing is auto-resolved. |
| Sync fork returns `pushable` (commits origin lacks); the push is a separate request `pushBase` whose schema requires `confirmed: true` and which, like Sync fork, **requires an `upstream` remote**. Origin rejects non-fast-forwards (no force). | SPEC 6.2: step 3 needs confirmation, never force-push. |
| New branches: `checkout -b <name> --no-track origin/<base>` after fetching; collisions checked against local **and** remote branch names. | A feature branch must not track `origin/develop`; `push -u` sets its own upstream later. |
| Push branch is blocked in the action (error kind `unsafe` → IPC `NOT_ALLOWED`) for the base and protected patterns, before any `git push` runs. | BUILD-PROMPTS: rejected **by the handler**; the integration test asserts no push command reached git. |
| Git errors map to IPC codes `GIT_MISSING`, `NOT_A_REPO`, `DIRTY_TREE`, `CONFLICT`, `NON_FAST_FORWARD`, `AUTH_FAILED`, `TIMEOUT`, `GIT_FAILED`, `NOT_ALLOWED`. | The renderer needs `DIRTY_TREE` to offer Stash & continue. |
| Open in VS Code: the configured binary; on Windows a non-`.exe` launcher runs via `cmd.exe /d /c`; on macOS falls back to `open -b com.microsoft.VSCode` when `code` isn't on a Finder-launched app's PATH. Terminal: Terminal.app / `cmd.exe` via `start` / `x-terminal-emulator`. | Node refuses to spawn `.cmd` without a shell; GUI apps on macOS don't inherit the shell PATH. |
| `GitRunner` sets `GIT_OPTIONAL_LOCKS=0`. | Background status checks must not take index locks the user's own git commands need. |
| One action at a time per repo (`GitActions` busy set); a second request is refused with `PRECONDITION_FAILED`. Refusals before git runs (wrong branch, missing remote, busy, duplicate repo) use error kind `precondition`. | Stash/merge/pop must not interleave; refusals shouldn't look like git failures. |
| `plan()` and `run()` share one precondition check and one command builder. | The disclosure must show what will run; plan refuses what run would refuse. |
| `baseBranch` must pass `isValidBranchName` (no leading `-`, valid ref); generated branch names are re-validated. | Renderer-supplied values reach git as arguments: no option injection. |
| `git.editorPath` must name a known launcher (`code`, `code-insiders`, `codium`, `vscodium`, `cursor`, optional `.cmd`/`.exe`, any folder) with no `"`, `%`, `^`. On Windows the repo folder is the child's **working directory** (`cmd.exe /d /s /c ""<editor>" ."`, `start cmd.exe`), never part of a cmd.exe command line. | The renderer must not be able to launch arbitrary programs; folder names like `R&D` must not break or inject into cmd.exe. |

## P1-C — Repos UI (2026-10-22)

| Decision | Why |
| --- | --- |
| Status refresh: React Query `refetchInterval` 2 min + refetch on focus (with `focusManager` wired to the window's `focus`/`blur`), plus main-process `fs.watch` on each repo's **git dir** for `HEAD`/`HEAD.lock` → `repos:changed` (debounced 300 ms). Watcher syncs are serialised. | SPEC 6.2. React Query's default focus signal (`visibilitychange`) doesn't fire when switching apps in Electron; git replaces HEAD by rename, which would end a watch on the file itself. |
| Every repo action runs in one `ActionDialog`: description → "Commands that will run" (from `repos:plan`) → explicit button → streamed activity log → result toast (also on failure). Dirty tree → Stash & continue (re-plans with the stash commands shown); conflict → file list + Open in VS Code + Abort (its own plan step); Sync fork → "Review push to origin…" → confirmed `pushBase`. Escape is ignored while git runs. | SPEC 6.2 action rules and §7 "no remote-changing action without confirmation". |
| Palette repo commands (Fetch, Sync base, Update, New branch, Push, Sync fork) **open that dialog in the main window**; from the global palette window via `repos:requestAction` → `repos:actionRequested`. Only the "open in editor/terminal/file manager" commands run directly. | Same disclosure and confirmation from every entry point; a palette must not push without confirmation. |
| Ahead/behind vs `origin/<base>` is hidden until the repo has been fetched ("fetch to compare with develop"). | It compares with the local copy of `origin/<base>`, which is meaningless before a fetch. |
| The activity log is keyboard-focusable but not a live region; results are announced by toasts and the conflict alert. | Raw git output would flood screen readers. |
| `branch NM-1234`-style palette arguments are deferred to P6.01 (palette arg parsers). | Planned there in PROGRESS. |

## P1-D — Dev server & baseline (2026-10-23)

| Decision | Why |
| --- | --- |
| A repo's dev command runs **without a shell**: it must start with `npm`, `pnpm`, `yarn`, `bun`, `npx`, `node` or a `./script` inside the repo, and contain no shell syntax (`parseDevCommand`). On Windows the runner is started as `cmd.exe /d /s /c "<argv>"` (verbatim), which is safe because metacharacters were refused. | SPEC 6.2 "runs the repo's `npm run dev` (configurable)"; the renderer must not be able to run arbitrary shell. Node only starts `.cmd` shims through cmd.exe. Env-prefixed commands (`PORT=3000 npm run dev`) aren't supported — use `npm run dev -- --port 3000`. |
| The strict dev-command check applies to **new values** (`RepoPatchSchema`) and at start; the stored `RepoConfigSchema` stays lenient (string ≤ 500). | P1-C saved any string. A strict load-time check would fail `SettingsSchema` and reset **all** settings (every repo) to defaults. Regression test in `settings.test.ts`. |
| Tree kill: macOS/Linux spawn with `detached: true` (own process group) and stop with `SIGTERM` to `-pid`, `SIGKILL` after 4 s, then a final group `SIGKILL`. Windows: `taskkill /pid <pid> /T /F` (`/F` at once, unlike Utilities' kill-by-port in SPEC 6.6). Waiting for exit is capped, so a stuck kill can't block quit. When the leader exits on its own (npm died), the rest of its group is killed too. On app quit, `before-quit` is deferred until `stopAll()` resolves. | SPEC 6.2 "process tree is killed correctly on both OSes when the app quits"; grandchildren that ignore SIGTERM must not keep the port. `/F` needs no second confirmation here because DevDock started the process itself; without it, quit could leave Node servers running. |
| **Stop** on a dev/baseline server has no confirmation dialog. | SPEC 7 confirms "killing a process" — read as processes DevDock didn't start (Utilities, P5.02). Stop is an explicit button on a server the user started from the same panel, and is fully reversible with Start. |
| Start/Stop dev server are **not yet** palette or tray commands (SPEC 7 "every action … from the command palette", SPEC 6.1 tray quick action). Deferred to P6.01 (palette registry with arguments) and the tray quick-actions work. | P1 BUILD-PROMPTS lists only the panel; the palette's repo-argument design is planned in P6.01. |
| URL detection: Vite `Local:` line first, else the first `http(s)://localhost|127.0.0.1|0.0.0.0|[::1]:<port>` URL; ANSI stripped, `0.0.0.0` shown as `localhost`. Status goes `starting → running` only once a URL is seen. Logs kept per server (last 200 kB). | BUILD-PROMPTS P1 dev server bullets. |
| The baseline server (`scripts/baseline.mjs`, offered only when the file exists) runs with **Electron's own binary** and `ELECTRON_RUN_AS_NODE=1`. | Works when `node` isn't on PATH (Finder-launched app). |
| Packaged macOS builds read the login shell's `PATH` once (`$SHELL -ilc`, 5 s timeout) and merge it in; dev-server starts wait for it. | Finder/Dock apps get `/usr/bin:/bin:…` only, so `npm` from Homebrew/nvm isn't found. |
| `app:openExternal` always allows `localhost`, `127.0.0.1` and `[::1]` (any port) besides the user's allowed hosts. | The dev server's URL must be openable from its panel; loopback can't leak data off the machine. |

## P2-A — Jira core (2026-10-23)

| Decision | Why |
| --- | --- |
| One `JiraClient`; Cloud and Data Center differ only in a small `JiraFlavorApi` (`cloud.ts`, `datacenter.ts`): API version, auth header (Basic `email:token` vs Bearer PAT), search URL, rich text (ADF vs wiki markup), user shape. | SPEC 6.5 "normalised into one model"; the rest (fields, sprint, detail, errors) is the same code path for both. |
| Cloud search uses `GET /rest/api/3/search/jql`; Data Center `GET /rest/api/2/search`. Lists are capped at 50 issues (no pagination yet). | Atlassian retired Cloud's `/search` in favour of `/search/jql`. 50 open issues per list is enough for "my work"; pagination can come with P3's scheduler if needed. |
| Sprint and "Acceptance Criteria" custom field ids are discovered once per client from `/field` (sprint by schema `gh-sprint`, AC by name). Sprint values are parsed from objects (Cloud/new DC) or legacy `Sprint@…[name=…]` strings; the active sprint wins. | Custom field ids differ per site; hard-coding `customfield_10020` breaks most Data Center installs. |
| "Current sprint" = active sprint ids from the Agile API (`/rest/agile/1.0/board/{id}/sprint?state=active`), then a normal JQL search `sprint in (…)`. | One normalisation path for every list. |
| Acceptance criteria: the "Acceptance Criteria" field if the site has one, else the description section under an "Acceptance criteria" heading / bold title / `Acceptance criteria:` line. `null` when absent — P2-B uses that for agent classification. | SPEC 6.5 step 4 needs "unclear acceptance criteria" to be decidable. |
| Linked URLs: Figma (`figma.com` and subdomains) and Confluence (`*.atlassian.net/wiki/…`, a `confluence` host, `/confluence/` context path, `/display/<space>/`, `pages/viewpage.action`) found in the description. | SPEC 6.5 issue card; self-hosted Confluence rarely has "confluence" in the host. |
| ADF → Markdown covers paragraph, text marks, hard break, heading, bullet/ordered/task lists, code block, blockquote, panel, rule, expand, mention, emoji, cards, status, date, table, media placeholder; unknown nodes keep their text. Wiki → Markdown is basic (headings, emphasis, monospace, code/noformat/quote, lists, tables, links, mentions). | BUILD-PROMPTS P2 node list, plus the nodes common in real tickets. Nothing is silently dropped. |
| `ServiceError` (`services/service-error.ts`, shared with future adapters) classifies HTTP statuses (401/403/404/429/5xx), non-JSON 2xx (proxy/login page), and fetch failures (Electron `net::ERR_*` names and Node cause codes → timeout / proxy / certificate / network), each with a fix-it hint. New IPC codes: `NOT_CONFIGURED`, `SERVICE_AUTH`, `SERVICE_FORBIDDEN`, `RATE_LIMITED`, `PROXY`, `CERTIFICATE`, `NETWORK`, `SERVICE_FAILED`; raw body goes in `details`. | SPEC 6.7 "a hint for common failures: 401, 403, proxy, certificate". |
| 429 is **reported**, with the `Retry-After` wait (seconds or HTTP date) in the message, not retried inside the adapter. Requests time out after 20 s. | Backoff and `Retry-After` scheduling belong to the polling scheduler (P3.06); a user-triggered request shouldn't hang silently. |
| Issue keys are validated (`^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$`) in the IPC schema and again in the client before they reach a URL path. | Renderer input must not be able to change the request path. |
| Settings `jira`: flavor, base URL (http/https, no credentials, trailing `/` removed), email (Cloud), JQL (SPEC default), board id, saved queries (≤ 20). Token stays in the `jira.token` secret. "Not configured" errors name exactly what's missing. | SPEC 6.5 / 6.7. |
| `app:openExternal` also allows the configured Jira host. | SPEC 5: "hosts from configured services plus the user-editable allowlist". |
| Demo: Cloud-flavoured MSW fixtures at `https://demo.devdock.invalid/jira`, 8 fake issues `DD-101…108` (`example.com` people), board 7 with one active sprint. | BUILD-PROMPTS P2 demo fixtures; covers the Start-work classifications P2-B needs (Bug, vague Story, Task without AC, AC in a custom field). |
| Comments come from `GET …/issue/{key}/comment?orderBy=-created&maxResults=10` (parallel with the issue), shown oldest first. | The comment list embedded in an issue is paged from the oldest, so long threads would miss the newest — the ones a brief needs. |
| 407 maps to the proxy error; Agile API 400 ("board does not support sprints") and 404 get board-specific messages (Kanban / unknown board). 401/403 hints come from each flavour (`JiraFlavorApi.hints`), not from the shared error module. | SPEC 6.7 hints; the shared module will serve Bitbucket and Jenkins too. |
| `ServiceError.details` (response body / low-level error text, ≤ 2 kB) is passed through the logger's `redact()` before it can reach the renderer. | SPEC 5 redaction; a proxy error page can echo request headers. |
| Failure HTTP status travels in the message ("… (401)"), not as a separate IPC field. | `IpcErrorShape` stays `code/message/details`; network/proxy/certificate failures have no status anyway. |
| The issue **list** model has no Figma/Confluence links (that would need every description); links are on the detail model for the drawer and TICKET.md. | BUILD-PROMPTS: "Issue detail drawer with links". |
| Base URL rejects a query or fragment (`?`, `#`) as well as credentials. | Every API path is appended to it; `…/#` would swallow them. |
| The demo Jira site is injected into `JiraService` (`deps.demo`); while demo mode is on, `app:openExternal` also allows the demo host. | Keeps msw fixtures out of the production service; demo issue links must open (SPEC 7 "works fully in demo mode"). |
| A malformed key reaching the client is `not_found` without a request; the IPC schema already rejects it as `INVALID_PAYLOAD`. | Defence in depth; the client is also called from main-process code (Start work). |

## P2-B — Start work (2026-10-23)

| Decision | Why |
| --- | --- |
| Two IPC steps: `startwork:plan` (read-only: branch name, git commands, brief path, `.gitignore` check, agent + reason, message, transition setting) and `startwork:run`. | SPEC 6.5 step 3 says the `.gitignore` is checked **first** and the user warned; the plan is what the dialog (P2-C) shows before anything changes, like the repo actions' disclosure. |
| The branch is made by `GitActions` `newBranch` (fetch + `checkout -b <name> --no-track origin/<base>`), so Start work gets the same checks, per-repo lock, collision suffixes and command log. Bugs use the `bugfix` template, everything else `feature`; name from `{KEY}` + slug of the summary. `GitActions.planNewBranch` exposes the name for the plan. | SPEC 6.5 step 2 "from a fresh base (6.2), named from the template". |
| Classification: issue type matching `bug`/`defect` → bug-fixer; Story/Task types (incl. Sub-task) → spec-writer when acceptance criteria are missing, a placeholder (TBD/TODO/N/A/?), or fewer than 3 words; everything else (incl. Epic, Improvement) → feature-builder. | SPEC 6.5 step 4 "unclear acceptance criteria" needs a concrete rule; a one-word criterion can't be tested. |
| `.gitignore` check is `git check-ignore -q -- docs/ai/specs/<KEY>/TICKET.md` (exit 0 = ignored). | Honours every ignore source (`.gitignore` at any level, `.git/info/exclude`, global excludes), not just the root file, and reports an already-committed brief as not ignored (tested). |
| Brief location "DevDock data" writes `<userData>/briefs/<KEY>/TICKET.md`; the agent message then carries that absolute path. Repo location uses the `/`-separated relative path in the message on every OS. | SPEC 6.5 toggle; the message is pasted into an agent running in the repo. |
| TICKET.md: title, facts (type, priority, status, sprint, fix version, Jira link), Summary, Description, Acceptance criteria, Links, Comments (newest 10, oldest first). Headings inside description/comments are demoted to nest under the brief's sections (code fences untouched). Criteria taken from the description are removed from the Description so they appear once. Rewritten on each Start work. | SPEC 6.5 step 3 contents; a brief agents can parse by section. |
| Transition: only when Settings → `features.jiraTransition` is on (read in the main process) **and** the run request carries `confirmTransition: true` (the dialog's explicit confirmation; otherwise `declined`). Skipped if the status is already "In Progress"; otherwise the transition whose name or target status is "In Progress" (case-insensitive) is posted. No match or an error is a **warning** — the branch, brief and clipboard are already done. | SPEC 6.5 step 6 "optional, off by default … if that transition exists"; BUILD-PROMPTS "never called unless the setting is on (test)". |
| After the branch: brief → clipboard (`clipboard.writeText` in main) → transition → open in VS Code (request flag `openEditor`, existing `openRepo(…, 'editor')`). Editor failure is a warning. | SPEC 6.5 order; failures after the branch exists shouldn't read as "Start work failed". |
| `docs/samples/` (generated TICKET.md + clipboard messages from demo data, `DEVDOCK_WRITE_SAMPLES=1 npx vitest run tests/integration/startwork.test.ts -t P2.D5`) is excluded from Prettier. | They are evidence of the app's exact output (P2.D5); reformatting would make them differ from what DevDock writes. |
| `startwork:run` carries the `agent` the preview showed; `run` re-reads the ticket and refuses (`PRECONDITION_FAILED`, nothing changed) if it now classifies differently. The branch name may still get a new collision suffix after the fetch; the result reports the real name. | The dialog's agent, branch template and message must be what runs (same idea as the repo actions' shared plan/run checks). |
| Issue keys returned by Jira are validated (`ISSUE_KEY`) when normalised, and Start work refuses a response for a different key than requested. | The key becomes a file path (`docs/ai/specs/<KEY>/TICKET.md`, `briefs/<KEY>/`); a hostile server or proxy must not be able to write outside them. |
| Failures after the branch exists: writing TICKET.md → typed `StartWorkError('brief')` ("Created <branch>, but couldn't write …", IPC `INTERNAL`); clipboard, transition and editor → warnings in the result. | The user must know the branch exists; DECISIONS' typed-error convention. |
| `openRepo` (editor/terminal/files) is one function in `main/index.ts`, shared by the repo IPC handlers and Start work. | Same editor resolution (and Finder-PATH fallback) everywhere. |

## P2-C — Tickets UI (2026-10-23)

| Decision | Why |
| --- | --- |
| Tickets view = issue list + detail pane (UI-THEMES "content area + optional detail pane"); two columns from 1100 px, stacked below. Opening an issue scrolls its pane into view and moves focus to it. | The default 900 px window stacks the pane below the list, out of sight; keyboard/screen-reader users must land on what they opened. |
| List switcher: My open issues, Current sprint (when a board id is set, or in demo mode), then each saved query. Lists refetch on window focus and after 60 s. | SPEC 6.5 lists; Jira changes outside DevDock. |
| Ticket text (description, criteria, comments) is shown as wrapped plain text, not rendered Markdown. | No Markdown/HTML renderer dependency (and no HTML from Jira in the renderer); the Markdown is readable as is. Revisit in P6.02 polish if needed. |
| Start work dialog: repo picker → preview from `startwork:plan` (agent + why, branch, commands, brief path, location choice, `.gitignore` warning, message) → **Start work** → streamed git output → result (branch, brief file, agent, Jira result, warnings). The location choice writes the `features.briefLocation` setting (the dialog says so) and re-plans. The message is labelled "Will be copied to the clipboard" before the run; the result toast only claims the clipboard when the copy worked. | SPEC 6.5 + "commands that will run" disclosure pattern from repo actions. |
| When the transition setting is on, the dialog shows a checkbox "Move <KEY> to In Progress in Jira (if the workflow allows it)", ticked by default, and the primary button then reads **"Start work and move to In Progress"**; Start work sends `confirmTransition` from it. | SPEC 7 / UI-THEMES: the confirming click states exactly what will happen; ticked because the user opted in via Settings. |
| Settings → Jira: site type, site URL, account email (Cloud), Test connection (HTTP status + user, or the error with its hint), JQL, board id, saved queries (add/remove), transition switch, brief location. The token stays in Credentials, relabelled "Jira API token or personal access token". | SPEC 6.7. One secret key (`jira.token`) for both flavours. |
| e2e `tickets.spec.ts` unticks "Open in VS Code" and saves/restores the system clipboard around the run. | A test must not launch the developer's editor or leave its clipboard changed. |
| Tickets on Today and palette commands for issues/Start work are not part of P2. | Today aggregation and palette arguments are P3.08 / P6.01. |
| `CommandList` and `ActivityLog` live in `ui/Run.tsx`, shared by the repo action dialog and Start work. | Both dialogs run git; tickets shouldn't import from repos. |
| Settings text fields follow external changes (import, Clear all data, other window) and validate before saving (board id must be a number). Saved-query inputs clear only after the save succeeds. Test connection results reset when site type/URL/email change. | A stale draft could be saved back over newer settings; errors belong next to the field. |
| Selected issue rows switch muted text to `--text` (as palette items do). | P0-C rule: muted text never sits on `--selection` (fails AA in Dark/Slate); asserted in `tickets.spec.ts`. |
| Fixed a flaky P1-C e2e (palette repo action, ~3/8 failures on the committed code): it typed before the palette input had focus, so Enter ran "Go to Today". It now waits for the focused input and the matching option. | 10/10 in isolation, full suite 3×: 63/63. |

## P3-A — Bitbucket core (2026-10-24)

| Decision | Why |
| --- | --- |
| One `BitbucketClient` over a `BitbucketAdapter` per flavour (`services/bitbucket/cloud.ts`, `datacenter.ts`): `myself`, `list`, `pr`, `builds`. The client adds the user lookup (once per client), de-duplication, newest-first sort and build statuses (≤ 4 lookups in flight). | SPEC 6.3 "normalised into one PR model"; Cloud and DC list PRs in very different ways, so the split is wider than Jira's `JiraFlavorApi`. |
| HTTP for Jira and Bitbucket goes through one `services/rest.ts` `requestJson` (auth header optional for probes; failures → `ServiceError` with the adapter's hints). The JSON guards moved from `jira/json.ts` to `services/json.ts`. | Same transport and error mapping for every adapter; Jira behaviour unchanged (its tests pass untouched). |
| **Cloud lists scan the registered repos.** Cloud has no cross-repository "PRs I review" endpoint, so each list is a per-repo query (`/repositories/{ws}/{repo}/pullrequests?state=…&q=author.uuid="…"` or `reviewers.uuid`, `fields=+values.participants`) over the bitbucket.org remotes of the repos in Repos (`cloudRepoFromRemote`; case-insensitive de-dup, first spelling wins). No such repos → `not_configured` naming the fix. A repo the token can't see (403/404) is skipped; 401 and network errors fail the list. | SPEC 6.3 lists; the developer's PRs are on the repos they work in. A settings list of extra repos can be added if needed. |
| Data Center lists use `GET /rest/api/1.0/dashboard/pull-requests` (`role=AUTHOR|REVIEWER`, `state=OPEN|MERGED`, `order=NEWEST`; merged also `closedSince=604800`, then filtered on `closedDate` ≥ now − 7 days). | Built for "my PRs" across projects. |
| Pagination: Cloud follows `next` **only on the API origin** (it carries the token); DC repeats the URL with `start=nextPageStart` until `isLastPage`. Both stop after 10 pages (comments/activities after 5). | P3.D1; a hostile or broken `next` must not receive credentials or loop forever. |
| Auth: Cloud sends Basic `username:token` when Settings → Bitbucket has a user name/email (app password or Atlassian API token), else Bearer (repository/workspace access token). DC always sends the HTTP access token as Bearer. No separate "auth type" field. | SPEC 6.3 "whatever credential type the workspace allows"; the user name being present is the auth type. |
| Test connection: Cloud `GET /2.0/user`; DC has no "myself", so `GET application-properties` with the token and read `X-AUSERNAME` (missing → `auth` error: the server answered anonymously), then `/users/{name}` for the display name (optional). The Cloud UUID is checked to be `{hex-dashes}` before it goes into a BBQL query. | SPEC 6.7 "the user it authenticated as". |
| Detect: bitbucket.org hosts → Cloud without a request; anything else → unauthenticated `GET {base}/rest/api/1.0/application-properties`; a JSON answer with a version (and a Bitbucket/Stash display name) → Data Center + version, 404/non-JSON/other product → "doesn't look like Bitbucket". In demo mode it probes the demo server. | SPEC 6.3 "Detect button that probes the base URL"; no credentials sent to a URL that is still being typed. |
| PR model: title, source → target, state (Cloud `SUPERSEDED` → declined), reviewers (Cloud: role REVIEWER or anyone who voted; DC: reviewers + participants who voted), approvals / needs-work counts, total comments, `unresolvedComments`, `conflicts`, created/updated/closed, head commit, build summary. | SPEC 6.3 PR card. |
| `unresolvedComments` is `null` in lists and filled for a single PR (`bitbucket:pr`, used by the watcher in P3-B): Cloud counts top-level, non-deleted comments without `resolution`; DC counts root comments with `threadResolved: false` from `/activities` (`null` on servers whose comments lack that flag). | Neither list API exposes it; one extra request per PR per list would double the polling cost. |
| `conflicts` is DC `properties.mergeResult.outcome` (CONFLICTED/CLEAN, else null); Cloud has no flag → `null`. Cloud has no close time, so `closedAt` = `updated_on` for merged/declined. | SPEC 6.3 "conflicts flag (if the API exposes it)". |
| Build status: Cloud `GET /repositories/{ws}/{repo}/commit/{hash}/statuses`, DC `GET /rest/build-status/1.0/commits/{hash}` on the PR's head commit; one per key; summary failed > running > stopped > success > none. 403/404 → no builds. | SPEC 6.3 "build status from Bitbucket build statuses posted by Jenkins"; the head commit is what the build ran on. |
| Settings `bitbucket`: flavor (default Cloud), base URL (empty = `https://bitbucket.org` for Cloud), user name (Cloud). Token is the existing `bitbucket.token` secret. The configured host is allowed for `app:openExternal`. | SPEC 6.7; same shape as `jira`. |
| PR refs `{owner, repo, id}`: owner is the Cloud workspace or DC project key (`~user` for personal repos), slugs `^~?[A-Za-z0-9][A-Za-z0-9._-]*$`, validated in the IPC schema. The link parser (`shared/prlink.ts`) accepts both URL shapes with any trailing page (`/overview`, `/diff`, `/commits/…`), query and fragment, DC context paths and ports, a missing scheme and `<…>`; it lives in `shared/` so the palette (P3-C) can validate as you type. | P3.02; renderer input must not change request paths. |
| Demo: Data Center-flavoured MSW fixtures at `https://demo.devdock.invalid/bitbucket` (user `dev`): 4 open PRs of mine (passing + 2 approvals, failing + needs work + 3 open threads, running + conflicts, no builds), 2 to review, 2 merged this week. Times are relative to now. | P3.08; shows the adapter Jira's Cloud demo doesn't. |
| Refs read from the server (Cloud `destination.repository.full_name` + id, DC `toRef` project key + slug + id) pass the same `PrRefSchema` check as renderer input (`checkedRef`) before they reach a URL path; a bad one is `bad_response`. | Code review: DECISIONS P2-A/P2-B rule "validated before a URL/file path"; `encodeURIComponent('..')` is still `..`. |
| `prKey` is lower case. | DC reports a personal project as `~JDOE`, its links say `/users/jdoe`; the watcher (P3-B) must see one PR. |
| Detect: a 401/403 on `application-properties` means Data Center (version unknown). | Some servers require a login for it; that path only exists on DC. |
| Cloud user name may not contain `:`. DC Test connection hides only a 403/404 on the user page (the name from `X-AUSERNAME` is shown); other failures surface. | Basic auth splits on the first `:`; a network failure must not look like success. |
| **Known limits (P3-A):** (1) Cloud "My PRs" and "Recently merged" also scan the registered repos, though Cloud has a per-user endpoint — kept uniform with "Reviewing" (which has no alternative); PRs in repos not added to Repos are missed. (2) Cloud repository/workspace **access tokens** (Bearer) act as a bot user, so `author`/`reviewer` lists come back empty; use an API token or app password with a user name/email (the Settings UI in P3-C will say so). (3) Cloud "merged" uses `updated_on`, so a PR merged earlier but commented on this week appears with that later time. (4) Unresolved counts read at most 500 comments/activities. | Accepted for now; revisit if they bite (BUILD-PROMPTS keeps Cloud and DC "unknown which"). |
