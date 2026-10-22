import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, otherClone, type Repos } from '../fixtures/git-repos'
import { callHook, expect, test, windowFor } from './fixtures'

/** P1.D5: Update my branch → conflict → Abort, through the UI, on a real repo. */
const shots = process.env.DEVDOCK_SCREENSHOTS
  ? join(import.meta.dirname, '../../docs/screenshots')
  : null
const snap = async (win: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await win.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' })
}

let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

/** feature/login edits README; someone else pushes a different README to develop. */
function conflictingRepo(): Repos {
  const r = makeRepos()
  r.git(r.clone, 'checkout', '-q', '-b', 'feature/NM-12-login')
  r.commit(r.clone, 'README.md', '# app\n\nLogin form (mine)\n')
  const other = otherClone(r, r.origin)
  r.git(other, 'checkout', '-q', 'develop')
  r.commit(other, 'README.md', '# app\n\nRelease notes (theirs)\n')
  r.git(other, 'push', '-q', 'origin', 'develop')
  // Uncommitted work the user must not lose.
  writeFileSync(join(r.clone, 'notes.txt'), 'work in progress\n')
  return r
}

test('update my branch → stash & continue → conflict → abort restores everything', async ({
  launched,
}) => {
  const { win } = launched
  repos = conflictingRepo()
  const before = repos.git(repos.clone, 'rev-parse', 'HEAD').trim()

  const added = await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  expect(added.ok).toBe(true)
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Repos' }).click()

  const card = win.getByRole('article', { name: 'clone' })
  await expect(card.getByText('feature/NM-12-login')).toBeVisible()
  await expect(card.getByText('fetch to compare with develop')).toBeVisible()
  await expect(card.getByText('1 changed file')).toBeVisible()

  // Fetch all through the UI: commands disclosure, run, result.
  await card.getByRole('button', { name: 'Fetch all' }).click()
  let dialog = win.getByRole('dialog')
  await expect(dialog.locator('.commands')).toContainText('git fetch --all --prune')
  await dialog.getByRole('button', { name: 'Fetch all', exact: true }).click()
  await expect(dialog.getByText('Fetched all remotes.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(card.getByText('1 behind, 1 ahead of origin/develop')).toBeVisible()
  await snap(win, 'p1-repos')

  await card.getByRole('button', { name: 'Update my branch' }).click()
  dialog = win.getByRole('dialog')
  // Dirty tree: refused, with the Stash & continue offer.
  await expect(dialog.getByText('You have uncommitted changes')).toBeVisible()
  await dialog.getByRole('button', { name: 'Stash & continue…' }).click()
  const commands = dialog.locator('.commands')
  await expect(commands).toContainText('git stash push --include-untracked')
  await expect(commands).toContainText('git merge --no-edit origin/develop')
  await snap(win, 'p1-update-plan')

  await dialog.getByRole('button', { name: 'Update my branch', exact: true }).click()
  const conflict = dialog.getByRole('region', { name: 'Conflicts' })
  await expect(conflict).toBeVisible()
  await expect(conflict.getByText('README.md')).toBeVisible()
  await expect(dialog.getByRole('log', { name: 'Git output' })).toContainText('CONFLICT')
  await snap(win, 'p1-update-conflict')

  await conflict.getByRole('button', { name: 'Abort merge…' }).click()
  await expect(dialog.locator('.commands')).toContainText('git merge --abort')
  await dialog.getByRole('button', { name: 'Abort', exact: true }).click()
  await expect(
    dialog.getByText(/Aborted the merge and restored your stashed changes/),
  ).toBeVisible()
  await snap(win, 'p1-abort-done')
  await dialog.getByRole('button', { name: 'Close' }).click()

  // Back where we started: same commit, no merge in progress, work in progress restored.
  expect(repos.git(repos.clone, 'rev-parse', 'HEAD').trim()).toBe(before)
  expect(readFileSync(join(repos.clone, 'notes.txt'), 'utf8')).toBe('work in progress\n')
  expect(repos.git(repos.clone, 'stash', 'list').trim()).toBe('')
  await expect(card.getByText(/in progress/)).toHaveCount(0)
})

test('push branch on a protected branch is refused and nothing is pushed', async ({ launched }) => {
  const { win } = launched
  repos = makeRepos()
  repos.git(repos.clone, 'checkout', '-q', 'main')
  repos.commit(repos.clone, 'x.txt', 'local\n')
  const originMain = repos.git(repos.origin, 'rev-parse', 'main').trim()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Repos' }).click()

  await win
    .getByRole('article', { name: 'clone' })
    .getByRole('button', { name: 'Push branch' })
    .click()
  const dialog = win.getByRole('dialog')
  await expect(dialog.getByText(/Pushing main is blocked/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Push branch', exact: true })).toHaveCount(0)
  expect(repos.git(repos.origin, 'rev-parse', 'main').trim()).toBe(originMain)
})

test('palette repo actions open the same dialog with the commands first', async ({ launched }) => {
  const { win } = launched
  repos = makeRepos()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  await win.keyboard.type('fetch all clone')
  await win.keyboard.press('Enter')
  const dialog = win.getByRole('dialog', { name: 'Fetch all — clone' })
  await expect(dialog.locator('.commands')).toContainText('git fetch --all --prune')
  await expect(win.locator('main')).toHaveAttribute('data-view', 'repos')
})

test('the global-shortcut palette window hands repo actions to the main window', async ({
  launched,
}) => {
  const { app, win } = launched
  repos = makeRepos()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  await callHook(app, 'togglePalette')
  const palette = await windowFor(app, 'palette.html')
  await palette.getByRole('combobox', { name: 'Command' }).fill('push branch clone')
  await palette.keyboard.press('Enter')
  const dialog = win.getByRole('dialog', { name: 'Push branch — clone' })
  // On develop (the base): refused in the plan step, before anything could be pushed.
  await expect(dialog.getByText(/Pushing develop is blocked/)).toBeVisible()
})

test('Today shows repo status', async ({ launched }) => {
  const { win } = launched
  repos = makeRepos()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' }).click()
  const list = win.getByRole('list', { name: 'clone status' })
  await expect(list).toContainText('develop')
  await expect(list).toContainText('clean')
})
