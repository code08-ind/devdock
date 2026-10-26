import { test } from '@playwright/test'
import { setup, UA } from './helpers'

/**
 * Full-page screenshots for a visual review, only when SHOTS_DIR is set:
 *   SHOTS_DIR=/some/folder npx playwright test screens
 */
const dir = process.env.SHOTS_DIR
test.skip(!dir, 'set SHOTS_DIR to take screenshots')

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

for (const scheme of ['light', 'dark'] as const) {
  for (const size of sizes) {
    test(`${scheme} ${size.name}`, async ({ browser }) => {
      for (const [label, manifest, ua] of [
        ['mac', true, UA.mac],
        ['soon', false, UA.mac],
        ['windows', true, UA.windows],
      ] as const) {
        if (label !== 'mac' && size.name === 'mobile' && scheme === 'dark') continue
        const context = await browser.newContext({
          colorScheme: scheme,
          viewport: { width: size.width, height: size.height },
          userAgent: ua,
          reducedMotion: 'reduce',
        })
        const page = await context.newPage()
        await setup(page, { manifest })
        await page.goto('/')
        await page.locator('#download-root .card').first().waitFor()
        // Load lazy images before a full-page shot.
        await page.evaluate(async () => {
          for (const img of document.querySelectorAll('img')) img.loading = 'eager'
          await Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
        })
        await page.screenshot({
          path: `${dir}/${scheme}-${size.name}-${label}.png`,
          fullPage: true,
        })
        await page.screenshot({ path: `${dir}/${scheme}-${size.name}-${label}-top.png` })
        await page
          .locator('#download')
          .screenshot({ path: `${dir}/${scheme}-${size.name}-${label}-download.png` })
        if (label === 'windows' || (label === 'mac' && size.name === 'mobile')) {
          await page.locator('#download a[data-asset]').first().click()
          await page.getByRole('dialog').waitFor()
          await page.screenshot({ path: `${dir}/${scheme}-${size.name}-${label}-dialog.png` })
        }
        await context.close()
      }
    })
  }
}
