import { describe, expect, it } from 'vitest'
import {
  FILE_NAMES as SCRIPT_NAMES,
  REPO as SCRIPT_REPO,
  toHistory,
  toManifest,
} from '../../scripts/releases-json.mjs'
import { REPO } from '../../src/config'
import { FILE_NAMES, releaseFromManifest, versionsFromManifest } from '../../src/downloads'

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

describe('all versions for the Downloads page', () => {
  const older = {
    tag_name: 'v0.0.9',
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T09:00:00Z',
    assets: [asset('DevDock-arm64.dmg', 90), asset('DevDock-0.0.9-Setup.exe', 80)],
  }

  it('keeps published releases with known files, newest first as given', () => {
    const list = toHistory([
      { ...release, published_at: '2026-11-01T18:40:00Z' },
      { ...release, tag_name: 'v0.2.0-beta', prerelease: true },
      { ...release, tag_name: 'v0.1.1', draft: true },
      { ...older },
      { tag_name: 'v0.0.1', draft: false, prerelease: false, assets: [asset('notes.txt')] },
    ])
    expect(list.map((r) => r.version)).toEqual(['0.1.0', '0.0.9'])
    expect(list[0]).toMatchObject({ tag: 'v0.1.0', date: '2026-11-01', checksums: true })
    expect(Object.keys(list[0]!.assets)).toHaveLength(4)
    // Only known names: the versioned Setup isn't offered.
    expect(list[1]).toMatchObject({ date: '2026-10-01', checksums: false })
    expect(Object.keys(list[1]!.assets)).toEqual(['mac-arm64'])
    expect(toHistory(null)).toEqual([])
  })

  it("the page links each version's own files and marks the latest", () => {
    const m = { ...toManifest(release)!, releases: toHistory([release, older]) }
    const latest = releaseFromManifest(m)!
    const versions = versionsFromManifest(m, latest)
    expect(versions.map((v) => [v.version, v.latest])).toEqual([
      ['0.1.0', true],
      ['0.0.9', false],
    ])
    expect(versions[1]!.installers.map((i) => i.url)).toEqual([
      `https://github.com/${REPO}/releases/download/v0.0.9/DevDock-arm64.dmg`,
    ])
    expect(versions[0]!.checksumsUrl).toBe(
      `https://github.com/${REPO}/releases/download/v0.1.0/SHA256SUMS.txt`,
    )
    expect(versions[1]!.checksumsUrl).toBeUndefined()
    expect(versions[1]!.notesUrl).toBe(`https://github.com/${REPO}/releases/tag/v0.0.9`)
  })

  it('ignores odd entries and falls back to the one known release', () => {
    const latest = releaseFromManifest(toManifest(release))!
    const odd = {
      releases: [
        { version: '1', tag: '../../evil', assets: { 'mac-arm64': { name: 'DevDock-arm64.dmg' } } },
        { version: '2', tag: 'v2', assets: { 'mac-arm64': { name: 'other.dmg' } } },
        {
          version: '3',
          tag: 'v3',
          date: 'yesterday',
          assets: { 'win-setup': { name: 'DevDock-Setup.exe' } },
        },
      ],
    }
    const v = versionsFromManifest(odd, latest)
    expect(v.map((x) => x.version)).toEqual(['3'])
    expect(v[0]!.date).toBeUndefined()
    // No list at all (local preview, older releases.json): the latest alone, with its own links.
    const alone = versionsFromManifest(null, latest)
    expect(alone).toHaveLength(1)
    expect(alone[0]).toMatchObject({ version: '0.1.0', latest: true })
    expect(alone[0]!.installers).toHaveLength(4)
  })
})
