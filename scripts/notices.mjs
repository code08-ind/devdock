// Writes out/THIRD_PARTY_NOTICES.txt: the license of every library bundled into the app.
// The packaged app carries no node_modules except node-pty (P6.14, P7-A), so their LICENSE files must ship this way
// (MIT and similar licenses require the notice to travel with copies). Runs after the build.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
/** What the bundles import at their top level: the renderer's and the main process's libraries. */
const BUNDLED = [
  'react',
  'react-dom',
  '@tanstack/react-query',
  'lucide-react',
  'zod',
  'msw',
  // P7-A terminal: xterm.js and its addons are bundled; node-pty ships as the one runtime module.
  '@xterm/xterm',
  '@xterm/addon-fit',
  '@xterm/addon-search',
  '@xterm/addon-unicode11',
  '@xterm/addon-web-links',
  '@xterm/addon-webgl',
  'node-pty',
  // P7-C-B: the official Anthropic SDK, bundled into the main process (MIT).
  '@anthropic-ai/sdk',
]

const pkgDir = (name) => join(root, 'node_modules', name)
const seen = new Map()

function visit(name) {
  if (seen.has(name)) return
  const dir = pkgDir(name)
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  seen.set(name, {
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see text'),
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : null,
  })
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep)
}

BUNDLED.forEach(visit)

const body = [...seen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, p]) =>
    [
      `${name} ${p.version} (${p.license})`,
      '-'.repeat(72),
      p.text ?? `Licensed under ${p.license}; no license file in the package.`,
    ].join('\n'),
  )
  .join('\n\n\n')

writeFileSync(
  join(root, 'out', 'THIRD_PARTY_NOTICES.txt'),
  `DevDock includes the following open-source software.\n\n\n${body}\n`,
)
console.log(`THIRD_PARTY_NOTICES.txt: ${seen.size} packages`)
