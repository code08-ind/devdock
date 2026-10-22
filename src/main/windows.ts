/** Main window and command-palette window, both with the hardened WEB_PREFERENCES. */
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { WEB_PREFERENCES } from './security'

type Page = 'index' | 'palette'

/** electron-vite sets this in dev; production loads the built files from disk. */
export const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL

const PALETTE = { width: 640, height: 420 }

const preload = join(import.meta.dirname, '../preload/index.cjs')

function load(win: BrowserWindow, page: Page): Promise<void> {
  if (DEV_RENDERER_URL) return win.loadURL(`${DEV_RENDERER_URL}/${page}.html`)
  return win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`))
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'DevDock',
    width: 900,
    height: 600,
    minWidth: 720,
    minHeight: 480,
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
