import { RELEASE_CONFIG, REPO_URL, type AssetId, type ReleaseConfig } from './config'

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

/** Installer file names, as electron-builder.yml's `artifactName`s write them (no version). */
export const FILE_NAMES: Record<AssetId, string> = {
  'mac-arm64': 'DevDock-arm64.dmg',
  'mac-x64': 'DevDock-x64.dmg',
  'win-setup': 'DevDock-Setup.exe',
  'win-portable': 'DevDock-Portable.exe',
}

/** Always the newest published release: GitHub redirects to that release's file. */
export function assetUrl(id: AssetId): string {
  return `${REPO_URL}/releases/latest/download/${FILE_NAMES[id]}`
}

export function releaseFromConfig(config: ReleaseConfig = RELEASE_CONFIG): Release {
  return {
    available: config.available,
    version: config.version,
    installers: ASSET_IDS.map((id) => ({
      id,
      ...META[id],
      file: FILE_NAMES[id],
      url: assetUrl(id),
      size: config.sizes[id],
    })),
  }
}

/**
 * `releases.json` (written at build time by scripts/releases-json.mjs from the latest published
 * GitHub release): `{ "version": "0.1.0", "assets": { "mac-arm64": { "name", "size" }, … } }`.
 * Only the version and sizes are taken from it; names and links are always FILE_NAMES and
 * `/releases/latest/download/`. Returns null unless every installer is listed under its name.
 */
export function releaseFromManifest(data: unknown): Release | null {
  if (!data || typeof data !== 'object') return null
  const { version, assets } = data as { version?: unknown; assets?: unknown }
  if (typeof version !== 'string' || !assets || typeof assets !== 'object') return null
  const installers: Installer[] = []
  for (const id of ASSET_IDS) {
    const a = (assets as Record<string, unknown>)[id] as
      { name?: unknown; size?: unknown } | undefined
    if (!a || a.name !== FILE_NAMES[id]) return null
    installers.push({
      id,
      ...META[id],
      file: FILE_NAMES[id],
      url: assetUrl(id),
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
