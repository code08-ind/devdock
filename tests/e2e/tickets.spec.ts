import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, openSettings, test } from './fixtures'

/** P2.D3: Start work in demo mode, through the UI, on a real temp repo. */
const shots = process.env.DEVDOCK_SCREENSHOTS
  ? join(import.meta.dirname, '../../docs/screenshots')
  : null
const snap = async (win: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await win.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' })
}

const readClipboard = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => clipboard.readText())
const writeClipboard = (app: ElectronApplication, text: string) =>
  app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)

let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

async function openTickets(win: Page) {
  await win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Tickets' })
    .click()
  await expect(win.getByRole('list', { name: 'My open issues' })).toBeVisible()
}

/** Opens Start work for `key`, checks the preview, runs it, and returns the dialog. */
async function startWork(win: Page, key: string, agent: string) {
  await win.getByRole('button', { name: new RegExp(`^${key}\\b`) }).click()
  const pane = win.getByRole('complementary', { name: `${key} details` })
  await pane.getByRole('button', { name: 'Start work…' }).click()
  const dialog = win.getByRole('dialog', { name: `Start work on ${key}` })
  await expect(dialog.getByText(agent, { exact: true })).toBeVisible()
  // Never launch the real VS Code from a test.
  await dialog.getByRole('checkbox', { name: 'Open the repo in VS Code afterwards' }).uncheck()
  return dialog
}

test('Start work: Bug and vague Story → branch, TICKET.md, agent message on the clipboard', async ({
  launched,
}) => {
  const { app, win } = launched
  repos = makeRepos()
  const saved = await readClipboard(app)
  try {
    const added = await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
    expect(added.ok).toBe(true)
    await openTickets(win)
    await expect(
      win.getByRole('list', { name: 'My open issues' }).getByRole('listitem'),
    ).toHaveCount(7)
    await snap(win, 'p2-tickets')

    // --- Bug ---------------------------------------------------------------------------------
    let dialog = await startWork(win, 'DD-101', 'bug-fixer')
    const branch = 'bugfix/DD-101-checkout-total-rounds-wrong-for-3-decimal'
    await expect(dialog.getByText(branch, { exact: true })).toBeVisible()
    await expect(dialog.locator('.commands')).toContainText(
      `git checkout -b ${branch} --no-track origin/develop`,
    )
    // The temp repo doesn't ignore docs/ai/specs: warned before anything happens.
    await expect(dialog.getByRole('alert')).toContainText("docs/ai/specs isn't ignored by git")
    // The lessons line is on by default (Settings → Workflow, P6-F).
    const bugMessage =
      'Use the bug-fixer agent. Ticket brief: docs/ai/specs/DD-101/TICKET.md.' +
      ' When you finish, add what you learned to docs/ai/LESSONS.md, one line each.'
    await expect(dialog.locator('.code')).toContainText(bugMessage)
    await snap(win, 'p2-startwork-preview')

    await dialog.getByRole('button', { name: 'Start work', exact: true }).click()
    await expect(dialog.getByRole('status').getByText(`Started work on ${branch}`)).toBeVisible()
    await snap(win, 'p2-startwork-done')
    expect(await readClipboard(app)).toBe(bugMessage)
    expect(repos.git(repos.clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(branch)
    const brief = readFileSync(join(repos.clone, 'docs/ai/specs/DD-101/TICKET.md'), 'utf8')
    for (const heading of [
      '## Summary',
      '## Description',
      '## Acceptance criteria',
      '## Links',
      '## Comments',
    ]) {
      expect(brief).toContain(heading)
    }
    await dialog.getByRole('button', { name: 'Close' }).click()

    // --- Vague Story ---------------------------------------------------------------------------
    repos.git(repos.clone, 'checkout', '-q', 'develop')
    dialog = await startWork(win, 'DD-103', 'spec-writer')
    await dialog.getByRole('button', { name: 'Start work', exact: true }).click()
    await expect(
      dialog
        .getByRole('status')
        .getByText('Started work on feature/DD-103-make-the-dashboard-feel-faster'),
    ).toBeVisible()
    expect(await readClipboard(app)).toBe(
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/DD-103/TICKET.md.' +
        ' When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
    expect(repos.git(repos.clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(
      'feature/DD-103-make-the-dashboard-feel-faster',
    )
    const storyBrief = readFileSync(join(repos.clone, 'docs/ai/specs/DD-103/TICKET.md'), 'utf8')
    for (const heading of [
      '## Summary',
      '## Description',
      '## Acceptance criteria',
      '## Links',
      '## Comments',
    ]) {
      expect(storyBrief).toContain(heading)
    }
    expect(storyBrief).toContain('_None in the ticket. Clarify them before building._')
    // Transition setting is off by default: no confirmation offered, nothing moved.
    await expect(dialog.getByText('Move DD-103 to In Progress')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()

    // --- Story with criteria and a Figma link: the full SPEC message shape ------------------------
    repos.git(repos.clone, 'checkout', '-q', 'develop')
    dialog = await startWork(win, 'DD-102', 'feature-builder')
    await dialog.getByRole('button', { name: 'Start work', exact: true }).click()
    await expect(
      dialog.getByRole('status').getByText(/^Started work on feature\/DD-102-/),
    ).toBeVisible()
    expect(await readClipboard(app)).toBe(
      'Use the feature-builder agent. Ticket brief: docs/ai/specs/DD-102/TICKET.md. Figma: https://www.figma.com/design/DEMOfile123/Profile?node-id=12-34.' +
        ' When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
  } finally {
    await writeClipboard(app, saved)
  }
})

test('lists, issue detail links, and Settings → Jira Test connection (demo)', async ({
  launched,
}) => {
  const { win } = launched
  await openTickets(win)
  // The radios are visually hidden; the visible label is what people click.
  await win.locator('label.segment', { hasText: 'Current sprint' }).click()
  await expect(win.getByRole('list', { name: 'Current sprint' }).getByRole('listitem')).toHaveCount(
    4,
  )

  await win.getByRole('button', { name: /^DD-102\b/ }).click()
  const pane = win.getByRole('complementary', { name: 'DD-102 details' })
  // Muted text never sits on the selection colour (contrast): the selected row uses --text.
  const colors = await win.evaluate(() => {
    const muted = document.querySelector('.issue-row[aria-current="true"] .muted')!
    return [getComputedStyle(muted).color, getComputedStyle(document.body).color]
  })
  expect(colors[0]).toBe(colors[1])
  await expect(
    pane.getByRole('heading', { name: 'Saved payment methods on the profile page' }),
  ).toBeVisible()
  await expect(
    pane.getByRole('button', { name: /^Figma: https:\/\/www\.figma\.com\// }),
  ).toBeVisible()
  await expect(pane.getByRole('button', { name: /^Confluence: / })).toBeVisible()
  await expect(pane.getByText('Demo Sprint 7')).toBeVisible()

  await openSettings(win)
  const jira = win.getByRole('region', { name: 'Jira' })
  await jira.getByRole('button', { name: 'Test connection' }).click()
  await expect(jira.getByRole('status')).toContainText('Connected (HTTP 200) as Demo Developer')

  // A saved query becomes a list in Tickets.
  await jira.getByRole('textbox', { name: 'Name', exact: true }).fill('Bugs')
  await jira.getByRole('textbox', { name: 'JQL', exact: true }).fill('type = Bug')
  await jira.getByRole('button', { name: 'Add query' }).click()
  await expect(jira.getByText('type = Bug')).toBeVisible()
  await openTickets(win)
  await expect(win.locator('label.segment', { hasText: 'Bugs' })).toBeVisible()
})

test('with the transition setting on, the Start button says it will move the issue', async ({
  launched,
}) => {
  const { win } = launched
  repos = makeRepos()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  await win.evaluate(() => window.devdock.settings.update({ features: { jiraTransition: true } }))
  await openTickets(win)
  const dialog = await startWork(win, 'DD-102', 'feature-builder')
  const move = dialog.getByRole('checkbox', { name: /^Move DD-102 to In Progress in Jira/ })
  await expect(move).toBeChecked()
  await expect(
    dialog.getByRole('button', { name: 'Start work and move to In Progress' }),
  ).toBeVisible()
  await move.uncheck()
  await expect(dialog.getByRole('button', { name: 'Start work', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Board id: field-level error, Save disabled.
  await openSettings(win)
  const jira = win.getByRole('region', { name: 'Jira' })
  const board = jira.getByRole('textbox', { name: 'Board id for Current sprint' })
  await board.fill('42a')
  await expect(jira.getByText('Use the board number, e.g. 42.')).toBeVisible()
  await expect(
    jira
      .locator('.field', { has: win.getByRole('textbox', { name: 'Board id for Current sprint' }) })
      .getByRole('button', { name: 'Save' }),
  ).toBeDisabled()
})
