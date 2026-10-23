// Fixture dev server: like Vite, the process npm starts spawns another process that owns the
// port. Killing only the direct child would leave the port taken.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const holder = fileURLToPath(new URL('./holder.mjs', import.meta.url))
spawn(process.execPath, [holder], { stdio: 'inherit' })
setInterval(() => {}, 1000)
