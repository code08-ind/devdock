import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../../src/shared/settings'
import {
  ANSI_NAMES,
  contrast,
  ensureContrast,
  mix,
  ShellOverrideSchema,
  terminalFontSize,
  terminalPalette,
  TerminalSettingsSchema,
  type ThemeTokens,
} from '../../src/shared/terminal'

/** The shipped tokens (src/renderer/ui/tokens.css), as the renderer reads them. */
const css = readFileSync(join(import.meta.dirname, '../../src/renderer/ui/tokens.css'), 'utf8')
function tokens(theme: string): ThemeTokens {
  const start = css.indexOf(`[data-theme='${theme}'] {`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const v = (name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(body)
    if (!m) throw new Error(`${theme} has no --${name}`)
    return m[1]!.toLowerCase()
  }
  return {
    bg: v('bg'),
    bgSubtle: v('bg-subtle'),
    border: v('border'),
    text: v('text'),
    textMuted: v('text-muted'),
    accent: v('accent'),
    focus: v('focus'),
    success: v('success'),
    warning: v('warning'),
    danger: v('danger'),
    info: v('info'),
    selection: v('selection'),
  }
}

const named = THEMES.filter((t) => t !== 'system')
/** Meant to sit close to the background (black on dark themes, white on light ones). */
const NEAR_BG = { dark: ['black'], light: ['white', 'brightWhite'] } as const

describe('terminal palette (P7-A)', () => {
  it.each(named)('%s: every colour is readable on the terminal background', (theme) => {
    const t = tokens(theme)
    const hc = theme === 'high-contrast'
    const p = terminalPalette(t, { highContrast: hc })
    const dark = contrast(t.bg, '#000000') < contrast(t.bg, '#ffffff')
    const near: readonly string[] = dark ? NEAR_BG.dark : NEAR_BG.light
    expect(p.background).toBe(t.bg)
    expect(contrast(p.foreground, p.background)).toBeGreaterThanOrEqual(hc ? 7 : 4.5)
    for (const name of ANSI_NAMES) {
      const min = near.includes(name) ? (hc ? 4.5 : 3) : hc ? 7 : 4.5
      expect(contrast(p[name], p.background), `${theme} ${name} ${p[name]}`).toBeGreaterThanOrEqual(
        min,
      )
    }
    // Selected text stays readable too.
    expect(contrast(p.selectionForeground, p.selectionBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('Slate uses its current tokens (text #CDD9E5, muted #A6B1BC)', () => {
    const p = terminalPalette(tokens('slate'))
    expect(p.foreground).toBe('#cdd9e5')
    expect(p.white).toBe('#cdd9e5')
    expect(p.brightBlack).toBe('#a6b1bc')
    // The muted colour (autosuggestions, comments) stays below the text in brightness.
    expect(contrast(p.brightBlack, p.background)).toBeLessThan(contrast(p.foreground, p.background))
  })

  it('oh-my-zsh colours come from the theme: red/green/yellow/blue are danger/success/warning/info', () => {
    const t = tokens('dark')
    const p = terminalPalette(t)
    expect([p.red, p.green, p.yellow, p.blue]).toEqual([t.danger, t.success, t.warning, t.info])
  })

  it('ensureContrast keeps a colour that passes and moves one that does not towards the text', () => {
    expect(ensureContrast('#000000', '#ffffff', '#000000', 4.5)).toBe('#000000')
    const raised = ensureContrast('#cccccc', '#ffffff', '#1f2328', 4.5)
    expect(contrast(raised, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('Settings → Terminal schema', () => {
  it('defaults: login shell, app font size, no DevDock prompt', () => {
    expect(TerminalSettingsSchema.parse(undefined)).toEqual({
      shell: '',
      fontSize: 'app',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 5000,
      devdockPrompt: false,
    })
    expect(terminalFontSize('app', 15)).toBe(15)
    expect(terminalFontSize(18, 15)).toBe(18)
  })

  it('a shell is a known name or an absolute path, never a command line', () => {
    for (const ok of [
      '',
      'zsh',
      'PWSH.exe',
      '/opt/homebrew/bin/fish',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    ])
      expect(ShellOverrideSchema.safeParse(ok).success, ok).toBe(true)
    for (const bad of [
      'zsh -c "rm -rf ~"',
      'bin/zsh',
      'zsh; rm',
      '/bin/zsh\n/bin/rm',
      'x'.repeat(501),
    ])
      expect(ShellOverrideSchema.safeParse(bad).success, bad).toBe(false)
  })

  it('rejects out-of-range sizes and scrollback', () => {
    expect(TerminalSettingsSchema.safeParse({ fontSize: 4 }).success).toBe(false)
    expect(TerminalSettingsSchema.safeParse({ scrollback: 10 }).success).toBe(false)
  })
})
