# Changelog

All notable changes to DevDock. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **AI with your own key: OpenAI and Google Gemini** (T6) besides Anthropic. Settings → AI picks
  the provider, its key (each in the OS keychain) and model — GPT-6.1 Sol / Astra / Luna,
  Gemini 3.8 Flash / 4 Argon / 3.1 Flash-Lite — with the same preview before anything is sent and
  the cost at the day's price. Demo mode answers for every provider.

## [0.1.0] — not released yet (the date is set when it is tagged, T18)

The first release: everything in [`docs/SPEC.md`](docs/SPEC.md), plus the owner's additions
recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). Phase 7 (terminal, GitHub and GitLab, agent
CLIs, AI with your own key, accessibility) joined it before the first tag, so it is all listed
here.

### Added

- **Terminal** (Phase 7, P7-A): a real terminal in DevDock — your login shell in tabs (zsh, bash,
  fish; PowerShell on Windows) with your own setup (oh-my-zsh as is), ANSI colours per theme,
  slightly bold text like a native terminal, find, copy/paste, links through the allowlist.
  Opens in a repo from its card, the menu-bar panel or the palette (`terminal <repo>`).
  Settings → Terminal: shell, font size (follows the app by default), cursor, scrollback, and an
  optional robbyrussell-style DevDock prompt for zsh and bash (your dotfiles are never edited).
  Shells stop when their tab closes or DevDock quits. Adds `node-pty` (the one native module).
- **Agent CLIs** (P7-C): Start work offers "Start Claude Code now" (or Codex, Gemini CLI, GitHub
  Copilot CLI — whichever you installed): the agent opens in a DevDock terminal tab in the repo
  with the Start work message as its first prompt. Settings → Workflow → Agent picks one.
- **AI with your own key** (P7-C-B, optional): Settings → AI takes your Anthropic API key (kept in
  the OS keychain) and a model (Claude Opus 5.5 by default, or Sonnet 5.5 / Haiku 5.5). Then
  DevDock can draft a PR status note, word a review comment as a lesson and polish the standup.
  Every request is shown first (text, model, estimated cost) and sent only on **Send**.
- **Accessibility** (P7-E): Settings → Accessibility and axe checks of every view.
- **GitHub and GitLab** (off until turned on in Settings): pull requests / merge requests join
  the PR lists, Watch field, notifications, Today, the menu-bar panel and the palette, with a
  provider filter; github.com and GitHub Enterprise Server, gitlab.com and self-managed.
- **GitHub Actions and GitLab pipelines** in Builds: my recent runs, jobs and steps, the end of
  each job's log, watch a run (or paste its link anywhere, `watch <run link>` in the palette),
  one notification when it finishes and the tray dot follows it.
- **Settings → Actions**: PR actions (now for every provider) and **CI actions** (off by default): re-run / retry failed jobs and cancel, each
  confirmed. Settings → Detect reads your repos' remotes; Bitbucket can be turned off.
- **More in the palette**: trigger a Jenkins build (opens the parameters dialog), watch a branch's
  deploy, start / stop the baseline server. From the global-shortcut palette window, commands
  that need a dialog (trigger build, stop a server, PR actions, the AI actions) open it in the
  main window.
- **Palette:** re-run / retry / cancel GitHub Actions runs and GitLab pipelines (with CI actions
  on), through the same confirmation as in Builds.
- **Terminal:** closing a tab that is running something (a dev server, an agent) asks first.
- **Workflow follow-ups** (Settings → Workflow, each off by default): run the repo's check command
  (e.g. `npm test`, set in the repo's settings) before Push branch — nothing is pushed if it
  fails; watch the branch's Jenkins build after a push; start the dev server after a branch
  switch (in DevDock, a terminal or an editor) when it isn't running; when a PR of yours opens
  for a Jira key, offer (on Today, a notification and the palette) to move the ticket to a status
  you choose, "In Review" by default — always confirmed first.

- **Shell:** menu-bar / tray icon with a status dot (green, red, grey); a **menu-bar panel** on
  click with one-click actions (Today, Repos, Tickets, Tools, search); a **Home** launcher; native
  notifications with history, per-type switches and quiet hours; launch at login; five themes,
  font size and density.
- **Command palette** in the app (`⌘K` / `Ctrl+K`) and from any app (global shortcut): every
  action, recent ones first, with arguments — `watch`, `pipeline`, `branch`, `kill`, `open` — and
  a reason when one can't run.
- **Repos:** local git repos with status; fetch, sync base, update my branch (merge/rebase,
  stash), new branch, push, sync fork — commands shown first, protected branches refused, safe
  abort on conflicts; dev server and baseline server with logs.
- **Jira:** Cloud and Data Center; my issues, current sprint, saved queries, issue detail;
  **Start work** — branch, ticket brief, agent message, optional transition.
- **Bitbucket:** Cloud and Data Center; my PRs, reviewing, recently merged, watched PRs with
  notifications; approve / needs work / merge behind a setting and a confirmation.
- **Jenkins:** builds of my branches and PR pipelines, stages, live console, watch builds, jobs
  and deploys; triggers for allowed, unprotected jobs only.
- **Utilities:** ports (stop with confirmation, force only after a second one), clean caches,
  encrypted env profiles, quick links, standup draft.
- **Agent lessons:** review comments on my PRs turned into a reviewed `docs/ai/LESSONS.md`;
  Start work points the agent there and asks it to add what it learns (no AI calls by DevDock).
- **Workflow options** in Settings and Start work.
- **Diagnostics:** versions, proxy in use, manual proxy override, Test all connections, a
  redacted report.
- **Demo mode** (on by default): Jira, Bitbucket and Jenkins on built-in data, no network (git
  and the Ports tool still act for real, after asking).
- **Packages:** macOS DMG (Apple silicon and Intel), Windows NSIS installer (per user, no
  admin) and portable exe — unsigned for now, see the README. Small: all code bundled (no
  `node_modules` in the app; licenses in `THIRD_PARTY_NOTICES.txt`), English-only Electron
  strings, maximum compression. DMG 121.5 → 103.5 MB (arm64) and 125.6 → 106.2 MB (x64);
  `app.asar` 50 MB → 1.9 MB.

### Security

- Tokens encrypted by the OS (Keychain / DPAPI), read only by the main process; sandboxed
  renderers with a strict content security policy; links open only on allowed hosts; logs and
  the diagnostics report redacted.

[0.1.0]: https://github.com/code08-ind/devdock/releases/tag/v0.1.0
