import { rememberRecent } from './commands'

/**
 * Recently run commands (P6.01 "recent actions first"), per device. Browser storage can be
 * missing or blocked; the palette then simply has no recents.
 */
const KEY = 'devdock.recentCommands'

export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveRecent(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rememberRecent(loadRecent(), id)))
  } catch {
    // No storage: nothing to remember.
  }
}
