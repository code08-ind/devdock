/**
 * The one place that says where DevDock's installers live. Everything the page shows about
 * downloads comes from here (or from a same-origin `releases.json`, see `downloads.ts`).
 *
 * Before the first release is published, keep `available: false`: the page then says
 * "Downloads coming soon" and links nowhere. See website/README.md "Publishing a release".
 */

export const REPO = 'code08-ind/devdock'
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`

export type AssetId = 'mac-arm64' | 'mac-x64' | 'win-setup' | 'win-portable'

/**
 * How installer files are named on GitHub Releases.
 * - `versioned`: today's electron-builder names (`DevDock-0.1.0-arm64.dmg`, …). Links point at the
 *   tag of `version` (`/releases/download/v0.1.0/<file>`), so `version` must be bumped per release.
 * - `versionless`: `DevDock-arm64.dmg`, … (proposed in DECISIONS P7-D). Links use
 *   `/releases/latest/download/<file>` and never need changing.
 */
export type AssetNaming = 'versioned' | 'versionless'

export interface ReleaseConfig {
  /** false until a release with installers is public: the page says "Downloads coming soon". */
  available: boolean
  version: string
  naming: AssetNaming
  /** Installer sizes in bytes, when known (shown next to each file). */
  sizes: Partial<Record<AssetId, number>>
  /** Same-origin manifest written at deploy time; when present it wins over this config. */
  manifestPath: string
}

const MB = 1_000_000

export const RELEASE_CONFIG: ReleaseConfig = {
  available: false,
  version: '0.1.0',
  naming: 'versioned',
  // Measured for 0.1.0 (README "Install"); Windows sizes come from the manifest once published.
  sizes: { 'mac-arm64': 103.5 * MB, 'mac-x64': 106.2 * MB },
  manifestPath: 'releases.json',
}
