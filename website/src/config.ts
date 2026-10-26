/**
 * The one place that says where DevDock's installers live. Everything the page shows about
 * downloads comes from here, or from the same-origin `releases.json` that the Vercel build writes
 * from the latest published GitHub release (`scripts/releases-json.mjs`, see `downloads.ts`).
 *
 * Installers are named without the version (DECISIONS "Phase 7 — Owner decisions"), so every link
 * is `/releases/latest/download/<file>` and never needs changing. Until a release is published,
 * keep `available: false`: the page then says "Downloads coming soon" and links nowhere.
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
  available: false,
  version: '0.1.0',
  // Measured for 0.1.0: DMGs from README "Install", Windows from CI run 40221500313. Once a
  // release is published, releases.json gives the exact sizes.
  sizes: {
    'mac-arm64': 103.5 * MB,
    'mac-x64': 106.2 * MB,
    'win-setup': 98.2 * MB,
    'win-portable': 98.0 * MB,
  },
  manifestPath: 'releases.json',
}
