import type { JiraComment, JiraIssue, JiraIssueDetail, JiraLink } from '@shared/jira'
import { STATUS_CATEGORIES } from '@shared/jira'
import { obj, text } from './json'

/** Raw REST issue (v2 and v3 share this shape; only rich-text fields differ). */
export interface RawIssue {
  key: string
  fields: Record<string, unknown>
}

/** Custom field ids differ per site; found once via /field. */
export interface FieldIds {
  sprint: string | null
  acceptanceCriteria: string | null
}

export function normaliseIssue(raw: RawIssue, baseUrl: string, ids: FieldIds): JiraIssue {
  const f = raw.fields
  const status = obj(f.status)
  const category = text(obj(status.statusCategory).key)
  return {
    key: raw.key,
    url: `${baseUrl}/browse/${raw.key}`,
    type: text(obj(f.issuetype).name) ?? 'Issue',
    priority: text(obj(f.priority).name),
    status: text(status.name) ?? 'Unknown',
    statusCategory: (STATUS_CATEGORIES as readonly string[]).includes(category ?? '')
      ? (category as JiraIssue['statusCategory'])
      : 'unknown',
    summary: text(f.summary) ?? '',
    sprint: ids.sprint ? sprintName(f[ids.sprint]) : null,
    fixVersions: Array.isArray(f.fixVersions)
      ? f.fixVersions.map((v) => text(obj(v).name)).filter((n): n is string => n !== null)
      : [],
    assignee: text(obj(f.assignee).displayName),
    updated: text(f.updated) ?? '',
  }
}

/** Detail = list fields + description/AC/comments, with `richText` converting ADF or wiki. */
export function normaliseDetail(
  raw: RawIssue,
  baseUrl: string,
  ids: FieldIds,
  richText: (value: unknown) => string,
  /** From /comment?orderBy=-created: newest first. */
  newestComments: unknown,
): JiraIssueDetail {
  const description = richText(raw.fields.description)
  const acField = ids.acceptanceCriteria ? richText(raw.fields[ids.acceptanceCriteria]) : ''
  return {
    ...normaliseIssue(raw, baseUrl, ids),
    description,
    acceptanceCriteria: acField.trim() || acceptanceSection(description),
    links: extractLinks(description),
    comments: lastComments(newestComments, richText),
  }
}

/** The 10 newest comments, returned oldest first (reading order). */
function lastComments(value: unknown, richText: (v: unknown) => string): JiraComment[] {
  const list = obj(value).comments
  if (!Array.isArray(list)) return []
  return list
    .slice(0, 10)
    .reverse()
    .map((c) => {
      const o = obj(c)
      return {
        author: text(obj(o.author).displayName) ?? 'Unknown',
        created: text(o.created) ?? '',
        body: richText(o.body),
      }
    })
}

/**
 * The sprint field holds objects ({ name, state }) on Cloud and current Data Center, or
 * strings like `com.atlassian.greenhopper.service.sprint.Sprint@1f[id=4,state=ACTIVE,name=S 7,…]`
 * on older Data Center. Prefers the active sprint, else the last one.
 */
export function sprintName(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const sprints = value
    .map((v) => {
      if (typeof v === 'string') {
        const name = /[[,]name=([^,\]]*)/.exec(v)?.[1]
        const state = /[[,]state=([^,\]]*)/.exec(v)?.[1]
        return name ? { name, state: state ?? '' } : null
      }
      const o = obj(v)
      const name = text(o.name)
      return name ? { name, state: text(o.state) ?? '' } : null
    })
    .filter((s): s is { name: string; state: string } => s !== null)
  const active = sprints.find((s) => s.state.toLowerCase() === 'active')
  return (active ?? sprints.at(-1))?.name ?? null
}

const AC_TITLE = /^acceptance\s+criteria\b/i

/**
 * The "Acceptance criteria" section of a Markdown description: under a heading, a bold line,
 * or a plain "Acceptance criteria:" line, up to the next heading (or bold title). Null if
 * there's no such section or it is empty.
 */
export function acceptanceSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const title = sectionTitle(lines[i]!)
    if (!title || !AC_TITLE.test(title.text)) continue
    // Text after "Acceptance criteria:" on the same line counts too.
    const inlineRest = title.text.replace(AC_TITLE, '').replace(/^\s*:?\s*/, '')
    const body: string[] = inlineRest ? [inlineRest] : []
    for (let j = i + 1; j < lines.length; j++) {
      const next = sectionTitle(lines[j]!)
      if (next && (next.level <= title.level || title.level === 7)) break
      body.push(lines[j]!)
    }
    const result = body.join('\n').trim()
    return result || null
  }
  return null
}

/** A line that starts a section: `## Title` (level 1–6) or `**Title**` / `Title:` (level 7). */
function sectionTitle(line: string): { level: number; text: string } | null {
  const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
  if (h) return { level: h[1]!.length, text: stripEmphasis(h[2]!) }
  const bold = /^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line)
  if (bold)
    return { level: 7, text: `${bold[1]!.replace(/:$/, '')}${bold[2] ? `: ${bold[2]}` : ''}` }
  const plain = /^\s*(acceptance\s+criteria)\s*:\s*(.*)$/i.exec(line)
  if (plain) return { level: 7, text: `${plain[1]}${plain[2] ? `: ${plain[2]}` : ''}` }
  return null
}

const stripEmphasis = (s: string) => s.replace(/[*_`]/g, '').trim()

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/g

/** Figma and Confluence URLs found in Markdown, de-duplicated, in order of appearance. */
export function extractLinks(markdown: string): JiraLink[] {
  const seen = new Set<string>()
  const links: JiraLink[] = []
  for (const match of markdown.matchAll(URL_RE)) {
    const raw = match[0].replace(/[.,;:!?*_]+$/, '')
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    const kind =
      host === 'figma.com' || host.endsWith('.figma.com')
        ? 'figma'
        : isConfluence(host, url.pathname)
          ? 'confluence'
          : null
    if (!kind || seen.has(url.toString())) continue
    seen.add(url.toString())
    links.push({ kind, url: url.toString() })
  }
  return links
}

/** Confluence Cloud (`*.atlassian.net/wiki`) or a self-hosted one (host or context path). */
function isConfluence(host: string, path: string): boolean {
  if (host.endsWith('.atlassian.net')) return path.startsWith('/wiki/')
  return (
    host.includes('confluence') ||
    path.startsWith('/confluence/') ||
    // Server paths, optionally under a /confluence or /wiki context path.
    /^\/(?:confluence\/|wiki\/)?(?:display\/[^/]+\/|pages\/viewpage\.action)/.test(path)
  )
}
