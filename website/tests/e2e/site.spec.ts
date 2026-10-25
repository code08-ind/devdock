import { expect, test } from '@playwright/test'
import { setup, UA } from './helpers'

test.describe('no release yet (shipped config)', () => {
  test.use({ userAgent: UA.mac })

  test('says "Downloads coming soon" and links to no installer', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    const section = page.locator('#download')
    await expect(section.getByRole('heading', { name: 'Downloads coming soon' })).toBeVisible()
    await expect(page.locator('a[data-asset]')).toHaveCount(0)
    await expect(page.locator('a[href*="/releases/download/"]')).toHaveCount(0)
    await expect(page.locator('#hero-meta')).toContainText('Downloads coming soon')
  })
})

test.describe('Mac, browser without CPU hints (Safari/Firefox)', () => {
  test.use({ userAgent: UA.mac })

  test('offers Apple silicon first, with an Intel link and all installers', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    const section = page.locator('#download')
    const primary = section.getByRole('link', { name: 'Download for macOS (Apple silicon)' })
    await expect(primary).toHaveAttribute('href', /DevDock-0\.1\.0-arm64\.dmg$/)
    await expect(primary).toHaveAttribute('download', 'DevDock-0.1.0-arm64.dmg')
    await expect(section.getByText('Intel Mac?')).toBeVisible()
    await expect(section.getByRole('link', { name: 'Download for Intel' })).toHaveAttribute(
      'href',
      /DevDock-0\.1\.0-x64\.dmg$/,
    )
    await expect(section.locator('table.installers tbody tr')).toHaveCount(4)
    await expect(section.getByText('103.5 MB').first()).toBeVisible()
    await expect(
      page.locator('#hero-download').getByRole('link', { name: /Apple silicon/ }),
    ).toBeVisible()
  })

  test('download starts natively and the dialog shows the macOS steps', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    const downloading = page.waitForEvent('download')
    await page
      .locator('#download')
      .getByRole('link', { name: 'Download for macOS (Apple silicon)' })
      .click()
    expect((await downloading).suggestedFilename()).toBe('DevDock-0.1.0-arm64.dmg')
    const dialog = page.getByRole('dialog', { name: 'Thanks for downloading DevDock' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Install DevDock on your Mac')
    await expect(dialog).toContainText('Applications')
    await expect(dialog).toContainText('System Settings → Privacy & Security')
    await expect(dialog).toContainText('Open Anyway')
    await expect(dialog).toContainText('IT team')
    await expect(dialog).not.toContainText('Run anyway')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test.describe('Mac, Chromium says Intel', () => {
  test.use({ userAgent: UA.mac })

  test('offers the Intel DMG first', async ({ page }) => {
    await setup(page, { manifest: true, arch: 'x86' })
    await page.goto('/')
    await expect(
      page.locator('#download').getByRole('link', { name: 'Download for macOS (Intel)' }),
    ).toHaveAttribute('href', /x64\.dmg$/)
  })
})

test.describe('Windows', () => {
  test.use({ userAgent: UA.windows })

  test('offers the Setup and shows the SmartScreen steps', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    const primary = page.locator('#download').getByRole('link', { name: 'Download for Windows' })
    await expect(primary).toHaveAttribute('href', /DevDock-Setup-0\.1\.0\.exe$/)
    const downloading = page.waitForEvent('download')
    await primary.click()
    expect((await downloading).suggestedFilename()).toBe('DevDock-Setup-0.1.0.exe')
    const dialog = page.getByRole('dialog', { name: 'Thanks for downloading DevDock' })
    await expect(dialog).toContainText('Install DevDock on Windows')
    await expect(dialog).toContainText('More info')
    await expect(dialog).toContainText('Run anyway')
    await expect(dialog).not.toContainText('Open Anyway')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
  })

  test('the portable link opens the portable steps', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    await page.locator('#download').getByRole('link', { name: 'Get the portable version' }).click()
    await expect(page.getByRole('dialog')).toContainText('Nothing is installed')
  })
})

test.describe('Linux', () => {
  test.use({ userAgent: UA.linux })

  test('explains there is no Linux build and lists every installer', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    const section = page.locator('#download')
    await expect(section).toContainText('no Linux build yet')
    await expect(section.locator('.btn-lg')).toHaveCount(0)
    await expect(section.locator('table.installers tbody tr')).toHaveCount(4)
  })
})

test.describe('page basics', () => {
  test.use({ userAgent: UA.mac })

  test('feature tabs work with the keyboard; theme choice applies', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    const tabs = page.getByRole('tablist', { name: 'Features' })
    await tabs.getByRole('tab', { name: 'Today' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: 'Repos' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    await expect(page.locator('#tp-repos')).toBeVisible()

    await page.getByLabel('Theme').selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('every image has alt text and there are no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await setup(page)
    await page.goto('/')
    for (const img of await page.locator('img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull()
    }
    // 404 for releases.json is expected (no release yet); anything else is a bug.
    expect(errors.filter((e) => !/404|releases\.json/.test(e))).toEqual([])
  })
})
