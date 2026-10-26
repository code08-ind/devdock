import { rmSync } from 'node:fs'
import { test as base, type Page } from '@playwright/test'
import {
  callHook,
  expect,
  launch,
  newProfile,
  openSettings,
  pickSegment,
  showView,
  test,
  type Launched,
} from './fixtures'

/**
 * P7-B in demo mode (src/main/demo/github.ts, gitlab.ts): GitHub and GitLab are off until
 * turned on in Settings; then their PRs/MRs join the lists, their runs show in Builds, and
 * re-run / retry / cancel sit behind Settings → CI actions plus a confirmation each time.
 */

const section = (win: Page, name: string) => win.getByRole('region', { name, exact: true })

async function turnOn(win: Page, provider: 'GitHub' | 'GitLab') {
  await openSettings(win)
  const s = section(win, provider)
  await s.getByRole('switch', { name: `Use ${provider}` }).click()
  await expect(s.getByRole('switch', { name: `Use ${provider}` })).toBeChecked()
  return s
}

test('GitHub and GitLab: off by default, then PRs/MRs join the lists with Test connection', async ({
  launched,
}) => {
  const { win } = launched
  await showView(win, 'Pull requests')
  const mine = win.getByRole('list', { name: 'My PRs' })
  await expect(mine).toBeVisible()
  // Off by default: only Bitbucket's PRs.
  await expect(mine).not.toContainText('GitHub')

  for (const provider of ['GitHub', 'GitLab'] as const) {
    const s = await turnOn(win, provider)
    await s.getByRole('button', { name: 'Test connection' }).click()
    await expect(s.getByText(/Connected \(HTTP 200\) as Demo Developer \(demo-dev\)/)).toBeVisible()
  }

  await showView(win, 'Pull requests')
  await expect(mine).toContainText('storefront #128')
  await expect(mine).toContainText('checkout !42')
  // Narrow to one provider.
  await win.getByRole('combobox', { name: 'Provider' }).selectOption('gitlab')
  await expect(mine).toContainText('checkout !45')
  await expect(mine).not.toContainText('storefront #128')
  await win.getByRole('combobox', { name: 'Provider' }).selectOption('all')

  // A GitLab MR link (subgroup namespace) can be watched like any other.
  await win
    .getByRole('textbox', { name: 'Watch a pull request' })
    .fill('https://gitlab.demo.devdock.invalid/acme/web/checkout/-/merge_requests/45')
  await win.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(win.getByRole('list', { name: 'Watched pull requests' })).toContainText(
    'checkout !45',
  )
})

test('GitLab pipeline: jobs and log; retry only after Settings → CI actions, confirmed', async ({
  launched,
}) => {
  const { win } = launched
  await turnOn(win, 'GitLab')
  await showView(win, 'Builds')
  await pickSegment(win, 'GitLab pipelines')
  const list = win.getByRole('list', { name: 'GitLab pipelines' })
  const failed = list.getByRole('listitem').filter({ hasText: 'checkout Pipeline #214' })
  await expect(failed).toContainText('Failed')
  // CI actions are off: no retry anywhere.
  await expect(win.getByRole('button', { name: /^Retry failed jobs/ })).toHaveCount(0)

  await failed.getByRole('button', { name: 'Jobs and log of checkout Pipeline #214' }).click()
  const dialog = win.getByRole('dialog', { name: 'checkout Pipeline #214' })
  await expect(dialog.getByRole('list', { name: 'Jobs' }).getByRole('listitem')).toHaveCount(3)
  await expect(dialog.getByRole('log', { name: 'Job log' })).toContainText(
    'Job failed: exit code 1',
  )
  await expect(dialog.getByText(/turn on CI actions in Settings/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  // Turning CI actions on asks first; Cancel leaves them off.
  await openSettings(win)
  const toggle = section(win, 'CI actions').getByRole('switch', {
    name: 'CI actions (re-run, retry, cancel)',
  })
  await toggle.click()
  const warn = win.getByRole('dialog', { name: 'Turn on CI actions?' })
  await warn.getByRole('button', { name: 'Cancel' }).click()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await warn.getByRole('button', { name: 'Turn on CI actions' }).click()
  await expect(toggle).toBeChecked()

  await showView(win, 'Builds')
  await pickSegment(win, 'GitLab pipelines')
  await failed.getByRole('button', { name: 'Retry failed jobs: checkout Pipeline #214' }).click()
  const confirm = win.getByRole('dialog', { name: 'Retry failed jobs: checkout Pipeline #214?' })
  await expect(confirm).toContainText('run the failed jobs of checkout Pipeline #214 again')
  // Backing out sends nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(failed).toContainText('Failed')
  await failed.getByRole('button', { name: 'Retry failed jobs: checkout Pipeline #214' }).click()
  await confirm.getByRole('button', { name: 'Retry failed jobs' }).click()
  await expect(win.getByText('Started again: checkout Pipeline #214')).toBeVisible()
  await expect(failed).toContainText('Running')
})

/** The demo runs 20× faster here: the running GitHub run finishes in ~12 s. */
const fast = base.extend<{ launched: Launched }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure.
  launched: async ({}, use) => {
    const launched = await launch(newProfile(), { DEVDOCK_DEMO_SPEED: '20' })
    try {
      await use(launched)
    } finally {
      await launched.app.close().catch(() => undefined)
      rmSync(launched.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },
})

fast(
  'watching a GitHub Actions run by its link ends in one notification and a green dot',
  async ({ launched }) => {
    fast.setTimeout(60_000)
    const { app, win } = launched
    await turnOn(win, 'GitHub')
    await showView(win, 'Builds')
    await win
      .getByLabel("Watch a pull request's pipeline")
      .fill('https://github.demo.devdock.invalid/acme/payments-api/actions/runs/9101')
    await win.getByRole('button', { name: 'Watch pipeline' }).click()
    const watched = win.getByRole('list', { name: 'Watched runs' })
    await expect(watched).toContainText('payments-api CI #88')
    await expect(watched).toContainText('Running')

    await expect
      .poll(
        async () => {
          await callHook(app, 'pollRuns')
          const history = await win.evaluate(() => window.devdock.notifications.history())
          return history.ok ? history.data.map((n) => n.title) : []
        },
        { timeout: 40_000, intervals: [1_000] },
      )
      .toContain('Passed · payments-api CI #88')
    await expect.poll(() => callHook(app, 'trayStatus')).toBe('green')
    await expect(watched).toContainText('Passed')
    const tray = await callHook(app, 'trayState')
    expect(tray.watched.map((w) => [w.label, w.state])).toEqual([['payments-api CI #88', 'passed']])
  },
)
