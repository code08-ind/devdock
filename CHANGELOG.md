# Changelog

All notable changes to DevDock. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **GitHub and GitLab** (off until turned on in Settings): pull requests / merge requests join
  the PR lists, Watch field, notifications, Today, the menu-bar panel and the palette, with a
  provider filter; github.com and GitHub Enterprise Server, gitlab.com and self-managed.
- **GitHub Actions and GitLab pipelines** in Builds: my recent runs, jobs and steps, the end of
  each job's log, watch a run (or paste its link anywhere, `watch <run link>` in the palette),
  one notification when it finishes and the tray dot follows it.
- **Settings → Actions**: PR actions (now for every provider) and **CI actions** (off by default): re-run / retry failed jobs and cancel, each
  confirmed. Settings → Detect reads your repos' remotes; Bitbucket can be turned off.

## [0.1.0] — 2026-10-25

The first release: everything in [`docs/SPEC.md`](docs/SPEC.md), plus the owner's additions
recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

### Added

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
