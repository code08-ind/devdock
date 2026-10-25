import { z } from 'zod'

/**
 * Agent lessons (P6-F, owner request): what reviewers asked for on my pull requests, kept in a
 * Markdown file in the repo that the user's own agent reads before it starts and adds to when it
 * finishes. DevDock makes no AI calls (SPEC 3): it gathers comments, the user picks the lessons.
 */

export const DEFAULT_LESSONS_PATH = 'docs/ai/LESSONS.md'

/** A repo-relative Markdown path that stays inside the repo. */
export const LessonsPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.startsWith('\\'), {
    message: 'A path inside the repo, e.g. docs/ai/LESSONS.md',
  })
  .refine((p) => !p.split(/[\\/]/).includes('..'), { message: "The path can't leave the repo" })
  .refine((p) => p.toLowerCase().endsWith('.md'), { message: 'A Markdown file (.md)' })

/** One lesson: a single line of plain text. */
export const LessonTextSchema = z
  .string()
  .trim()
  .min(3, 'A lesson needs a few words')
  .max(500, 'Keep a lesson under 500 characters')
  .refine((t) => !/[\r\n]/.test(t), { message: 'One line per lesson' })

export const ReviewCommentSchema = z.object({
  id: z.string(),
  /** "web-app #415". */
  pr: z.string(),
  prTitle: z.string(),
  author: z.string(),
  text: z.string(),
  /** The file an inline comment is on. */
  path: z.string().nullable(),
  createdAt: z.string().nullable(),
})
export type ReviewComment = z.infer<typeof ReviewCommentSchema>

export const LessonsRequestSchema = z.object({ repoId: z.string().min(1).max(100) })

export const LessonsAddSchema = z.object({
  repoId: z.string().min(1).max(100),
  lessons: z.array(LessonTextSchema).min(1).max(50),
})
export type LessonsAdd = z.infer<typeof LessonsAddSchema>

export const LessonsStateSchema = z.object({
  /** Repo-relative path from Settings → Workflow. */
  path: z.string(),
  exists: z.boolean(),
  lessons: z.array(z.string()),
  /** Bitbucket repo slugs of the repo's remotes: its own PRs' comments are offered first. */
  remoteRepos: z.array(z.string()),
})
export type LessonsState = z.infer<typeof LessonsStateSchema>

export const LessonsAddResultSchema = LessonsStateSchema.extend({
  /** How many were new (the rest were already in the file). */
  added: z.number().int(),
})
export type LessonsAddResult = z.infer<typeof LessonsAddResultSchema>

export const LESSONS_HEADER = `# Lessons for agents

What reviewers asked for on this repo's pull requests, and what agents learned working here.
Read this before you start. When you finish, add anything new as one line under "Lessons".

## Lessons
`

/** The lessons in a file: its "- " list items, in order. */
export function parseLessons(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((l): l is string => Boolean(l))
}

const sameLesson = (s: string) =>
  s
    .replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * The file with `lessons` appended as list items (a new file starts with the header). Lessons
 * already in the file, or repeated in `lessons`, are skipped; the rest of the file is kept as is.
 */
export function appendLessons(
  markdown: string | null,
  lessons: readonly string[],
): { text: string; added: number } {
  const base = markdown ?? LESSONS_HEADER
  const seen = new Set(parseLessons(base).map(sameLesson))
  const fresh: string[] = []
  for (const lesson of lessons) {
    const key = sameLesson(lesson)
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(lesson.trim())
  }
  if (fresh.length === 0) return { text: base, added: 0 }
  const eol = base.includes('\r\n') ? '\r\n' : '\n'
  const body = base.replace(/(\r?\n)*$/, '')
  return { text: `${body}${eol}${fresh.map((l) => `- ${l}`).join(eol)}${eol}`, added: fresh.length }
}

/**
 * A comment as a lesson to edit: Markdown quotes, code fences and links flattened to one line,
 * capped, with where it came from ("(web-app #415, src/Checkout.tsx)").
 */
export function lessonFromComment(c: ReviewComment): string {
  const text = c.text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const short = text.length > 300 ? `${text.slice(0, 297).trimEnd()}…` : text
  const where = [c.pr, c.path].filter(Boolean).join(', ')
  // Within LessonTextSchema's 500 characters, however long the PR list or path.
  const source = where.length > 150 ? `${where.slice(0, 149)}…` : where
  return `${short} (${source})`
}

/**
 * The same comment from the same reviewer on several PRs, as one: the PRs listed together
 * ("web-app #412, #415"), newest first. A reviewer repeating themselves is the lesson to keep.
 */
export function groupComments(comments: readonly ReviewComment[]): ReviewComment[] {
  const groups = new Map<string, ReviewComment[]>()
  for (const c of comments) {
    const key = `${c.author}\n${c.text.replace(/\s+/g, ' ').trim().toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.values()].map((same) => {
    const first = same[0]!
    if (same.length === 1) return first
    const prs = [...new Set(same.map((c) => c.pr))]
    const repo = (pr: string) => pr.slice(0, pr.lastIndexOf(' #'))
    // "web-app #412, #415" when they share a repo; full labels otherwise.
    const pr = prs
      .map((p, i) => (i > 0 && repo(p) === repo(prs[0]!) ? p.slice(p.lastIndexOf('#')) : p))
      .join(', ')
    const paths = new Set(same.map((c) => c.path))
    return { ...first, pr, path: paths.size === 1 ? first.path : null }
  })
}

/** Review comments worth offering: someone else's, with more than a quick "LGTM". */
export const MIN_COMMENT_LENGTH = 12

export interface LessonsMessageOptions {
  pointToLessons: boolean
  askForLessons: boolean
}

/**
 * What the Start work agent message adds about lessons. "Read" only when the file exists;
 * "add" either way (the agent creates it).
 */
export function lessonsNote(
  opts: LessonsMessageOptions,
  path: string,
  exists: boolean,
): string | null {
  const parts = [
    opts.pointToLessons && exists && `Read ${path} first.`,
    opts.askForLessons && `When you finish, add what you learned to ${path}, one line each.`,
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/**
 * The repo slug in a remote URL (`git@bitbucket.org:team/web-app.git`,
 * `https://host/scm/PROJ/web-app.git`): its last path segment, lower case, without `.git`.
 */
export function remoteRepoSlug(url: string): string | null {
  const path = url.trim().replace(/\/+$/, '')
  const last = path.split(/[/:\\]/).pop() ?? ''
  const slug = last.replace(/\.git$/i, '').toLowerCase()
  return slug ? slug : null
}

/** The repo part of a PR label ("web-app #415" → "web-app"). */
export const prRepo = (pr: string) => pr.slice(0, pr.indexOf(' #')).toLowerCase()
