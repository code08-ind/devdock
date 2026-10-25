import { describe, expect, it } from 'vitest'
import { RELEASE_CONFIG, type ReleaseConfig } from '../../src/config'
import {
  assetUrl,
  fileName,
  formatSize,
  loadRelease,
  releaseFromConfig,
  releaseFromManifest,
} from '../../src/downloads'

const REPO = 'https://github.com/code08-ind/devdock'

describe('installer names and links', () => {
  it('versioned names match electron-builder.yml and link to the version tag', () => {
    expect(fileName('mac-arm64', 'versioned', '0.1.0')).toBe('DevDock-0.1.0-arm64.dmg')
    expect(fileName('mac-x64', 'versioned', '0.1.0')).toBe('DevDock-0.1.0-x64.dmg')
    expect(fileName('win-setup', 'versioned', '0.1.0')).toBe('DevDock-Setup-0.1.0.exe')
    expect(fileName('win-portable', 'versioned', '0.1.0')).toBe('DevDock-Portable-0.1.0.exe')
    expect(assetUrl('DevDock-0.1.0-arm64.dmg', 'versioned', '0.1.0')).toBe(
      `${REPO}/releases/download/v0.1.0/DevDock-0.1.0-arm64.dmg`,
    )
  })

  it('version-less names link to releases/latest/download', () => {
    expect(fileName('mac-arm64', 'versionless', '9.9.9')).toBe('DevDock-arm64.dmg')
    expect(fileName('win-setup', 'versionless', '9.9.9')).toBe('DevDock-Setup.exe')
    expect(fileName('win-portable', 'versionless', '9.9.9')).toBe('DevDock-Portable.exe')
    expect(assetUrl('DevDock-arm64.dmg', 'versionless', '9.9.9')).toBe(
      `${REPO}/releases/latest/download/DevDock-arm64.dmg`,
    )
  })

  it('the shipped config says "coming soon" until a release exists', () => {
    expect(RELEASE_CONFIG.available).toBe(false)
    const r = releaseFromConfig()
    expect(r.available).toBe(false)
    expect(r.installers.map((i) => i.id)).toEqual([
      'mac-arm64',
      'mac-x64',
      'win-setup',
      'win-portable',
    ])
  })

  it('sizes are formatted in MB and blank when unknown', () => {
    expect(formatSize(103_500_000)).toBe('103.5 MB')
    expect(formatSize(undefined)).toBe('')
  })
})

const manifest = {
  version: '0.2.0',
  assets: {
    'mac-arm64': {
      name: 'DevDock-0.2.0-arm64.dmg',
      url: `${REPO}/releases/download/v0.2.0/DevDock-0.2.0-arm64.dmg`,
      size: 100,
    },
    'mac-x64': {
      name: 'DevDock-0.2.0-x64.dmg',
      url: `${REPO}/releases/download/v0.2.0/DevDock-0.2.0-x64.dmg`,
      size: 101,
    },
    'win-setup': {
      name: 'DevDock-Setup-0.2.0.exe',
      url: `${REPO}/releases/download/v0.2.0/DevDock-Setup-0.2.0.exe`,
      size: 80,
    },
    'win-portable': {
      name: 'DevDock-Portable-0.2.0.exe',
      url: `${REPO}/releases/download/v0.2.0/DevDock-Portable-0.2.0.exe`,
      size: 79,
    },
  },
}

describe('releases.json manifest', () => {
  it('a complete manifest makes downloads available with exact sizes', () => {
    const r = releaseFromManifest(manifest)
    expect(r?.available).toBe(true)
    expect(r?.version).toBe('0.2.0')
    expect(r?.installers.find((i) => i.id === 'win-setup')?.size).toBe(80)
  })

  it('rejects incomplete manifests and links that are not this repo’s releases', () => {
    expect(releaseFromManifest(null)).toBeNull()
    expect(releaseFromManifest({ version: '1' })).toBeNull()
    const { 'win-portable': _, ...three } = manifest.assets
    expect(releaseFromManifest({ version: '1', assets: three })).toBeNull()
    const evil = structuredClone(manifest)
    evil.assets['mac-arm64'].url = 'https://evil.example/DevDock.dmg'
    expect(releaseFromManifest(evil)).toBeNull()
  })

  it('loadRelease prefers the manifest and falls back to the config', async () => {
    const ok = (async () => new Response(JSON.stringify(manifest))) as typeof fetch
    expect((await loadRelease(ok)).version).toBe('0.2.0')

    const missing = (async () => new Response('not found', { status: 404 })) as typeof fetch
    const config: ReleaseConfig = { ...RELEASE_CONFIG, available: true }
    const r = await loadRelease(missing, config)
    expect(r.available).toBe(true)
    expect(r.version).toBe(RELEASE_CONFIG.version)

    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect((await loadRelease(offline)).available).toBe(false)
  })
})
