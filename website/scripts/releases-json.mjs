// Writes the page's releases.json from the latest *published* GitHub release (drafts and
// pre-releases are never "latest"). Run by the Vercel build (`npm run build:site`):
//   node scripts/releases-json.mjs <out/releases.json>                 asks the GitHub API
//   node scripts/releases-json.mjs --from <latest.json> <out.json>     uses a saved API response
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

async function fetchLatest() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'devdock-website-build' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
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
  try {
    release = input ? JSON.parse(readFileSync(input, 'utf8')) : await fetchLatest()
  } catch (err) {
    console.warn(`Couldn't read the latest release (${err.message}).`)
  }
  const manifest = toManifest(release)
  if (!manifest) {
    rmSync(output, { force: true })
    console.log(
      'No published release with all four installers: no releases.json, the page uses src/config.ts.',
    )
  } else {
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`releases.json for ${manifest.version} written to ${output}`)
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
