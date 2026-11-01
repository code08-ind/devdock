import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The built page as it ships: no console errors (a CSP violation would show here, e.g. from the
 * JSON-LD block), and the 404 page passes the same WCAG 2.2 AA rules as the site in both schemes.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const path of ['/', '/downloads']) {
  test(`the built page ${path} loads with no console errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`404 page (${colorScheme}): a way home and no axe violations`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/404.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to DevDock' })).toHaveAttribute('href', '/')
    const result = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    expect(result.violations.map((v) => v.id)).toEqual([])
  })
}
