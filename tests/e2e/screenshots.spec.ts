import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixtures'

/**
 * P0.25: Today in Light and Dark, written to docs/screenshots/ (demo mode, default window).
 * Opt-in (`npm run screenshots`) so ordinary e2e runs don't rewrite tracked images.
 */
const out = join(import.meta.dirname, '../../docs/screenshots')

test.skip(!process.env.DEVDOCK_SCREENSHOTS, 'run with npm run screenshots')

test('screenshots: Today in Light and Dark', async ({ launched }) => {
  const { win } = launched
  mkdirSync(out, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((t) => window.devdock.settings.update({ appearance: { theme: t } }), theme)
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme)
    await win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Today' })
      .click()
    await expect(win.locator('main')).toHaveAttribute('data-view', 'today')
    await win.screenshot({ path: join(out, `today-${theme}.png`), animations: 'disabled' })
  }
})
