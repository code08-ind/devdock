import { describe, expect, it } from 'vitest'
import {
  FILE_NAMES as SCRIPT_NAMES,
  REPO as SCRIPT_REPO,
  toManifest,
} from '../../scripts/releases-json.mjs'
import { REPO } from '../../src/config'
import { FILE_NAMES, releaseFromManifest } from '../../src/downloads'

const asset = (name: string, size = 1) => ({
  name,
  size,
  browser_download_url: `https://github.com/${REPO}/releases/download/v0.1.0/${name}`,
})

const release = {
  tag_name: 'v0.1.0',
  draft: false,
  prerelease: false,
  assets: [
    asset('DevDock-arm64.dmg', 103_500_000),
    asset('DevDock-x64.dmg', 106_200_000),
    asset('DevDock-Setup.exe', 98_200_000),
    asset('DevDock-Portable.exe'),
    asset('SHA256SUMS.txt'),
  ],
}

describe('releases.json from the GitHub API (Vercel build)', () => {
  it('uses the same repo and file names as the page', () => {
    expect(SCRIPT_REPO).toBe(REPO)
    expect(SCRIPT_NAMES).toEqual(FILE_NAMES)
  })

  it('maps every installer, and the page accepts the result', () => {
    const m = toManifest(release)
    expect(m?.version).toBe('0.1.0')
    expect(m?.assets['mac-arm64']).toEqual({ name: 'DevDock-arm64.dmg', size: 103_500_000 })
    expect(m?.assets['win-setup']?.size).toBe(98_200_000)
    expect(releaseFromManifest(m)?.available).toBe(true)
  })

  it('writes nothing for drafts, pre-releases, a missing installer or versioned names', () => {
    expect(toManifest(null)).toBeNull()
    expect(toManifest({ ...release, draft: true })).toBeNull()
    expect(toManifest({ ...release, prerelease: true })).toBeNull()
    expect(toManifest({ ...release, assets: release.assets.slice(1) })).toBeNull()
    expect(
      toManifest({
        ...release,
        assets: [
          'DevDock-0.1.0-arm64.dmg',
          'DevDock-0.1.0-x64.dmg',
          'DevDock-Setup-0.1.0.exe',
          'DevDock-Portable-0.1.0.exe',
        ].map((n) => asset(n)),
      }),
    ).toBeNull()
  })
})
