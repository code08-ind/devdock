// node-pty 1.1.0 ships its macOS `spawn-helper` prebuilds without the execute bit, so every
// PTY fails with "posix_spawnp failed". Runs after `npm install` / `npm ci` (DECISIONS P7-A).
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const prebuilds = join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
