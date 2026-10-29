import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The site wears www.aryangarg.com's palette (it is served on a subdomain of it), not the app's
 * UI-THEMES tokens; see docs/DECISIONS.md "Website v2". These tests keep the colours equal to
 * that site's light (:root) and dark (.dark) values, keep the system-dark copy in sync with the
 * toggled dark theme, and keep text contrast at WCAG AA.
 */
const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')

/** www.aryangarg.com's shadcn/zinc tokens (from its stylesheet, 2026-10-29). */
const PARENT = {
  light: {
    '--background': '#ffffff',
    '--foreground': '#09090b',
    '--surface': '#fafafa',
    '--card': '#ffffff',
    '--primary': '#18181b',
    '--primary-foreground': '#fafafa',
    '--muted': '#f4f4f5',
    '--muted-foreground': '#52525b',
    '--border': '#e4e4e7',
    '--ring': '#a1a1aa',
    '--status-available': '#16a34a',
  },
  dark: {
    '--background': '#09090b',
    '--foreground': '#fafafa',
    '--surface': '#18181b',
    '--card': '#18181b',
    '--primary': '#f4f4f5',
    '--primary-foreground': '#18181b',
    '--muted': '#27272a',
    '--muted-foreground': '#a1a1aa',
    '--border': '#27272a',
    '--ring': '#52525b',
    '--status-available': '#22c55e',
  },
} as const

const SELECTOR = {
  light: ':root {',
  dark: ":root[data-theme='dark'] {",
  system: ':root:not([data-theme]) {',
} as const

function siteTokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1],
      (m[2] ?? '').toLowerCase(),
    ]),
  )
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('site colours', () => {
  it('the system-dark copy (no theme chosen) equals the toggled Dark theme', () => {
    expect(siteTokens(SELECTOR.system)).toEqual(siteTokens(SELECTOR.dark))
  })

  it.each(['light', 'dark'] as const)('%s matches www.aryangarg.com', (theme) => {
    const site = siteTokens(SELECTOR[theme])
    for (const [token, value] of Object.entries(PARENT[theme]))
      expect(`${token} ${site[token]}`).toBe(`${token} ${value}`)
  })

  it.each(['light', 'dark'] as const)('%s text meets WCAG AA (4.5:1)', (theme) => {
    const t = siteTokens(SELECTOR[theme])
    const pairs: [string, string][] = [
      ['--foreground', '--background'],
      ['--muted-foreground', '--background'],
      ['--muted-foreground', '--card'],
      ['--muted-foreground', '--surface'],
      ['--muted-foreground', '--muted'],
      ['--primary-foreground', '--primary'],
    ]
    for (const [fg, bg] of pairs) {
      const ratio = contrast(t[fg] ?? '', t[bg] ?? '')
      expect(`${fg} on ${bg}: ${ratio >= 4.5}`, ratio.toFixed(2)).toBe(`${fg} on ${bg}: true`)
    }
  })
})
