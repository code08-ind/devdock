import { describe, expect, it } from 'vitest'
import { RELEASE_CONFIG, type ReleaseConfig } from '../../src/config'
import { readFileSync } from 'node:fs'
import {
  assetUrl,
  FILE_NAMES,
  formatSize,
  loadRelease,
  releaseFromConfig,
  releaseFromManifest,
} from '../../src/downloads'

const REPO = 'https://github.com/code08-ind/devdock'

describe('installer names and links', () => {
  it('names carry no version and link to releases/latest/download', () => {
    expect(FILE_NAMES).toEqual({
      'mac-arm64': 'DevDock-arm64.dmg',
      'mac-x64': 'DevDock-x64.dmg',
      'win-setup': 'DevDock-Setup.exe',
      'win-portable': 'DevDock-Portable.exe',
    })
    expect(assetUrl('mac-arm64')).toBe(`${REPO}/releases/latest/download/DevDock-arm64.dmg`)
    expect(assetUrl('win-portable')).toBe(`${REPO}/releases/latest/download/DevDock-Portable.exe`)
  })

  it('names match the artifactNames in electron-builder.yml', () => {
    const yml = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8')
    const name = (section: string) =>
      new RegExp(`^${section}:\\n(?:  .*\\n)*?  artifactName: (.+)$`, 'm').exec(yml)?.[1]
    const expand = (pattern: string | undefined, arch: string) =>
      pattern?.replace('${productName}', 'DevDock').replace('${arch}', arch).replace('${ext}', '')
    expect(expand(name('dmg'), 'arm64')).toBe('DevDock-arm64.')
    expect(expand(name('dmg'), 'x64')).toBe('DevDock-x64.')
    expect(expand(name('nsis'), 'x64')).toBe('DevDock-Setup.')
    expect(expand(name('portable'), 'x64')).toBe('DevDock-Portable.')
  })

  it('the shipped config offers v0.2.0 (the first public release) with all four installers', () => {
    expect(RELEASE_CONFIG).toMatchObject({ available: true, version: '0.2.0' })
    const r = releaseFromConfig()
    expect(r.available).toBe(true)
    // "Coming soon" stays possible for a config without a release.
    expect(releaseFromConfig({ ...RELEASE_CONFIG, available: false }).available).toBe(false)
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
    'mac-arm64': { name: 'DevDock-arm64.dmg', size: 100 },
    'mac-x64': { name: 'DevDock-x64.dmg', size: 101 },
    'win-setup': { name: 'DevDock-Setup.exe', size: 80 },
    'win-portable': { name: 'DevDock-Portable.exe', size: 79 },
  },
}

describe('releases.json manifest', () => {
  it('a complete manifest makes downloads available with exact sizes', () => {
    const r = releaseFromManifest(manifest)
    expect(r?.available).toBe(true)
    expect(r?.version).toBe('0.2.0')
    expect(r?.installers.find((i) => i.id === 'win-setup')?.size).toBe(80)
    expect(r?.installers.every((i) => i.url === assetUrl(i.id))).toBe(true)
  })

  it('rejects incomplete manifests and unexpected file names', () => {
    expect(releaseFromManifest(null)).toBeNull()
    expect(releaseFromManifest({ version: '1' })).toBeNull()
    const { 'win-portable': _, ...three } = manifest.assets
    expect(releaseFromManifest({ version: '1', assets: three })).toBeNull()
    const renamed = structuredClone(manifest)
    renamed.assets['mac-arm64'].name = 'DevDock-0.2.0-arm64.dmg'
    expect(releaseFromManifest(renamed)).toBeNull()
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
    const none: ReleaseConfig = { ...RELEASE_CONFIG, available: false }
    expect((await loadRelease(offline, none)).available).toBe(false)
    // Offline with the shipped config: the config's links (latest release) still work.
    expect((await loadRelease(offline)).available).toBe(true)
  })
})
