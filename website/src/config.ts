/**
 * The one place that says where DevDock's installers live. Everything the page shows about
 * downloads comes from here, or from the same-origin `releases.json` that the Vercel build writes
 * from the latest published GitHub release (`scripts/releases-json.mjs`, see `downloads.ts`).
 *
 * Installers are named without the version (DECISIONS "Phase 7 — Owner decisions"), so every link
 * is `/releases/latest/download/<file>` and never needs changing. With `available: false` the page
 * says "Downloads coming soon" and links nowhere (used before the first public release).
 */

export const REPO = 'code08-ind/devdock'
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`

export type AssetId = 'mac-arm64' | 'mac-x64' | 'win-setup' | 'win-portable'

export interface ReleaseConfig {
  /** false until a release with installers is public: the page says "Downloads coming soon". */
  available: boolean
  version: string
  /** Installer sizes in bytes, when known (shown next to each file). */
  sizes: Partial<Record<AssetId, number>>
  /** Same-origin manifest written at build time; when present it wins over this config. */
  manifestPath: string
}

const MB = 1_000_000

export const RELEASE_CONFIG: ReleaseConfig = {
  // v0.2.0 is the first public release (owner, 2026-11-01). The site goes live after it is
  // published, so /releases/latest/download/ links resolve.
  available: true,
  version: '0.2.0',
  // Measured on the 2026-11-01 release build (draft); releases.json gives the exact sizes of the
  // published release at build time.
  sizes: {
    'mac-arm64': 108.8 * MB,
    'mac-x64': 112.0 * MB,
    'win-setup': 105.7 * MB,
    'win-portable': 105.5 * MB,
  },
  manifestPath: 'releases.json',
}
