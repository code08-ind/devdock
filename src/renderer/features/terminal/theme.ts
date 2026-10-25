import { terminalPalette, type TerminalPalette, type ThemeTokens } from '@shared/terminal'

const TOKEN_VARS: Record<keyof ThemeTokens, string> = {
  bg: '--bg',
  bgSubtle: '--bg-subtle',
  border: '--border',
  text: '--text',
  textMuted: '--text-muted',
  accent: '--accent',
  focus: '--focus',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  selection: '--selection',
}

/** The theme tokens in effect right now (the CSS is the source of truth, UI-THEMES.md). */
export function currentTokens(root: HTMLElement = document.documentElement): ThemeTokens {
  const css = getComputedStyle(root)
  const out = {} as ThemeTokens
  for (const [key, name] of Object.entries(TOKEN_VARS) as [keyof ThemeTokens, string][]) {
    out[key] = css.getPropertyValue(name).trim().toLowerCase()
  }
  return out
}

/** The terminal palette for the theme on <html> (System follows the OS, like the app). */
export function currentPalette(): TerminalPalette {
  const highContrast = document.documentElement.dataset.theme === 'high-contrast'
  return terminalPalette(currentTokens(), { highContrast })
}
