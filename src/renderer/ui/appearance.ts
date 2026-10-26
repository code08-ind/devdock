import type { Density, FontSize, Settings, Theme } from '@shared/settings'

export const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
  paper: 'Paper',
  slate: 'Slate',
}

export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
}

/** Applies theme, font size and density live by setting data attributes on <html>. */
export function applyAppearance(a: Settings['appearance']): void {
  const html = document.documentElement
  html.dataset.theme = a.theme
  html.dataset.fontSize = String(a.fontSize satisfies FontSize)
  html.dataset.density = a.density
}

/** Applies the Accessibility switches the same way; tokens.css styles the attributes. */
export function applyAccessibility(a: Settings['accessibility']): void {
  const html = document.documentElement
  html.dataset.reduceMotion = a.reduceMotion
  html.toggleAttribute('data-larger-targets', a.largerTargets)
  html.toggleAttribute('data-underline-links', a.underlineLinks)
  html.toggleAttribute('data-focus-always', a.focusAlways)
}

/** Reduce motion is on here or in the OS: for motion CSS can't reach (smooth scrolling). */
export function reducedMotion(): boolean {
  return (
    document.documentElement.dataset.reduceMotion === 'on' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
