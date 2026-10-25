import type { Page } from '@playwright/test'

export const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
}

const REPO = 'https://github.com/code08-ind/devdock'

export const MANIFEST = {
  version: '0.1.0',
  assets: {
    'mac-arm64': {
      name: 'DevDock-0.1.0-arm64.dmg',
      url: `${REPO}/releases/download/v0.1.0/DevDock-0.1.0-arm64.dmg`,
      size: 103_500_000,
    },
    'mac-x64': {
      name: 'DevDock-0.1.0-x64.dmg',
      url: `${REPO}/releases/download/v0.1.0/DevDock-0.1.0-x64.dmg`,
      size: 106_200_000,
    },
    'win-setup': {
      name: 'DevDock-Setup-0.1.0.exe',
      url: `${REPO}/releases/download/v0.1.0/DevDock-Setup-0.1.0.exe`,
      size: 88_400_000,
    },
    'win-portable': {
      name: 'DevDock-Portable-0.1.0.exe',
      url: `${REPO}/releases/download/v0.1.0/DevDock-Portable-0.1.0.exe`,
      size: 88_100_000,
    },
  },
}

/**
 * Pretends to be a browser on `os`: hides Chromium's own client hints (so the user agent decides,
 * like Safari/Firefox), optionally serves a releases.json, and answers GitHub downloads locally
 * with a small attachment so no real request leaves the machine.
 */
export async function setup(
  page: Page,
  { manifest = false, arch }: { manifest?: boolean; arch?: 'arm' | 'x86' } = {},
): Promise<void> {
  await page.addInitScript((architecture) => {
    const data = architecture
      ? {
          mobile: false,
          platform: navigator.userAgent.includes('Windows') ? 'Windows' : 'macOS',
          getHighEntropyValues: async () => ({ architecture }),
        }
      : undefined
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data })
  }, arch ?? null)
  await page.route('**/releases.json', (route) =>
    manifest ? route.fulfill({ json: MANIFEST }) : route.fulfill({ status: 404, body: '' }),
  )
  await page.route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename=${route.request().url().split('/').pop()}`,
      },
      body: 'not a real installer',
    }),
  )
}
