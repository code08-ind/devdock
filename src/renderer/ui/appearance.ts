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
