import { RELEASE_CONFIG, REPO_URL, type AssetId, type AssetNaming, type ReleaseConfig } from './config'

export interface Installer {
  id: AssetId
  /** Button text: "Download for macOS (Apple silicon)". */
  label: string
  /** Table text: "macOS, Apple silicon". */
  system: string
  note: string
  file: string
  url: string
  size?: number
}

export interface Release {
  available: boolean
  version: string
  installers: Installer[]
}

export const ASSET_IDS: readonly AssetId[] = ['mac-arm64', 'mac-x64', 'win-setup', 'win-portable']

const META: Record<AssetId, { label: string; system: string; note: string }> = {
  'mac-arm64': {
    label: 'Download for macOS (Apple silicon)',
    system: 'macOS, Apple silicon (M1 and later)',
    note: 'Disk image. Drag DevDock to Applications.',
  },
  'mac-x64': {
    label: 'Download for macOS (Intel)',
    system: 'macOS, Intel',
    note: 'Disk image. Drag DevDock to Applications.',
  },
  'win-setup': {
    label: 'Download for Windows',
    system: 'Windows 10 and 11, 64-bit',
    note: 'Installer. Installs for you only, no admin rights.',
  },
  'win-portable': {
    label: 'Download for Windows (portable)',
    system: 'Windows, no install',
    note: 'Runs from any folder or USB stick.',
  },
}

/** File names as electron-builder writes them (electron-builder.yml), or the proposed version-less ones. */
export function fileName(id: AssetId, naming: AssetNaming, version: string): string {
  const v = naming === 'versioned' ? `-${version}` : ''
  switch (id) {
    case 'mac-arm64':
      return `DevDock${v}-arm64.dmg`
    case 'mac-x64':
      return `DevDock${v}-x64.dmg`
    case 'win-setup':
      return `DevDock-Setup${v}.exe`
    case 'win-portable':
      return `DevDock-Portable${v}.exe`
  }
}

export function assetUrl(file: string, naming: AssetNaming, version: string): string {
  return naming === 'versionless'
    ? `${REPO_URL}/releases/latest/download/${file}`
    : `${REPO_URL}/releases/download/v${version}/${file}`
}

export function releaseFromConfig(config: ReleaseConfig = RELEASE_CONFIG): Release {
  return {
    available: config.available,
    version: config.version,
    installers: ASSET_IDS.map((id) => {
      const file = fileName(id, config.naming, config.version)
      return {
        id,
        ...META[id],
        file,
        url: assetUrl(file, config.naming, config.version),
        size: config.sizes[id],
      }
    }),
  }
}

/**
 * `releases.json` (written at deploy time by scripts/releases-json.mjs from the latest GitHub
 * release): `{ "version": "0.1.0", "assets": { "mac-arm64": { "name", "url", "size" }, … } }`.
 * Returns null unless every installer is present with a GitHub download URL.
 */
export function releaseFromManifest(data: unknown): Release | null {
  if (!data || typeof data !== 'object') return null
  const { version, assets } = data as { version?: unknown; assets?: unknown }
  if (typeof version !== 'string' || !assets || typeof assets !== 'object') return null
  const installers: Installer[] = []
  for (const id of ASSET_IDS) {
    const a = (assets as Record<string, unknown>)[id] as
      | { name?: unknown; url?: unknown; size?: unknown }
      | undefined
    if (!a || typeof a.name !== 'string' || typeof a.url !== 'string') return null
    if (!a.url.startsWith(`${REPO_URL}/releases/`)) return null
    installers.push({
      id,
      ...META[id],
      file: a.name,
      url: a.url,
      size: typeof a.size === 'number' ? a.size : undefined,
    })
  }
  return { available: true, version, installers }
}

/** The manifest if the deploy wrote one, else the config. Never throws. */
export async function loadRelease(
  fetchFn: typeof fetch = fetch,
  config: ReleaseConfig = RELEASE_CONFIG,
): Promise<Release> {
  try {
    const res = await fetchFn(config.manifestPath, { cache: 'no-cache' })
    if (res.ok) {
      const fromManifest = releaseFromManifest(await res.json())
      if (fromManifest) return fromManifest
    }
  } catch {
    // No manifest (local preview, or no release yet): fall back to the config.
  }
  return releaseFromConfig(config)
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
