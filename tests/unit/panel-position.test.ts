import { describe, expect, it } from 'vitest'
import { PANEL_GAP, panelPosition, type Rect } from '../../src/main/panelPosition'

const SIZE = { width: 400, height: 600 }
const G = PANEL_GAP

describe('menu-bar panel position (P6-E)', () => {
  it('macOS: below the menu bar, centred on the icon', () => {
    // 1440×900 display, 25px menu bar; icon at x=1100.
    const work: Rect = { x: 0, y: 25, width: 1440, height: 875 }
    const icon: Rect = { x: 1100, y: 0, width: 24, height: 24 }
    expect(panelPosition(icon, work, SIZE)).toEqual({ x: 1112 - 200, y: 25 + G })
  })

  it('macOS: an icon near the right edge keeps the panel on screen', () => {
    const work: Rect = { x: 0, y: 25, width: 1440, height: 875 }
    const icon: Rect = { x: 1400, y: 0, width: 24, height: 24 }
    expect(panelPosition(icon, work, SIZE)).toEqual({ x: 1440 - 400 - G, y: 25 + G })
  })

  it('Windows: bottom taskbar → above it, by the icon', () => {
    // 1920×1080, 40px taskbar at the bottom; tray icon at x=1700.
    const work: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const icon: Rect = { x: 1700, y: 1048, width: 24, height: 24 }
    expect(panelPosition(icon, work, SIZE)).toEqual({ x: 1712 - 200, y: 1040 - 600 - G })
  })

  it('Windows: top, left and right taskbars', () => {
    const top: Rect = { x: 0, y: 40, width: 1920, height: 1040 }
    expect(panelPosition({ x: 1700, y: 8, width: 24, height: 24 }, top, SIZE)).toEqual({
      x: 1512,
      y: 40 + G,
    })
    const leftBar: Rect = { x: 60, y: 0, width: 1860, height: 1080 }
    expect(panelPosition({ x: 18, y: 1000, width: 24, height: 24 }, leftBar, SIZE)).toEqual({
      x: 60 + G,
      y: 1080 - 600 - G,
    })
    const rightBar: Rect = { x: 0, y: 0, width: 1860, height: 1080 }
    expect(panelPosition({ x: 1878, y: 500, width: 24, height: 24 }, rightBar, SIZE)).toEqual({
      x: 1860 - 400 - G,
      y: 212,
    })
  })

  it('a second display with negative coordinates', () => {
    const work: Rect = { x: -1920, y: 0, width: 1920, height: 1040 }
    const icon: Rect = { x: -300, y: 1048, width: 24, height: 24 }
    expect(panelPosition(icon, work, SIZE)).toEqual({ x: -488, y: 1040 - 600 - G })
  })

  it('icon inside the work area (auto-hide taskbar / overflow flyout): opens towards the middle', () => {
    const work: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(panelPosition({ x: 1700, y: 1050, width: 24, height: 24 }, work, SIZE)).toEqual({
      x: 1512,
      y: 1050 - 600 - G,
    })
    expect(panelPosition({ x: 1700, y: 4, width: 24, height: 24 }, work, SIZE)).toEqual({
      x: 1512,
      y: 4 + 24 + G,
    })
  })

  it('no icon bounds: top-right corner of the work area', () => {
    const work: Rect = { x: 0, y: 25, width: 1440, height: 875 }
    expect(panelPosition({ x: 0, y: 0, width: 0, height: 0 }, work, SIZE)).toEqual({
      x: 1440 - 400 - G,
      y: 25 + G,
    })
  })

  it('a screen smaller than the panel still pins it to the top-left of the work area', () => {
    const work: Rect = { x: 0, y: 25, width: 300, height: 400 }
    expect(panelPosition({ x: 250, y: 0, width: 24, height: 24 }, work, SIZE)).toEqual({
      x: G,
      y: 25 + G,
    })
  })
})
