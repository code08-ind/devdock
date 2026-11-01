import { z } from 'zod'

/**
 * T9 (owner): an "update available" notice, not auto-update — DevDock ships unsigned (T8), and
 * macOS installs updates only for signed apps. Once a day DevDock asks GitHub for the latest
 * published release (drafts and pre-releases don't count) and, if it's newer, says so.
 */
export const REPO = 'code08-ind/devdock'
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
/** Release pages DevDock may open (the URL comes from GitHub's answer, checked against this). */
export const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`
export const UPDATE_INTERVAL_MS = 24 * 60 * 60_000

export const UpdateStatusSchema = z.object({
  current: z.string(),
  /** The newest published version, when one was found (it may equal `current`). */
  latest: z.string().nullable(),
  /** Its release page, when it is newer than `current`. */
  url: z.string().nullable(),
  /** No published release yet (GitHub answers 404). */
  noRelease: z.boolean(),
  checkedAt: z.number().nullable(),
  /** Why the last check failed (offline, rate limited…), in a few words. */
  error: z.string().nullable(),
  /** Demo mode: not checked (no network calls in demo mode). */
  demo: z.boolean(),
})
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

/** `1.2.3` or `v1.2.3` as numbers; null for anything else (pre-release tags included). */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when `a` is a newer version than `b` (unparseable versions are never newer). */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!
  return false
}
