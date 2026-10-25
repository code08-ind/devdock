/** Where the menu-bar panel opens, next to the tray icon (P6-E). Pure, so it is unit-tested. */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Space between the panel and the menu bar / taskbar, and the screen edges. */
export const PANEL_GAP = 6

/**
 * The panel's top-left corner. The bar the icon sits in is found from where the icon is
 * relative to the display's work area (which excludes the bar): above it on macOS (menu bar)
 * or a top taskbar, below it for the usual Windows taskbar, or to the left/right. The panel
 * lines up with the icon along the bar and always stays inside the work area. An icon with
 * no bounds (some Linux trays) puts it in the work area's top-right corner.
 */
export function panelPosition(
  icon: Rect,
  workArea: Rect,
  size: { width: number; height: number },
): { x: number; y: number } {
  const left = workArea.x + PANEL_GAP
  const top = workArea.y + PANEL_GAP
  const right = workArea.x + workArea.width - size.width - PANEL_GAP
  const bottom = workArea.y + workArea.height - size.height - PANEL_GAP
  const clamp = (v: number, min: number, max: number) =>
    Math.round(Math.min(Math.max(v, min), Math.max(min, max)))

  if (icon.width === 0 && icon.height === 0) return { x: clamp(right, left, right), y: top }

  const cx = icon.x + icon.width / 2
  const cy = icon.y + icon.height / 2
  const alongX = clamp(cx - size.width / 2, left, right)
  const alongY = clamp(cy - size.height / 2, top, bottom)

  if (cy < workArea.y) return { x: alongX, y: top }
  if (cy > workArea.y + workArea.height) return { x: alongX, y: clamp(bottom, top, bottom) }
  if (cx < workArea.x) return { x: left, y: alongY }
  if (cx > workArea.x + workArea.width) return { x: clamp(right, left, right), y: alongY }
  // The icon is inside the work area (an auto-hiding taskbar or the Windows overflow flyout):
  // open towards the middle of the screen.
  const upper = cy < workArea.y + workArea.height / 2
  return {
    x: alongX,
    y: upper
      ? clamp(icon.y + icon.height + PANEL_GAP, top, bottom)
      : clamp(icon.y - size.height - PANEL_GAP, top, bottom),
  }
}
