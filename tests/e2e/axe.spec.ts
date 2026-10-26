import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { callHook, expect, test, windowFor } from './fixtures'

/**
 * P7.12: automated WCAG 2.2 AA checks (axe-core) on every view in every theme, the menu-bar
 * panel, the palette window and the dialogs. Axe finds what can be found automatically; the
 * keyboard rounds in a11y.spec.ts and the token ratios in contrast.test.ts cover the rest.
 */
const VIEWS = [
  'Home',
  'Today',
  'Repos',
  'Pull requests',
  'Builds',
  'Tickets',
  'Utilities',
  'Settings',
] as const
const THEMES = ['light', 'dark', 'high-contrast', 'paper', 'slate'] as const
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const show = (win: Page, label: string) =>
  win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click()
const segment = (win: Page, label: string) =>
  win.locator('label.segment', { hasText: label }).first().click()

/** Each violation as "rule: target" lines, so a failure names the element to fix. */
async function violations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(TAGS).setLegacyMode(true)
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.failureSummary}`),
  )
}

test('axe: every view in every theme has no WCAG 2.2 AA violations', async ({ launched }) => {
  test.setTimeout(240_000)
  const { win } = launched
  const found: string[] = []
  for (const theme of THEMES) {
    await win.evaluate(
      (t) => window.devdock.settings.update({ appearance: { theme: t } as never }),
      theme,
    )
    for (const view of VIEWS) {
      await show(win, view)
      await expect(win.locator('main h1')).toBeVisible()
      // Let queries settle so the scan sees the loaded view, not its skeleton.
      await win.waitForTimeout(300)
      found.push(...(await violations(win)).map((v) => `${theme} ${view}: ${v}`))
    }
  }
  expect(found).toEqual([])
})

test('axe: the menu-bar panel and the palette window', async ({ launched }) => {
  test.setTimeout(120_000)
  const found: string[] = []
  await callHook(launched.app, 'togglePanel')
  const panel = await windowFor(launched.app, 'panel.html')
  for (const tab of ['Today', 'Repos', 'Tickets', 'Tools']) {
    await panel.getByText(tab, { exact: true }).click()
    await panel.waitForTimeout(300)
    found.push(...(await violations(panel)).map((v) => `panel ${tab}: ${v}`))
  }
  await callHook(launched.app, 'togglePalette')
  const palette = await windowFor(launched.app, 'palette.html')
  await palette.getByRole('combobox').waitFor()
  found.push(...(await violations(palette)).map((v) => `palette window: ${v}`))
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
  found.push(...(await violations(win)).map((v) => `palette: ${v}`))
  await win.keyboard.press('Escape')

  await show(win, 'Tickets')
  await win.getByRole('button', { name: /^DD-101\b/ }).click()
  found.push(...(await violations(win)).map((v) => `issue details: ${v}`))
  await win
    .getByRole('complementary', { name: 'DD-101 details' })
    .getByRole('button', { name: 'Start work…' })
    .click()
  await win.getByRole('dialog', { name: 'Start work on DD-101' }).waitFor()
  found.push(...(await violations(win)).map((v) => `start work dialog: ${v}`))
  await win.keyboard.press('Escape')

  // The tabs inside views (each a different panel) and a build's details.
  await show(win, 'Pull requests')
  await segment(win, 'Reviewing')
  found.push(...(await violations(win)).map((v) => `PRs › Reviewing: ${v}`))
  await show(win, 'Utilities')
  for (const tab of ['Clean caches', 'Env profiles', 'Quick links', 'Standup']) {
    await segment(win, tab)
    await win.waitForTimeout(300)
    found.push(...(await violations(win)).map((v) => `Utilities › ${tab}: ${v}`))
  }
  await show(win, 'Builds')
  await win
    .getByRole('button', { name: /^Details and console of / })
    .first()
    .click()
  await win.getByRole('dialog').waitFor()
  await win.waitForTimeout(300)
  found.push(...(await violations(win)).map((v) => `build details: ${v}`))
  await win.keyboard.press('Escape')

  // Settings: a warning before PR actions turn on, and the diagnostics report.
  await show(win, 'Settings')
  await win
    .getByRole('region', { name: 'Bitbucket' })
    .getByRole('switch', { name: 'PR actions (approve, needs work, merge)' })
    .click()
  await win.getByRole('dialog', { name: 'Turn on PR actions?' }).waitFor()
  found.push(...(await violations(win)).map((v) => `PR actions warning: ${v}`))
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: 'Export diagnostics' }).click()
  await win.getByRole('dialog', { name: 'Diagnostics report' }).waitFor()
  found.push(...(await violations(win)).map((v) => `diagnostics report: ${v}`))
  expect(found).toEqual([])
})
