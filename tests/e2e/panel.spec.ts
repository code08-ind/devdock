import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, test, windowFor } from './fixtures'

/** P6-E: the menu-bar / tray panel — the day at a glance and one-click actions. */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

test('panel: Today, one-click watch, repo action dialog, Start work, tools; Open DevDock hides it', async ({
  launched,
}) => {
  // Eight steps in one window: a busy CI runner took 30.8 s once (2026-11-01).
  test.setTimeout(60_000)
  const { app, win } = launched
  repos = makeRepos()
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  await callHook(app, 'togglePanel')
  await expect.poll(() => callHook(app, 'isPanelVisible')).toBe(true)
  const panel = await windowFor(app, 'panel.html')

  // Today: my PRs (demo data), watched in one click.
  const prs = panel.getByRole('list', { name: 'My pull requests' })
  await expect(prs.getByRole('listitem').first()).toBeVisible()
  await prs.getByRole('button', { name: 'Watch web-app #412' }).click()
  await expect(prs.getByRole('button', { name: 'Stop watching web-app #412' })).toBeVisible()
  // Tickets in progress are on Today too, with Start work.
  const started = panel.getByRole('list', { name: 'Tickets in progress' })
  await expect(started.getByRole('button', { name: 'Start work…' }).first()).toBeVisible()

  // Repos: an action opens the same dialog as the Repos view, commands first.
  await panel.getByText('Repos', { exact: true }).click()
  const repo = panel.getByRole('listitem', { name: 'clone' })
  await expect(repo.getByText('develop')).toBeVisible()
  await repo.getByRole('button', { name: 'Sync base' }).click()
  const sync = panel.getByRole('dialog')
  await expect(sync.getByText(/git fetch/).first()).toBeVisible()
  // Escape closes the dialog, not the panel.
  await panel.keyboard.press('Escape')
  await expect(sync).toBeHidden()
  expect(await callHook(app, 'isPanelVisible')).toBe(true)

  // Tickets: Start work opens its dialog with the preview.
  await panel.getByText('Tickets', { exact: true }).click()
  const ticket = panel.getByRole('list', { name: 'My open tickets' }).getByRole('listitem').first()
  await ticket.getByRole('button', { name: 'Start work…' }).click()
  const start = panel.getByRole('dialog', { name: /^Start work on DD-/ })
  await expect(start).toBeVisible()
  await panel.keyboard.press('Escape')
  await expect(start).toBeHidden()

  // Tools: standup in one click; ports listed.
  await panel.getByText('Tools', { exact: true }).click()
  await panel.getByRole('button', { name: 'Copy as text' }).click()
  await expect(panel.getByText('Standup copied as text')).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Ports' })).toBeVisible()

  // Search runs palette commands; going to a view opens the main window and hides the panel.
  await panel.getByRole('button', { name: 'Search every action' }).click()
  await expect(panel.getByRole('combobox', { name: 'Command' })).toBeFocused()
  await panel.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: 'Search every action' })).toBeVisible()
  // `kill <port>` from the panel's search is handled in the panel (Tools), not the main window.
  await panel.getByRole('button', { name: 'Search every action' }).click()
  await panel.keyboard.type('kill 59999')
  await expect(panel.getByRole('option').first()).toContainText('Stop the process on port 59999…')
  await panel.keyboard.press('Enter')
  await expect(panel.getByText('Nothing is listening on port 59999.')).toBeVisible()
  expect(await callHook(app, 'isPanelVisible')).toBe(true)
  await panel.getByRole('button', { name: 'Open DevDock' }).click()
  await expect.poll(() => callHook(app, 'isPanelVisible')).toBe(false)
  await expect(win.getByRole('heading', { level: 1, name: /^Welcome to DevDock/ })).toBeVisible()
})

test('panel: Escape hides it; opening again starts at the top', async ({ launched }) => {
  const { app } = launched
  await callHook(app, 'togglePanel')
  const panel = await windowFor(app, 'panel.html')
  await expect(panel.getByRole('button', { name: 'Open DevDock' })).toBeVisible()
  await panel.keyboard.press('Escape')
  await expect.poll(() => callHook(app, 'isPanelVisible')).toBe(false)
  await callHook(app, 'togglePanel')
  await expect.poll(() => callHook(app, 'isPanelVisible')).toBe(true)
})
