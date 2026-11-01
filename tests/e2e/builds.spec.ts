import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, type Page } from '@playwright/test'
import { callHook, expect, launch, newProfile, openSettings, test, type Launched } from './fixtures'

/** P4 in demo mode (src/main/demo/jenkins.ts), through the Builds view. */

const shots = process.env.DEVDOCK_SCREENSHOTS
  ? join(import.meta.dirname, '../../docs/screenshots')
  : null
const snap = async (win: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await win.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' })
}

const PR_88 =
  'https://demo.devdock.invalid/bitbucket/projects/DEMO/repos/design-system/pull-requests/88'

/** The demo builds run 10× faster here: PR-88 passes after ~12 s, the failing one after ~9 s. */
const fast = base.extend<{ launched: Launched }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure.
  launched: async ({}, use) => {
    const launched = await launch(newProfile(), { DEVDOCK_DEMO_SPEED: '10' })
    try {
      await use(launched)
    } finally {
      await launched.app.close().catch(() => undefined)
      rmSync(launched.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },
})

async function openBuilds(win: Page) {
  await win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Builds' })
    .click()
  await expect(win.getByRole('heading', { level: 1, name: 'Builds' })).toBeVisible()
}
const branchRow = (win: Page, branch: string) =>
  win.getByRole('list', { name: 'My branches' }).getByRole('listitem').filter({ hasText: branch })

/** Polls the build watcher (as its scheduler would) until `title` is in the history. */
async function waitForNotification(launched: Launched, title: string) {
  await expect
    .poll(
      async () => {
        await callHook(launched.app, 'pollBuilds')
        const history = await launched.win.evaluate(() => window.devdock.notifications.history())
        return history.ok ? history.data.map((n) => n.title) : []
      },
      { timeout: 40_000, intervals: [1_000] },
    )
    .toContain(title)
}

fast(
  'P4.D2: watching a running PR pipeline ends in a "passed" notification and a green dot',
  async ({ launched }) => {
    fast.setTimeout(60_000)
    const { app, win } = launched
    await openBuilds(win)
    await expect(branchRow(win, 'PR-88')).toContainText('Running')
    await expect(branchRow(win, 'feature/DD-102-checkout-summary-card')).toContainText('Failed')
    await snap(win, 'p4-builds')
    expect(await callHook(app, 'trayStatus')).toBe('grey')

    await win.getByLabel("Watch a pull request's pipeline").fill(PR_88)
    await win.getByRole('button', { name: 'Watch pipeline' }).click()
    const watched = win.getByRole('list', { name: 'Watched builds' })
    await expect(watched).toContainText('design-system #88 pipeline #12')
    await expect(watched).toContainText('Running')

    await waitForNotification(launched, 'Passed · design-system #88 pipeline #12')
    await expect.poll(() => callHook(app, 'trayStatus')).toBe('green')
    await expect(watched).toContainText('Passed')

    // The finished build: stages and the console tail, with search.
    await watched.getByRole('button', { name: /Details and console of design-system #88/ }).click()
    const dialog = win.getByRole('dialog', { name: 'design-system › PR-88 #12' })
    await expect(dialog.getByRole('list', { name: 'Stages' }).getByRole('listitem')).toHaveCount(5)
    const log = dialog.getByRole('log', { name: 'Console output' })
    await expect(log).toContainText('Finished: SUCCESS')
    await dialog.getByLabel('Search the console').fill('built in')
    await expect(dialog.getByText('1 matching line')).toBeVisible()
    await expect(log).toContainText('✓ built in 41.2s')
    await snap(win, 'p4-build-console')
    await dialog.getByRole('button', { name: 'Close' }).click()
  },
)

fast(
  'P4.D2: a failing watched build ends in a "failed" notification and a red dot',
  async ({ launched }) => {
    fast.setTimeout(60_000)
    const { app, win } = launched
    await openBuilds(win)
    const row = branchRow(win, 'chore/bump-tooling')
    await expect(row).toContainText('Running')
    await row.getByRole('button', { name: 'Watch web-app › chore/bump-tooling' }).click()
    await expect(row).toContainText('Watched')

    await waitForNotification(launched, 'Failed · web-app › chore/bump-tooling #2')
    await expect.poll(() => callHook(app, 'trayStatus')).toBe('red')
    const tray = await callHook(app, 'trayState')
    expect(tray.watched.map((w) => [w.label, w.state])).toEqual([
      ['web-app › chore/bump-tooling #2', 'failed'],
    ])
  },
)

test('triggers: hidden by default, shown only for allowed jobs, never for protected ones; confirmation lists job, branch and parameters', async ({
  launched,
}) => {
  const { win } = launched
  await openBuilds(win)
  const row = branchRow(win, 'bugfix/DD-101-date-picker-focus')
  await expect(row).toContainText('Passed')
  await expect(win.getByRole('button', { name: /^Trigger a build/ })).toHaveCount(0)

  await win.evaluate(() =>
    window.devdock.settings.update({
      features: {
        jobTriggers: true,
        allowedJobs: ['web-app/bugfix%2FDD-101-date-picker-focus', 'web-app/PR-412'],
      },
      // PR jobs are protected here, so PR-412 stays without a button although allowed.
      jenkins: { protectedPatterns: ['prod', 'production', 'uat', 'release', 'PR-'] },
    }),
  )
  await expect(win.getByRole('button', { name: /^Trigger a build/ })).toHaveCount(1)
  await row
    .getByRole('button', { name: 'Trigger a build of web-app › bugfix/DD-101-date-picker-focus' })
    .click()
  const dialog = win.getByRole('dialog', {
    name: 'Trigger a build of web-app › bugfix/DD-101-date-picker-focus?',
  })
  await expect(dialog).toContainText('web-app/bugfix%2FDD-101-date-picker-focus')
  await expect(dialog).toContainText('bugfix/DD-101-date-picker-focus')
  await dialog.getByRole('button', { name: 'Trigger build' }).click()
  await expect(
    win.getByText('Build queued for web-app › bugfix/DD-101-date-picker-focus'),
  ).toBeVisible()
  await expect(dialog).toBeHidden()
  // The new build (#4), not an older one, is the one watched.
  await expect(
    win.getByText("Watching web-app › bugfix/DD-101-date-picker-focus: you'll be notified"),
  ).toBeVisible()
  const watched = await win.evaluate(() => window.devdock.buildwatch.list())
  expect(watched).toMatchObject({
    ok: true,
    data: [{ kind: 'job', job: 'web-app/bugfix%2FDD-101-date-picker-focus' }],
  })
  // Watched again: the row says so.
  await expect(row).toContainText('Watched')
})

test('Settings → Jenkins: Test connection, jobs as paths or links', async ({ launched }) => {
  const { win } = launched
  await openSettings(win)
  const section = win.getByRole('region', { name: 'Jenkins' })
  await section.getByRole('button', { name: /^Test the / }).click()
  await expect(section.getByText('Connected (HTTP 200) as Demo Developer (dev)')).toBeVisible()
  const jobs = section.getByLabel('Multibranch jobs for My branches', { exact: true })
  await jobs.fill('apps/../x')
  await expect(section.getByText("apps/../x isn't a job path.", { exact: false })).toBeVisible()
  await jobs.fill('web-app\ndesign-system')
  await jobs.locator('xpath=..').getByRole('button', { name: 'Save' }).click()
  await expect(win.getByText('Jobs saved')).toBeVisible()
})
