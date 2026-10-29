# DevDock — product spec

DevDock is a small cross-platform desktop app (macOS and Windows) that sits in the menu bar or
system tray and handles a frontend developer's daily chores. It works with **Bitbucket, Jenkins,
Jira, local git repos, and the dev server**, so you stop babysitting tabs and terminals.

Place this file at `docs/SPEC.md` in the new repository. Every build phase refers to it.

---

## 1. Goals
1. **One-click git chores.** Sync the base branch, update my branch from base, sync a fork,
   create a branch from a ticket, and start the dev server.
2. **Stop watching tabs.**
   - Get notified when a PR build passes or fails, when a PR gets comments or approvals, and
     when a Jenkins job finishes.
   - Paste a PR link to watch its pipeline until it finishes.
3. **Ticket → agent kickoff.** Pick a Jira ticket. DevDock then creates the branch, writes a
   ticket brief, and copies the exact message for the Copilot spec-writer, bug-fixer or
   feature-builder agent to the clipboard.
4. **Small utilities:**
   - see what is using a port and stop it
   - switch `.env` profiles
   - quick links
   - a standup draft from yesterday's commits and ticket activity
5. **Trustworthy.**
   - secrets stored in the OS keychain/DPAPI
   - no telemetry
   - no remote-changing action without explicit confirmation
   - a demo mode that works with zero real credentials

## 2. Non-goals
- Not a git GUI, CI dashboard, or Jira client replacement. DevDock does the 20 most frequent
  actions and deep-links to the real tool for everything else.
- No AI API calls by default. The agent work stays in the user's own agent (VS Code/Copilot, or
  an agent CLI DevDock starts in its terminal, 6.9). Since Phase 7 the user may add their own AI
  keys for a few opt-in features (DECISIONS "Phase 7").
- No phone/remote access, and no exposing local ports to a network. This is deliberately
  excluded for a client environment.
- No production deployments. See the protected-job rules in 6.4.

## 3. Users and context
- A frontend SDE 1. Can push branches and open PRs, but is not necessarily allowed to approve,
  merge, or trigger deployments.
  - PR actions and job triggers exist but are **off by default** and gated by server-side
    permissions.
- Daily machines: a personal Mac (Apple silicon) and an office Windows laptop. The Windows laptop
  may have no admin rights, a corporate proxy, TLS inspection, and an app allow-list.
- Systems:
  - **Bitbucket:** Cloud or Data Center/Server, unknown which. Support both via adapters.
  - **Jenkins**
  - **Jira:** Cloud or Data Center. Support both.
  - **AWS:** links only.

## 4. Tech decisions
| Area | Decision | Why |
|---|---|---|
| Shell | **Electron** (current stable) via **electron-vite** | JavaScript/TypeScript only; no Rust toolchain needed on a locked-down Windows laptop; mature tray, notification, and global-shortcut APIs on both OSes |
| UI | **React 18 + TypeScript**, CSS Modules + tokens from `docs/UI-THEMES.md` | Same design system as DevLens |
| Data fetching | TanStack Query in the renderer, calling **main-process services via IPC** | Polling, caching, retries, and backoff for free; tokens never reach the renderer |
| Validation | `zod` for IPC payloads, settings, and API responses | Trust boundaries are explicit |
| Git | `child_process.execFile('git', [...args])`, never shell strings | Safe on both OSes; uses the user's own git and credential helper |
| Secrets | Electron `safeStorage` (Keychain on macOS, DPAPI on Windows) encrypting a file in `userData` | No native-module build step |
| Packaging | electron-builder: macOS dmg (arm64 + x64), Windows NSIS **per-user** installer + **portable exe** | Portable/per-user works without admin |
| Tests | Vitest (main services + renderer), MSW for HTTP fixtures, Playwright `_electron` for e2e | |
| Lint/format | ESLint (typescript-eslint, react-hooks, jsx-a11y) + Prettier | |

## 5. Architecture and security baseline (non-negotiable)
- `BrowserWindow` options: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`.
- **Content Security Policy:** `default-src 'self'`, with no remote scripts, styles, or fonts.
- The preload script exposes one typed `window.devdock` API. Each method maps to an allow-listed
  IPC channel, and the main process validates every payload with zod.
- **All network and git calls run in the main process.** The renderer never sees tokens.
- `shell.openExternal` only for `https:`/`http:` URLs, on hosts from configured services plus a
  user-editable allowlist. Navigation and new windows inside the app are blocked.
- **Logs:**
  - rotating file in `userData/logs`
  - redact `Authorization` headers, tokens, and query params named
    `token|key|secret|password`
  - "Open logs folder" in Settings
- **Networking:**
  - Electron's network stack (`net.fetch`), so the OS proxy settings and the OS certificate
    store (corporate root CA) are used automatically
  - Settings allow a manual proxy override and a "Test connection" diagnostics view
- **Demo mode:** every adapter has a fixture-backed fake (MSW). Toggling demo mode in Settings
  runs the whole app on fake data. This mode is used for screenshots, blog posts, and e2e.
- No auto-update in v1, no telemetry, no crash upload.

## 6. Modules

### 6.1 Shell, tray, notifications, command palette
- **Tray/menu-bar icon** with a status dot: green when all watched builds pass, red when any
  fails, grey when idle. The menu shows:
  - watched items with their status
  - quick actions: Sync base (current repo), Update my branch, Start dev server, Open DevDock,
    Pause notifications 1h, Quit
- **Main window:** compact, about 900×600, resizable. Left nav rail: Today, Repos, Pull
  Requests, Builds, Tickets, Utilities, Settings.
- **"Today" view:**
  - my PRs with build/approval/comment state
  - watched builds
  - my in-progress tickets
  - repo status (ahead/behind, dirty)
- **Global shortcut** (default `Ctrl+Shift+Space` / `Cmd+Shift+Space`, configurable, with
  conflict detection) opens a **command palette** window. Every action is searchable, and some
  take arguments, e.g. `watch <PR link>`, `branch NM-1234`, `kill 5173`.
- **Native notifications:** build finished (pass/fail), PR comment/approval/needs-work, and
  watched-job finished. Clicking a notification opens the item. A notification history is kept
  (last 200), with per-type toggles and quiet hours.
- Option to launch at login (off by default).

### 6.2 Repos (local git)
- Register local repos by folder picker. Validate that the folder is a git repo, and detect:
  - the remotes (`origin`, optional `upstream`)
  - the base branch (configurable, default `develop`, falling back to `main`)
- **Status per repo**, refreshed on focus and every 2 minutes, plus a file-watcher on `.git/HEAD`:
  - current branch
  - ahead/behind vs `origin/<branch>` and vs `origin/<base>`
  - dirty file count
  - stash count
  - last fetch time
- **Actions.** Each shows the exact git commands it will run in a details disclosure, streams
  the output into an activity log, and ends with a result toast.
  - **Fetch all:** `git fetch --all --prune`.
  - **Sync base:** fetch, then fast-forward the local base branch to `origin/<base>` without
    checking it out (`git fetch origin <base>:<base>` when safe). Refuse if a fast-forward is
    impossible and explain why.
  - **Update my branch from base:** the user picks merge or rebase as their saved default.
    - Refuse if the working tree is dirty, offering "Stash & continue", which re-applies the
      stash afterwards.
    - On conflict, stop and show the conflicted files. Offer "Open in VS Code" and "Abort"
      (`git merge --abort` / `git rebase --abort`).
    - Never auto-resolve.
  - **Sync fork** (only if an `upstream` remote exists):
    1. fetch upstream
    2. fast-forward the local base from `upstream/<base>`
    3. push the base to `origin`

    Step 3 needs confirmation. Never force-push.
  - **New branch:** from a fresh `origin/<base>` with a name template
    `feature/{KEY}-{slug}` / `bugfix/{KEY}-{slug}`. The slug is ASCII-only, kebab-case, and
    at most 50 characters.
  - **Push branch:** `git push -u origin <branch>`. Blocked for base and protected branches
    (configurable patterns, default `main|master|develop|release/*`).
  - **Open in VS Code** (`code <path>`, with the binary path configurable), **Open terminal**,
    and **Reveal in Finder/Explorer**.
  - **Start dev server:**
    - runs the repo's `npm run dev` (configurable) as a managed child process
    - captures the URL/port from the output
    - shows the logs in a panel
    - has a Stop button
    - the process tree is killed correctly on both OSes when the app quits
  - **Baseline server:** if `scripts/baseline.mjs` exists (from the Copilot workflow kit),
    offer Start/Stop baseline and show its port.
- All git commands use `execFile` with argument arrays, run with the repo as `cwd`, and have
  timeouts. Credentials come from the user's existing git credential helper. DevDock never
  stores git credentials.

### 6.3 Pull requests (Bitbucket)
- **Adapters:**
  - **Bitbucket Cloud:** REST API 2.0, authenticated with whatever credential type the
    workspace allows (API token / app password).
  - **Bitbucket Data Center/Server:** REST API 1.0, authenticated with an HTTP access token as
    a Bearer token.
  - Both are normalised into one PR model. Settings has a "Detect" button that probes the base
    URL to pick the adapter.
- **Lists:**
  - My open PRs.
  - PRs where I am a reviewer (read-only view).
  - Recently merged (7 days).
- **PR card:**
  - title, source → target branch
  - build status (from Bitbucket build statuses posted by Jenkins)
  - approvals / needs-work count
  - unresolved comments count
  - conflicts flag (if the API exposes it)
  - age, and the link
- **Paste a PR link** anywhere (command palette or a "Watch" field). DevDock parses the
  workspace/project, repo and id for both Cloud and DC URL shapes, adds the PR to Watched, and
  notifies on state changes.
- **PR actions:** approve, request changes/needs work, merge.
  - **Disabled by default.** Enabling them in Settings shows a warning: "Use only if your role
    permits."
  - Even when enabled, each action needs a confirmation dialog naming the PR and target branch.
    Merge additionally requires typing the target branch name.
  - Server permission errors are shown verbatim.
- Polling defaults to every 60s while the app is focused and every 3 min in the background, with
  exponential backoff on errors and `Retry-After` honoured.

### 6.3a GitHub and GitLab (Phase 7, P7-B)
- **Provider model:** a pull request (GitLab: merge request) belongs to Bitbucket, GitHub or
  GitLab; the ref carries its provider (absent = Bitbucket, so stored watches keep working). The
  lists, PR card, Watch field, watcher, notifications, Today, the menu-bar panel and the palette
  show every provider that is turned on, in one list (a provider filter appears when more than
  one is on). A repo's remote host decides its provider; Settings → Detect reads the remotes.
- **GitHub:** github.com or GitHub Enterprise Server (REST v3 + one GraphQL query for unresolved
  review threads), personal access token as Bearer. My PRs, reviewing (requested or reviewed by
  me), merged in 7 days; checks and commit statuses as the build pill. **Actions:** my recent
  workflow runs on the registered repos hosted there, jobs with steps, the end of a job's log
  (the signed storage redirect is followed without the token), watch a run.
- **GitLab:** gitlab.com or self-managed (relative URL root supported; subgroup namespaces),
  REST v4, personal access token as Bearer. Merge requests (mine, reviewing, merged), approvals,
  open threads, head pipeline. **CI/CD:** my recent pipelines, jobs by stage, job trace tail,
  watch a pipeline. GitLab's API has no "request changes": only approve and merge are offered.
- **Off by default**, each with a switch (Settings → GitHub / GitLab); Bitbucket can be turned
  off too. Tokens live only in the OS keychain (`github.token`, `gitlab.token`).
- **PR actions** use the same switch, confirmation and typed merge target as 6.3 (merge sends
  the checked head SHA, so a push in between is refused by the server).
- **CI actions** (re-run failed jobs / retry failed jobs / cancel): behind Settings → **CI
  actions**, off by default, **and** a confirmation each time naming the run; checked again in
  the IPC handler, and refused before any request when the run's state doesn't allow it.
- **Rate limits:** GitHub `X-RateLimit-*` / secondary limits and GitLab 429 pause that provider
  until the reset (no requests sent meanwhile); GitHub GETs use ETags (304s don't count).

### 6.4 Builds (Jenkins)
- Auth: Jenkins username + API token (Basic). Crumb issuer support for POSTs.
- **My branches:** for configured multibranch pipeline jobs, show the last build of each branch
  I have locally or in open PRs. Each build shows status, duration, stages (via the Pipeline
  REST `wfapi` endpoints if available, otherwise "stages unavailable"), and a link.
- **Watch a build/job:** watch until finished, then notify. Console tail view uses progressive
  text, auto-scrolls, and has a search box.
- **Watch PR pipeline:** from a PR link, resolve the branch, find the matching job/build, and
  watch it. This is the "paste link and walk away" flow from the talk.
- **Trigger build / build with parameters:**
  - Disabled by default and enabled per job in Settings.
  - **Protected jobs:** any job whose name or path matches the configurable patterns (default
    `prod|production|uat|release`) can **never** be triggered from DevDock. The button is
    hidden and the IPC handler rejects the call too.
  - Non-protected triggers need a confirmation dialog listing the job, branch, and parameters.
- **Deploy watcher:** follow a deploy job (e.g. `deploy-dev`) for my branch and notify when it
  finishes. Read-only by default.

### 6.5 Tickets (Jira)
- **Adapters:** Jira Cloud (email + API token, REST v3) and Jira Data Center (personal access
  token as Bearer, REST v2), normalised into one model.
- **Lists** (configurable JQL, saved queries):
  - My open issues. Default:
    `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`.
  - Current sprint (if the board id is configured).
- **Issue card:**
  - key, type, priority, status, summary, sprint, and fix version
  - links to the issue and to linked Figma/Confluence URLs found in the description
- **Start work** flow:
  1. Choose a repo.
  2. DevDock creates the branch from a fresh base (6.2), named from the template.
  3. It writes a **ticket brief** to `<repo>/docs/ai/specs/<KEY>/TICKET.md`:
     - summary, description converted to Markdown, acceptance criteria, linked URLs, and
       comments (last 10)
     - Personal data present in the ticket is kept only as the ticket holds it; there is a
       Settings toggle to write the brief to DevDock's own data folder instead of the repo.
     - The repo's `.gitignore` is checked first and the user is warned if `docs/ai/specs` would
       be committed.
  4. It classifies the issue: Bug → bug-fixer; Story/Task with unclear acceptance criteria →
     spec-writer; otherwise → feature-builder.
  5. It copies the ready message for that agent to the clipboard, e.g.
     `Use the spec-writer agent. Ticket brief: docs/ai/specs/NM-1234/TICKET.md. Figma: <link>.`
  6. Optional, off by default: transition the issue to "In Progress" if that transition exists.
- **Open in VS Code** on the branch afterwards.
- **Start <agent> now** (Phase 7, 6.9): when an agent CLI is installed, the finished dialog offers
  to start it in DevDock's terminal, in the repo, with the message from step 5.

### 6.6 Utilities
- **Ports:** list listening TCP ports with PID, process name, and command.
  - macOS: `lsof -nP -iTCP -sTCP:LISTEN`.
  - Windows: `netstat -ano -p tcp` plus `tasklist /FO CSV`.
  - Stop a process (with confirmation): `kill`, or `taskkill /PID <pid> /T` (add `/F` only
    after a second confirmation).
  - Quick filters for 3000–3010, 5173–5180, 8080.
- **Env profiles:** per repo, save named copies of `.env.local` (e.g. dev-api, mock-api) in
  DevDock's data folder, encrypted with safeStorage. Switch them, keeping a backup of the
  current file. Values are masked in the UI with a reveal-per-value option.
- **Clean caches:** remove `node_modules/.vite`, `dist`, `coverage` for a repo, with a
  confirmation that lists the paths and sizes. `node_modules` itself only with a second
  confirmation.
- **Quick links:** a user-defined launcher (name, URL, group) for AWS console pages,
  CloudWatch dashboards, Jenkins, Bitbucket, Jira boards, Figma files, and Confluence.
  Searchable from the palette.
- **Standup draft:**
  - **Yesterday** = the previous working day (Friday when today is Monday).
  - Collect my commits across registered repos
    (`git log --author=<configured email> --since --until --no-merges`), my PRs opened, merged
    or commented, and Jira issues I transitioned or commented on when the API permits.
  - Output an editable Yesterday / Today / Blockers draft. Today is prefilled from in-progress
    tickets. Copy as plain text or Markdown.

### 6.7 Settings
- **Services:** base URL, auth type, and credentials for Bitbucket, Jenkins and Jira (Phase 7:
  GitHub and GitLab, each with a "Use" switch and Detect). Each has
  "Test connection" (shows the HTTP status, the user it authenticated as, and a hint for common
  failures: 401, 403, proxy, certificate).
- **Repos:** list, base branch, name templates, protected branch patterns, dev command.
- **Feature switches:** PR actions (off), CI actions (off; Phase 7), job triggers (off; per-job allow list), Jira
  transition on Start work (off), and brief location.
- **Appearance:** theme (5 + System), font size, density.
- **Terminal** (Phase 7, P7-A): shell (empty = login shell), font size (follows the app by default), cursor style and blink, scrollback, Use DevDock prompt (off).
- **Accessibility** (Phase 7, P7.13; all off by default): reduce motion (follow the system / always), larger click targets (44 × 44px), underline links, always show the focus ring, read out background events to screen readers.
- **Notifications:** per type, quiet hours, sound on/off.
- **Polling intervals**, global shortcut, launch at login, and demo mode.
- **Import/export settings JSON.** Secrets are never included in the export.
- **Danger zone:** clear credentials, clear all data.

### 6.8 Terminal (Phase 7, P7-A)
- A Terminal view with tabs, each a real pseudo-terminal (`node-pty`, in main only) running the
  user's login shell with their own startup files (oh-my-zsh as is); PowerShell on Windows.
- Opens in the home folder or a registered repo (repo card, menu-bar panel, palette
  `terminal <repo>`); the renderer never sends a path.
- xterm.js: fit, find, copy/paste, links (through the link allowlist), Unicode widths; ANSI
  colours from the theme's tokens (readable on every theme); text slightly bold like a native
  terminal.
- Optional DevDock prompt (zsh/bash, robbyrussell-style with the git branch); DevDock never
  edits the user's dotfiles.
- Shells (and what they started) stop when their tab closes, their window closes or reloads, or
  DevDock quits.

### 6.9 Agent CLIs (Phase 7, P7-C)
- DevDock finds the coding-agent CLIs the user installed on their shell's PATH: Claude Code
  (`claude`), Codex (`codex`), Gemini CLI (`gemini`), GitHub Copilot CLI (`copilot`).
- Start work offers "Start <agent> now": a terminal tab in the repo runs that CLI with the Start
  work message as its first prompt. Settings → Workflow → Agent picks which one (default: the
  first installed). The palette has "Start <agent> — <repo>" (no first message) for later runs.
- The CLI is the tab's process, started with an argument array — never through a shell, so text
  from a ticket is never run as a command. On Windows, an npm `.cmd` script gets the message only
  when cmd.exe would find nothing to interpret in it; otherwise it starts without it and says
  the message is on the clipboard.
- DevDock holds no keys for these CLIs; each signs in its own way.

### 6.10 AI with your own key (Phase 7, P7-C-B)
- Optional: Settings → AI takes the user's own Anthropic API key (OS keychain, like other
  tokens) and a model (Claude Opus 5.5 default; Sonnet 5.5, Haiku 5.5). DevDock ships no key;
  without one the AI buttons are hidden (demo mode answers with local samples).
- Features: a status note for a pull request (from the PR facts DevDock shows), a reviewer's
  comment worded as a lesson (Utilities → Lessons, "Use as the lesson" fills it in), and a
  polished standup (from the user's edited draft).
- Every request is prepared in main and shown first — the exact text and instructions, the
  model, an estimated and a maximum cost — and sent only when the user presses Send; a prepared
  request is sent once and expires after ten minutes. The renderer can't change what is sent.
- Refusals, a cut-off answer, a rejected key, rate limits and network failures each say so in
  plain words; the answer shows the tokens used and the cost.

## 7. Quality bar
- Every action is reachable from the keyboard and from the command palette.
- No remote-changing action happens without confirmation:
  - push, sync-fork push, PR actions, job trigger, Jira transition
  - killing a process
  - deleting files
- Errors are human-readable with a "Details" disclosure. No raw stack traces as the main message.
- The app idles under ~1% CPU and keeps memory reasonable with 5 repos and 10 watched items.
  Report the measured numbers.
- Works fully in demo mode with no network.
- `npm run lint`, `npm test`, `npm run e2e`, and `npm run dist` all pass. CI matrix: macOS and
  Windows runners, if the repo is on a platform with CI.

## 8. Repository layout (target)
```
src/
  main/
    index.ts               app lifecycle, windows, tray, global shortcut
    ipc/                   channel registry + zod schemas (one file per module)
    services/
      git/                 execFile wrapper, status, actions (pure parsing tested on fixtures)
      bitbucket/           cloud.ts, datacenter.ts, model.ts, detect.ts
      jenkins/             client.ts, wfapi.ts, watcher.ts
      jira/                cloud.ts, datacenter.ts, model.ts, brief.ts
      process/             dev-server manager, port scanner (mac/win), kill
      secrets.ts           safeStorage-backed store
      scheduler.ts         polling with backoff, focus-aware
      notifications.ts
    demo/                  MSW handlers + fixture data for all adapters
  preload/index.ts         typed window.devdock API
  renderer/
    ui/                    design system + themes
    features/              today, repos, prs, builds, tickets, utilities, settings, palette
tests/ unit/ e2e/ fixtures/ (temp git repos created per test)
docs/ SPEC.md UI-THEMES.md DECISIONS.md
```
