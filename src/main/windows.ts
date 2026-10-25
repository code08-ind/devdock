/** Main window, command-palette window and menu-bar panel, all with the hardened WEB_PREFERENCES. */
import { join } from 'node:path'
import { BrowserWindow, screen, type Rectangle } from 'electron'
import { panelPosition } from './panelPosition'
import { WEB_PREFERENCES } from './security'

type Page = 'index' | 'palette' | 'panel'

/** electron-vite sets this in dev; production loads the built files from disk. */
export const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL

const PALETTE = { width: 640, height: 420 }
/** Narrow like other menu-bar apps; tall enough for a short list and a dialog. */
export const PANEL = { width: 400, height: 600 }

const preload = join(import.meta.dirname, '../preload/index.cjs')

function load(win: BrowserWindow, page: Page): Promise<void> {
  if (DEV_RENDERER_URL) return win.loadURL(`${DEV_RENDERER_URL}/${page}.html`)
  return win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`))
}

export function createMainWindow(): BrowserWindow {
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
  win.once('ready-to-show', () => win.show())
  void load(win, 'index')
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
  win.show()
  win.focus()
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
  win.show()
  win.focus()
}
