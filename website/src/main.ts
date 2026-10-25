import './style.css'
import { RELEASES_URL, REPO_URL } from './config'
import { describe, detect, primaryAsset, type Detected, type NavigatorLike } from './detect'
import { formatSize, loadRelease, type Installer, type Release } from './downloads'
import { installGuide, type Rich } from './steps'

const THEME_KEY = 'devdock-site-theme'
const THEMES = ['system', 'light', 'dark', 'hc', 'paper', 'slate'] as const

type Child = Node | string | null | undefined | false

/** Tiny element builder: text is always set as text, never parsed as HTML. */
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const c of children) if (c) el.append(c)
  return el
}

/** `**bold**` spans to <strong>; everything else stays plain text. */
function renderRich(text: Rich): DocumentFragment {
  const frag = document.createDocumentFragment()
  text.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
    if (!part) return
    frag.append(i % 2 ? h('strong', {}, part) : part)
  })
  return frag
}

// ---------------------------------------------------------------- theme

function initTheme(): void {
  const select = document.querySelector<HTMLSelectElement>('#theme')
  if (!select) return
  select.value = document.documentElement.dataset.theme ?? 'system'
  select.addEventListener('change', () => {
    const value = select.value as (typeof THEMES)[number]
    if (!THEMES.includes(value)) return
    if (value === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = value
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  })
}

// ---------------------------------------------------------------- feature tour (tabs)

function initTour(): void {
  const root = document.querySelector<HTMLElement>('[data-tour]')
  const list = root?.querySelector<HTMLElement>('[role="tablist"]')
  if (!root || !list) return
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''))

  const select = (index: number, focus: boolean): void => {
    tabs.forEach((tab, i) => {
      const on = i === index
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      const panel = panels[i]
      if (panel) panel.hidden = !on
    })
    if (focus) tabs[index]?.focus()
  }

  root.classList.add('is-tabs')
  list.hidden = false
  panels.forEach((p) => {
    p?.setAttribute('role', 'tabpanel')
    p?.setAttribute('tabindex', '0')
  })
  tabs.forEach((tab, i) => {
    tab.type = 'button'
    tab.addEventListener('click', () => select(i, false))
    tab.addEventListener('keydown', (e) => {
      const last = tabs.length - 1
      const next =
        e.key === 'ArrowRight'
          ? (i + 1) % tabs.length
          : e.key === 'ArrowLeft'
            ? (i - 1 + tabs.length) % tabs.length
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? last
                : -1
      if (next < 0) return
      e.preventDefault()
      select(next, true)
    })
  })
  select(0, false)
}

// ---------------------------------------------------------------- downloads

function downloadLink(inst: Installer, text: string, className = ''): HTMLElement {
  return h(
    'a',
    { href: inst.url, download: inst.file, 'data-asset': inst.id, class: className },
    text,
  )
}

function kind(inst: Installer): string {
  if (inst.id.startsWith('mac')) return 'Disk image (.dmg)'
  return inst.id === 'win-setup' ? 'Installer (.exe)' : 'Portable app (.exe)'
}

function installerTable(release: Release): HTMLElement {
  const rows = release.installers.map((inst) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, inst.system, h('span', { class: 'cell-note' }, inst.note)),
      h('td', {}, h('code', { class: 'file' }, inst.file)),
      h('td', { class: 'num' }, formatSize(inst.size) || '—'),
      h(
        'td',
        {},
        downloadLink(inst, 'Download', 'btn btn-secondary btn-sm'),
        // Screen readers hear which file each identical "Download" belongs to.
        h('span', { class: 'visually-hidden' }, ` ${inst.system}`),
      ),
    ),
  )
  return h(
    'div',
    { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'all-title' },
    h(
      'table',
      { class: 'installers' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'System'),
          h('th', { scope: 'col' }, 'File'),
          h('th', { scope: 'col', class: 'num' }, 'Size'),
          h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Download')),
        ),
      ),
      h('tbody', {}, ...rows),
    ),
  )
}

function alternative(release: Release, primaryId: string): HTMLElement | null {
  const find = (id: string) => release.installers.find((i) => i.id === id)
  const pair: Record<string, [string, string, string]> = {
    'mac-arm64': ['Intel Mac? ', 'mac-x64', 'Download for Intel'],
    'mac-x64': ['Mac with Apple silicon? ', 'mac-arm64', 'Download for Apple silicon'],
    'win-setup': ['Can’t install apps? ', 'win-portable', 'Get the portable version'],
  }
  const p = pair[primaryId]
  const inst = p && find(p[1])
  if (!p || !inst) return null
  return h('p', { class: 'alt-link' }, p[0], downloadLink(inst, p[2]))
}

function renderAvailable(release: Release, d: Detected): HTMLElement[] {
  const primaryId = primaryAsset(d)
  const primary = release.installers.find((i) => i.id === primaryId)
  const top = h('div', { class: 'card download-primary' })
  top.append(h('p', { class: 'detected' }, describe(d)))
  if (primary) {
    const size = formatSize(primary.size)
    top.append(
      downloadLink(primary, primary.label, 'btn btn-primary btn-lg'),
      h(
        'p',
        { class: 'download-meta' },
        `Version ${release.version}, ${kind(primary).toLowerCase()}${size ? `, ${size}` : ''}.`,
      ),
    )
    const alt = alternative(release, primary.id)
    if (alt) top.append(alt)
  }
  const all = h(
    'div',
    { class: 'card all-installers' },
    h('h3', { id: 'all-title' }, primary ? 'All installers' : 'Installers'),
    installerTable(release),
    h(
      'p',
      { class: 'small' },
      'Release notes and checksums are on the ',
      h('a', { href: `${RELEASES_URL}/tag/v${release.version}` }, `v${release.version} release`),
      ' page.',
    ),
  )
  return [top, all]
}

function renderSoon(release: Release): HTMLElement[] {
  const formats = release.installers.map((inst) =>
    h('li', {}, h('strong', {}, inst.system), h('span', { class: 'cell-note' }, kind(inst))),
  )
  return [
    h(
      'div',
      { class: 'card download-primary soon' },
      h('h3', {}, 'Downloads coming soon'),
      h(
        'p',
        {},
        `The first release, DevDock ${release.version}, is being prepared. When it’s published, this is where you’ll get the installer for your computer, picked for you.`,
      ),
      h(
        'p',
        {},
        'Until then, follow the project on ',
        h('a', { href: REPO_URL }, 'GitHub'),
        ' (Watch → Custom → Releases tells you when it’s out), or build it yourself from the source with ',
        h('code', {}, 'npm run dist'),
        '.',
      ),
    ),
    h(
      'div',
      { class: 'card all-installers' },
      h('h3', {}, 'What you’ll be able to download'),
      h('ul', { class: 'formats' }, ...formats),
    ),
  ]
}

function renderHero(release: Release, d: Detected): void {
  const actions = document.getElementById('hero-download')
  const meta = document.getElementById('hero-meta')
  if (!actions || !meta) return
  const primary = release.installers.find((i) => i.id === primaryAsset(d))
  if (release.available && primary) {
    actions.replaceChildren(
      downloadLink(primary, primary.label, 'btn btn-primary btn-lg'),
      h('a', { href: '#download', class: 'btn btn-ghost btn-lg' }, 'Other systems'),
    )
    meta.textContent = `Version ${release.version}. Free. No account, no telemetry.`
  } else if (!release.available) {
    meta.textContent = 'Downloads coming soon for macOS and Windows. No account, no telemetry.'
  }
}

// ---------------------------------------------------------------- "Thanks for downloading" dialog

function openThanks(inst: Installer): void {
  const dialog = document.querySelector<HTMLDialogElement>('#thanks')
  const body = document.getElementById('thanks-body')
  if (!dialog || !body) return
  const g = installGuide(inst.id, inst.file)
  body.replaceChildren(
    h(
      'p',
      { class: 'dialog-lede' },
      'Your download of ',
      h('code', {}, inst.file),
      ' should have started. If it didn’t, ',
      h('a', { href: inst.url, download: inst.file }, 'download it again'),
      '.',
    ),
    h('h3', {}, g.heading),
    h('ol', { class: 'install-steps' }, ...g.install.map((s) => h('li', {}, renderRich(s)))),
    h(
      'div',
      { class: 'callout' },
      h('h4', {}, g.unsignedTitle),
      h('ul', {}, ...g.unsigned.map((s) => h('li', {}, renderRich(s)))),
    ),
    h('p', { class: 'small' }, renderRich(g.work)),
    h('p', {}, renderRich(g.after)),
  )
  dialog.dataset.asset = inst.id
  if (!dialog.open) dialog.showModal()
}

function initDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#thanks')
  if (!dialog) return
  dialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    // A click on the backdrop lands on the <dialog> itself.
    if (target === dialog || target.closest('[data-close]')) dialog.close()
  })
}

function initDownloads(release: Release, d: Detected): void {
  document.documentElement.dataset.os = d.os
  const root = document.getElementById('download-root')
  if (root) root.replaceChildren(...(release.available ? renderAvailable(release, d) : renderSoon(release)))
  renderHero(release, d)

  // One listener for every download link: the browser's own download starts (we don't cancel the
  // click), and the dialog explains what to do next.
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-asset]')
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey)
      return
    const inst = release.installers.find((i) => i.id === link.dataset.asset)
    if (inst) openThanks(inst)
  })
}

async function init(): Promise<void> {
  initTheme()
  initTour()
  initDialog()
  const [detected, release] = await Promise.all([
    detect(navigator as unknown as NavigatorLike),
    loadRelease(),
  ])
  initDownloads(release, detected)
}

void init()
