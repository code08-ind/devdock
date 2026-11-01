// Writes the page's releases.json from the latest *published* GitHub release (drafts and
// pre-releases are never "latest"), plus every published release for the Downloads page's
// "All versions" list. Run by the Vercel build (`npm run build:site`):
//   node scripts/releases-json.mjs <out/releases.json>                 asks the GitHub API
//   node scripts/releases-json.mjs --from <latest.json> <out.json>     uses a saved API response
//                                                                       (a release, or a list)
// It never fails the build: with no published release, a missing installer, no network or a
// rate limit, it removes <out> and the page falls back to src/config.ts ("coming soon" until
// `available: true`). GITHUB_TOKEN, when set, raises the API rate limit.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Must match REPO in src/config.ts (tests/unit/releases-json.test.ts checks). */
export const REPO = 'code08-ind/devdock'

/** Must match FILE_NAMES in src/downloads.ts and electron-builder.yml's artifactNames. */
export const FILE_NAMES = {
  'mac-arm64': 'DevDock-arm64.dmg',
  'mac-x64': 'DevDock-x64.dmg',
  'win-setup': 'DevDock-Setup.exe',
  'win-portable': 'DevDock-Portable.exe',
}

/** @returns {{ version: string, assets: Record<string, { name: string, size: number }> } | null} */
export function toManifest(release) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') {
    return null
  }
  const assets = {}
  for (const [id, name] of Object.entries(FILE_NAMES)) {
    const a = (release.assets ?? []).find((x) => x.name === name)
    if (!a) return null
    assets[id] = { name, size: a.size }
  }
  return { version: release.tag_name.replace(/^v/, ''), assets }
}

export const CHECKSUMS = 'SHA256SUMS.txt'

/**
 * Every published release (newest first) with the installers it has under the known names, for
 * the "All versions" list. Drafts, pre-releases and releases without any installer are left out.
 * @returns {{ version: string, tag: string, date?: string, assets: Record<string, { name: string, size: number }>, checksums: boolean }[]}
 */
export function toHistory(releases) {
  if (!Array.isArray(releases)) return []
  const out = []
  for (const r of releases) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string') continue
    const assets = {}
    for (const [id, name] of Object.entries(FILE_NAMES)) {
      const a = (r.assets ?? []).find((x) => x.name === name)
      if (a) assets[id] = { name, size: a.size }
    }
    if (Object.keys(assets).length === 0) continue
    const date = typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : undefined
    out.push({
      version: r.tag_name.replace(/^v/, ''),
      tag: r.tag_name,
      ...(date ? { date } : {}),
      assets,
      checksums: (r.assets ?? []).some((x) => x.name === CHECKSUMS),
    })
  }
  return out
}

async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'devdock-website-build' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null // no published release yet
  if (!res.ok) throw new Error(`GitHub API answered ${res.status}`)
  return res.json()
}

async function main(args) {
  const [input, output] = args[0] === '--from' ? [args[1], args[2]] : [undefined, args[0]]
  if (!output || (args[0] === '--from' && !input)) {
    console.error('usage: node scripts/releases-json.mjs [--from <latest.json>] <releases.json>')
    return 2
  }
  let release = null
  let list = []
  try {
    if (input) {
      const saved = JSON.parse(readFileSync(input, 'utf8'))
      list = Array.isArray(saved) ? saved : [saved]
      release = list.find((r) => r && !r.draft && !r.prerelease) ?? null
    } else {
      release = await api('releases/latest')
      if (release) list = (await api('releases?per_page=50').catch(() => null)) ?? [release]
    }
  } catch (err) {
    console.warn(`Couldn't read the latest release (${err.message}).`)
  }
  const latest = toManifest(release)
  const history = toHistory(list)
  const manifest = latest && {
    ...latest,
    // The latest is always listed, even if the list request failed.
    releases: history.some((r) => r.version === latest.version)
      ? history
      : [...toHistory([release]), ...history],
  }
  if (!manifest) {
    rmSync(output, { force: true })
    console.log(
      'No published release with all four installers: no releases.json, the page uses src/config.ts.',
    )
  } else {
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(
      `releases.json for ${manifest.version} (versions listed: ${manifest.releases.length}) written to ${output}`,
    )
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
