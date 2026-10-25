/** DOM-free pieces of the Utilities view (unit-tested). */
import { PORT_FILTERS, type ListeningPort } from '@shared/utilities'

export type PortFilter = 'all' | (typeof PORT_FILTERS)[number]['label']

/** Rows matching the quick filter and the typed port (prefix). */
export function filterPorts(
  rows: ListeningPort[],
  filter: PortFilter,
  typed: string,
): ListeningPort[] {
  const range = PORT_FILTERS.find((f) => f.label === filter)
  const q = typed.trim()
  return rows.filter(
    (r) =>
      (!range || (r.port >= range.from && r.port <= range.to)) &&
      (q === '' ||
        String(r.port).startsWith(q) ||
        r.process.toLowerCase().includes(q.toLowerCase())),
  )
}

/** Draft items ↔ textarea text: one item per line, blank lines and stray "- " dropped. */
export const toLines = (items: readonly string[]) => items.join('\n')
export const fromLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean)
