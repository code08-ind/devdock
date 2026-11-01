/** Shared by both pages (index.html, downloads.html): element builder, logos, theme toggle. */
import type { Rich } from './steps'

const THEME_KEY = 'devdock-site-theme'

type Child = Node | string | null | undefined | false

/** Tiny element builder: text is always set as text, never parsed as HTML. */
export function h(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const c of children) if (c) el.append(c)
  return el
}

export type Platform = 'mac' | 'windows'

/** The Apple or Windows logo from the page's sprite (`#i-apple`, `#i-windows`). */
export function logo(platform: Platform): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(ns, 'use')
  use.setAttribute('href', platform === 'mac' ? '#i-apple' : '#i-windows')
  svg.append(use)
  return svg
}

/** `**bold**` spans to <strong>; everything else stays plain text. */
export function renderRich(text: Rich): DocumentFragment {
  const frag = document.createDocumentFragment()
  text.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
    if (!part) return
    frag.append(i % 2 ? h('strong', {}, part) : part)
  })
  return frag
}

// ---------------------------------------------------------------- theme

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** The theme in use: the visitor's choice, else the system's. */
function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme
  return chosen ? chosen === 'dark' : darkQuery.matches
}

/** One Light/Dark toggle. Until it's pressed the page follows the system. */
export function initTheme(): void {
  const button = document.querySelector<HTMLButtonElement>('#theme')
  if (!button) return
  const sync = (): void => button.setAttribute('aria-pressed', String(isDark()))
  sync()
  darkQuery.addEventListener('change', sync)
  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    sync()
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  })
}
