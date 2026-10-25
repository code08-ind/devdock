import { describe, expect, it } from 'vitest'
import { toManifest } from '../../scripts/releases-json.mjs'
import { releaseFromManifest } from '../../src/downloads'

const base = 'https://github.com/code08-ind/devdock/releases/download/v0.1.0'
const asset = (name: string, size = 1) => ({
  name,
  size,
  browser_download_url: `${base}/${name}`,
})

const release = {
  tag_name: 'v0.1.0',
  draft: false,
  prerelease: false,
  assets: [
    asset('DevDock-0.1.0-arm64.dmg', 103_500_000),
    asset('DevDock-0.1.0-x64.dmg', 106_200_000),
    asset('DevDock-Setup-0.1.0.exe'),
    asset('DevDock-Portable-0.1.0.exe'),
    asset('SHA256SUMS.txt'),
  ],
}

describe('releases.json from the GitHub API (deploy workflow)', () => {
  it('maps every installer, and the page accepts the result', () => {
    const m = toManifest(release)
    expect(m?.version).toBe('0.1.0')
    expect(m?.assets['mac-arm64']?.name).toBe('DevDock-0.1.0-arm64.dmg')
    expect(m?.assets['mac-x64']?.name).toBe('DevDock-0.1.0-x64.dmg')
    expect(m?.assets['win-setup']?.size).toBe(1)
    expect(releaseFromManifest(m)?.available).toBe(true)
  })

  it('works with version-less names too', () => {
    const m = toManifest({
      ...release,
      assets: ['DevDock-arm64.dmg', 'DevDock-x64.dmg', 'DevDock-Setup.exe', 'DevDock-Portable.exe'].map(
        (n) => asset(n),
      ),
    })
    expect(m?.assets['mac-x64']?.name).toBe('DevDock-x64.dmg')
  })

  it('writes nothing for drafts, pre-releases or a missing installer', () => {
    expect(toManifest({ ...release, draft: true })).toBeNull()
    expect(toManifest({ ...release, prerelease: true })).toBeNull()
    expect(toManifest({ ...release, assets: release.assets.slice(1) })).toBeNull()
  })
})
