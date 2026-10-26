import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { setup, UA } from './helpers'

/**
 * Automated WCAG 2.2 AA checks (axe-core, the same rules as the app's tests/e2e/axe.spec.ts) on
 * the whole page in every theme, before and after a release exists, and with the install dialog
 * open. Keyboard use is covered in site.spec.ts; theme colours by tests/unit/themes.test.ts.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const THEMES = ['light', 'dark', 'hc', 'paper', 'slate']

/** Each violation as "rule: target" lines, so a failure names the element to fix. */
async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`))
}

test.use({ userAgent: UA.mac })

for (const theme of THEMES) {
  test(`no axe violations in the ${theme} theme`, async ({ page }) => {
    // Saved before load (as a returning visitor's choice): switching live would scan mid-transition.
    await page.addInitScript((t) => localStorage.setItem('devdock-site-theme', t), theme)
    await setup(page, { manifest: true })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    expect(await violations(page)).toEqual([])
  })
}

test('no axe violations while downloads are "coming soon"', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Downloads coming soon' })).toBeVisible()
  expect(await violations(page)).toEqual([])
})

test('no axe violations with the install dialog open', async ({ page }) => {
  await setup(page, { manifest: true })
  await page.goto('/')
  const downloading = page.waitForEvent('download')
  await page
    .locator('#download')
    .getByRole('link', { name: 'Download for macOS (Apple silicon)' })
    .click()
  await downloading
  await expect(page.getByRole('dialog', { name: 'Thanks for downloading DevDock' })).toBeVisible()
  expect(await violations(page)).toEqual([])
})
