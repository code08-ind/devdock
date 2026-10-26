import { readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  callHook,
  expect,
  filesUnder,
  launch,
  newProfile,
  openSettings,
  test,
  windowFor,
  type Launched,
} from './fixtures'

const NAV = [
  ['Home', 'home'],
  ['Today', 'today'],
  ['Repos', 'repos'],
  ['Pull requests', 'prs'],
  ['Builds', 'builds'],
  ['Tickets', 'tickets'],
  ['Utilities', 'utilities'],
  ['Terminal', 'terminal'],
  ['Settings', 'settings'],
] as const

test('opens on Home; every tile opens its feature', async ({ launched }) => {
  const { win, errors } = launched
  await expect(win.locator('main')).toHaveAttribute('data-view', 'home')
  const tiles = win.locator('.home-tile')
  await expect(tiles).toHaveCount(14)
  const go = async (name: string) => {
    await win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Home' })
      .click()
    await win
      .locator('main')
      .getByRole('button', { name: new RegExp(`^${name}\\b`) })
      .click()
  }
  for (const [name, view] of [
    ['Today', 'today'],
    ['Repos', 'repos'],
    ['Pull requests', 'prs'],
    ['Builds', 'builds'],
    ['Tickets', 'tickets'],
    ['Terminal', 'terminal'],
    ['Settings', 'settings'],
  ] as const) {
    await go(name)
    await expect(win.locator('main')).toHaveAttribute('data-view', view)
  }
  for (const [name, tab] of [
    ['Ports', 'Ports'],
    ['Clean caches', 'Clean caches'],
    ['Env profiles', 'Env profiles'],
    ['Quick links', 'Quick links'],
    ['Standup', 'Standup'],
    ['Agent lessons', 'Lessons'],
  ] as const) {
    await go(name)
    await expect(win.locator('main')).toHaveAttribute('data-view', 'utilities')
    await expect(win.getByRole('radio', { name: tab })).toBeChecked()
  }
  await go('Command palette')
  await expect(win.getByTestId('command-palette')).toBeVisible()
  expect(errors).toEqual([])
})

test('opens each nav item', async ({ launched }) => {
  const { win, errors } = launched
  const nav = win.getByRole('navigation', { name: 'Main' })
  for (const [label, view] of NAV) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await expect(win.locator('main')).toHaveAttribute('data-view', view)
    await expect(win.getByRole('heading', { level: 1 })).toHaveText(
      // Home's heading is its welcome line.
      view === 'home' ? /^Welcome to DevDock/ : label,
    )
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  expect(errors).toEqual([])
})

/** Body background as rendered, and the theme's --bg token, as comparable rgb() strings. */
const backgrounds = (win: Page) =>
  win.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg')
    document.body.append(probe)
    const token = getComputedStyle(probe).color
    probe.remove()
    return { body: getComputedStyle(document.body).backgroundColor, token }
  })

test('theme, font size and density apply live and persist across restarts', async () => {
  const profile = newProfile()
  let current: Launched | null = null
  try {
    current = await launch(profile)
    const { win } = current
    await openSettings(win)
    const light = await backgrounds(win)

    await win.getByText('Dark', { exact: true }).click()
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await backgrounds(win)
    expect(dark.body).toBe(dark.token)
    expect(dark.body).not.toBe(light.body)

    await win.getByLabel('Font size').selectOption('18')
    await expect(win.locator('html')).toHaveAttribute('data-font-size', '18')
    expect(await win.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('18px')

    await win.getByText('Compact', { exact: true }).click()
    await expect(win.locator('html')).toHaveAttribute('data-density', 'compact')
    await current.app.close()
    current = null

    current = await launch(profile)
    const html = current.win.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-font-size', '18')
    await expect(html).toHaveAttribute('data-density', 'compact')
  } finally {
    await current?.app.close()
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('Cmd/Ctrl+K palette searches and runs a command', async ({ launched }) => {
  const { win } = launched
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  const palette = win.getByTestId('command-palette')
  await expect(palette).toBeVisible()
  await win.keyboard.type('jenkins')
  // "Go to Builds" first; the pipeline watch (P4-C) matches the keyword too.
  await expect(palette.getByRole('option')).toHaveCount(2)
  await expect(palette.getByRole('option').first()).toContainText('Go to Builds')
  await win.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(win.locator('main')).toHaveAttribute('data-view', 'builds')
})

// Global shortcuts can't be pressed from Playwright (the OS owns them), so this opens the
// palette window through the IPC test hook the shortcut itself calls (DEVDOCK_E2E only).
test('global shortcut is registered and its palette window opens (via test hook)', async ({
  launched,
}) => {
  const { app } = launched
  const status = await callHook(app, 'shortcutStatus')
  expect(status.accelerator).toBe('CommandOrControl+Shift+Space')
  // Hosted CI runners may refuse global shortcuts (no interactive session); locally it must work.
  if (!process.env.CI) expect(status, status.reason).toMatchObject({ ok: true })

  await callHook(app, 'togglePalette')
  expect(await callHook(app, 'isPaletteVisible')).toBe(true)
  const pw = await windowFor(app, 'palette.html')
  await expect(pw.getByTestId('command-palette')).toBeVisible()
  await expect(pw.getByRole('combobox', { name: 'Command' })).toBeFocused()
})

test('a secret saved in Settings is encrypted on disk', async ({ launched }) => {
  const { win, userData } = launched
  const secret = 'ATATT3x-e2e-secret-value-9f8e7d'
  await openSettings(win)
  const input = win.getByRole('textbox', { name: 'Jira API token' })
  // Inputs stay disabled until the encryption status has loaded.
  await expect(input).toBeEnabled()
  await input.fill(secret)
  await win
    .locator('.secret-row', { has: input })
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  await expect(win.getByText('Jira API token or personal access token saved')).toBeVisible()

  const keys = await win.evaluate(() => window.devdock.secrets.list())
  expect(keys).toEqual({ ok: true, data: ['jira.token'] })
  // Close first: Windows locks Chromium's cache files while the app runs.
  await launched.app.close()

  // The store really wrote something...
  const secretsFile = join(userData, 'secrets.bin')
  expect(statSync(secretsFile).size).toBeGreaterThan(0)
  // ...and no file anywhere in the profile (incl. Chromium storage and logs) has the plain value.
  const needle = Buffer.from(secret)
  const files = filesUnder(userData)
  expect(files).toContain(secretsFile)
  for (const file of files) expect(readFileSync(file).includes(needle), file).toBe(false)
})

test('the window never scrolls: only the content pane does, on every view (18px)', async ({
  launched,
}) => {
  const { win } = launched
  // Large text makes every view taller than the window.
  await win.evaluate(() => window.devdock.settings.update({ appearance: { fontSize: 18 } }))
  const nav = win.getByRole('navigation', { name: 'Main' })
  for (const [label] of NAV) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await win.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight))
    const layout = await win.evaluate(() => {
      const rail = document.querySelector('nav[aria-label="Main"]')!.getBoundingClientRect()
      const page = document.scrollingElement!
      return {
        pageScrolls: page.scrollHeight > page.clientHeight + 1,
        railTop: Math.round(rail.top),
        railFillsHeight: Math.abs(rail.height - window.innerHeight) <= 1,
      }
    })
    expect(layout, label).toEqual({ pageScrolls: false, railTop: 0, railFillsHeight: true })
  }
})
