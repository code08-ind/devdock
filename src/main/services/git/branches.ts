/** Branch-name helpers: slugs, templates, collisions and protected patterns. Pure. */

export const SLUG_MAX = 50

/**
 * ASCII-only kebab-case slug, at most `max` characters, cut at a word boundary when possible
 * (SPEC 6.2). Letters with accents are transliterated ("Café" → "cafe"); other scripts drop out.
 */
export function slugify(text: string, max = SLUG_MAX): string {
  const ascii = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
  const words = ascii.split(/[^a-z0-9]+/).filter(Boolean)
  let slug = ''
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w
    if (next.length <= max) slug = next
    else {
      // A single word longer than the limit is cut; otherwise stop at the last whole word.
      if (!slug) slug = w.slice(0, max)
      break
    }
  }
  return slug
}

export interface BranchTemplateValues {
  KEY?: string
  slug: string
}

/**
 * Fills a template such as `feature/{KEY}-{slug}`. Empty parts are dropped along with the
 * separator next to them, so a ticket without a usable title gives `feature/NM-12`.
 */
export function renderBranchName(template: string, values: BranchTemplateValues): string {
  // Nothing to name the branch after: let the caller ask for a name instead of returning "feature".
  if (!(values.KEY ?? '').trim() && !values.slug) return ''
  const filled = template
    .replace(/\{KEY\}/g, (values.KEY ?? '').trim())
    .replace(/\{slug\}/g, values.slug)
  return filled
    .replace(/-{2,}/g, '-')
    .replace(/\/-|-\//g, '/')
    .replace(/^-|-$/g, '')
    .replace(/\/$/, '')
}

/**
 * Renders the template and, if that branch exists, retries with `-2`, `-3`, … appended to the
 * slug (compared case-insensitively, like the file system). The slug is shortened to make room
 * for the suffix, so it never exceeds SLUG_MAX.
 */
export function uniqueBranchName(
  template: string,
  values: BranchTemplateValues,
  taken: ReadonlySet<string>,
): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()))
  const first = renderBranchName(template, values)
  if (!lower.has(first.toLowerCase())) return first
  for (let n = 2; ; n++) {
    const suffix = String(n)
    const room = SLUG_MAX - suffix.length - (values.slug ? 1 : 0)
    const slug = values.slug ? `${slugify(values.slug, room)}-${suffix}` : suffix
    const candidate = renderBranchName(template, { ...values, slug })
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

export { isValidBranchName } from '@shared/gitref'

export { DEFAULT_PROTECTED } from '@shared/settings'

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*')
  return new RegExp(`^${body}$`, 'i')
}

/**
 * Whether pushing `branch` is blocked. Case-insensitive (refs are case-insensitive on the
 * default macOS and Windows file systems). `*` stays within one path segment, `**` spans them.
 */
export function isProtectedBranch(branch: string, patterns: readonly string[]): boolean {
  const name = branch.replace(/^refs\/heads\//, '')
  return patterns.some((p) => p.trim() && globToRegExp(p.trim()).test(name))
}
