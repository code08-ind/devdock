// Renders scripts/og-card.html to public/og.png (1200×630, the link-preview image).
// Run from website/: node scripts/og-image.mjs  (needs Playwright's Chromium: npx playwright install chromium)
import { chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto(pathToFileURL(here('./og-card.html')).href)
await page.evaluate(() => globalThis.document.fonts.ready)
await page.screenshot({ path: here('../public/og.png') })
await browser.close()
