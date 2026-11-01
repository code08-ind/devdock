import { expect, test } from '@playwright/test'
import { setup, UA } from './helpers'

test.describe('Downloads page, no releases.json (shipped config)', () => {
  test.use({ userAgent: UA.mac })

  test('offers v0.1.0 from the config: latest-release links, no "coming soon"', async ({
    page,
  }) => {
    await setup(page)
    await page.goto('/downloads')
    const section = page.locator('#latest')
    await expect(
      section.getByRole('link', { name: 'Download for macOS (Apple silicon)' }),
    ).toHaveAttribute('href', /\/releases\/latest\/download\/DevDock-arm64\.dmg$/)
    await expect(page.locator('#versions article').first().locator('tbody tr')).toHaveCount(4)
    await expect(page.locator('#versions').getByText('108.8 MB').first()).toBeVisible()
    // The one version the config knows, with that version's own links.
    await expect(page.locator('#versions article')).toHaveCount(1)
    await expect(
      page.locator('#versions').getByRole('link', { name: 'Download macOS, Intel' }),
    ).toHaveAttribute('href', /\/releases\/download\/v0\.1\.0\/DevDock-x64\.dmg$/)
    await expect(page.getByText('Downloads coming soon')).toHaveCount(0)
  })
})

test.describe('Mac, browser without CPU hints (Safari/Firefox)', () => {
  test.use({ userAgent: UA.mac })

  test('offers Apple silicon first, with an Intel link and all installers', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/downloads')
    const section = page.locator('#latest')
    const primary = section.getByRole('link', { name: 'Download for macOS (Apple silicon)' })
    await expect(primary).toHaveAttribute(
      'href',
      /\/releases\/latest\/download\/DevDock-arm64\.dmg$/,
    )
    await expect(primary).toHaveAttribute('download', 'DevDock-arm64.dmg')
    await expect(section.getByText('Intel Mac?')).toBeVisible()
    await expect(section.getByRole('link', { name: 'Download for Intel' })).toHaveAttribute(
      'href',
      /\/releases\/latest\/download\/DevDock-x64\.dmg$/,
    )
    await expect(page.locator('#versions article').first().locator('tbody tr')).toHaveCount(4)
    await expect(page.locator('#versions').getByText('103.5 MB').first()).toBeVisible()
  })

  test('download starts natively and the dialog shows the macOS steps', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/downloads')
    const downloading = page.waitForEvent('download')
    await page
      .locator('#latest')
      .getByRole('link', { name: 'Download for macOS (Apple silicon)' })
      .click()
    expect((await downloading).suggestedFilename()).toBe('DevDock-arm64.dmg')
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
    await page.goto('/downloads')
    await expect(
      page.locator('#latest').getByRole('link', { name: 'Download for macOS (Intel)' }),
    ).toHaveAttribute('href', /x64\.dmg$/)
  })
})

test.describe('Windows', () => {
  test.use({ userAgent: UA.windows })

  test('offers the Setup and shows the SmartScreen steps', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/downloads')
    const primary = page.locator('#latest').getByRole('link', { name: 'Download for Windows' })
    await expect(primary).toHaveAttribute(
      'href',
      /\/releases\/latest\/download\/DevDock-Setup\.exe$/,
    )
    const downloading = page.waitForEvent('download')
    await primary.click()
    expect((await downloading).suggestedFilename()).toBe('DevDock-Setup.exe')
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
    await page.goto('/downloads')
    await page.locator('#latest').getByRole('link', { name: 'Get the portable version' }).click()
    await expect(page.getByRole('dialog')).toContainText('Nothing is installed')
  })
})

test.describe('Linux', () => {
  test.use({ userAgent: UA.linux })

  test('explains there is no Linux build and lists every installer', async ({ page }) => {
    await setup(page, { manifest: true })
    await page.goto('/downloads')
    const section = page.locator('#latest')
    await expect(section).toContainText('no Linux build yet')
    await expect(section.locator('.btn-lg')).toHaveCount(0)
    await expect(page.locator('#versions article').first().locator('tbody tr')).toHaveCount(4)
  })
})

test.describe('Downloads page: all versions', () => {
  test.use({ userAgent: UA.mac })

  test('lists every release newest first with its own files, notes and checksums', async ({
    page,
  }) => {
    await setup(page, { manifest: true })
    await page.goto('/downloads')
    const versions = page.locator('#versions article')
    await expect(versions).toHaveCount(2)
    const latest = versions.nth(0)
    await expect(latest.getByRole('heading', { name: 'DevDock 0.1.0' })).toBeVisible()
    await expect(latest.getByText('Latest', { exact: true })).toBeVisible()
    await expect(latest.locator('time')).toHaveAttribute('datetime', '2026-11-01')
    await expect(latest.locator('tbody tr')).toHaveCount(4)
    await expect(latest.getByRole('link', { name: 'SHA-256 checksums for 0.1.0' })).toHaveAttribute(
      'href',
      /\/releases\/download\/v0\.1\.0\/SHA256SUMS\.txt$/,
    )
    const older = versions.nth(1)
    await expect(older.getByRole('heading', { name: 'DevDock 0.0.9' })).toBeVisible()
    await expect(older.getByText('Latest', { exact: true })).toHaveCount(0)
    // Only the files that release has; no checksums link when it has none.
    await expect(older.locator('tbody tr')).toHaveCount(2)
    await expect(older.getByRole('link', { name: /checksums/ })).toHaveCount(0)
    await expect(older.getByRole('link', { name: 'Release notes for 0.0.9' })).toHaveAttribute(
      'href',
      /\/releases\/tag\/v0\.0\.9$/,
    )
    const link = older.getByRole('link', { name: 'Download macOS, Apple silicon (M1 and later)' })
    await expect(link).toHaveAttribute(
      'href',
      /\/releases\/download\/v0\.0\.9\/DevDock-arm64\.dmg$/,
    )
    const downloading = page.waitForEvent('download')
    await link.click()
    expect((await downloading).suggestedFilename()).toBe('DevDock-arm64.dmg')
    await expect(page.getByRole('dialog', { name: 'Thanks for downloading DevDock' })).toBeVisible()
  })
})

test.describe('home page links to the Downloads page', () => {
  test.use({ userAgent: UA.mac })

  test('no direct installer links; Mac and Windows buttons open the Downloads page', async ({
    page,
  }) => {
    await setup(page, { manifest: true })
    await page.goto('/')
    const hero = page.locator('#hero-download')
    await expect(hero.getByRole('link', { name: 'Download for Mac' })).toHaveAttribute(
      'href',
      'downloads#mac',
    )
    await expect(page.locator('a[data-asset]')).toHaveCount(0)
    await expect(page.locator('#hero-meta')).toContainText('Version 0.1.0')
    await page.locator('#download').getByRole('link', { name: 'Download for Windows' }).click()
    await expect(page).toHaveURL(/\/downloads#windows$/)
    const first = page.locator('#latest .platform').first()
    await expect(first.getByRole('heading', { name: 'Windows' })).toBeVisible()
    await expect(first.getByText('You picked this')).toBeVisible()
    await expect(first).toBeInViewport()
  })

  test('the header Download link and the closing button open it too', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await expect(page.locator('header').getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'downloads',
    )
    await page.getByRole('link', { name: 'Get DevDock' }).click()
    await expect(page).toHaveURL(/\/downloads$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Download DevDock' })).toBeVisible()
    // The visitor's own system first when nothing was picked.
    await expect(page.locator('#latest .platform').first()).toContainText('For this computer')
  })
})

test.describe('page basics', () => {
  test.use({ userAgent: UA.mac })

  test('feature tabs work with the keyboard; the theme toggle applies and is kept', async ({
    page,
  }) => {
    await setup(page)
    await page.goto('/')
    const tabs = page.getByRole('tablist', { name: 'Features' })
    await tabs.getByRole('tab', { name: 'Today' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: 'Menu-bar panel' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    await expect(page.locator('#tp-panel')).toBeVisible()

    const toggle = page.getByRole('button', { name: 'Dark theme' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('every image has alt text and there are no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await setup(page)
    for (const path of ['/', '/downloads']) {
      await page.goto(path)
      for (const img of await page.locator('img').all()) {
        expect(await img.getAttribute('alt')).not.toBeNull()
      }
    }
    // 404 for releases.json is expected (served only on Vercel); anything else is a bug.
    expect(errors.filter((e) => !/404|releases\.json/.test(e))).toEqual([])
  })
})

test.describe('demo clips', () => {
  test.use({ userAgent: UA.mac })

  test('every clip has a poster and sources that load; it plays when shown and can be paused', async ({
    page,
    request,
  }) => {
    await setup(page)
    await page.goto('/')
    const videos = page.locator('video[data-demo]')
    expect(await videos.count()).toBe(6)
    for (const v of await videos.all()) {
      await expect(v).toHaveAttribute('aria-label', /^Demo: /)
      for (const src of [
        await v.getAttribute('poster'),
        ...(await v.locator('source').evaluateAll((s) => s.map((e) => e.getAttribute('src')))),
      ]) {
        expect((await request.get(`/${src}`)).status(), String(src)).toBe(200)
      }
    }
    await page
      .getByRole('tablist', { name: 'Features' })
      .getByRole('tab', { name: 'Repos' })
      .click()
    const panel = page.locator('#tp-repos')
    await panel.scrollIntoViewIfNeeded()
    const video = panel.locator('video')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)
    const toggle = panel.getByRole('button', { name: /^Pause the clip/ })
    await toggle.click()
    await expect(panel.getByRole('button', { name: /^Play the clip/ })).toBeVisible()
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  })

  test('with reduced motion, a clip waits for Play', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setup(page)
    await page.goto('/')
    await page
      .getByRole('tablist', { name: 'Features' })
      .getByRole('tab', { name: 'Repos' })
      .click()
    const panel = page.locator('#tp-repos')
    await panel.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    expect(await panel.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await panel.getByRole('button', { name: /^Play the clip/ }).click()
    await expect(panel.getByRole('button', { name: /^Pause the clip/ })).toBeVisible()
  })
})

test.describe('hero buttons follow the visitor’s system', () => {
  for (const [os, ua, first, second] of [
    ['Mac', UA.mac, /Download for Mac/, /Download for Windows/],
    ['Windows', UA.windows, /Download for Windows/, /Download for Mac/],
  ] as const) {
    test(`${os}: its own system is the primary button, with its logo`, async ({ browser }) => {
      const page = await browser.newPage({ userAgent: ua })
      await setup(page, { manifest: true })
      await page.goto('/')
      const buttons = page.locator('#hero-download a')
      await expect(buttons.nth(0)).toHaveAttribute('href', /^downloads#(mac|windows)$/)
      await expect(buttons).toHaveCount(2)
      await expect(buttons.nth(0)).toHaveAccessibleName(first)
      await expect(buttons.nth(0)).toHaveClass(/btn-primary/)
      await expect(buttons.nth(1)).toHaveAccessibleName(second)
      await expect(buttons.nth(1)).toHaveClass(/btn-outline/)
      for (const b of await buttons.all()) await expect(b.locator('svg use')).toHaveCount(1)
      await page.close()
    })
  }
})

test.describe('family and layout', () => {
  test.use({ userAgent: UA.mac })

  test('links back to aryangarg.com in the header and footer', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await expect(page.locator('header a[href="https://www.aryangarg.com/"]')).toHaveText(
      'by Aryan Garg',
    )
    await expect(page.locator('footer a[href="https://www.aryangarg.com/"]')).toHaveCount(1)
  })

  test('no horizontal scrolling at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await setup(page, { manifest: true })
    for (const [path, ready] of [
      ['/', '#download-root .download-cta'],
      ['/downloads', '#download-root .platform'],
    ] as const) {
      await page.goto(path)
      await page.locator(ready).first().waitFor()
      const [scroll, client] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scroll, path).toBe(client)
    }
  })
})
