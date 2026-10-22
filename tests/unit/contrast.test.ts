import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../../src/shared/settings'

/** UI-THEMES.md Phase 0 criterion, computed from the shipped CSS rather than a copy of it. */
const css = readFileSync(join(import.meta.dirname, '../../src/renderer/ui/tokens.css'), 'utf8')

const TOKENS = [
  'bg',
  'bg-subtle',
  'surface',
  'border',
  'text',
  'text-muted',
  'accent',
  'accent-contrast',
  'focus',
  'success',
  'warning',
  'danger',
  'info',
  'selection',
] as const
type Palette = Record<(typeof TOKENS)[number], string>

function block(selector: string, from = 0): string {
  const start = css.indexOf(selector, from)
  if (start < 0) throw new Error(`missing ${selector}`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

function palette(body: string): Palette {
  const out: Partial<Palette> = {}
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)) {
    out[m[1] as keyof Palette] = m[2]!.toLowerCase()
  }
  return out as Palette
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const named = THEMES.filter((t) => t !== 'system')
const palettes = Object.fromEntries(
  named.map((t) => [t, palette(block(`[data-theme='${t}'] {`))]),
) as Record<(typeof named)[number], Palette>

describe('theme tokens', () => {
  it('computes WCAG ratios correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it.each(named)('%s defines every token', (t) => {
    expect(Object.keys(palettes[t]).sort()).toEqual([...TOKENS].sort())
  })

  it('System dark is the Dark palette', () => {
    const media = css.indexOf('@media (prefers-color-scheme: dark)')
    expect(palette(block(`[data-theme='system'] {`, media))).toEqual(palettes.dark)
  })

  it.each(named)('%s: text and muted text are readable on bg and surface', (t) => {
    const p = palettes[t]
    const min = t === 'high-contrast' ? 7 : 4.5
    for (const fg of [p.text, p['text-muted']]) {
      for (const bg of [p.bg, p.surface, p['bg-subtle']]) {
        expect(contrast(fg, bg), `${t} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min)
      }
    }
    // Selected rows use --text (never --text-muted) on --selection.
    expect(contrast(p.text, p.selection)).toBeGreaterThanOrEqual(min)
  })

  it.each(named)('%s: status colours and focus are >= 3:1 against bg and surface', (t) => {
    const p = palettes[t]
    for (const k of ['success', 'warning', 'danger', 'info', 'accent', 'focus'] as const) {
      for (const bg of [p.bg, p.surface]) {
        expect(contrast(p[k], bg), `${t} ${k}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it.each(named)('%s: primary button label is readable', (t) => {
    const p = palettes[t]
    expect(contrast(p['accent-contrast'], p.accent)).toBeGreaterThanOrEqual(4.5)
  })
})
