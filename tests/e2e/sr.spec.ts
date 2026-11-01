import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, test, windowFor } from './fixtures'

/**
 * T12 (automated half of the screen-reader pass): what VoiceOver / NVDA would be given on every
 * screen, dialog, the palette and the menu-bar panel — the accessibility tree as Playwright's
 * aria snapshot — plus where focus lands when a dialog opens and after it closes. Written to
 * files for review. Opt-in: `DEVDOCK_SR_DIR=<folder> npx playwright test sr`.
 */
const out = process.env.DEVDOCK_SR_DIR
test.skip(!out, 'set DEVDOCK_SR_DIR to write the accessibility-tree review')
test.setTimeout(300_000)

let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

const nav = (win: Page, label: string) =>
  win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click()
const tab = (win: Page, label: string) =>
  win.locator('label.segment', { hasText: label }).first().click()

/** What has focus, as a screen reader would name it. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return '(nothing: body)'
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
    const name =
      el.getAttribute('aria-label') ??
      (el as HTMLInputElement).labels?.[0]?.textContent ??
      el.textContent ??
      ''
    return `${role} "${name.trim().replace(/\s+/g, ' ').slice(0, 80)}"`
  })

test('screen-reader review: accessibility trees and focus', async ({ launched }) => {
  const { app, win } = launched
  mkdirSync(out!, { recursive: true })
  const notes: string[] = []
  const save = async (name: string, page: Page = win, scope = 'body') => {
    const tree = await page.locator(scope).first().ariaSnapshot()
    writeFileSync(join(out!, `${name}.yml`), tree)
  }
  const note = async (what: string, page: Page = win) =>
    notes.push(`${what}: ${await focused(page)}`)

  repos = makeRepos()
  repos.git(repos.clone, 'checkout', '-q', '-b', 'feature/sr')
  const added = await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)
  if (!added.ok) throw new Error(added.error.message)
  await win.evaluate(
    (id) => window.devdock.repos.update({ id, patch: { checkCommand: 'npm test' } }),
    added.data.id,
  )
  await win.evaluate(() =>
    window.devdock.settings.update({
      github: { enabled: true },
      gitlab: { enabled: true },
      features: {
        jobTriggers: true,
        prActions: true,
        ciActions: true,
        allowedJobs: ['web-app/PR-412'],
      },
      workflow: { checkBeforePush: true, watchBuildAfterPush: true, moveTicketOnPr: true },
    }),
  )
  await callHook(app, 'pollTicketMoves')
  await callHook(app, 'forgetSeenPrs')
  await callHook(app, 'pollTicketMoves')

  // Views and their tabs.
  const views: [string, () => Promise<void>][] = [
    ['home', () => nav(win, 'Home')],
    ['today', () => nav(win, 'Today')],
    ['repos', () => nav(win, 'Repos')],
    ['prs-mine', () => nav(win, 'Pull requests')],
    ['prs-reviewing', async () => (await nav(win, 'Pull requests'), tab(win, 'Reviewing'))],
    ['builds-mine', async () => (await nav(win, 'Builds'), tab(win, 'My branches'))],
    ['builds-github', async () => (await nav(win, 'Builds'), tab(win, 'GitHub Actions'))],
    ['tickets', () => nav(win, 'Tickets')],
    [
      'tickets-detail',
      async () => (
        await nav(win, 'Tickets'),
        win.getByRole('button', { name: /^DD-101\b/ }).click()
      ),
    ],
    ['util-ports', async () => (await nav(win, 'Utilities'), tab(win, 'Ports'))],
    ['util-standup', async () => (await nav(win, 'Utilities'), tab(win, 'Standup'))],
    ['terminal', async () => (await nav(win, 'Terminal'), win.waitForTimeout(1000))],
    ['settings', () => nav(win, 'Settings')],
  ]
  for (const [name, go] of views) {
    await go()
    await win.waitForTimeout(400)
    await note(`view ${name} (after switching)`)
    await save(name, win, 'main')
  }
  await save('rail', win, 'nav[aria-label="Main"]')

  // Dialogs: focus when opened, the tree, focus after Escape.
  const dialogs: [string, () => Promise<void>][] = [
    [
      'dialog-push',
      async () => {
        await nav(win, 'Repos')
        await win
          .getByRole('article', { name: 'clone' })
          .getByRole('button', { name: 'Push branch' })
          .click()
        await win.getByRole('checkbox', { name: /^Run the check first/ }).waitFor()
      },
    ],
    [
      'dialog-ai-summary',
      async () => {
        await nav(win, 'Pull requests')
        await win.getByRole('button', { name: /^Summarise web-app #412 with Claude$/ }).click()
        await win.getByRole('button', { name: 'Send to Claude' }).waitFor()
      },
    ],
    [
      'dialog-move-ticket',
      async () => {
        await nav(win, 'Today')
        await win
          .getByRole('button', { name: /^Move DD-\d+ to In Review…$/ })
          .first()
          .click()
        await win.getByRole('dialog').waitFor()
      },
    ],
    [
      'dialog-start-work',
      async () => {
        await nav(win, 'Tickets')
        await win.getByRole('button', { name: /^DD-104\b/ }).click()
        await win
          .getByRole('complementary', { name: 'DD-104 details' })
          .getByRole('button', { name: 'Start work…' })
          .click()
        await win.getByRole('dialog').waitFor()
        await win.waitForTimeout(500)
      },
    ],
  ]
  for (const [name, open] of dialogs) {
    await open()
    await note(`${name} opened`)
    await save(name, win, 'dialog[open]')
    await win.keyboard.press('Escape')
    await win.waitForTimeout(200)
    await note(`${name} after Escape`)
  }

  // The AI answer: what is announced after Send.
  await nav(win, 'Pull requests')
  await win.getByRole('button', { name: /^Summarise web-app #412 with Claude$/ }).click()
  await win.getByRole('button', { name: 'Send to Claude' }).click()
  await expect(win.getByRole('dialog').getByRole('status')).toContainText('Demo answer')
  await save('dialog-ai-answer', win, 'dialog[open]')
  await win.keyboard.press('Escape')

  // The palette: the list and a disabled command's reason.
  await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+K`)
  await win.getByTestId('command-palette').getByRole('combobox').fill('trigger')
  await win.waitForTimeout(300)
  await note('palette open, typed')
  await save('palette', win, '[data-testid="command-palette"]')
  await win.keyboard.press('Escape')

  // Terminal close prompt (sleep in the foreground).
  await nav(win, 'Terminal')
  await win.locator('.terminal-screen:not([hidden]) .xterm').click()
  await win.keyboard.type('sleep 30')
  await win.keyboard.press('Enter')
  await expect
    .poll(() => win.evaluate(() => window.devdock.terminal.busy({ id: 't1' })), { timeout: 15_000 })
    .toMatchObject({ ok: true, data: { busy: true } })
  await win.getByRole('button', { name: 'Close terminal' }).click()
  await win.getByRole('dialog').waitFor()
  await note('terminal close prompt opened')
  await save('dialog-terminal-close', win, 'dialog[open]')
  await win.keyboard.press('Escape')

  // Live regions: what the app announces (Announcer), after a toast.
  await nav(win, 'Utilities')
  await tab(win, 'Standup')
  await save('live-regions', win, 'body')

  // Menu-bar panel, each tab.
  await callHook(app, 'togglePanel')
  const panel = await windowFor(app, 'panel.html')
  for (const t of ['Today', 'Repos', 'Tickets', 'Tools']) {
    await panel.getByText(t, { exact: true }).click()
    await panel.waitForTimeout(300)
    await save(`panel-${t.toLowerCase()}`, panel, 'body')
  }
  await note('panel', panel)

  writeFileSync(join(out!, 'focus.txt'), notes.join('\n') + '\n')
})
