import { RELEASE_CONFIG, RELEASES_URL, REPO_URL, type AssetId, type ReleaseConfig } from './config'

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

function installer(id: AssetId, size: number | undefined): Installer {
  return { id, ...META[id], file: FILE_NAMES[id], url: assetUrl(id), size }
}

export function releaseFromConfig(config: ReleaseConfig = RELEASE_CONFIG): Release {
  return {
    available: config.available,
    version: config.version,
    installers: ASSET_IDS.map((id) => installer(id, config.sizes[id])),
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
    installers.push(installer(id, typeof a.size === 'number' ? a.size : undefined))
  }
  return { available: true, version, installers }
}

/** One published version for the Downloads page's "All versions" list. */
export interface Version {
  version: string
  /** ISO day it was published (from the manifest; unknown for the config fallback). */
  date?: string
  latest: boolean
  /** That version's own files: `/releases/download/<tag>/<file>`. */
  installers: Installer[]
  notesUrl: string
  checksumsUrl?: string
}

const tagOf = (version: string) => `v${version}`

function versionEntry(
  version: string,
  tag: string,
  sizes: Partial<Record<AssetId, number | undefined>>,
  latest: boolean,
  date?: string,
  checksums = true,
): Version {
  const base = `${RELEASES_URL}/download/${encodeURIComponent(tag)}`
  return {
    version,
    date,
    latest,
    installers: ASSET_IDS.filter((id) => id in sizes).map((id) => ({
      ...installer(id, sizes[id]),
      url: `${base}/${FILE_NAMES[id]}`,
    })),
    notesUrl: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
    checksumsUrl: checksums ? `${base}/SHA256SUMS.txt` : undefined,
  }
}

/**
 * The manifest's `releases` list (newest first, written by scripts/releases-json.mjs). Without it
 * (local preview, older manifest, or no manifest) the one release the page knows is listed.
 * Only known file names are used; anything else in an entry is ignored.
 */
export function versionsFromManifest(data: unknown, release: Release): Version[] {
  const list = (data as { releases?: unknown } | null)?.releases
  const out: Version[] = []
  if (Array.isArray(list)) {
    for (const raw of list as Record<string, unknown>[]) {
      if (!raw || typeof raw.version !== 'string' || typeof raw.tag !== 'string') continue
      if (!/^[\w.+-]+$/.test(raw.tag)) continue
      const assets = (raw.assets ?? {}) as Record<string, { name?: unknown; size?: unknown }>
      const sizes: Partial<Record<AssetId, number | undefined>> = {}
      for (const id of ASSET_IDS) {
        const a = assets[id]
        if (a && a.name === FILE_NAMES[id])
          sizes[id] = typeof a.size === 'number' ? a.size : undefined
      }
      if (Object.keys(sizes).length === 0) continue
      const date =
        typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined
      out.push(
        versionEntry(
          raw.version,
          raw.tag,
          sizes,
          raw.version === release.version,
          date,
          raw.checksums === true,
        ),
      )
    }
  }
  if (out.length === 0 && release.available) {
    const sizes = Object.fromEntries(release.installers.map((i) => [i.id, i.size]))
    out.push(versionEntry(release.version, tagOf(release.version), sizes, true))
  }
  return out
}

export interface Downloads {
  release: Release
  versions: Version[]
}

async function fetchManifest(fetchFn: typeof fetch, path: string): Promise<unknown> {
  try {
    const res = await fetchFn(path, { cache: 'no-cache' })
    if (res.ok) return await res.json()
  } catch {
    // No manifest (local preview, or no release yet): the config applies.
  }
  return null
}

/** The latest release and every version, from the manifest if the deploy wrote one. Never throws. */
export async function loadDownloads(
  fetchFn: typeof fetch = fetch,
  config: ReleaseConfig = RELEASE_CONFIG,
): Promise<Downloads> {
  const data = await fetchManifest(fetchFn, config.manifestPath)
  const release = releaseFromManifest(data) ?? releaseFromConfig(config)
  return { release, versions: versionsFromManifest(data, release) }
}

/** The manifest if the deploy wrote one, else the config. Never throws. */
export async function loadRelease(
  fetchFn: typeof fetch = fetch,
  config: ReleaseConfig = RELEASE_CONFIG,
): Promise<Release> {
  return (await loadDownloads(fetchFn, config)).release
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
