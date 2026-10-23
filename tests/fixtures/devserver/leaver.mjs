// Like `npm` dying while the server it started keeps running: the leader exits, the child that
// owns the port stays (same process group).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

spawn(process.execPath, [fileURLToPath(new URL('./holder.mjs', import.meta.url))], {
  stdio: 'inherit',
})
setTimeout(() => process.exit(0), 1500)
