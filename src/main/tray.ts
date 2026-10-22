/** Tray / menu-bar icon and menu (SPEC §6.1). Status dot and watched items arrive in P4. */
import { join } from 'node:path'
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'

export interface TrayState {
  pausedUntil: number | null
}

export interface TrayActions {
  open: () => void
  pause: (minutes: number) => void
  resume: () => void
  quit: () => void
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Pure menu description; watched items and quick actions join it in later phases. */
export function trayMenuTemplate(state: TrayState, a: TrayActions): MenuItemConstructorOptions[] {
  const pause: MenuItemConstructorOptions =
    state.pausedUntil === null
      ? { id: 'pause', label: 'Pause notifications 1h', click: () => a.pause(60) }
      : {
          id: 'resume',
          label: `Resume notifications (paused until ${timeOf(state.pausedUntil)})`,
          click: () => a.resume(),
        }
  return [
    { id: 'open', label: 'Open DevDock', click: () => a.open() },
    { type: 'separator' },
    pause,
    { type: 'separator' },
    { id: 'quit', label: 'Quit DevDock', click: () => a.quit() },
  ]
}

/** macOS uses a template image (auto light/dark); Windows uses the ICO. */
export function trayIconPath(resourcesDir: string, platform: NodeJS.Platform): string {
  return join(resourcesDir, platform === 'win32' ? 'tray.ico' : 'trayTemplate.png')
}

export interface TrayHandle {
  refresh: () => void
  destroy: () => void
}

export function createTray(
  resourcesDir: string,
  getState: () => TrayState,
  actions: TrayActions,
): TrayHandle {
  const image = nativeImage.createFromPath(trayIconPath(resourcesDir, process.platform))
  if (process.platform === 'darwin') image.setTemplateImage(true)
  const tray = new Tray(image)
  tray.setToolTip('DevDock')
  // Windows convention: left click opens the window, right click shows the menu.
  if (process.platform === 'win32') tray.on('click', () => actions.open())

  const refresh = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(getState(), actions)))
  }
  refresh()
  return { refresh, destroy: () => tray.destroy() }
}
