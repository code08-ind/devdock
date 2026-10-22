/**
 * App lifecycle: single instance, services, windows, tray, global shortcut and IPC.
 * Services are plain classes with injected Electron adapters (see ./services).
 */
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  net,
  Notification,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import type { EventChannel, View } from '@shared/channels'
import type { EventPayload } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import { demoHandlers } from './demo/handlers'
import { createHandlers } from './handlers'
import { GitActions } from './services/git/actions'
import { GitRunner } from './services/git/exec'
import { editorCommand, editorFallback, launchDetached, terminalCommand } from './services/open'
import { RepoWatcher } from './services/repo-watcher'
import { RepoService } from './services/repos'
import { registerIpc } from './ipc/registry'
import { checkExternalUrl, installSecurity, isAppUrl } from './security'
import { DemoHttpClient, RealHttpClient, SwitchingHttpClient } from './services/http'
import { initLogger, log } from './services/logger'
import { NotificationService, type NativeNotifier } from './services/notifications'
import { SecretStore } from './services/secrets'
import { SettingsStore } from './services/settings'
import { ShortcutService } from './services/shortcut'
import { createTray, type TrayHandle } from './tray'
import { createMainWindow, createPaletteWindow, DEV_RENDERER_URL, showPalette } from './windows'

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
let tray: TrayHandle | null = null
let quitting = false

/** Opens a link in the browser only if it passes the allowlist; otherwise logs why not. */
function openExternalSafe(url: string): void {
  const verdict = checkExternalUrl(url, settings?.get().links.allowedHosts ?? [])
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
  return [mainWindow, paletteWindow].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
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

function applyLoginItem(s: Settings): void {
  // In dev this would register the bare Electron binary, so only packaged builds touch it.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin })
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
    onClick: (n) => (n.url ? openExternalSafe(n.url) : showMain()),
    onChange: notificationsChanged,
  })
  const shortcut = new ShortcutService(globalShortcut, togglePalette)
  const http = new SwitchingHttpClient(
    () => store.get().general.demoMode,
    new RealHttpClient((request) => net.fetch(request)),
    new DemoHttpClient(demoHandlers()),
  )

  const git = new GitRunner()
  const repos = new RepoService(store, git)
  const watcher = new RepoWatcher(git, (id) => broadcast('repos:changed', { id }))
  void watcher.sync(store.get().repos)

  registerIpc(
    createHandlers({
      settings: store,
      secrets,
      notifications,
      shortcut,
      http,
      logsDir,
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
      quit,
      repos,
      git,
      actions: new GitActions(git),
      pickFolder: async () => {
        const opts = { title: 'Add a git repository', properties: ['openDirectory' as const] }
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, opts)
          : await dialog.showOpenDialog(opts)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      openRepo: async (repo, target) => {
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
      },
      requestRepoAction: (event) => {
        showView('repos')
        mainWindow?.webContents.send('repos:actionRequested', event)
      },
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

  store.onChange((s) => {
    broadcast('settings:changed', s)
    void watcher.sync(s.repos)
    applyLoginItem(s)
    // settings:update/import/reset can name a shortcut that is taken or reserved. Keep the
    // working one and write it back, so the settings file never disagrees with the OS.
    if (s.general.paletteShortcut === shortcut.active()) return
    const result = shortcut.set(s.general.paletteShortcut)
    if (result.ok) return
    log.warn(`palette shortcut ${result.accelerator} rejected: ${result.reason}`)
    const active = shortcut.active()
    if (active) store.update({ general: { paletteShortcut: active } })
  })

  mainWindow = createMainWindow()
  mainWindow.on('close', (event) => {
    if (quitting) return
    if (store.get().general.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    } else {
      quit()
    }
  })
  paletteWindow = createPaletteWindow()

  const trayDir = app.isPackaged
    ? join(process.resourcesPath, 'tray')
    : join(app.getAppPath(), 'build', 'tray')
  tray = createTray(trayDir, () => ({ pausedUntil: notifications.getPausedUntil() }), {
    open: showMain,
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
        shortcutStatus: () => shortcut.status(),
      },
    })
  }

  app.on('will-quit', () => {
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
