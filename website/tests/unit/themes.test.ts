import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The site's theme tokens must be the app's (docs/UI-THEMES.md "Tokens"), so they can't drift. */
const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
const doc = readFileSync(new URL('../../../docs/UI-THEMES.md', import.meta.url), 'utf8')

const THEMES = ['Light', 'Dark', 'High Contrast', 'Paper', 'Slate'] as const
const SELECTOR: Record<(typeof THEMES)[number], string> = {
  Light: ':root {',
  Dark: ":root[data-theme='dark'] {",
  'High Contrast': ":root[data-theme='hc'] {",
  Paper: ":root[data-theme='paper'] {",
  Slate: ":root[data-theme='slate'] {",
}

function siteTokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  )
}

function specTokens(): Record<string, string[]> {
  const rows = [...doc.matchAll(/^\| `(--[\w-]+)` \|(.+)\|$/gm)]
  return Object.fromEntries(
    rows.map((m) => [m[1], m[2].split('|').map((c) => c.trim().toLowerCase())]),
  )
}

describe('theme tokens match UI-THEMES.md', () => {
  const spec = specTokens()
  it.each(THEMES.map((t, i) => [t, i] as const))('%s', (theme, column) => {
    const site = siteTokens(SELECTOR[theme])
    const shared = Object.keys(site).filter((token) => token in spec)
    expect(shared.length).toBeGreaterThanOrEqual(10)
    for (const token of shared)
      expect(`${token} ${site[token]}`).toBe(`${token} ${spec[token][column]}`)
  })
})
