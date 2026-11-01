/**
 * The Downloads page's parts: a card per platform (the visitor's own, or the one they picked on
 * the home page, first), the table of every installer, the "All versions" list and the
 * "Thanks for downloading" dialog with install steps. Every installer link is a plain link to
 * GitHub with `download`, so the browser's own download starts on click.
 */
import { REPO_URL } from './config'
import { describe, primaryAsset, type Detected } from './detect'
import { formatSize, type Installer, type Release, type Version } from './downloads'
import { installGuide } from './steps'
import { h, logo, renderRich, type Platform } from './ui'

function downloadLink(inst: Installer, text: string, className = ''): HTMLElement {
  return h(
    'a',
    { href: inst.url, download: inst.file, 'data-asset': inst.id, class: className },
    text,
  )
}

export function kind(inst: Installer): string {
  if (inst.id.startsWith('mac')) return 'Disk image (.dmg)'
  return inst.id === 'win-setup' ? 'Installer (.exe)' : 'Portable app (.exe)'
}

function installerTable(installers: Installer[], labelledBy: string): HTMLElement {
  const rows = installers.map((inst) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, inst.system, h('span', { class: 'cell-note' }, inst.note)),
      h('td', {}, h('code', { class: 'file' }, inst.file)),
      h('td', { class: 'num' }, formatSize(inst.size) || '—'),
      h(
        'td',
        {},
        // Screen readers hear which file each "Download" link belongs to.
        h(
          'a',
          {
            href: inst.url,
            download: inst.file,
            'data-asset': inst.id,
            class: 'btn btn-secondary btn-sm',
          },
          'Download',
          h('span', { class: 'visually-hidden' }, ` ${inst.system}`),
        ),
      ),
    ),
  )
  return h(
    'div',
    { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-labelledby': labelledBy },
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

function platformCard(
  release: Release,
  platform: Platform,
  primaryId: string,
  tag: string | null,
): HTMLElement | null {
  const inst = release.installers.find((i) => i.id === primaryId)
  if (!inst) return null
  const size = formatSize(inst.size)
  const card = h(
    'div',
    { class: `card platform${tag ? ' is-recommended' : ''}`, id: platform },
    h(
      'div',
      { class: 'platform-head' },
      logo(platform),
      h('h2', {}, platform === 'mac' ? 'macOS' : 'Windows'),
      tag ? h('span', { class: 'tag' }, tag) : null,
    ),
    h(
      'p',
      { class: 'platform-sys' },
      platform === 'mac' ? 'macOS 12 or later, Apple silicon or Intel' : 'Windows 10 or 11, 64-bit',
    ),
    downloadLink(inst, inst.label, tag ? 'btn btn-primary btn-lg' : 'btn btn-outline'),
    h(
      'p',
      { class: 'download-meta' },
      `Version ${release.version}, ${kind(inst).toLowerCase()}${size ? `, ${size}` : ''}.`,
    ),
  )
  const alt = alternative(release, inst.id)
  if (alt) card.append(alt)
  return card
}

/**
 * The platform shown first: the one picked on the home page (`#mac` / `#windows`), else the
 * visitor's own. Its card is highlighted ("For this computer", or "You picked this" when it
 * isn't the system we detected).
 */
export function renderLatest(
  release: Release,
  d: Detected,
  picked: Platform | null,
): HTMLElement[] {
  const own: Platform | null = d.os === 'mac' || d.os === 'windows' ? d.os : null
  const first = picked ?? own
  const tagFor = (p: Platform) =>
    p !== first ? null : p === own ? 'For this computer' : 'You picked this'
  const macId = primaryAsset(d) === 'mac-x64' ? 'mac-x64' : 'mac-arm64'
  const cards = [
    platformCard(release, 'mac', macId, tagFor('mac')),
    platformCard(release, 'windows', 'win-setup', tagFor('windows')),
  ].filter((c): c is HTMLElement => c !== null)
  if (first === 'windows') cards.reverse()
  return [
    h('p', { class: 'detected' }, describe(d)),
    h('div', { class: 'platforms' }, ...cards),
    // Every file of this version (and the earlier ones) is in "All versions" below.
    h(
      'p',
      { class: 'small' },
      'Intel or Apple silicon, installer or portable, checksums and earlier versions: ',
      h('a', { href: '#versions' }, `all installers for ${release.version}`),
      '.',
    ),
  ]
}

export function renderSoon(release: Release): HTMLElement[] {
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

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "All versions": each published release, newest first, with its own files and notes. */
export function renderVersions(versions: Version[]): HTMLElement[] {
  if (versions.length === 0)
    return [
      h(
        'p',
        { class: 'small' },
        'No version has been published yet. Every release will be listed here.',
      ),
    ]
  return versions.map((v) => {
    const id = `v-${v.version.replace(/[^\w-]/g, '-')}`
    const date = formatDate(v.date)
    return h(
      'article',
      { class: 'card version', 'aria-labelledby': id },
      h(
        'div',
        { class: 'version-head' },
        h('h3', { id }, `DevDock ${v.version}`),
        v.latest ? h('span', { class: 'tag' }, 'Latest') : null,
        date ? h('time', { datetime: v.date ?? '', class: 'version-date' }, date) : null,
      ),
      installerTable(v.installers, id),
      h(
        'p',
        { class: 'small version-links' },
        h('a', { href: v.notesUrl }, `Release notes for ${v.version}`),
        v.checksumsUrl ? ' · ' : null,
        v.checksumsUrl
          ? h('a', { href: v.checksumsUrl }, `SHA-256 checksums for ${v.version}`)
          : null,
      ),
    )
  })
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

/**
 * One listener for every installer link on the page: the browser's own download starts (the
 * click isn't cancelled) and the dialog explains what to do next.
 */
export function initDownloadDialog(installers: Installer[]): void {
  const dialog = document.querySelector<HTMLDialogElement>('#thanks')
  if (!dialog) return
  dialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    // A click on the backdrop lands on the <dialog> itself.
    if (target === dialog || target.closest('[data-close]')) dialog.close()
  })
  const byUrl = new Map(installers.map((i) => [i.url, i]))
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-asset]')
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey)
      return
    const inst = byUrl.get(link.getAttribute('href') ?? '')
    if (inst) openThanks(inst)
  })
}
