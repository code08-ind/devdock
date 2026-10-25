import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { z } from 'zod'
import { log } from './logger'

/**
 * Watch lists on disk (PR watches, build watches): `{version: 1, items}` checked with zod.
 * An unreadable file is copied to `<file>.unreadable` and the list starts empty, so the next
 * save doesn't destroy what was there.
 */
export function loadItems<T>(file: string, item: z.ZodType<T>, what: string): T[] {
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; items?: unknown }
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) throw new Error('not version 1')
    return parsed.items.map((raw) => item.parse(raw))
  } catch (err) {
    log.warn(`${what} unreadable, starting empty (copy kept as .unreadable)`, err)
    try {
      copyFileSync(file, `${file}.unreadable`)
    } catch {
      // Nothing more to do; the warning is logged.
    }
    return []
  }
}

/** Writes `{version: 1, items}` atomically (temp file + rename). */
export function saveItems(file: string, items: unknown[]): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, items }), 'utf8')
  renameSync(tmp, file)
}
