import './style.css'
import { DOWNLOADS_PAGE } from './config'
import { detect, type Detected, type NavigatorLike } from './detect'
import { loadRelease, type Release } from './downloads'
import { h, initTheme, logo, type Platform } from './ui'

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

// ---------------------------------------------------------------- demo clips

/**
 * The feature clips play (muted, looping) only while on screen and in the open tab, and only
 * fetch when they first play (`preload="none"`). Each has a visible Play / Pause button (WCAG
 * 2.2.2 for motion over five seconds); with reduced motion they wait for Play.
 */
function initDemos(): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-demo]')) {
    const button = video.parentElement?.querySelector<HTMLButtonElement>('.demo-toggle')
    if (!button) continue
    const name = video.getAttribute('aria-label')?.replace(/^Demo: /, '') ?? 'demo'
    let userPaused = false
    let userPlayed = false
    let visible = false
    const show = () => {
      const playing = !video.paused
      button.textContent = playing ? 'Pause' : 'Play'
      button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} the clip: ${name}`)
    }
    const update = () => {
      const wanted = visible && !userPaused && (!reduce.matches || userPlayed)
      if (wanted && video.paused) void video.play().catch(() => undefined)
      if (!wanted && !video.paused) video.pause()
    }
    button.hidden = false
    button.addEventListener('click', () => {
      if (video.paused) {
        userPaused = false
        userPlayed = true
        void video.play().catch(() => undefined)
      } else {
        userPaused = true
        video.pause()
      }
    })
    video.addEventListener('play', show)
    video.addEventListener('pause', show)
    // A hidden tab panel has no box: it leaves the viewport, and the clip pauses.
    new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting)
        update()
      },
      { threshold: 0.35 },
    ).observe(video)
    reduce.addEventListener('change', update)
    show()
  }
}

// ---------------------------------------------------------------- download buttons

/**
 * The home page links to the Downloads page; each button names its platform there
 * (`downloads#mac`, `downloads#windows`), which shows that platform first. The visitor's own
 * system is the solid button.
 */
function platformButton(platform: Platform, solid: boolean, size = ''): HTMLElement {
  const text = platform === 'mac' ? 'Download for Mac' : 'Download for Windows'
  return h(
    'a',
    {
      href: `${DOWNLOADS_PAGE}#${platform}`,
      class: `btn btn-platform ${solid ? 'btn-primary' : 'btn-outline'}${size}`,
      'data-platform': platform,
    },
    logo(platform),
    h('span', {}, text),
  )
}

function buttons(d: Detected, size = ''): HTMLElement[] {
  const mac = platformButton('mac', d.os !== 'windows', size)
  const win = platformButton('windows', d.os === 'windows', size)
  return d.os === 'windows' ? [win, mac] : [mac, win]
}

function initDownloads(release: Release, d: Detected): void {
  document.documentElement.dataset.os = d.os
  document.getElementById('hero-download')?.replaceChildren(...buttons(d))
  const meta = release.available
    ? `Version ${release.version}, free for macOS and Windows. No account, no telemetry.`
    : 'Downloads coming soon for macOS and Windows. No account, no telemetry.'
  const heroMeta = document.getElementById('hero-meta')
  if (heroMeta) heroMeta.textContent = meta
  document
    .getElementById('download-root')
    ?.replaceChildren(
      h(
        'div',
        { class: 'card download-primary download-cta' },
        h('div', { class: 'hero-actions' }, ...buttons(d)),
        h(
          'p',
          { class: 'download-meta' },
          release.available
            ? `DevDock ${release.version}. The Downloads page has every installer (Apple silicon, Intel, Windows installer and portable), install steps and all earlier versions.`
            : 'The first release is being prepared; the Downloads page will have every installer.',
        ),
        h('p', {}, h('a', { href: DOWNLOADS_PAGE }, 'All installers and versions')),
      ),
    )
}

async function init(): Promise<void> {
  initTheme()
  initTour()
  initDemos()
  const [detected, release] = await Promise.all([
    detect(navigator as unknown as NavigatorLike),
    loadRelease(),
  ])
  initDownloads(release, detected)
}

void init()
