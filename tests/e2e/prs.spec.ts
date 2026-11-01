import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { callHook, expect, openSettings, test, windowFor } from './fixtures'

/** P3-C in demo mode (Data Center fixtures, src/main/demo/bitbucket.ts), through the UI. */
const shots = process.env.DEVDOCK_SCREENSHOTS
  ? join(import.meta.dirname, '../../docs/screenshots')
  : null
const snap = async (win: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await win.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' })
}

const DEMO = 'https://demo.devdock.invalid/bitbucket/projects/DEMO/repos'
const link = (repo: string, id: number) => `${DEMO}/${repo}/pull-requests/${id}/overview`

async function openPrs(win: Page) {
  await win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Pull requests' })
    .click()
  await expect(win.getByRole('heading', { level: 1, name: 'Pull requests' })).toBeVisible()
}
/** Segmented controls hide the radio itself; people click the segment. */
const pick = (win: Page, name: string) => win.locator('label.segment', { hasText: name }).click()
const list = (win: Page, name: string) => win.getByRole('list', { name })
const row = (win: Page, listName: string, label: string) =>
  list(win, listName).getByRole('listitem').filter({ hasText: label })

test('P3.D4: Today shows my PRs in mixed states, in-progress tickets and repos', async ({
  launched,
}) => {
  const { win } = launched
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' }).click()
  const mine = list(win, 'My pull requests')
  await expect(mine.getByRole('listitem')).toHaveCount(4)
  await expect(row(win, 'My pull requests', 'web-app #412')).toContainText('Build passed')
  await expect(row(win, 'My pull requests', 'web-app #412')).toContainText('2 approvals')
  // Lists don't know which comments are resolved: the total is labelled as such.
  await expect(row(win, 'My pull requests', 'web-app #412')).toContainText('4 comments in all')
  await expect(row(win, 'My pull requests', 'web-app #415')).toContainText('Build failed')
  await expect(row(win, 'My pull requests', 'web-app #415')).toContainText('Needs work (1)')
  await expect(row(win, 'My pull requests', 'design-system #88')).toContainText('Building')
  await expect(row(win, 'My pull requests', 'design-system #88')).toContainText('Conflicts')
  await expect(row(win, 'My pull requests', 'web-app #419')).toContainText('No builds')
  await expect(row(win, 'My pull requests', 'web-app #415')).toContainText(
    'feature/DD-102-checkout-summary-card → develop',
  )
  await expect(list(win, 'Tickets in progress').getByRole('listitem').first()).toBeVisible()
  await expect(win.getByRole('heading', { name: 'Repos' })).toBeVisible()
  // PR actions are off by default: no action buttons anywhere.
  await expect(win.getByRole('button', { name: /^(Approve|Merge|Needs work)/ })).toHaveCount(0)
  await snap(win, 'p3-today')
  for (const theme of ['dark'] as const) {
    await win.evaluate((t) => window.devdock.settings.update({ appearance: { theme: t } }), theme)
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme)
    // Capture after the theme transition has settled (dark --bg is #1E1F22).
    await expect
      .poll(() => win.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(30, 31, 34)')
    await snap(win, `p3-today-${theme}`)
  }
})

test('PRs: the three lists, the Watch field and the Watched list', async ({ launched }) => {
  const { win, errors } = launched
  await openPrs(win)
  await expect(list(win, 'My PRs').getByRole('listitem')).toHaveCount(4)

  await pick(win, 'Reviewing')
  await expect(list(win, 'Reviewing').getByRole('listitem')).toHaveCount(2)
  await expect(row(win, 'Reviewing', 'web-app #410')).toContainText('by Priya Reviewer')

  await pick(win, 'Recently merged')
  await expect(list(win, 'Recently merged').getByRole('listitem')).toHaveCount(2)
  await expect(row(win, 'Recently merged', 'web-app #401')).toContainText('Merged')

  // Watch field: checked as you type, then watched on submit.
  const field = win.getByRole('textbox', { name: 'Watch a pull request' })
  await field.fill('https://github.com/acme/web-app/issues/1')
  await expect(win.getByText("That isn't a pull request link from Bitbucket.")).toBeVisible()
  await expect(win.getByRole('button', { name: 'Watch', exact: true })).toBeDisabled()
  // Another Bitbucket site: refused by main with the reason.
  await field.fill('https://bitbucket.org/acme/web-app/pull-requests/7')
  await win.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(win.getByRole('alert')).toContainText(/That link is on https:\/\/bitbucket\.org/)
  // A PR that doesn't exist: Bitbucket's 404 with its hint and Details.
  await field.fill(link('web-app', 999))
  await win.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(win.getByRole('alert')).toContainText('returned 404')

  await field.fill(link('design-system', 88))
  await win.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(win.getByRole('radio', { name: 'Watched (1)' })).toBeChecked()
  const watched = row(win, 'Watched pull requests', 'design-system #88')
  await expect(watched).toContainText('Building')
  await expect(watched).toContainText(/Watching\. Checked/)
  await expect(field).toHaveValue('')

  // The eye button on a list row watches / unwatches too.
  await pick(win, 'My PRs')
  await row(win, 'My PRs', 'web-app #412')
    .getByRole('button', { name: 'Watch web-app #412' })
    .click()
  await expect(win.getByRole('radio', { name: 'Watched (2)' })).toBeAttached()
  await row(win, 'My PRs', 'web-app #412')
    .getByRole('button', { name: 'Stop watching web-app #412' })
    .click()
  await expect(win.getByRole('radio', { name: 'Watched (1)' })).toBeAttached()

  // Today lists live watches.
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' }).click()
  await expect(row(win, 'Watched pull requests', 'design-system #88')).toBeVisible()
  expect(errors).toEqual([])
})

test('palette: `watch <link>` watches the PR and shows Pull requests', async ({ launched }) => {
  const { win } = launched
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  const palette = win.getByTestId('command-palette')
  await palette.getByRole('combobox', { name: 'Command' }).fill(`watch ${link('web-app', 415)}`)
  await expect(palette.getByRole('option').first()).toHaveText(/Watch pull request web-app #415/)
  await win.keyboard.press('Enter')
  await expect(win.getByRole('heading', { level: 1, name: 'Pull requests' })).toBeVisible()
  await pick(win, 'Watched (1)')
  await expect(row(win, 'Watched pull requests', 'web-app #415')).toContainText('Build failed')
})

test('global palette window: `watch <link>` is handed to the main window', async ({ launched }) => {
  const { app, win } = launched
  await callHook(app, 'togglePalette')
  const pw = await windowFor(app, 'palette.html')
  const box = pw.getByRole('combobox', { name: 'Command' })
  await expect(box).toBeFocused()
  // A bare pasted link works too.
  await box.fill(link('design-system', 91))
  await expect(pw.getByRole('option').first()).toHaveText(/Watch pull request design-system #91/)
  await pw.keyboard.press('Enter')
  await expect.poll(() => callHook(app, 'isPaletteVisible')).toBe(false)
  await expect(win.getByRole('heading', { level: 1, name: 'Pull requests' })).toBeVisible()
  await expect(win.getByText('Watching design-system #91')).toBeVisible()
  await expect(win.getByRole('radio', { name: 'Watched (1)' })).toBeAttached()
})

test('Settings → Bitbucket: Test connection, Detect; Settings → Actions: PR actions behind a warning; approve and a typed merge', async ({
  launched,
}) => {
  const { win } = launched
  await openSettings(win)
  const section = win.getByRole('region', { name: 'Bitbucket' })
  await section.getByRole('button', { name: /^Test the / }).click()
  await expect(section.getByText('Connected (HTTP 200) as Demo Developer (dev)')).toBeVisible()
  await section.getByRole('button', { name: /^Detect / }).click()
  await expect(win.getByText('Demo site is Bitbucket Data Center 8.19.1')).toBeVisible()

  // Turning PR actions on asks first; Cancel leaves them off.
  const toggle = win
    .getByRole('region', { name: 'Actions' })
    .getByRole('switch', { name: 'PR actions (approve, needs work, merge)' })
  await toggle.click()
  const warn = win.getByRole('dialog', { name: 'Turn on PR actions?' })
  await expect(warn).toContainText('Use only if your role permits.')
  await warn.getByRole('button', { name: 'Cancel' }).click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await win
    .getByRole('dialog', { name: 'Turn on PR actions?' })
    .getByRole('button', { name: 'Turn on PR actions' })
    .click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Watched follows role: merge on my own PRs, reviews on everyone else's.
  await openPrs(win)
  const field = win.getByRole('textbox', { name: 'Watch a pull request' })
  for (const id of [412, 410]) {
    await field.fill(link('web-app', id))
    await win.getByRole('button', { name: 'Watch', exact: true }).click()
    await expect(field).toHaveValue('')
  }
  const own = row(win, 'Watched pull requests', 'web-app #412')
  const theirs = row(win, 'Watched pull requests', 'web-app #410')
  await expect(own.getByRole('button', { name: 'Merge web-app #412' })).toBeVisible()
  await expect(own.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
  await expect(theirs.getByRole('button', { name: 'Approve web-app #410' })).toBeVisible()
  await expect(theirs.getByRole('button', { name: /^Merge/ })).toHaveCount(0)

  // Approve a PR under review: the dialog names it and its target branch.
  await pick(win, 'Reviewing')
  await row(win, 'Reviewing', 'web-app #410')
    .getByRole('button', { name: 'Approve web-app #410' })
    .click()
  const approve = win.getByRole('dialog', { name: 'Approve web-app #410?' })
  await expect(approve).toContainText('feature/DD-099-search-skeleton → develop')
  await approve.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(win.getByText('Approved web-app #410')).toBeVisible()
  await expect(row(win, 'Reviewing', 'web-app #410')).toContainText('2 approvals')

  // Merge needs the target branch typed exactly; Bitbucket's veto is shown verbatim.
  await pick(win, 'My PRs')
  await row(win, 'My PRs', 'web-app #415')
    .getByRole('button', { name: 'Merge web-app #415' })
    .click()
  const vetoed = win.getByRole('dialog', { name: 'Merge web-app #415?' })
  const confirm415 = vetoed.getByRole('button', { name: 'Merge into develop' })
  await expect(confirm415).toBeDisabled()
  await vetoed.getByRole('textbox', { name: 'Type develop to confirm' }).fill('develop')
  await confirm415.click()
  await expect(vetoed.getByRole('alert')).toContainText(
    'This pull request needs a successful build before it can be merged.',
  )
  await vetoed.getByRole('button', { name: 'Cancel' }).click()

  await row(win, 'My PRs', 'web-app #412')
    .getByRole('button', { name: 'Merge web-app #412' })
    .click()
  const merge = win.getByRole('dialog', { name: 'Merge web-app #412?' })
  const input = merge.getByRole('textbox', { name: 'Type develop to confirm' })
  const confirm = merge.getByRole('button', { name: 'Merge into develop' })
  await input.fill('main')
  await expect(confirm).toBeDisabled()
  await input.fill('develop')
  await snap(win, 'p3-merge-confirm')
  await confirm.click()
  await expect(win.getByText('Merged web-app #412')).toBeVisible()
  await expect(list(win, 'My PRs').getByRole('listitem')).toHaveCount(3)
  await pick(win, 'Recently merged')
  await expect(row(win, 'Recently merged', 'web-app #412')).toContainText('Merged')
})
