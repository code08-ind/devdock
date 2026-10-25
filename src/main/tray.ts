/** Tray / menu-bar icon, status dot and menu (SPEC §6.1). Quick actions arrive in P6. */
import { join } from 'node:path'
import {
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron'
import { prKey, type WatchItem } from '@shared/bitbucket'
import { jobLabel, type BuildWatch } from '@shared/jenkins'
import { log } from './services/logger'

/** SPEC 6.1: green when all watched builds pass, red when any fails, grey when idle. */
export type TrayStatus = 'green' | 'red' | 'grey'

/** A watched build's last state, as the tray shows it (`stopped`: aborted / not built). */
export type WatchedState = 'waiting' | 'running' | 'passed' | 'failed' | 'stopped'

export interface TrayWatched {
  label: string
  state: WatchedState
  /** When a finished build ended (epoch ms); null while it runs, or for PR watches. */
  finishedAt: number | null
}

export interface TrayState {
  pausedUntil: number | null
  watched: TrayWatched[]
}

export interface TrayActions {
  open: () => void
  /** Opens the Builds view (a watched item was clicked). */
  showBuilds: () => void
  pause: (minutes: number) => void
  resume: () => void
  quit: () => void
}

/** A finished build stops colouring the dot after this long ("grey when idle"). */
export const STALE_AFTER_MS = 8 * 3_600_000

/**
 * Red when any watched build failed; green when some passed and none failed; else grey.
 * Finished builds older than `STALE_AFTER_MS` don't count (they stay listed in the menu).
 */
export function trayStatus(watched: readonly TrayWatched[], now = Date.now()): TrayStatus {
  const recent = watched.filter((w) => w.finishedAt === null || now - w.finishedAt < STALE_AFTER_MS)
  if (recent.some((w) => w.state === 'failed')) return 'red'
  return recent.some((w) => w.state === 'passed') ? 'green' : 'grey'
}

/** Items listed in the menu (the rest are in the Builds view). */
export const TRAY_MAX_ITEMS = 10

const BUILD_STATE: Record<NonNullable<BuildWatch['build']>['state'], WatchedState> = {
  success: 'passed',
  failed: 'failed',
  unstable: 'failed',
  aborted: 'stopped',
  not_built: 'stopped',
  running: 'running',
}

const PR_STATE: Partial<Record<WatchItem['pr']['build']['state'], WatchedState>> = {
  success: 'passed',
  failed: 'failed',
  running: 'running',
  stopped: 'stopped',
}

/**
 * Build watches (all, until removed) and the build state of open PR watches, newest first.
 * PRs with no builds reported aren't listed, nor PRs whose pipeline is watched (one entry each).
 */
export function watchedForTray(
  builds: readonly BuildWatch[],
  prs: readonly WatchItem[],
): TrayWatched[] {
  const fromBuilds = builds.map((w): TrayWatched => {
    const name = w.label ?? jobLabel(w.job)
    const finished = w.done && w.build
    return {
      label: w.number === null ? name : `${name} #${w.number}`,
      state: w.number === null || !w.build ? 'waiting' : BUILD_STATE[w.build.state],
      finishedAt: finished
        ? (w.build!.startedAt ?? w.checkedAt ?? w.addedAt) + (w.build!.durationMs ?? 0)
        : null,
    }
  })
  const piped = new Set(builds.flatMap((w) => w.pr ?? []))
  const fromPrs = prs.flatMap((w): TrayWatched[] => {
    const state = w.pr.state === 'open' ? PR_STATE[w.pr.build.state] : undefined
    if (!state || piped.has(prKey(w.ref))) return []
    return [{ label: `${w.pr.ref.repo} #${w.pr.ref.id}`, state, finishedAt: null }]
  })
  return [...fromBuilds, ...fromPrs]
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Pure menu description. */
export function trayMenuTemplate(state: TrayState, a: TrayActions): MenuItemConstructorOptions[] {
  const pause: MenuItemConstructorOptions =
    state.pausedUntil === null
      ? { id: 'pause', label: 'Pause notifications 1h', click: () => a.pause(60) }
      : {
          id: 'resume',
          label: `Resume notifications (paused until ${timeOf(state.pausedUntil)})`,
          click: () => a.resume(),
        }
  const shown = state.watched.slice(0, TRAY_MAX_ITEMS)
  const more = state.watched.length - shown.length
  const watched: MenuItemConstructorOptions[] = state.watched.length
    ? [
        { type: 'separator' },
        { id: 'watched', label: 'Watched', enabled: false },
        ...shown.map((w, i): MenuItemConstructorOptions => ({
          id: `watched-${i}`,
          label: `${w.label} — ${w.state}`,
          click: () => a.showBuilds(),
        })),
        ...(more > 0
          ? [{ id: 'watched-more', label: `${more} more…`, click: () => a.showBuilds() }]
          : []),
      ]
    : []
  return [
    { id: 'open', label: 'Open DevDock', click: () => a.open() },
    ...watched,
    { type: 'separator' },
    pause,
    { type: 'separator' },
    { id: 'quit', label: 'Quit DevDock', click: () => a.quit() },
  ]
}

export function trayTooltip(watched: readonly TrayWatched[]): string {
  if (watched.length === 0) return 'DevDock'
  const failed = watched.filter((w) => w.state === 'failed').length
  const running = watched.filter((w) => w.state === 'running').length
  const parts = [failed && `${failed} failed`, running && `${running} running`].filter(Boolean)
  return `DevDock — ${watched.length} watched${parts.length ? `: ${parts.join(', ')}` : ''}`
}

/** macOS uses a template image (auto light/dark); Windows uses the ICO. */
export function trayIconPath(resourcesDir: string, platform: NodeJS.Platform): string {
  return join(resourcesDir, platform === 'win32' ? 'tray.ico' : 'trayTemplate.png')
}

type Rgb = readonly [number, number, number]

export const DOT_COLORS: Record<TrayStatus, Rgb> = {
  green: [46, 160, 67],
  red: [209, 36, 47],
  grey: [140, 149, 159],
}

/** Alpha of the grey dot on macOS, where it stays a template image (only alpha counts). */
const TEMPLATE_DOT_ALPHA = 150

/**
 * Paints the status dot into a premultiplied BGRA bitmap (Electron's `toBitmap` format), in
 * place: a filled circle in the bottom-right quarter with a transparent gap around it so it
 * reads against the glyph. `glyph` recolours the icon itself (a coloured dot can't stay a
 * macOS template image, so the glyph is drawn white or black for the menu bar's appearance).
 */
export function paintDot(
  bitmap: Uint8Array,
  width: number,
  height: number,
  color: Rgb,
  glyph: Rgb | null,
  dotAlpha = 255,
): void {
  // Premultiplied: a colour channel never exceeds its alpha.
  const put = (i: number, rgb: Rgb, alpha: number) => {
    bitmap[i] = Math.round((rgb[2] * alpha) / 255)
    bitmap[i + 1] = Math.round((rgb[1] * alpha) / 255)
    bitmap[i + 2] = Math.round((rgb[0] * alpha) / 255)
    bitmap[i + 3] = alpha
  }
  const r = Math.max(2, Math.round(width * 0.22))
  const gap = Math.max(1, Math.round(width / 16))
  const cx = width - r - 0.5
  const cy = height - r - 0.5
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) put(i, color, dotAlpha)
      else if (d <= r + gap) put(i, [0, 0, 0], 0)
      else if (glyph && bitmap[i + 3]! > 0) put(i, glyph, bitmap[i + 3]!)
    }
  }
}

/**
 * The base icon with the dot, at its largest scale factor; the base icon if that fails. As a
 * template (macOS, grey) the dot is a half-transparent black, so the menu bar tints it with
 * the glyph and it reads grey on any appearance.
 */
function withDot(
  base: NativeImage,
  status: TrayStatus,
  look: { glyph: Rgb | null; template: boolean },
): NativeImage {
  const scale = Math.max(...base.getScaleFactors(), 1)
  const size = base.getSize()
  const width = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)
  const bitmap = Buffer.from(base.toBitmap({ scaleFactor: scale }))
  if (bitmap.length !== width * height * 4) {
    log.warn('tray icon bitmap has an unexpected size; showing it without a status dot')
    return base
  }
  if (look.template) paintDot(bitmap, width, height, [0, 0, 0], null, TEMPLATE_DOT_ALPHA)
  else paintDot(bitmap, width, height, DOT_COLORS[status], look.glyph)
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: scale })
  if (look.template) image.setTemplateImage(true)
  return image
}

export interface TrayHandle {
  refresh: () => void
  /** For tests: what the tray shows now. */
  status: () => TrayStatus
  destroy: () => void
}

export function createTray(
  resourcesDir: string,
  getState: () => TrayState,
  actions: TrayActions,
): TrayHandle {
  const base = nativeImage.createFromPath(trayIconPath(resourcesDir, process.platform))
  const mac = process.platform === 'darwin'
  if (mac) base.setTemplateImage(true)
  const tray = new Tray(base)
  tray.setToolTip('DevDock')
  // Windows convention: left click opens the window, right click shows the menu.
  if (process.platform === 'win32') tray.on('click', () => actions.open())

  let shown: string | null = null
  let status: TrayStatus = 'grey'
  const refresh = (): void => {
    const state = getState()
    status = trayStatus(state.watched)
    // macOS: grey stays a template (the system picks its colour); red/green need a glyph
    // colour chosen from the appearance.
    const template = mac && status === 'grey'
    const glyph: Rgb | null =
      mac && !template ? (nativeTheme.shouldUseDarkColors ? [255, 255, 255] : [0, 0, 0]) : null
    // Rebuilding the image only when it changes keeps idle refreshes cheap.
    const look = `${status}:${template}:${glyph?.join(',') ?? ''}`
    if (look !== shown) {
      shown = look
      tray.setImage(withDot(base, status, { glyph, template }))
    }
    tray.setToolTip(trayTooltip(state.watched))
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(state, actions)))
  }
  nativeTheme.on('updated', refresh)
  // Finished builds age out of the dot's colour; nothing else fires when they do.
  const ageing = setInterval(refresh, 10 * 60_000)
  ageing.unref()
  refresh()
  return {
    refresh,
    status: () => status,
    destroy: () => {
      clearInterval(ageing)
      nativeTheme.removeListener('updated', refresh)
      tray.destroy()
    },
  }
}
