import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepos } from '../fixtures/git-repos'
import { callHook, expect, launch, test, windowFor } from './fixtures'

/**
 * P0.25: Today in Light and Dark, written to docs/screenshots/ (demo mode, default window).
 * Opt-in (`npm run screenshots`) so ordinary e2e runs don't rewrite tracked images.
 */
const out = join(import.meta.dirname, '../../docs/screenshots')

test.skip(!process.env.DEVDOCK_SCREENSHOTS, 'run with npm run screenshots')

test('screenshots: Today in Light and Dark', async ({ launched }) => {
  const { win } = launched
  mkdirSync(out, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((t) => window.devdock.settings.update({ appearance: { theme: t } }), theme)
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme)
    await win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Today' })
      .click()
    await expect(win.locator('main')).toHaveAttribute('data-view', 'today')
    await win.screenshot({ path: join(out, `today-${theme}.png`), animations: 'disabled' })
  }
})

let repos: ReturnType<typeof makeRepos> | undefined
test.afterEach(() => repos?.cleanup())

/** P6.07: the README's feature screenshots, in demo mode (Light, the default window size). */
test('screenshots: README features', async ({ launched }) => {
  const { app, win } = launched
  mkdirSync(out, { recursive: true })
  await win.evaluate(() => window.devdock.settings.update({ appearance: { theme: 'light' } }))
  const nav = (label: string) =>
    win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: label, exact: true })
      .click()
  const shot = (name: string) =>
    win.screenshot({ path: join(out, `readme-${name}.png`), animations: 'disabled' })

  await nav('Home')
  await shot('home')
  // A real (temporary) repo, for Repos and Lessons; removed after the test.
  repos = makeRepos()
  await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)
  await nav('Repos')
  await expect(win.getByText('develop', { exact: true }).first()).toBeVisible()
  await shot('repos')
  await nav('Pull requests')
  await expect(win.getByRole('list', { name: 'My PRs' })).toBeVisible()
  await shot('prs')
  await nav('Builds')
  await expect(win.getByRole('list', { name: 'My branches' })).toBeVisible()
  await shot('builds')
  await nav('Tickets')
  await win.getByRole('button', { name: /^DD-102\b/ }).click()
  await shot('tickets')
  await nav('Utilities')
  await win.locator('label.segment', { hasText: 'Lessons' }).click()
  const collect = win.getByRole('button', { name: 'Collect review comments' })
  if (await collect.isVisible()) await collect.click()
  await expect(win.getByRole('list', { name: 'Lessons to pick' })).toBeVisible()
  await shot('lessons')
  await nav('Settings')
  await win.getByRole('region', { name: 'Diagnostics' }).scrollIntoViewIfNeeded()
  await shot('diagnostics')
  await nav('Today')
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await win.keyboard.type('start work')
  await expect(win.getByRole('option').first()).toContainText('Start work on DD-')
  await shot('palette')
  await win.keyboard.press('Escape')

  await callHook(app, 'togglePanel')
  const panel = await windowFor(app, 'panel.html')
  await expect(panel.getByRole('list', { name: 'My pull requests' })).toBeVisible()
  await panel.screenshot({ path: join(out, 'readme-panel.png'), animations: 'disabled' })
})

/** P7-A: the terminal in Dark with the DevDock prompt in a repo (an empty home: no one's rc files). */
test('screenshots: README terminal', async () => {
  test.skip(process.platform === 'win32', 'zsh prompt (macOS)')
  const home = mkdtempSync(join(tmpdir(), 'devdock-home-'))
  const { app, win, userData } = await launch(undefined, { HOME: home, ZDOTDIR: '' })
  try {
    mkdirSync(out, { recursive: true })
    repos = makeRepos()
    await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)
    await win.evaluate(() =>
      window.devdock.settings.update({
        appearance: { theme: 'dark' },
        terminal: { shell: '/bin/zsh', devdockPrompt: true },
      }),
    )
    await win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Repos' })
      .click()
    await win
      .getByRole('article', { name: 'clone' })
      .getByRole('button', { name: 'Open in DevDock terminal' })
      .click()
    const screen = win.locator('.terminal-screen:not([hidden]) .xterm')
    await expect(screen).toBeVisible()
    await win.waitForTimeout(1000)
    await screen.click()
    for (const line of [
      'git log --oneline -3',
      'echo "export const ok = true" > ok.ts',
      'git status -sb',
      'ls -G',
    ]) {
      await win.keyboard.type(line)
      await win.keyboard.press('Enter')
      await win.waitForTimeout(300)
    }
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(out, 'readme-terminal.png'), animations: 'disabled' })
  } finally {
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
