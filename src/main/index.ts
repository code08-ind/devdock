/**
 * App lifecycle: single instance, services, windows, tray, global shortcut and IPC.
 * Services are plain classes with injected Electron adapters (see ./services).
 */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { OpenTarget } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  net,
  Notification,
  safeStorage,
  session,
  shell,
  webContents,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron'
import type { EventChannel, View } from '@shared/channels'
import type { EventPayload } from '@shared/ipc'
import { enabledProviders, type Settings } from '@shared/settings'
import { demoHandlers } from './demo/handlers'
import { createHandlers } from './handlers'
import { GitActions } from './services/git/actions'
import { GitRunner } from './services/git/exec'
import { remotesByRepo, remoteUrls } from './services/git/repo'
import { editorCommand, editorFallback, launchDetached, terminalCommand } from './services/open'
import { DEMO_BITBUCKET } from './demo/bitbucket'
import { DEMO_JENKINS } from './demo/jenkins'
import { DEMO_JIRA } from './demo/jira'
import { DEMO_GITHUB_CONFIG } from './demo/github'
import { DEMO_GITLAB_CONFIG } from './demo/gitlab'
import { CiWatcher } from './services/ci/watcher'
import { GitHubClient } from './services/github/client'
import { GitLabClient } from './services/gitlab/client'
import { configuredHosts, detectHosts } from './services/providers/detect'
import { PrHub } from './services/providers/hub'
import { HostService } from './services/providers/service'
import { BitbucketService } from './services/bitbucket/service'
import { PrWatcher } from './services/bitbucket/watcher'
import { Scheduler } from './services/scheduler'
import { collectMyWork } from './services/jenkins/mine'
import { JenkinsService } from './services/jenkins/service'
import { BuildWatcher } from './services/jenkins/watcher'
import { JiraService } from './services/jira/service'
import { StartWorkService } from './services/startwork'
import { DevServerManager } from './services/process/devserver'
import { makeCheckRunner } from './services/process/check'
import { PortService, runCommand } from './services/process/ports'
import { EnvProfiles } from './services/envprofiles'
import { LessonsService } from './services/lessons'
import { gitCommits, standupDraft } from './services/standup'
import { demoCommits } from './demo/standup'
import { loginShellPath, mergePath } from './services/process/shell-path'
import { RepoWatcher } from './services/repo-watcher'
import { BranchSwitchFollower } from './services/branch-switch'
import { RepoService } from './services/repos'
import { registerIpc } from './ipc/registry'
import { checkExternalUrl, installSecurity, isAppUrl, linkHosts } from './security'
import { DemoHttpClient, RealHttpClient, SwitchingHttpClient } from './services/http'
import { proxyRules } from '@shared/diagnostics'
import { DiagnosticsService } from './services/diagnostics'
import { initLogger, log } from './services/logger'
import { NotificationService, type NativeNotifier } from './services/notifications'
import { SecretStore } from './services/secrets'
import { SettingsStore } from './services/settings'
import { ShortcutService } from './services/shortcut'
import { TerminalManager, type PtySpawn } from './services/terminal/manager'
import { detectAgents } from './services/agents'
import { AiService } from './services/ai/service'
import { createTray, watchedForTray, type TrayHandle } from './tray'
import {
  createMainWindow,
  createPaletteWindow,
  createPanelWindow,
  DEV_RENDERER_URL,
  showPalette,
  showPanel,
} from './windows'

// Test-only switches. Ignored in packaged builds, so a shipped app can't be put in test mode.
const E2E = !app.isPackaged && process.env.DEVDOCK_E2E === '1'
// e2e runs each test against a throwaway profile. Only honoured in e2e mode.
if (E2E && process.env.DEVDOCK_USER_DATA) app.setPath('userData', process.env.DEVDOCK_USER_DATA)

const userData = app.getPath('userData')
const logsDir = join(userData, 'logs')
initLogger({ dir: logsDir, echo: !app.isPackaged })
process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))

const appOrigin = DEV_RENDERER_URL ? new URL(DEV_RENDERER_URL).origin : 'file://'

let settings: SettingsStore | null = null
let mainWindow: BrowserWindow | null = null
let paletteWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
/** When the panel last hid on blur: a click on the tray icon blurs it first, then toggles. */
let panelHiddenAt = 0
/** A tray click this soon after that blur is the same click: it must not reopen the panel. */
const PANEL_REOPEN_GUARD_MS = 300
/** e2e only: the panel stays up when it loses focus. */
let panelPinned = false
let tray: TrayHandle | null = null
let quitting = false

/**
 * node-pty is the one native module (P7-A): loaded on the first terminal, not at start, so a
 * PTY problem can't stop DevDock from starting and launch stays fast. Kept out of the bundle
 * (see electron.vite.config.ts) and unpacked from the asar (electron-builder.yml).
 */
type NodePty = { spawn: PtySpawn }
let nodePty: NodePty | null = null
const spawnPty: PtySpawn = (file, args, options) => {
  nodePty ??= createRequire(import.meta.url)('node-pty') as NodePty
  return nodePty.spawn(file, args, options)
}

/** Opens a link in the browser only if it passes the allowlist; otherwise logs why not. */
function openExternalSafe(url: string): void {
  const current = settings?.get()
  const hosts = current ? linkHosts(current, current.general.demoMode) : []
  const verdict = checkExternalUrl(url, hosts)
  if (verdict.ok) {
    shell.openExternal(verdict.url).catch((err) => log.warn('could not open link', err))
  } else {
    log.warn(`blocked external link: ${verdict.reason}`)
  }
}

// Registered before any window exists so every webContents is hardened.
installSecurity(app, {
  appOrigin,
  isDev: Boolean(DEV_RENDERER_URL),
  onExternalRequest: openExternalSafe,
  onBlocked: (kind, detail) => log.warn(`blocked ${kind}: ${detail}`),
})

function windows(): BrowserWindow[] {
  return [mainWindow, paletteWindow, panelWindow].filter(
    (w): w is BrowserWindow => !!w && !w.isDestroyed(),
  )
}

function broadcast<E extends EventChannel>(event: E, payload: EventPayload<E>): void {
  for (const w of windows()) w.webContents.send(event, payload)
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showView(view: View): void {
  paletteWindow?.hide()
  panelWindow?.hide()
  showMain()
  mainWindow?.webContents.send('nav:goto', view)
}

function openPalette(): void {
  if (!paletteWindow || paletteWindow.isDestroyed()) return
  showPalette(paletteWindow)
  paletteWindow.webContents.send('palette:shown', null)
}

function togglePalette(): void {
  if (paletteWindow?.isVisible()) paletteWindow.hide()
  else openPalette()
}

/**
 * The panel window, made on the first tray click (P6.05: a hidden renderer costs ~130 MB, and
 * many people never open the panel). Resolves once its page has loaded.
 */
let panelLoaded: Promise<BrowserWindow> | null = null
function ensurePanel(): Promise<BrowserWindow> {
  // A second click while the first is still loading waits for the same load.
  if (panelLoaded && panelWindow && !panelWindow.isDestroyed()) return panelLoaded
  const win = createPanelWindow()
  panelWindow = win
  // Like other menu-bar panels: clicking anywhere else dismisses it.
  win.on('blur', () => {
    if (E2E && panelPinned) return
    panelHiddenAt = Date.now()
    win.hide()
  })
  // Resolved whether the page loads or not (a failed load still shows the window, not a hang).
  panelLoaded = new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve(win))
    win.webContents.once('did-fail-load', () => resolve(win))
  })
  return panelLoaded
}

/** Tray left click: show the panel by the icon, or hide it if it is showing. */
async function togglePanel(icon: Rectangle): Promise<void> {
  if (panelWindow?.isVisible()) {
    panelWindow.hide()
    return
  }
  // The click that blurred (and so hid) the panel must not open it again straight away.
  if (Date.now() - panelHiddenAt < PANEL_REOPEN_GUARD_MS) return
  const win = await ensurePanel()
  showPanel(win, icon)
  win.webContents.send('panel:shown', null)
}

function quit(): void {
  quitting = true
  app.quit()
}

/** Only our own windows, on our own origin, may call IPC. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const ours = windows().some((w) => w.webContents.id === event.sender.id)
  return ours && isAppUrl(event.senderFrame?.url ?? '', appOrigin)
}

/** Electron drops click handlers of garbage-collected notifications, so hold a reference. */
function electronNotifier(): NativeNotifier {
  const live = new Set<Notification>()
  return {
    show(n, { silent, onClick }) {
      if (!Notification.isSupported()) return
      const native = new Notification({ title: n.title, body: n.body, silent })
      live.add(native)
      native.on('click', () => {
        live.delete(native)
        onClick()
      })
      native.on('close', () => live.delete(native))
      native.show()
    },
  }
}

/** SPEC 5: the system proxy (PAC, WPAD, OS settings) unless a manual one is set. */
let appliedProxy = ''
function applyProxy(s: Settings): void {
  const { proxyMode, proxyServer } = s.network
  const manual = proxyMode === 'manual' && proxyServer !== ''
  const key = manual ? proxyRules(proxyServer) : 'system'
  if (key === appliedProxy) return
  appliedProxy = key
  void session.defaultSession
    .setProxy(manual ? { proxyRules: key } : { mode: 'system' })
    .then(() => log.info(`proxy: ${manual ? 'manual' : 'system'}`))
}

let loginItemApplied: boolean | null = null
function applyLoginItem(s: Settings): void {
  // In dev this would register the bare Electron binary, so only packaged builds touch it.
  // Only when it changes (off is the default, so nothing at start): macOS refuses login items
  // for unsigned copies and logs an error on every call.
  if (!app.isPackaged || s.general.launchAtLogin === (loginItemApplied ?? false)) return
  loginItemApplied = s.general.launchAtLogin
  app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin })
}

function start(): void {
  const store = new SettingsStore(join(userData, 'settings.json'))
  settings = store
  if (store.loadWarning) log.warn(store.loadWarning)

  const secrets = new SecretStore(join(userData, 'secrets.bin'), safeStorage)
  let pauseTimer: NodeJS.Timeout | undefined
  const notificationsChanged = (): void => {
    broadcast('notifications:changed', null)
    tray?.refresh()
    // Nothing fires when a pause runs out, so refresh the tray and renderer at that moment.
    clearTimeout(pauseTimer)
    const until = notifications.getPausedUntil()
    if (until !== null) pauseTimer = setTimeout(notificationsChanged, until - Date.now() + 1000)
  }
  const notifications = new NotificationService({
    file: join(userData, 'notifications.json'),
    getPrefs: () => store.get().notifications,
    native: electronNotifier(),
    // SPEC 6.1 "Clicking a notification opens the item": in DevDock when it lives there.
    onClick: (n) => (n.view ? showView(n.view) : n.url ? openExternalSafe(n.url) : showMain()),
    onChange: notificationsChanged,
  })
  const shortcut = new ShortcutService(globalShortcut, togglePalette)
  const http = new SwitchingHttpClient(
    () => store.get().general.demoMode,
    new RealHttpClient((request) => net.fetch(request)),
    // e2e may run the demo builds faster (DEVDOCK_DEMO_SPEED); never in normal runs.
    new DemoHttpClient(
      demoHandlers({ jenkinsSpeed: E2E ? Number(process.env.DEVDOCK_DEMO_SPEED) || 1 : 1 }),
    ),
  )

  const git = new GitRunner()
  const repos = new RepoService(store, git)
  const lessons = new LessonsService({
    repo: (id) => repos.get(id),
    settings: () => store.get(),
    git,
  })
  const watcher = new RepoWatcher(git, (id) => {
    broadcast('repos:changed', { id })
    // T5: start the dev server after a branch switch (Settings → Workflow).
    void branchSwitch.changed(id)
  })
  // Finder-launched macOS apps don't get the shell PATH (npm, node, code). Dev servers wait for it.
  const envReady =
    process.platform === 'darwin' && app.isPackaged
      ? loginShellPath().then((p) => {
          if (p) process.env.PATH = mergePath(p, process.env.PATH)
          else log.warn('could not read the login shell PATH')
        })
      : Promise.resolve()
  const devServers = new DevServerManager({
    envReady,
    onChange: (states) => broadcast('devserver:changed', states),
    onOutput: (e) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('devserver:output', e)
    },
  })
  const branchSwitch = new BranchSwitchFollower({ git, settings: () => store.get(), devServers })
  void watcher.sync(store.get().repos)
  void branchSwitch.sync(store.get().repos)

  /** Sends to one window, if it is still there (terminal output goes only to its owner). */
  const sendTo = <E extends EventChannel>(id: number, event: E, payload: EventPayload<E>) => {
    const wc = webContents.fromId(id)
    if (wc && !wc.isDestroyed()) wc.send(event, payload)
  }
  const terminal = new TerminalManager({
    spawn: spawnPty,
    settings: () => store.get().terminal,
    onOutput: (owner, e) => sendTo(owner, 'terminal:output', e),
    onExit: (owner, e) => sendTo(owner, 'terminal:exit', e),
    promptDir: join(userData, 'terminal'),
    appVersion: app.getVersion(),
    ownerAlive: (id) => {
      const wc = webContents.fromId(id)
      return wc !== undefined && !wc.isDestroyed()
    },
  })
  // A window that closes or reloads takes its terminals with it: no shell is left behind.
  app.on('web-contents-created', (_e, wc) => {
    const id = wc.id
    wc.on('destroyed', () => void terminal.killOwner(id))
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) void terminal.killOwner(id)
    })
  })

  const actions = new GitActions(git, makeCheckRunner({ envReady }))
  const jira = new JiraService({
    http,
    settings: () => store.get(),
    token: () => secrets.get('jira.token'),
    demo: DEMO_JIRA,
  })
  const bitbucket = new BitbucketService({
    http,
    settings: () => store.get(),
    token: () => secrets.get('bitbucket.token'),
    repoRemotes: () => remoteUrls(git, store.get().repos),
    demo: DEMO_BITBUCKET,
  })
  const repoRemotes = () => remoteUrls(git, store.get().repos)
  // P7.05 / P7.06: GitHub and GitLab, each off until turned on in Settings.
  const github = new HostService({
    provider: 'github',
    http,
    settings: () => store.get(),
    token: () => secrets.get('github.token'),
    repoRemotes,
    demo: DEMO_GITHUB_CONFIG,
    makeClient: (h, config, projects) => new GitHubClient(h, config, projects),
  })
  const gitlab = new HostService({
    provider: 'gitlab',
    http,
    settings: () => store.get(),
    token: () => secrets.get('gitlab.token'),
    repoRemotes,
    demo: DEMO_GITLAB_CONFIG,
    makeClient: (h, config, projects) => new GitLabClient(h, config, projects),
  })
  const hosts = { github, gitlab }
  // P7.04: the watchers, Today and lists reach every provider through the hub.
  const prs = new PrHub({ bitbucket, github, gitlab })
  const myPrs = () => prs.listAll(enabledProviders(store.get()), 'mine')
  const prWatcher = new PrWatcher({
    file: join(userData, 'watches.json'),
    bitbucket: prs,
    notify: (n) => notifications.notify(n),
    onChange: () => {
      broadcast('watch:changed', prWatcher.list())
      tray?.refresh()
    },
  })
  const jenkins = new JenkinsService({
    http,
    settings: () => store.get(),
    token: () => secrets.get('jenkins.token'),
    myWork: () => collectMyWork(git, store.get().repos, myPrs),
    demo: DEMO_JENKINS,
  })
  const buildWatcher = new BuildWatcher({
    file: join(userData, 'build-watches.json'),
    jenkins,
    bitbucket: prs,
    notify: (n) => notifications.notify(n),
    onChange: () => {
      broadcast('buildwatch:changed', buildWatcher.list())
      tray?.refresh()
    },
  })
  const ciWatcher = new CiWatcher({
    file: join(userData, 'ci-watches.json'),
    ci: {
      runInfo: (ref) => hosts[ref.provider].runInfo(ref),
      site: (provider) => hosts[provider].site(),
    },
    notify: (n) => notifications.notify(n),
    onChange: () => {
      broadcast('ciwatch:changed', ciWatcher.list())
      tray?.refresh()
    },
  })
  // SPEC 6.3: 60 s while a DevDock window has focus, 3 min otherwise (Settings → Polling).
  const intervalsMs = () => {
    const { foregroundSec, backgroundSec } = store.get().polling
    return { foreground: foregroundSec * 1000, background: backgroundSec * 1000 }
  }
  const prPolling = new Scheduler({ name: 'pr watcher', run: () => prWatcher.poll(), intervalsMs })
  const buildPolling = new Scheduler({
    name: 'build watcher',
    run: () => buildWatcher.poll(),
    intervalsMs,
  })
  const ciPolling = new Scheduler({ name: 'ci watcher', run: () => ciWatcher.poll(), intervalsMs })
  const pollers = [prPolling, buildPolling, ciPolling]
  const openRepo = async (repo: RepoConfig, target: OpenTarget): Promise<void> => {
    if (target === 'files') {
      const error = await shell.openPath(repo.path)
      if (error) throw new Error(error)
    } else if (target === 'terminal') {
      await launchDetached(terminalCommand(repo.path, process.platform))
    } else {
      const cmd = editorCommand(store.get().git.editorPath, repo.path, process.platform)
      const fallback = editorFallback(repo.path, process.platform)
      // Finder-launched apps don't get the shell PATH where `code` usually lives.
      await launchDetached(cmd).catch((err) => {
        if (!fallback) throw err
        return launchDetached(fallback)
      })
    }
  }

  registerIpc(
    createHandlers({
      settings: store,
      secrets,
      notifications,
      shortcut,
      http,
      logsDir,
      diagnostics: new DiagnosticsService({
        versions: () => ({
          app: app.getVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          platform: process.platform,
          arch: process.arch,
        }),
        run: runCommand,
        resolveProxy: (url) => session.defaultSession.resolveProxy(url),
        settings: () => store.get(),
        credentials: async () => secrets.keys(),
        logFile: join(logsDir, 'devdock.log'),
        home: homedir(),
        user: userInfo().username,
      }),
      saveText: async (defaultName, text) => {
        const opts = { title: 'Save diagnostics', defaultPath: defaultName }
        const r = mainWindow
          ? await dialog.showSaveDialog(mainWindow, opts)
          : await dialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return null
        await writeFile(r.filePath, text, 'utf8')
        return r.filePath
      },
      versions: () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      }),
      openExternal: (url) => shell.openExternal(url),
      openPath: (path) => shell.openPath(path),
      showView,
      openPalette,
      closePalette: () => paletteWindow?.hide(),
      closePanel: () => panelWindow?.hide(),
      quit,
      repos,
      git,
      actions,
      pickFolder: async () => {
        const opts = { title: 'Add a git repository', properties: ['openDirectory' as const] }
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, opts)
          : await dialog.showOpenDialog(opts)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      openRepo,
      devServers,
      jira,
      bitbucket,
      prs,
      hosts,
      ciWatcher,
      detectProviders: async () => {
        const repoList = store.get().repos
        const remotes = await remotesByRepo(git, repoList)
        return detectHosts(
          repoList.map((repo, i) => ({ name: repo.name, remotes: remotes[i] ?? [] })),
          configuredHosts(store.get()),
        )
      },
      prWatcher,
      jenkins,
      buildWatcher,
      envProfiles: new EnvProfiles({ dir: join(userData, 'env-profiles'), cipher: safeStorage }),
      lessons,
      standupDraft: () =>
        standupDraft(
          {
            holidays: () => store.get().standup.holidays,
            commits: (from, to) =>
              http.demo
                ? Promise.resolve(demoCommits(from))
                : gitCommits(git, store.get().repos, store.get().standup.authorEmail, from, to),
            prs: (list) => prs.listAll(enabledProviders(store.get()), list),
            jira,
          },
          new Date(),
        ),
      ports: new PortService({
        platform: process.platform,
        run: runCommand,
        signal: (pid, sig) => process.kill(pid, sig),
        ownPids: () => [process.pid, process.ppid],
      }),
      startWork: new StartWorkService({
        jira,
        actions,
        git,
        repo: (id) => repos.get(id),
        settings: () => store.get(),
        lessonsExist: (id) => lessons.exists(id),
        briefsDir: join(userData, 'briefs'),
        writeClipboard: (text) => clipboard.writeText(text),
        openEditor: (repo) => openRepo(repo, 'editor'),
      }),
      requestUtility: (request) => {
        showView('utilities')
        mainWindow?.webContents.send('utilities:requested', request)
      },
      requestTicket: (key) => {
        showView('tickets')
        mainWindow?.webContents.send('tickets:requested', { key })
      },
      requestCommand: (id) => {
        paletteWindow?.hide()
        panelWindow?.hide()
        showMain()
        mainWindow?.webContents.send('commands:requested', { id })
      },
      requestWatch: (link, pipeline) => {
        showView(pipeline ? 'builds' : 'prs')
        mainWindow?.webContents.send('watch:requested', { link, pipeline })
      },
      requestRepoAction: (event) => {
        showView('repos')
        mainWindow?.webContents.send('repos:actionRequested', event)
      },
      terminal,
      home: homedir(),
      requestTerminal: (request) => {
        // No separate `nav:goto`: the window switches view and opens the tab in one step, so its
        // first visit doesn't open a Home tab as well (that raced on CI).
        paletteWindow?.hide()
        panelWindow?.hide()
        showMain()
        mainWindow?.webContents.send('terminal:requested', request)
      },
      // After the login shell's PATH is merged in (where these CLIs usually live).
      agents: () =>
        envReady.then(() => detectAgents({ platform: process.platform, env: process.env })),
      platform: process.platform,
      ai: new AiService({
        http,
        key: () => secrets.get('anthropic.key'),
        model: () => store.get().ai.model,
      }),
      emitOutput: (event) => {
        // The window may close while git is still running.
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('repos:output', event)
      },
    }),
    isTrustedSender,
  )

  const registered = shortcut.set(store.get().general.paletteShortcut)
  if (!registered.ok) log.warn(`palette shortcut not registered: ${registered.reason}`)
  applyLoginItem(store.get())
  applyProxy(store.get())

  // One per poller, in `pollers` order: the settings each one reads from.
  const signatures = (s: Settings) => [
    JSON.stringify([s.bitbucket, s.github, s.gitlab, s.general.demoMode]),
    JSON.stringify([s.jenkins, s.bitbucket, s.github, s.gitlab, s.general.demoMode]),
    JSON.stringify([s.github, s.gitlab, s.general.demoMode]),
  ]
  let lastSignatures = signatures(store.get())
  store.onChange((s) => {
    broadcast('settings:changed', s)
    // New intervals apply now; a new site or demo toggle is worth a check straight away.
    const next = signatures(s)
    pollers.forEach((poller, i) => {
      if (next[i] !== lastSignatures[i]) void poller.runNow()
      else poller.reschedule()
    })
    lastSignatures = next
    void watcher.sync(s.repos)
    void branchSwitch.sync(s.repos)
    applyLoginItem(s)
    applyProxy(s)
    // settings:update/import/reset can name a shortcut that is taken or reserved. Keep the
    // working one and write it back, so the settings file never disagrees with the OS.
    if (s.general.paletteShortcut === shortcut.active()) return
    const result = shortcut.set(s.general.paletteShortcut)
    if (result.ok) return
    log.warn(`palette shortcut ${result.accelerator} rejected: ${result.reason}`)
    const active = shortcut.active()
    if (active) store.update({ general: { paletteShortcut: active } })
  })

  mainWindow = createMainWindow({ e2e: E2E })
  mainWindow.on('close', (event) => {
    if (quitting) return
    if (store.get().general.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    } else {
      quit()
    }
  })
  // The palette window is made now: the global shortcut must open it instantly.
  paletteWindow = createPaletteWindow()

  // Focus moves between our windows as blur-then-focus; read the result after both.
  const focusChanged = (): void => {
    setImmediate(() => {
      const focused = BrowserWindow.getFocusedWindow() !== null
      pollers.forEach((p) => p.setFocused(focused))
    })
  }
  app.on('browser-window-focus', focusChanged)
  app.on('browser-window-blur', focusChanged)
  for (const poller of pollers) {
    poller.setFocused(mainWindow.isFocused())
    poller.start()
  }

  const trayDir = app.isPackaged
    ? join(process.resourcesPath, 'tray')
    : join(app.getAppPath(), 'build', 'tray')
  const trayState = () => ({
    pausedUntil: notifications.getPausedUntil(),
    watched: watchedForTray(buildWatcher.list(), prWatcher.list(), ciWatcher.list()),
  })
  tray = createTray(trayDir, trayState, {
    open: showMain,
    togglePanel: (icon) => void togglePanel(icon),
    showBuilds: () => showView('builds'),
    pause: (minutes) => notifications.pause(minutes),
    resume: () => notifications.resume(),
    quit,
  })

  if (E2E) {
    // Test hook for Playwright's electronApp.evaluate(); never present in normal runs.
    Object.assign(globalThis, {
      __devdockTest: {
        userData,
        togglePalette,
        showView,
        isPaletteVisible: () => paletteWindow?.isVisible() ?? false,
        /** Opens the panel as a tray click would (no real tray click from Playwright). */
        togglePanel: (pin = true) => {
          // Test windows lose focus to each other; keep the panel up while a test drives it.
          panelPinned = pin
          return togglePanel({ x: 0, y: 0, width: 0, height: 0 })
        },
        isPanelVisible: () => panelWindow?.isVisible() ?? false,
        shortcutStatus: () => shortcut.status(),
        trayStatus: () => tray?.status() ?? null,
        trayState,
        pollBuilds: () => buildPolling.runNow(),
        /** PIDs of the in-app terminals' shells (to check closing a tab stops them). */
        terminalPids: () => terminal.pids(),
        pollRuns: () => ciPolling.runNow(),
      },
    })
  }

  // SPEC 6.2: dev server process trees are killed when the app quits.
  let serversStopped = false
  app.on('before-quit', (event) => {
    if (serversStopped || !devServers.hasRunning()) return
    event.preventDefault()
    void devServers.stopAll().finally(() => {
      serversStopped = true
      app.quit()
    })
  })
  // P7-A: the in-app terminals' shells (and what they started) go too.
  let terminalsStopped = false
  app.on('before-quit', (event) => {
    if (terminalsStopped || terminal.count() === 0) return
    event.preventDefault()
    void terminal.killAll().finally(() => {
      terminalsStopped = true
      app.quit()
    })
  })
  app.on('will-quit', () => {
    pollers.forEach((p) => p.stop())
    watcher.dispose()
    shortcut.dispose()
    tray?.destroy()
  })
  log.info(`DevDock ${app.getVersion()} started (demo mode: ${store.get().general.demoMode})`)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMain)
  app.on('activate', showMain)
  app.on('before-quit', () => {
    quitting = true
  })
  // The hidden palette window keeps the app alive; quitting is explicit (tray, menu, close).
  app.on('window-all-closed', () => undefined)
  void app.whenReady().then(start)
}
