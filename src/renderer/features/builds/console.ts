/** Console tail text handling (pure, unit-tested). */

/** Most console text kept in the view; the start is dropped beyond it. */
export const MAX_CONSOLE_CHARS = 2 * 1024 * 1024

/** Appends a chunk, keeping the end when the log grows past the limit. */
export function appendConsole(text: string, chunk: string, max = MAX_CONSOLE_CHARS): string {
  const next = text + chunk
  return next.length > max ? next.slice(next.length - max) : next
}

/** Lines containing the search (case-insensitive), with their 1-based numbers. */
export function matchingLines(text: string, query: string): { n: number; line: string }[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return text
    .split('\n')
    .flatMap((line, i) => (line.toLowerCase().includes(q) ? [{ n: i + 1, line }] : []))
}
