import { rmSync } from 'node:fs'

/**
 * Deletes a test's temp folder. On Windows a folder can stay locked after its processes are gone
 * (antivirus scans, git's MSYS helpers), so there a locked folder is left behind instead of
 * failing the test: CI runners are discarded. Leaks are checked by the tests themselves
 * (e.g. "port is free"), not by cleanup.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (process.platform !== 'win32' || (code !== 'EBUSY' && code !== 'EPERM')) throw err
    console.warn(`left locked temp folder ${dir} (${code})`)
  }
}
