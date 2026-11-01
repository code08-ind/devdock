/** Main window, command-palette window and menu-bar panel, all with the hardened WEB_PREFERENCES. */
import { join } from 'node:path'
import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import { panelPosition } from './panelPosition'
import { WEB_PREFERENCES } from './security'

type Page = 'index' | 'palette' | 'panel'

/** electron-vite sets this in dev; production loads the built files from disk. */
export const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL

const PALETTE = { width: 640, height: 420 }
/** Narrow like other menu-bar apps; tall enough for a short list and a dialog. */
export const PANEL = { width: 400, height: 600 }

const preload = join(import.meta.dirname, '../preload/index.cjs')

/**
 * e2e runs stay out of the way of whoever is at the computer: windows are fully transparent and
 * never take focus, there is no Dock icon and no system notification (the tests read
 * DevDock's own history). `DEVDOCK_E2E_VISIBLE=1` shows them as usual, to watch a run.
 * Never in a packaged app.
 */
export const QUIET_E2E =
  !app.isPackaged &&
  process.env.DEVDOCK_E2E === '1' &&
  process.env.DEVDOCK_E2E_VISIBLE !== '1'

/** Shows a window and gives it focus — or, in a quiet e2e run, shows it without either. */
export function reveal(win: BrowserWindow): void {
  if (QUIET_E2E) {
    win.setOpacity(0)
    win.showInactive()
    return
  }
  win.show()
  win.focus()
}

/** `e2e`: the page gets `?e2e=1` and exposes its test hook (never in a packaged app). */
function load(win: BrowserWindow, page: Page, e2e = false): Promise<void> {
  if (DEV_RENDERER_URL) return win.loadURL(`${DEV_RENDERER_URL}/${page}.html${e2e ? '?e2e=1' : ''}`)
  return win.loadFile(
    join(import.meta.dirname, `../renderer/${page}.html`),
    e2e ? { query: { e2e: '1' } } : undefined,
  )
}

export function createMainWindow({ e2e = false }: { e2e?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    title: 'DevDock',
    // Roomy like other desktop toolboxes (user request, P6-A); still fits a 1280×800 screen.
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 580,
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload },
  })
  win.once('ready-to-show', () => (QUIET_E2E ? reveal(win) : win.show()))
  void load(win, 'index', e2e)
  return win
}

export function createPaletteWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'DevDock command palette',
    ...PALETTE,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload },
  })
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  // A palette that loses focus is dismissed, like Spotlight.
  win.on('blur', () => win.hide())
  void load(win, 'palette')
  return win
}

/** Shows the palette on the display under the cursor, roughly a third of the way down. */
export function showPalette(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width: w, height: h } = PALETTE
  win.setPosition(
    Math.round(workArea.x + (workArea.width - w) / 2),
    Math.round(workArea.y + (workArea.height - h) / 3),
  )
  reveal(win)
}

/** The menu-bar / tray panel (P6-E): one-click actions without opening the main window. */
export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'DevDock',
    ...PANEL,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload },
  })
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  void load(win, 'panel')
  return win
}

/** Shows the panel next to the tray icon, on the display the icon is on. */
export function showPanel(win: BrowserWindow, icon: Rectangle): void {
  const point = icon.width || icon.height ? { x: icon.x, y: icon.y } : screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(point)
  const { x, y } = panelPosition(icon, workArea, PANEL)
  win.setPosition(x, y)
  reveal(win)
}
