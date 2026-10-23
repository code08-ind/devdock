import { markdownTable } from './markdown'

/**
 * Atlassian Document Format (Jira Cloud descriptions/comments) → Markdown. Pure.
 * Covers the common nodes (SPEC 6.5 / BUILD-PROMPTS P2); unknown nodes fall back to their text,
 * so content is never silently dropped.
 */

export interface AdfNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: AdfNode[]
}

export function adfToMarkdown(doc: unknown): string {
  if (!isNode(doc)) return typeof doc === 'string' ? doc : ''
  return blocks(doc.content ?? (doc.type === 'doc' ? [] : [doc]))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isNode(v: unknown): v is AdfNode {
  return typeof v === 'object' && v !== null && typeof (v as AdfNode).type === 'string'
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** Block-level children separated by blank lines. */
function blocks(nodes: AdfNode[]): string {
  return nodes
    .map(block)
    .filter((b) => b !== '')
    .join('\n\n')
}

function block(node: AdfNode): string {
  const kids = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return inline(kids)
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return `${'#'.repeat(level)} ${inline(kids)}`
    }
    case 'bulletList':
      return kids.map((item) => listItem(item, '- ')).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.order) || 1
      return kids.map((item, i) => listItem(item, `${start + i}. `)).join('\n')
    }
    case 'taskList':
      return kids
        .map((item) => listItem(item, item.attrs?.state === 'DONE' ? '- [x] ' : '- [ ] '))
        .join('\n')
    case 'decisionList':
      return kids.map((item) => listItem(item, '- ')).join('\n')
    case 'codeBlock': {
      const text = kids.map((k) => k.text ?? '').join('')
      const fence = text.includes('```') ? '~~~' : '```'
      return `${fence}${str(node.attrs?.language)}\n${text}\n${fence}`
    }
    case 'blockquote':
      return quote(blocks(kids))
    case 'panel': {
      const kind = str(node.attrs?.panelType)
      const label = kind ? `**${kind[0]!.toUpperCase()}${kind.slice(1)}:** ` : ''
      return quote(label + blocks(kids))
    }
    case 'expand':
    case 'nestedExpand': {
      const title = str(node.attrs?.title)
      return [title ? `**${title}**` : '', blocks(kids)].filter(Boolean).join('\n\n')
    }
    case 'rule':
      return '---'
    case 'table':
      return table(node)
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '_[attachment]_'
    case 'blockCard':
    case 'embedCard': {
      const url = str(node.attrs?.url)
      return url ? `<${url}>` : ''
    }
    default:
      // Unknown block: keep whatever it contains.
      return kids.length && kids.every((k) => isInlineType(k.type)) ? inline(kids) : blocks(kids)
  }
}

const INLINE = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date'])
const isInlineType = (t: string) => INLINE.has(t)

/** A list item: its blocks, the first line after the marker and the rest indented under it. */
function listItem(item: AdfNode, marker: string): string {
  const kids = item.content ?? []
  // taskItem/decisionItem hold inline content directly.
  const body = kids.every((k) => isInlineType(k.type))
    ? inline(kids)
    : kids.map(block).filter(Boolean).join('\n')
  const pad = ' '.repeat(marker.length)
  return body
    .split('\n')
    .map((line, i) => (i === 0 ? marker + line : line ? pad + line : line))
    .join('\n')
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
}

function table(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? []).map(block).filter(Boolean).join('<br>').replace(/\n/g, '<br>'),
    ),
  )
  const firstIsHeader = (node.content?.[0]?.content ?? []).some((c) => c.type === 'tableHeader')
  return markdownTable(rows, firstIsHeader)
}

function inline(nodes: AdfNode[]): string {
  return nodes.map(inlineNode).join('')
}

function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return marked(node.text ?? '', node.marks ?? [])
    case 'hardBreak':
      return '  \n'
    case 'mention': {
      const text = str(node.attrs?.text) || 'someone'
      return text.startsWith('@') ? text : `@${text}`
    }
    case 'emoji':
      return str(node.attrs?.text) || str(node.attrs?.shortName)
    case 'inlineCard': {
      const url = str(node.attrs?.url)
      return url ? `<${url}>` : ''
    }
    case 'status':
      return `[${str(node.attrs?.text)}]`
    case 'date': {
      const ms = Number(node.attrs?.timestamp)
      return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
    }
    default:
      return node.text ?? inline(node.content ?? [])
  }
}

/** Applies marks, keeping surrounding spaces outside the delimiters (`** x**` isn't bold). */
function marked(text: string, marks: NonNullable<AdfNode['marks']>): string {
  if (!text) return ''
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  const [, lead, core, trail] = m as unknown as [string, string, string, string]
  if (!core) return text
  const has = (t: string) => marks.some((mk) => mk.type === t)
  let out = core
  if (has('code')) {
    out = core.includes('`') ? `\`\` ${core} \`\`` : `\`${core}\``
  } else {
    if (has('strike')) out = `~~${out}~~`
    if (has('em')) out = `*${out}*`
    if (has('strong')) out = `**${out}**`
  }
  const link = marks.find((mk) => mk.type === 'link')
  const href = str(link?.attrs?.href)
  if (href) out = `[${out}](${href})`
  return lead + out + trail
}
