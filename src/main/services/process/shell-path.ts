import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'

const MARK = '__DEVDOCK_PATH__'

/**
 * A macOS app started from Finder or the Dock gets PATH=/usr/bin:/bin:/usr/sbin:/sbin, so
 * `npm`, `node` and `code` from Homebrew/nvm aren't found. Ask the user's login shell for its
 * PATH once (fixed command, argument array, timeout) and merge it in.
 */
export function loginShellPath(shell = process.env.SHELL || '/bin/zsh'): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      shell,
      // printenv prints the exported, ':'-joined PATH in any shell (fish's "$PATH" uses spaces).
      ['-ilc', `printf ${MARK}; printenv PATH; printf ${MARK}`],
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (err, stdout) => {
        const m = new RegExp(`${MARK}(.*?)\\n?${MARK}`).exec(stdout ?? '')
        resolve(err || !m?.[1] ? null : m[1])
      },
    )
  })
}

/** Login-shell entries first, then anything already on PATH; no duplicates. */
export function mergePath(shellPath: string, current: string | undefined): string {
  const parts = [...shellPath.split(delimiter), ...(current ?? '').split(delimiter)]
  return [...new Set(parts.filter(Boolean))].join(delimiter)
}
