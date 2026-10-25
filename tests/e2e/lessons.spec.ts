import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, openSettings, test } from './fixtures'

/** P6-F: agent lessons from review comments, and the Workflow options in Start work. */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

const nav = (win: Page, label: string) =>
  win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click()

test('lessons: pick review comments and my own, written to the repo; Start work points the agent there', async ({
  launched,
}) => {
  const { win } = launched
  repos = makeRepos()
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  const file = join(repos.clone, 'docs/ai/LESSONS.md')

  await nav(win, 'Utilities')
  await win.locator('label.segment', { hasText: 'Lessons' }).click()
  await expect(
    win.getByText('No lessons file yet: adding one creates docs/ai/LESSONS.md.'),
  ).toBeVisible()
  await win.getByRole('button', { name: 'Collect review comments' }).click()
  const list = win.getByRole('list', { name: 'Lessons to pick' })
  const money = list
    .getByRole('listitem')
    .filter({ hasText: 'Priya Reviewer' })
    .filter({
      has: win.locator('input[value*="formatMoney"]'),
    })
  await expect(money).toHaveCount(1)
  // Nothing is picked until I pick it; my own replies aren't offered.
  await expect(win.getByRole('button', { name: 'Pick lessons to add' })).toBeDisabled()
  await expect(list.getByText('Demo Developer on', { exact: false })).toHaveCount(0)
  await money.getByRole('checkbox').check()
  await win.getByLabel('Your own lesson').fill('Run the visual tests before pushing UI changes')
  await win.getByRole('button', { name: 'Add to the list' }).click()
  await win.getByRole('button', { name: 'Add 2 lessons to docs/ai/LESSONS.md' }).click()
  await expect(win.getByText('Added 2 lessons to docs/ai/LESSONS.md')).toBeVisible()
  expect(existsSync(file)).toBe(true)
  const text = readFileSync(file, 'utf8')
  expect(text).toMatch(
    /^- Use the formatMoney helper here .*\(web-app #\d+.*, src\/checkout\/Total\.tsx\)$/m,
  )
  expect(text).toContain('- Run the visual tests before pushing UI changes\n')
  await expect(
    win.getByRole('list', { name: 'Lessons in the file' }).getByRole('listitem'),
  ).toHaveCount(2)

  // Start work: the message points the agent at the lessons; unticking updates the preview.
  await nav(win, 'Tickets')
  await win.getByRole('button', { name: /^DD-104\b/ }).click()
  await win
    .getByRole('complementary', { name: 'DD-104 details' })
    .getByRole('button', { name: 'Start work…' })
    .click()
  const dialog = win.getByRole('dialog', { name: 'Start work on DD-104' })
  const message = dialog.locator('pre').first()
  await expect(message).toContainText('Read docs/ai/LESSONS.md first.')
  await expect(message).toContainText('When you finish, add what you learned to docs/ai/LESSONS.md')
  await dialog.getByRole('checkbox', { name: 'Ask the agent to add what it learned' }).uncheck()
  await expect(message).not.toContainText('When you finish')
  await expect(message).toContainText('Read docs/ai/LESSONS.md first.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Per run: Settings → Workflow keeps its default.
  await openSettings(win)
  const workflow = win.getByRole('region', { name: 'Workflow' })
  await expect(
    workflow.getByRole('switch', { name: /Ask the agent to add what it learned/ }),
  ).toHaveAttribute('aria-checked', 'true')
})
