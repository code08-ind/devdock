import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { THEMES, VIEWS, callHook, expect, pickSegment, showView, test, windowFor } from './fixtures'

/**
 * P7.12: automated WCAG 2.2 AA checks (axe-core) on every view in every theme, the menu-bar
 * panel, the palette window and the dialogs. Axe finds what can be found automatically; the
 * keyboard rounds in a11y.spec.ts and the token ratios in contrast.test.ts cover the rest.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const show = showView
const segment = pickSegment
const setTheme = (win: Page, theme: string) =>
  win.evaluate((t) => window.devdock.settings.update({ appearance: { theme: t } as never }), theme)

/** Each violation as "where: rule: target" lines, so a failure names the element to fix. */
async function violations(page: Page, where: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).setLegacyMode(true).analyze()
  return violations.flatMap((v) =>
    v.nodes.map(
      (n) => `${where}: ${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.failureSummary}`,
    ),
  )
}

test('axe: every view in every theme has no WCAG 2.2 AA violations', async ({ launched }) => {
  test.setTimeout(240_000)
  const { win } = launched
  const found: string[] = []
  for (const theme of THEMES) {
    await setTheme(win, theme)
    for (const view of VIEWS) {
      await show(win, view)
      await expect(win.locator('main h1')).toBeVisible()
      // Let queries settle so the scan sees the loaded view, not its skeleton.
      await win.waitForTimeout(300)
      found.push(...(await violations(win, `${theme} ${view}`)))
    }
  }
  expect(found).toEqual([])
})

test('axe: the menu-bar panel and the palette window in every theme', async ({ launched }) => {
  test.setTimeout(180_000)
  const found: string[] = []
  await callHook(launched.app, 'togglePanel')
  const panel = await windowFor(launched.app, 'panel.html')
  await callHook(launched.app, 'togglePalette')
  const palette = await windowFor(launched.app, 'palette.html')
  await palette.getByRole('combobox').waitFor()
  for (const theme of THEMES) {
    // Settings are shared: every window follows the theme.
    await setTheme(launched.win, theme)
    await expect(panel.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(palette.locator('html')).toHaveAttribute('data-theme', theme)
    for (const tab of ['Today', 'Repos', 'Tickets', 'Tools']) {
      await panel.getByText(tab, { exact: true }).click()
      await panel.waitForTimeout(300)
      found.push(...(await violations(panel, `${theme} panel ${tab}`)))
    }
    found.push(...(await violations(palette, `${theme} palette window`)))
  }
  expect(found).toEqual([])
})

test('axe: the command palette and dialogs in the main window', async ({ launched }) => {
  test.setTimeout(90_000)
  const { win } = launched
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const found: string[] = []
  await show(win, 'Today')
  await win.keyboard.press(`${mod}+K`)
  await win.getByTestId('command-palette').waitFor()
  found.push(...(await violations(win, `palette`)))
  await win.keyboard.press('Escape')

  await show(win, 'Tickets')
  await win.getByRole('button', { name: /^DD-101\b/ }).click()
  found.push(...(await violations(win, `issue details`)))
  await win
    .getByRole('complementary', { name: 'DD-101 details' })
    .getByRole('button', { name: 'Start work…' })
    .click()
  await win.getByRole('dialog', { name: 'Start work on DD-101' }).waitFor()
  found.push(...(await violations(win, `start work dialog`)))
  await win.keyboard.press('Escape')

  // The tabs inside views (each a different panel) and a build's details.
  await show(win, 'Pull requests')
  await segment(win, 'Reviewing')
  found.push(...(await violations(win, `PRs › Reviewing`)))
  await show(win, 'Utilities')
  for (const tab of ['Clean caches', 'Env profiles', 'Quick links', 'Standup']) {
    await segment(win, tab)
    await win.waitForTimeout(300)
    found.push(...(await violations(win, `Utilities › ${tab}`)))
  }
  await show(win, 'Builds')
  await win
    .getByRole('button', { name: /^Details and console of / })
    .first()
    .click()
  await win.getByRole('dialog').waitFor()
  await win.waitForTimeout(300)
  found.push(...(await violations(win, `build details`)))
  await win.keyboard.press('Escape')

  // Settings: a warning before PR actions turn on, and the diagnostics report.
  await show(win, 'Settings')
  await win
    .getByRole('region', { name: 'Bitbucket' })
    .getByRole('switch', { name: 'PR actions (approve, needs work, merge)' })
    .click()
  await win.getByRole('dialog', { name: 'Turn on PR actions?' }).waitFor()
  found.push(...(await violations(win, `PR actions warning`)))
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: 'Export diagnostics' }).click()
  await win.getByRole('dialog', { name: 'Diagnostics report' }).waitFor()
  found.push(...(await violations(win, `diagnostics report`)))
  expect(found).toEqual([])
})

test('axe: GitHub and GitLab (P7-B) — lists, runs, the run dialog and CI action confirm, every theme', async ({
  launched,
}) => {
  test.setTimeout(180_000)
  const { win } = launched
  await win.evaluate(() =>
    window.devdock.settings.update({
      github: { enabled: true },
      gitlab: { enabled: true },
      features: { ciActions: true },
    } as never),
  )
  const found: string[] = []
  for (const theme of THEMES) {
    await setTheme(win, theme)
    await show(win, 'Pull requests')
    await expect(win.getByRole('list', { name: 'My PRs' })).toContainText('checkout !42')
    found.push(...(await violations(win, `${theme} PRs (all providers)`)))
    await show(win, 'Builds')
    for (const tab of ['GitHub Actions', 'GitLab pipelines']) {
      await segment(win, tab)
      await expect(win.getByRole('list', { name: tab })).toBeVisible()
      found.push(...(await violations(win, `${theme} Builds › ${tab}`)))
    }
    await win
      .getByRole('button', { name: /^Jobs and log of / })
      .first()
      .click()
    const dialog = win.getByRole('dialog')
    await expect(dialog.getByRole('log', { name: 'Job log' })).not.toBeEmpty()
    found.push(...(await violations(win, `${theme} run dialog`)))
    await win.keyboard.press('Escape')
    await win
      .getByRole('button', { name: /^(Retry failed jobs|Cancel pipeline): / })
      .first()
      .click()
    await win.getByRole('dialog').waitFor()
    found.push(...(await violations(win, `${theme} CI action confirm`)))
    await win.keyboard.press('Escape')
    await show(win, 'Settings')
    found.push(...(await violations(win, `${theme} Settings with GitHub / GitLab on`)))
  }
  expect(found).toEqual([])
})
