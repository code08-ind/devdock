import { z } from 'zod'

/** SPEC 6.6 Quick links: a user-defined launcher (name, URL, group), searchable from the palette. */

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const url = new URL(u)
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      )
    } catch {
      return false
    }
  }, 'Use an http(s) address without a user name or password')

export const QuickLinkSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  url: httpUrl,
  /** "AWS", "Dashboards"…; '' = ungrouped. */
  group: z.string().trim().max(60).default(''),
})
export type QuickLink = z.infer<typeof QuickLinkSchema>

export const MAX_QUICK_LINKS = 200

/** The export file: `{ "version": 1, "links": [...] }`. */
export function linksToJson(links: readonly QuickLink[]): string {
  return JSON.stringify({ version: 1, links }, null, 2)
}

/**
 * Reads an export file (or a bare array). Every link is checked; ids are re-made where missing
 * or repeated. Throws with a readable message when the file isn't a links export.
 */
export function parseLinksJson(text: string, newId: () => string): QuickLink[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't JSON.")
  }
  const raw = Array.isArray(data) ? data : (data as { links?: unknown })?.links
  if (!Array.isArray(raw))
    throw new Error('That file has no links list (expected { "links": [...] }).')
  if (raw.length > MAX_QUICK_LINKS) throw new Error(`At most ${MAX_QUICK_LINKS} links.`)
  const seen = new Set<string>()
  return raw.map((item, i) => {
    const candidate = { ...(item as object), id: (item as { id?: unknown })?.id ?? newId() }
    const parsed = QuickLinkSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new Error(`Link ${i + 1}: ${parsed.error.issues[0]?.message ?? 'not a valid link'}.`)
    }
    const link = seen.has(parsed.data.id) ? { ...parsed.data, id: newId() } : parsed.data
    seen.add(link.id)
    return link
  })
}

/** Links matching every search word (in name, group or host), in their saved order. */
export function searchLinks(links: readonly QuickLink[], query: string): QuickLink[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...links]
  return links.filter((l) => {
    let host = ''
    try {
      host = new URL(l.url).hostname
    } catch {
      // checked on save
    }
    const hay = `${l.name} ${l.group} ${host}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** Groups in first-seen order, ungrouped last. */
export function groupLinks(links: readonly QuickLink[]): { group: string; links: QuickLink[] }[] {
  const groups = new Map<string, QuickLink[]>()
  for (const l of links) groups.set(l.group, [...(groups.get(l.group) ?? []), l])
  const named = [...groups].filter(([g]) => g !== '')
  const loose = groups.get('') ?? []
  return [
    ...named.map(([group, items]) => ({ group, links: items })),
    ...(loose.length ? [{ group: '', links: loose }] : []),
  ]
}
