import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CACHE_PATHS,
  HEAVY_CACHE,
  type CacheEntry,
  type CachePlan,
  type CleanResult,
} from '@shared/utilities'

/**
 * SPEC 6.6 Clean caches: `node_modules/.vite`, `dist`, `coverage` of a registered repo, sized
 * first; `node_modules` itself only when asked (the UI's second confirmation). Only these fixed
 * paths inside the repo are touched, and symlinks are never followed: a linked `dist` is
 * removed as a link, its target left alone.
 */

/** Files counted before a size is reported as approximate. */
export const MAX_FILES = 200_000

/** Bytes under `abs` without following symlinks; stops at `MAX_FILES` (then approximate). */
export async function sizeOf(
  abs: string,
  maxFiles = MAX_FILES,
): Promise<{ bytes: number; approximate: boolean }> {
  let bytes = 0
  let files = 0
  const stack = [abs]
  while (stack.length) {
    const dir = stack.pop()!
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue // unreadable or vanished: count what we can
    }
    for (const name of names) {
      if (++files > maxFiles) return { bytes, approximate: true }
      const path = join(dir, name)
      try {
        const st = await lstat(path)
        if (st.isDirectory()) stack.push(path)
        else bytes += st.size
      } catch {
        // vanished meanwhile
      }
    }
  }
  return { bytes, approximate: false }
}

/** True when a folder between the repo and `rel` is a symlink (removing would reach outside). */
async function underLink(root: string, rel: string): Promise<boolean> {
  const parts = rel.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    try {
      if ((await lstat(join(root, ...parts.slice(0, i)))).isSymbolicLink()) return true
    } catch {
      return false // missing: nothing below it exists either
    }
  }
  return false
}

/** A path that isn't there (or that we won't touch). */
const absent = (rel: string): CacheEntry => ({
  path: rel,
  exists: false,
  symlink: false,
  bytes: 0,
  approximate: false,
})

/** Removing stopped part-way: what was removed already, and what the OS said. */
export class CacheError extends Error {
  override readonly name = 'CacheError'
  constructor(
    message: string,
    readonly removed: string[],
    readonly details?: string,
  ) {
    super(message)
  }
}

async function entry(root: string, rel: string): Promise<CacheEntry> {
  const abs = join(root, ...rel.split('/'))
  // `node_modules/.vite` through a linked `node_modules` is someone else's folder: skip it.
  if (await underLink(root, rel)) return absent(rel)
  try {
    const st = await lstat(abs)
    if (st.isSymbolicLink())
      return { path: rel, exists: true, symlink: true, bytes: 0, approximate: false }
    if (!st.isDirectory()) {
      return { path: rel, exists: true, symlink: false, bytes: st.size, approximate: false }
    }
    return { path: rel, exists: true, symlink: false, ...(await sizeOf(abs)) }
  } catch {
    return absent(rel)
  }
}

export async function planClean(root: string): Promise<CachePlan> {
  const [entries, heavy] = await Promise.all([
    Promise.all(CACHE_PATHS.map((rel) => entry(root, rel))),
    entry(root, HEAVY_CACHE),
  ])
  return { entries, heavy }
}

/**
 * Removes what exists of the plan (sized again now, for the freed total). `node_modules` covers
 * `node_modules/.vite`, so that one isn't counted twice.
 */
export async function clean(root: string, includeNodeModules: boolean): Promise<CleanResult> {
  const plan = await planClean(root)
  const targets = [
    ...plan.entries.filter((e) => !(includeNodeModules && e.path.startsWith(`${HEAVY_CACHE}/`))),
    ...(includeNodeModules ? [plan.heavy] : []),
  ].filter((e) => e.exists)
  const removed: string[] = []
  let freedBytes = 0
  for (const e of targets) {
    try {
      // rm on a symlink removes the link itself; recursive never follows links inside.
      await rm(join(root, ...e.path.split('/')), { recursive: true, force: true, maxRetries: 3 })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const done = removed.length ? ` Removed ${removed.join(', ')} first.` : ''
      throw new CacheError(
        `Couldn't remove ${e.path}${code === 'EBUSY' || code === 'EPERM' ? ': a file in it is in use (stop the dev server or editor using it and try again)' : ''}.${done}`,
        removed,
        err instanceof Error ? err.message : String(err),
      )
    }
    removed.push(e.path)
    freedBytes += e.bytes
  }
  return { removed, freedBytes }
}
