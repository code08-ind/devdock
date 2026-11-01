# DevDock: build prompts, phase by phase

**How to use these:**
1. Create an empty repo `devdock`. Copy `PRODUCT-SPEC.md` to `docs/SPEC.md` and `UI-THEMES.md`
   to `docs/UI-THEMES.md`.
2. Optionally add the Copilot workflow kit (`C-copilot-workflow-kit/.github`) to this repo.
3. Run **one phase per fresh chat** in agent mode. Paste the shared preamble, then the phase.
4. After each phase:
   - review the diff
   - run the Check commands yourself
   - try the app on your Mac
   - commit
5. Build everything first in **demo mode**. Connect real Bitbucket/Jenkins/Jira only after
   you've confirmed company policy allows personal access tokens for a local tool.

---

## Shared preamble (paste at the top of every phase)

```
You are building DevDock, a cross-platform (macOS + Windows) Electron tray app for a frontend
developer. Read docs/SPEC.md and docs/UI-THEMES.md fully before doing anything. They are the contract.
Stack: Electron (current stable) + electron-vite + React 18 + TypeScript + CSS Modules with the
theme tokens; TanStack Query in the renderer; zod for every IPC payload, settings object and API
response; Vitest + MSW for unit/integration; Playwright `_electron` for e2e; electron-builder;
ESLint (typescript-eslint, react-hooks, jsx-a11y) + Prettier; npm.

Working rules:
- First, give me your plan for this phase: files, IPC channels, and how each Done criterion will
  be proven. Wait for my OK if it deviates from the spec.
- Follow the security baseline in SPEC section 5 at all times: contextIsolation, sandbox, no
  nodeIntegration, strict CSP, typed preload API, zod validation in main, tokens never in the
  renderer, execFile with argument arrays (never shell strings built from input).
- Every remote-changing or destructive action needs a confirmation dialog that states exactly
  what will happen. Its IPC handler must also enforce the rule server-side; don't rely on UI
  hiding alone.
- Every adapter gets a demo-mode implementation backed by MSW fixtures, so the feature works
  with no credentials and no network.
- Write pure parsing and logic in main/services with unit tests. Keep React components thin.
- Handle Windows and macOS differences explicitly: paths, process killing, shells, line endings,
  and `.cmd` shims. Add tests for both code paths. Use platform mocks where you can't run both.
- After building, run lint, unit tests, e2e and build, paste the real output, then list each Done
  criterion with its evidence. Never claim a check you didn't run.
- No new dependencies beyond the spec without asking. Record each in docs/DECISIONS.md.
```

---

## Phase 0: Scaffold, security baseline, shell, settings, secrets, demo mode

**Task:**
- electron-vite project with main, preload and renderer.
- Security baseline (SPEC §5) with a unit/e2e test proving:
  - `window.require` / `process` are undefined in the renderer
  - CSP blocks an inline remote script
  - navigation to an external URL is blocked
  - `openExternal` rejects `file:` and non-allow-listed hosts
- Typed IPC registry: one place declaring each channel, with its zod request/response schema
  and handler. Invalid payloads are rejected with a typed error.
- Design system + themes from UI-THEMES.md (5 + System), font size, density, and command palette
  component. Include the contrast unit test.
- Main window shell:
  - nav rail (Today, Repos, Pull Requests, Builds, Tickets, Utilities, Settings)
  - empty states for each
- Tray/menu-bar icon (template image on macOS, ICO on Windows) with Open, Pause notifications,
  and Quit. Closing the window hides it to the tray (configurable).
- Global shortcut with conflict detection, opening a palette window.
- Settings store (zod schema + migrations, `userData/settings.json`) and secrets store
  (`safeStorage`, encrypted file). Show a clear message if `safeStorage` encryption is
  unavailable, and refuse to store secrets in plain text.
- Notification service with history and per-type toggles.
- Rotating logger with redaction (unit-tested), plus "Open logs folder".
- Demo-mode switch that swaps all adapters to MSW fakes (no adapters exist yet, so set up the
  mechanism).
- Packaging config: macOS dmg (arm64 + x64), Windows NSIS per-user + portable.

**Done:**
- `npm run dev` runs on macOS. `npm run dist` produces the dmg here. The Windows targets are
  configured; build them on a Windows machine or CI and report the result honestly.
- Theme, font and density persist and apply live.
- Security tests pass. A secret saved through Settings is not readable as plain text in
  `userData`; a test checks the file bytes.
- e2e (Playwright `_electron`) launches the app, opens each nav item, switches theme, and opens
  the palette with the shortcut (or via an IPC test hook if global shortcuts are unavailable in
  CI; state which).

**Check:** lint, unit, e2e and dist output, plus screenshots of Today in Light and Dark.

---

## Phase 1: Repos and git actions

**Context:** SPEC 6.2.

**Task:**
- Git service:
  - `execFile('git', args, { cwd, timeout })` wrapper with output capture
  - typed errors (not a repo, git missing, dirty tree, conflict, non-fast-forward, auth
    failure)
  - parsing of `status --porcelain=v2 --branch`, `rev-list --left-right --count`, and
    `stash list`
- Repo registry: add with folder picker and validate, detect remotes and base branch, edit
  settings.
- Status polling: on focus, every 2 min, and on a `.git/HEAD` watcher. Show it in Repos and Today.
- Actions, each with a "commands that will run" disclosure, a streamed activity log and a result
  toast:
  - Fetch all
  - Sync base (fast-forward without checkout when safe)
  - Update my branch (merge/rebase per setting, Stash & continue, conflict view with Open in
    VS Code / Abort)
  - Sync fork (upstream only; push needs confirmation; never force)
  - New branch from template
  - Push branch (protected patterns blocked in the handler)
  - Open in VS Code / terminal / file manager
- Dev server manager:
  - spawn the configured command
  - detect the URL/port from output (Vite "Local:" line and generic `http://localhost:\d+`)
  - live log panel and Stop button
  - kill the process tree on stop and on app quit: `taskkill /T` on Windows, process group on
    macOS
- Baseline integration if `scripts/baseline.mjs` exists.

**Done:**
- Integration tests create temporary git repos (origin + clone + optional upstream) and prove
  each action, including:
  - non-fast-forward refusal
  - a dirty-tree refusal and Stash & continue round trip
  - a merge conflict detected and aborted cleanly
  - rebase conflict abort
  - a protected-branch push rejected by the handler
  - sync-fork end to end
- Branch-name slug unit tests: unicode, punctuation, max length, collisions.
- Dev server: e2e starts a tiny fixture dev script, detects its port, stops it, and asserts the
  port is free afterwards.
- No action ever runs `git push --force` or `git reset --hard` on the user's working copy. A test
  greps the command log.

**Check:** lint, unit, integration and e2e output, plus a recording or screenshots of Update my
branch → conflict → Abort.

---

## Phase 2: Jira

**Context:** SPEC 6.5.

**Task:**
- Cloud adapter (REST v3, email + API token; convert ADF descriptions to Markdown for the
  common node types: paragraph, heading, lists, code, link, mention, table) and Data Center
  adapter (REST v2, PAT Bearer; description is wiki markup, so do a basic conversion). Both
  normalise to one model.
- "Test connection" that reports which user it authenticated as.
- Lists: My open issues (configurable JQL) and Sprint (optional board id). Saved queries.
- Issue detail drawer with links (extract Figma/Confluence URLs).
- **Start work** flow exactly as in SPEC 6.5: branch, TICKET.md brief (with the `.gitignore`
  warning and the location toggle), agent classification, clipboard message, optional
  transition, open in VS Code.
- Demo-mode fixtures: 8 realistic but obviously fake issues (bugs, stories, a task with no
  acceptance criteria).

**Done:**
- Adapter unit tests against recorded-style fixtures for both Cloud and DC, including 401, 403,
  rate-limit 429 with `Retry-After`, and proxy/certificate failure messages.
- ADF→Markdown tests for each supported node type.
- Start work e2e in demo mode: creates the branch in a temp repo, writes TICKET.md with the
  expected sections, and the clipboard contains the right agent message for a Bug and for a
  vague Story.
- Transition is never called unless the setting is on (test).

**Check:** lint, unit and e2e output, plus a generated TICKET.md from demo data.

---

## Phase 3: Bitbucket pull requests

**Context:** SPEC 6.3.

**Task:**
- Cloud (2.0) and Data Center (1.0) adapters, normalised into one PR model, and the base-URL
  "Detect" probe.
- PR link parser for both URL shapes (with tests for edge cases: trailing paths like
  `/overview` and `/diff`, query strings, project vs user repos on DC).
- Lists:
  - My PRs
  - Reviewing (read-only)
  - Recently merged
- PR card fields per spec, with build status from Bitbucket's build-status API.
- Watch list:
  - add via the palette `watch <link>` or a paste field
  - state-change detection (build state, approvals, needs work, new comments, merged/declined)
  - notifications
- Scheduler:
  - focus-aware polling (60s foreground, 3 min background)
  - exponential backoff with jitter on errors
  - honours `Retry-After`
- PR actions behind the Settings switch (off by default), with the confirmation rules in SPEC
  (typing the target branch to merge). The handler re-checks the switch.

**Done:**
- Adapter tests for both flavours, including pagination.
- Watcher tests: a sequence of fixture snapshots produces exactly the expected notifications
  (no duplicates on restart, because watcher state is persisted).
- With PR actions off, the IPC handler rejects approve/merge even when called directly (test).
- Demo mode shows a realistic Today view.

**Check:** lint, unit and e2e output, plus a screenshot of Today with PRs in mixed states.

---

## Phase 4: Jenkins builds and watchers

**Context:** SPEC 6.4.

**Task:**
- Jenkins client:
  - Basic auth with API token
  - crumb handling
  - job tree discovery for configured multibranch jobs
  - last build per branch
  - `wfapi/describe` for stages when available, with graceful fallback
- Console tail with progressive text (`start` offset), auto-scroll, search, and copy.
- Watch build or job until finished, with notifications. **Watch PR pipeline**: PR link →
  branch → job/build resolution, with a clear message when no matching job is found.
- Triggers:
  - off by default
  - per-job allow-list
  - protected-pattern jobs can never be triggered, enforced in the handler, and the UI hides
    the button
  - confirmation lists the job, branch and parameters
- Deploy watcher (read-only follow of a configured deploy job for my branch).
- Tray status dot reflects watched builds.

**Done:**
- Tests:
  - stage parsing
  - progressive console offset logic
  - PR→job resolution
  - protected-pattern enforcement (including case-insensitivity and folder paths like
    `apps/deploy-prod`)
  - crumb retry on 403
- Demo-mode e2e: watching a running build ends in a "passed" notification and the tray dot
  turns green. A failing fixture turns it red.

**Check:** lint, unit and e2e output.

---

## Phase 5: Utilities and standup

**Context:** SPEC 6.6.

**Task:**
- Port scanner:
  - parsers for `lsof` (macOS) and `netstat -ano` + `tasklist /FO CSV` (Windows), unit-tested
    with captured sample outputs including IPv6 and multiple PIDs
  - stop a process with escalation confirmation
- Env profiles:
  - encrypted store
  - switch with backup
  - masked values with per-value reveal
  - diff between profiles, showing key names only by default
- Clean caches with a size preview and confirmation.
- Quick links launcher: groups, search, palette entries, import/export.
- Standup draft:
  - previous-working-day logic (Monday → Friday), unit-tested including holidays as a
    configurable list
  - git log across repos by configured author email
  - PR and Jira activity where the APIs allow
  - editable output, copy as text or Markdown

**Done:**
- Parser tests for both OSes.
- Killing a fixture process by port works on macOS in e2e. The Windows path is covered by unit
  tests with mocked `execFile`, and the README notes how to verify it on Windows.
- Env switch round trip restores the original file byte-for-byte.
- Standup from demo data produces the expected draft.

**Check:** lint, unit and e2e output.

---

## Phase 6: Command palette completeness, polish, packaging, docs

**Task:**
- Palette:
  - every action registered with a title, keywords, an optional argument parser
    (`watch <url>`, `branch <KEY>`, `kill <port>`, `open <link name>`) and an enabled-state
    reason
  - recent actions first
- Polish:
  - empty, loading and error states everywhere
  - an "error with Details" pattern
  - font sizes 12 and 18 in every theme
  - keyboard-only pass through every screen
- Diagnostics screen:
  - versions (app, Electron, git, node if present)
  - proxy in use
  - "Test all connections"
  - "Export diagnostics", redacted
- Performance check with 5 repos and 10 watched items in demo mode: report idle CPU and memory.
- Packaging:
  - dmg (arm64 + x64), Windows NSIS per-user + portable
  - app icons
  - version + CHANGELOG
  - a README section on unsigned-app warnings (Gatekeeper/SmartScreen) and why company IT may
    need to approve it
- README: features with demo-mode screenshots, setup per service (which token type, minimal
  scopes or permissions), security model in plain words, and keyboard shortcuts.

**Done:** Full suite green. Packages built (state which ones were verified on which OS).
README verified step by step in demo mode. A qa-tester agent run in demo mode reports no Fail
items.

**Check:** full command output, artifact list, QA report.

---

## Phase 7 and the wrap-up (T1–T20)

Phase 7 (terminal, GitHub and GitLab, agent CLIs, AI with your own key, the website,
accessibility) was planned with the owner rather than from a prompt here: its tasks and Done
criteria are in `docs/PROGRESS.md` (Phase 7 steps P7.01–P7.13, then the "Pending tasks — master
list" T1–T20), and every decision, with the owner's answers, in `docs/DECISIONS.md` (sections
"Phase 7" to "T11"). SPEC 6.3a and 6.8–6.10 hold the resulting behaviour.

## Notes before you start
- **Credentials and policy.** Creating personal access tokens for Bitbucket, Jenkins or Jira on
  a client system, and running an unsigned app on the office laptop, may need approval. Ask
  first. Until then, use DevDock on your Mac in demo mode and against your own GitHub/Jira
  sandbox if you have one.
- **Role-appropriate defaults.** PR approve/merge and job triggers ship disabled. That matches
  an SDE 1 role and makes the tool safe to show to your team.
- **Showcase safely.** Blog screenshots and demos should always use demo mode, never the client
  app or real ticket data.
