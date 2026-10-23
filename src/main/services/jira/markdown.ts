/**
 * A GFM table from cell strings (already Markdown). Pipes are escaped; short rows are padded.
 * Markdown needs a header row, so a table without one gets an empty header.
 */
export function markdownTable(rows: string[][], hasHeader: boolean): string {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')]
  const line = (r: string[]) => `| ${pad(r.map((c) => c.replace(/\|/g, '\\|'))).join(' | ')} |`
  const head = hasHeader ? rows[0]! : Array<string>(width).fill('')
  const body = hasHeader ? rows.slice(1) : rows
  return [line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n')
}
