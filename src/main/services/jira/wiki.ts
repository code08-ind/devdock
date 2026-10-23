import { markdownTable } from './markdown'

/**
 * Jira wiki markup (Data Center descriptions/comments) → Markdown. Pure and deliberately basic
 * (BUILD-PROMPTS P2): headings, emphasis, monospace, code/noformat/quote blocks, lists, tables,
 * links and mentions. Anything else passes through as text.
 */

export function wikiToMarkdown(input: string | null | undefined): string {
  if (!input) return ''
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let table: string[][] | null = null
  let tableHeader = false
  const flushTable = () => {
    if (!table) return
    out.push(markdownTable(table, tableHeader))
    table = null
    tableHeader = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // {code:java} … {code} / {noformat} … {noformat}: copied verbatim into a fence.
    const fenceOpen = /^\s*\{(code|noformat)(?::([^}]*))?\}(.*)$/.exec(line)
    if (fenceOpen) {
      flushTable()
      const tag = fenceOpen[1]!
      const lang = tag === 'code' ? language(fenceOpen[2]) : ''
      const body: string[] = []
      let rest = fenceOpen[3]!
      const close = `{${tag}}`
      while (true) {
        const end = rest.indexOf(close)
        if (end >= 0) {
          if (rest.slice(0, end)) body.push(rest.slice(0, end))
          break
        }
        if (rest || body.length) body.push(rest)
        if (++i >= lines.length) break
        rest = lines[i]!
      }
      const text = body.join('\n').replace(/^\n+|\n+$/g, '')
      const fence = text.includes('```') ? '~~~' : '```'
      out.push(`${fence}${lang}\n${text}\n${fence}`)
      continue
    }

    // {quote} … {quote}
    if (/^\s*\{quote\}\s*$/.test(line)) {
      flushTable()
      const body: string[] = []
      while (++i < lines.length && !/^\s*\{quote\}\s*$/.test(lines[i]!)) body.push(lines[i]!)
      out.push(
        body
          .map((l) => inline(l))
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n'),
      )
      continue
    }

    // Tables: ||head||head|| and |cell|cell|
    const row = /^\s*(\|\|?)(.*?)\|*\s*$/.exec(line)
    if (row && line.trim().startsWith('|')) {
      const isHeader = row[1] === '||'
      const cells = tableCells(line).map((c) => inline(c.trim()))
      if (!table) {
        table = []
        tableHeader = isHeader
      }
      table.push(cells)
      continue
    }
    flushTable()

    const heading = /^\s*h([1-6])\.\s+(.*)$/.exec(line)
    if (heading) {
      out.push(`${'#'.repeat(Number(heading[1]))} ${inline(heading[2]!)}`)
      continue
    }
    const bq = /^\s*bq\.\s+(.*)$/.exec(line)
    if (bq) {
      out.push(`> ${inline(bq[1]!)}`)
      continue
    }
    if (/^\s*-{4,}\s*$/.test(line)) {
      out.push('---')
      continue
    }
    // Lists: "* a", "** nested", "# one", "*# mixed", "- a".
    const list = /^\s*([*#]+|-)\s+(.*)$/.exec(line)
    if (list) {
      const markers = list[1]!
      const indent = [...markers.slice(0, -1)].map((m) => (m === '#' ? '   ' : '  ')).join('')
      const bullet = markers.endsWith('#') ? '1. ' : '- '
      out.push(indent + bullet + inline(list[2]!))
      continue
    }
    out.push(inline(line))
  }
  flushTable()
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function language(spec: string | undefined): string {
  if (!spec) return ''
  // {code:title=Foo.java|borderStyle=solid} or {code:java} or {code:language=java|…}
  const parts = spec.split('|')
  const named = parts.find((p) => p.startsWith('language='))
  if (named) return named.slice('language='.length)
  return parts[0]!.includes('=') ? '' : parts[0]!.trim()
}

/** Splits a table row on `|` / `||`, but not inside `[label|url]` links or `{{code}}`. */
function tableCells(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let link = 0
  let code = false
  const s = line
    .trim()
    .replace(/^\|\|?/, '')
    .replace(/\|\|?$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (s.startsWith('{{', i) || s.startsWith('}}', i)) {
      code = s[i] === '{'
      cell += s.slice(i, i + 2)
      i++
      continue
    }
    if (!code && c === '[') link++
    if (!code && c === ']' && link > 0) link--
    if (c === '|' && link === 0 && !code) {
      cells.push(cell)
      cell = ''
      if (s[i + 1] === '|') i++
      continue
    }
    cell += c
  }
  cells.push(cell)
  return cells
}

/** Inline markup. Code spans and links are swapped out first so emphasis rules can't touch them. */
function inline(text: string): string {
  const saved: string[] = []
  const keep = (s: string) => `\uE000${saved.push(s) - 1}\uE000`

  let s = text
    .replace(/\{\{(.+?)\}\}/g, (_, code: string) =>
      keep(code.includes('`') ? `\`\` ${code} \`\`` : `\`${code}\``),
    )
    .replace(/\[~([^\]]+)\]/g, (_, user: string) => keep(`@${user}`))
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, (_, label: string, href: string) =>
      keep(`[${label.trim()}](${href.trim()})`),
    )
    .replace(/\[((?:https?:|mailto:)[^\]\s]+)\]/g, (_, href: string) => keep(`<${href}>`))
    .replace(/\bhttps?:\/\/[^\s<>)\]]+/g, (url) => keep(url))
    .replace(/\{color(?::[^}]*)?\}/g, '')
    .replace(/\\\\/g, '  \n')

  s = s
    .replace(/(^|[^\w*])\*(\S(?:[^*]*?\S)?)\*(?=[^\w*]|$)/g, '$1**$2**')
    .replace(/(^|[^\w_])_(\S(?:[^_]*?\S)?)_(?=[^\w_]|$)/g, '$1*$2*')
    .replace(/(^|\s)-(\S(?:[^-]*?\S)?)-(?=\s|$|[.,;:!?])/g, '$1~~$2~~')
    .replace(/(^|[^\w+])\+(\S(?:[^+]*?\S)?)\+(?=[^\w+]|$)/g, '$1$2')
    .replace(/\?\?(\S(?:.*?\S)?)\?\?/g, '*$1*')

  return s.replace(/\uE000(\d+)\uE000/g, (_, n: string) => saved[Number(n)]!)
}
