# DevDock

A tray app for a frontend developer's daily chores: local git repos, Bitbucket pull requests,
Jenkins builds, Jira tickets, and utilities (ports, env profiles, caches, quick links, standup).
Electron + React + TypeScript; works fully offline in demo mode.

The full specification is in [`docs/SPEC.md`](docs/SPEC.md); design decisions in
[`docs/DECISIONS.md`](docs/DECISIONS.md); progress in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Develop

```sh
npm install
npm run dev     # the app, with demo mode on by default
npm run lint    # eslint + prettier + typecheck
npm test        # unit + integration (vitest)
npm run e2e     # Playwright against the built app
npm run dist    # installers (dmg on macOS, nsis on Windows)
```

## Checking "stop a process by port" on Windows

CI covers the Windows port scanner and stop path with unit tests that mock `execFile`
(`tests/unit/ports.test.ts`); the end-to-end test that kills a real process runs on macOS only.
To check it by hand on Windows:

1. In PowerShell, start something listening, e.g. `npx --yes http-server -p 5174` (or any dev
   server), and note its port.
2. In DevDock open **Utilities → Ports**, pick the **5173–5180** filter (or type the port). The row
   shows the port, `node.exe` and its PID; `netstat -ano -p tcp | findstr :5174` should show the
   same PID.
3. Press **Stop** and confirm: DevDock runs `taskkill /PID <pid> /T`. The port should be free
   afterwards (`netstat` shows nothing for it).
4. If the process ignores the request, DevDock says so and offers **Force stop**; confirming that
   runs `taskkill /PID <pid> /T /F`.
5. From the command palette (`Ctrl+K`), `kill 5174` opens the same stop dialog.

Processes of another user, or that need admin rights, are refused with Windows' own message under
**Details**.
