import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, newProfile, test, windowFor } from './fixtures'

/**
 * Website demo clips: the real app in demo mode, recorded while a feature is used. One launch per
 * clip (one video file each); `marks.json` says where each clip's action starts, so the encoder
 * trims the start-up. Opt-in: `DEVDOCK_DEMOS_DIR=<folder> npx playwright test demos`, then
 * `sh website/scripts/demos.sh <folder>`.
 */
const out = process.env.DEVDOCK_DEMOS_DIR
test.skip(!out, 'set DEVDOCK_DEMOS_DIR to record the website demo clips')
test.setTimeout(180_000)

const root = join(import.meta.dirname, '../..')
const SIZE = { width: 1240, height: 820 }
const marks: Record<string, number> = {}
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())
test.afterAll(() => {
  if (out) writeFileSync(join(out, 'marks.json'), JSON.stringify(marks, null, 2))
})

/**
 * Records one clip. `body` returns the window to keep (default: the main window); every window
 * is recorded, so the kept one is saved as `<dir>/<name>.webm` and the others are removed.
 */
async function record(
  name: string,
  env: Record<string, string>,
  body: (app: ElectronApplication, win: Page) => Promise<Page | void>,
  size = SIZE,
) {
  const dir = join(out!, name)
  mkdirSync(dir, { recursive: true })
  const userData = newProfile()
  const app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DEVDOCK_E2E: '1', DEVDOCK_USER_DATA: userData, ...env },
    recordVideo: { dir, size },
  })
  try {
    const win = await windowFor(app, 'index.html')
    await win.locator('nav[aria-label="Main"]').waitFor()
    await win.evaluate(() => window.devdock.settings.update({ appearance: { theme: 'light' } }))
    const kept = (await body(app, win)) ?? win
    const video = kept.video()
    marks[name] ??= 0
    await app.close().catch(() => undefined)
    if (video) await video.saveAs(join(dir, `${name}.webm`))
  } finally {
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
    // Only the kept window's clip stays.
    for (const f of readdirSync(dir)) if (f !== `${name}.webm`) rmSync(join(dir, f))
  }
}

/** Marks the start of the part worth showing (seconds into the video). */
const markStart = (name: string, since: number) => (marks[name] = (Date.now() - since) / 1000)
/** Marks the still used as the poster (default: the last frame). */
const markPoster = (name: string, since: number) =>
  (marks[`${name}:poster`] = (Date.now() - since) / 1000)
const pause = (win: Page, ms: number) => win.waitForTimeout(ms)
const nav = (win: Page, label: string) =>
  win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click()
const slowType = (win: Page, text: string) => win.keyboard.type(text, { delay: 90 })

test('demo: command palette', async () => {
  repos = makeRepos()
  const clip = repos.clone
  const t0 = Date.now()
  await record('palette', {}, async (_app, win) => {
    await win.evaluate((p) => window.devdock.repos.add({ path: p }), clip)
    await nav(win, 'Today')
    await pause(win, 800)
    markStart('palette', t0)
    await pause(win, 700)
    await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+K`)
    await pause(win, 500)
    await slowType(win, 'watch')
    await pause(win, 1200)
    await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
    await slowType(win, 'start work')
    await pause(win, 1200)
    await win.keyboard.press('ArrowDown')
    await pause(win, 500)
    await win.keyboard.press('ArrowDown')
    await pause(win, 500)
    await win.keyboard.press('Enter')
    await expect(win.getByRole('dialog', { name: /^Start work on DD-/ })).toBeVisible()
    await pause(win, 2500)
  })
})

test('demo: menu-bar panel', async () => {
  repos = makeRepos()
  const clip = repos.clone
  await record(
    'panel',
    {},
    async (app, win) => {
      await win.evaluate((p) => window.devdock.repos.add({ path: p }), clip)
      await callHook(app, 'togglePanel')
      const panel = await windowFor(app, 'panel.html')
      // Its video starts with its window, not with the app.
      const tPanel = Date.now()
      await panel.getByRole('list', { name: 'My pull requests' }).waitFor()
      markStart('panel', tPanel)
      await pause(panel, 1500)
      for (const tab of ['Repos', 'Tickets', 'Tools', 'Today']) {
        await panel.getByText(tab, { exact: true }).click()
        await pause(panel, 1600)
      }
      return panel
    },
    { width: 400, height: 600 },
  )
})

test('demo: start work and the agent', async () => {
  // A stand-in `claude` on PATH so Start work offers it; it only waits (no made-up output).
  const bin = mkdtempSync(join(tmpdir(), 'devdock-demo-bin-'))
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec sleep 60\n')
  chmodSync(join(bin, 'claude'), 0o755)
  repos = makeRepos()
  const clip = repos.clone
  const t0 = Date.now()
  try {
    await record('start-work', { PATH: `${bin}:${process.env.PATH}` }, async (app, win) => {
      const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
      try {
        await win.evaluate((p) => window.devdock.repos.add({ path: p }), clip)
        await nav(win, 'Tickets')
        await win.getByRole('button', { name: /^DD-101\b/ }).waitFor()
        markStart('start-work', t0)
        await pause(win, 800)
        await win.getByRole('button', { name: /^DD-101\b/ }).click()
        await pause(win, 1200)
        await win
          .getByRole('complementary', { name: 'DD-101 details' })
          .getByRole('button', { name: 'Start work…' })
          .click()
        const dialog = win.getByRole('dialog', { name: 'Start work on DD-101' })
        await dialog
          .getByRole('checkbox', { name: 'Open the repo in VS Code afterwards' })
          .uncheck()
        await pause(win, 2000)
        await dialog.getByRole('button', { name: 'Start work', exact: true }).click()
        await expect(dialog.getByRole('status')).toContainText('Started work on')
        await pause(win, 1000)
        markPoster('start-work', t0)
        await pause(win, 1000)
        await dialog.getByRole('button', { name: 'Start Claude Code now' }).click()
        await expect(win.locator('main[data-view="terminal"]')).toBeVisible()
        await pause(win, 2500)
      } finally {
        await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboard)
      }
    })
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('demo: repos and builds', async () => {
  repos = makeRepos()
  const r = repos
  r.git(r.clone, 'checkout', '-q', '-b', 'feature/DD-102-checkout-summary-card')
  r.commit(r.clone, 'check.mjs', "console.log('✓ 24 tests passed')\n")
  const t0 = Date.now()
  await record('repos-builds', { DEVDOCK_DEMO_SPEED: '8' }, async (app, win) => {
    const added = await win.evaluate((p) => window.devdock.repos.add({ path: p }), r.clone)
    if (!added.ok) throw new Error(added.error.message)
    await win.evaluate(
      (id) => window.devdock.repos.update({ id, patch: { checkCommand: 'node check.mjs' } }),
      added.data.id,
    )
    await win.evaluate(() =>
      window.devdock.settings.update({ workflow: { checkBeforePush: true } }),
    )
    await nav(win, 'Repos')
    await win.getByRole('article', { name: 'clone' }).waitFor()
    markStart('repos-builds', t0)
    await pause(win, 1200)
    await win
      .getByRole('article', { name: 'clone' })
      .getByRole('button', { name: 'Push branch' })
      .click()
    const dialog = win.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: /^Run the check first/ }).waitFor()
    await pause(win, 1800)
    await dialog.getByRole('button', { name: 'Push branch', exact: true }).click()
    await expect(dialog.getByText(/passed\./)).toBeVisible({ timeout: 20_000 })
    await pause(win, 1800)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await nav(win, 'Builds')
    await pause(win, 800)
    await win
      .getByLabel("Watch a pull request's pipeline")
      .fill(
        'https://demo.devdock.invalid/bitbucket/projects/DEMO/repos/design-system/pull-requests/88',
      )
    await pause(win, 600)
    await win.getByRole('button', { name: 'Watch pipeline' }).click()
    const watched = win.getByRole('list', { name: 'Watched builds' })
    await expect(watched).toContainText('Running')
    await expect
      .poll(
        async () => {
          await callHook(app, 'pollBuilds')
          return watched.innerText()
        },
        { timeout: 40_000, intervals: [1_000] },
      )
      .toContain('Passed')
    await pause(win, 2500)
  })
})

test('demo: AI PR summary', async () => {
  const t0 = Date.now()
  await record('ai-summary', {}, async (_app, win) => {
    await nav(win, 'Pull requests')
    const button = win.getByRole('button', { name: 'Summarise web-app #412 with Claude' })
    await button.waitFor()
    markStart('ai-summary', t0)
    await pause(win, 1000)
    await button.click()
    const dialog = win.getByRole('dialog', { name: 'Summarise this pull request' })
    await dialog.getByRole('button', { name: 'Send to Claude' }).waitFor()
    await pause(win, 1200)
    await dialog
      .locator('.code-body')
      .first()
      .evaluate((el) => el.scrollTo({ top: 400, behavior: 'smooth' }))
    await pause(win, 1800)
    await dialog.getByRole('button', { name: 'Send to Claude' }).click()
    await expect(dialog.getByRole('status')).toContainText('Demo answer')
    await pause(win, 3500)
  })
})

test('demo: terminal', async () => {
  test.skip(process.platform === 'win32', 'zsh prompt (macOS)')
  repos = makeRepos()
  const r = repos
  // An empty home: no one's dotfiles; the DevDock prompt shows the git branch.
  const home = mkdtempSync(join(tmpdir(), 'devdock-demo-home-'))
  const t0 = Date.now()
  try {
    await record('terminal', { HOME: home, ZDOTDIR: '' }, async (_app, win) => {
      await win.evaluate((p) => window.devdock.repos.add({ path: p }), r.clone)
      await win.evaluate(() =>
        window.devdock.settings.update({
          appearance: { theme: 'dark' },
          terminal: { shell: '/bin/zsh', devdockPrompt: true },
        }),
      )
      await nav(win, 'Repos')
      await win
        .getByRole('article', { name: 'clone' })
        .getByRole('button', { name: 'Open in DevDock terminal' })
        .click()
      const screen = win.locator('.terminal-screen:not([hidden]) .xterm')
      await expect(screen).toBeVisible()
      await pause(win, 1200)
      markStart('terminal', t0)
      await screen.click()
      for (const line of [
        'git switch -c feature/DD-103-faster-search',
        'echo "export const ok = true" > search.ts',
        'git status -sb',
        'git add . && git commit -qm "DD-103: faster search"',
        'git --no-pager log --oneline -2',
      ]) {
        await slowType(win, line)
        await win.keyboard.press('Enter')
        await pause(win, 900)
      }
      await pause(win, 2000)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
