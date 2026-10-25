// Turns the GitHub API's "latest release" JSON into the page's releases.json.
//   node scripts/releases-json.mjs <latest-release.json> <out/releases.json>
// Writes nothing (and exits 0) when the release lacks any of the four installers, so the page
// falls back to src/config.ts instead of showing a broken link.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PATTERNS = {
  'mac-arm64': /^DevDock-(.*-)?arm64\.dmg$/,
  'mac-x64': /^DevDock-(.*-)?x64\.dmg$/,
  'win-setup': /^DevDock-Setup.*\.exe$/,
  'win-portable': /^DevDock-Portable.*\.exe$/,
}

/** @returns {{ version: string, assets: Record<string, { name: string, url: string, size: number }> } | null} */
export function toManifest(release) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') {
    return null
  }
  const assets = {}
  for (const [id, pattern] of Object.entries(PATTERNS)) {
    const a = (release.assets ?? []).find((x) => pattern.test(x.name))
    if (!a) return null
    assets[id] = { name: a.name, url: a.browser_download_url, size: a.size }
  }
  return { version: release.tag_name.replace(/^v/, ''), assets }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    console.error('usage: node scripts/releases-json.mjs <latest-release.json> <releases.json>')
    process.exit(2)
  }
  const manifest = toManifest(JSON.parse(readFileSync(input, 'utf8')))
  if (!manifest) {
    console.log('Latest release is missing an installer: no releases.json written.')
  } else {
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`releases.json for ${manifest.version} written to ${output}`)
  }
}
