import { describe as group, expect, it } from 'vitest'
import { detect, primaryAsset, type NavigatorLike } from '../../src/detect'

const UA = {
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  macFirefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
}

function chromium(userAgent: string, platform: string, architecture: string): NavigatorLike {
  return {
    userAgent,
    userAgentData: {
      mobile: false,
      platform,
      getHighEntropyValues: async () => ({ architecture }),
    },
  }
}

async function assetFor(nav: NavigatorLike) {
  return primaryAsset(await detect(nav))
}

group('OS and CPU detection → installer', () => {
  it('Chrome on Apple silicon (client hint "arm") → arm64 DMG', async () => {
    const nav = chromium(UA.macChrome, 'macOS', 'arm')
    expect(await detect(nav)).toEqual({ os: 'mac', arch: 'arm64' })
    expect(await assetFor(nav)).toBe('mac-arm64')
  })

  it('Chrome on an Intel Mac (client hint "x86") → x64 DMG', async () => {
    const nav = chromium(UA.macChrome, 'macOS', 'x86')
    expect(await detect(nav)).toEqual({ os: 'mac', arch: 'x64' })
    expect(await assetFor(nav)).toBe('mac-x64')
  })

  it('Safari and Firefox on a Mac (no hint; UA always says Intel) → defaults to Apple silicon', async () => {
    expect(await detect({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toEqual({
      os: 'mac',
      arch: 'unknown',
    })
    expect(await assetFor({ userAgent: UA.macSafari })).toBe('mac-arm64')
    expect(await assetFor({ userAgent: UA.macFirefox })).toBe('mac-arm64')
  })

  it('a refused high-entropy hint falls back to the user agent', async () => {
    const nav: NavigatorLike = {
      userAgent: UA.macChrome,
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: () => Promise.reject(new Error('NotAllowedError')),
      },
    }
    expect(await detect(nav)).toEqual({ os: 'mac', arch: 'unknown' })
    expect(await assetFor(nav)).toBe('mac-arm64')
  })

  it('Windows (Chrome with hints, Firefox without) → Setup', async () => {
    expect(await detect(chromium(UA.winChrome, 'Windows', 'x86'))).toEqual({
      os: 'windows',
      arch: 'x64',
    })
    expect(await assetFor(chromium(UA.winChrome, 'Windows', 'x86'))).toBe('win-setup')
    expect(await detect({ userAgent: UA.winFirefox })).toEqual({ os: 'windows', arch: 'x64' })
    expect(await assetFor({ userAgent: UA.winFirefox })).toBe('win-setup')
  })

  it('Windows on Arm still gets the x64 Setup (runs under emulation)', async () => {
    const nav = chromium(UA.winChrome, 'Windows', 'arm')
    expect(await detect(nav)).toEqual({ os: 'windows', arch: 'arm64' })
    expect(await assetFor(nav)).toBe('win-setup')
  })

  it('Linux, phones and iPads get no primary installer', async () => {
    expect(await detect({ userAgent: UA.linux })).toEqual({ os: 'linux', arch: 'unknown' })
    expect(await assetFor({ userAgent: UA.linux })).toBeNull()
    expect(await assetFor({ userAgent: UA.iphone })).toBeNull()
    expect(await assetFor({ userAgent: UA.android })).toBeNull()
    // iPadOS asks for desktop sites with a Mac user agent, but has touch points.
    expect(await detect({ userAgent: UA.macSafari, maxTouchPoints: 5 })).toEqual({
      os: 'mobile',
      arch: 'unknown',
    })
    expect(
      await assetFor({
        userAgent: UA.android,
        userAgentData: { mobile: true, platform: 'Android' },
      }),
    ).toBeNull()
  })

  it('an unknown system gets no primary installer', async () => {
    expect(await assetFor({ userAgent: 'curl/8.0' })).toBeNull()
  })
})
