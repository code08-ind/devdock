import type { PullRequest } from '@shared/bitbucket'
import type { JiraIssue } from '@shared/jira'
import type { RepoConfig } from '@shared/settings'
import { dayKey, standupWindow, type StandupDraft } from '@shared/standup'
import type { GitRunner } from './git/exec'
import { ServiceError } from './service-error'

/**
 * SPEC 6.6 Standup draft: my commits across the registered repos, my PRs opened or merged, and
 * Jira issues whose status I changed — from the previous working day's start until today — and
 * Today prefilled from my in-progress tickets. A source that isn't set up (or fails) adds a
 * note instead of failing the draft.
 */

export interface Commit {
  repo: string
  subject: string
  /** ISO time. */
  at: string
}

export interface StandupDeps {
  holidays: () => string[]
  /** My commits in the period (git, or the demo's). */
  commits: (from: Date, to: Date) => Promise<Commit[]>
  prs: (list: 'mine' | 'merged') => Promise<PullRequest[]>
  jira: {
    statusChangedByMe(from: Date, to: Date): Promise<JiraIssue[]>
    inProgress(): Promise<JiraIssue[]>
  }
}

/** A failed source becomes a note (its own words for "not set up"). */
async function attempt<T>(what: string, fn: () => Promise<T>, notes: string[]): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    notes.push(
      err instanceof ServiceError && err.kind === 'not_configured'
        ? `${what}: not set up, so not included.`
        : `${what}: couldn't be read (${err instanceof Error ? err.message : String(err)}).`,
    )
    return null
  }
}

const within = (iso: string | null, from: Date, to: Date) => {
  const t = iso ? Date.parse(iso) : NaN
  return t >= from.getTime() && t < to.getTime()
}

export async function standupDraft(deps: StandupDeps, today: Date): Promise<StandupDraft> {
  const { from, to } = standupWindow(today, deps.holidays())
  const notes: string[] = []
  const [commits, mine, merged, moved, active] = await Promise.all([
    attempt('Commits', () => deps.commits(from, to), notes),
    attempt('Pull requests', () => deps.prs('mine'), notes),
    attempt('Merged pull requests', () => deps.prs('merged'), notes),
    attempt('Jira activity', () => deps.jira.statusChangedByMe(from, to), notes),
    attempt('Jira in-progress tickets', () => deps.jira.inProgress(), notes),
  ])

  const yesterday: string[] = []
  // Commits per repo, oldest first; the same subject twice (a cherry-pick) once.
  const seen = new Set<string>()
  for (const c of [...(commits ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const line = `${c.repo}: ${c.subject}`
    if (!seen.has(line)) yesterday.push(line)
    seen.add(line)
  }
  const pr = (p: PullRequest) => `${p.ref.repo} #${p.ref.id} ${p.title}`
  for (const p of mine ?? [])
    if (within(p.createdAt, from, to)) yesterday.push(`Opened PR ${pr(p)}`)
  for (const p of merged ?? []) {
    // The open list misses a PR opened and merged in the same period.
    const verb = within(p.createdAt, from, to) ? 'Opened and merged' : 'Merged'
    if (within(p.closedAt, from, to)) yesterday.push(`${verb} PR ${pr(p)}`)
  }
  for (const i of moved ?? []) yesterday.push(`${i.key} → ${i.status}: ${i.summary}`)

  return {
    yesterdayDate: dayKey(from),
    yesterday,
    today: (active ?? []).map((i) => `${i.key}: ${i.summary} (${i.status})`),
    blockers: [],
    notes,
  }
}

/**
 * `git log` per registered repo: my non-merge commits on any branch in the period, by the
 * configured author email. Hashes de-duplicate a commit reachable from several branches.
 */
export async function gitCommits(
  git: GitRunner,
  repos: RepoConfig[],
  author: string,
  from: Date,
  to: Date,
): Promise<Commit[]> {
  if (!author) {
    throw new ServiceError(
      'not_configured',
      'Set your git author email in Settings → Standup to include commits.',
    )
  }
  const lists = await Promise.all(
    repos.map(async (repo) => {
      const { stdout } = await git
        .run(
          [
            'log',
            '--all',
            '--no-merges',
            // Fixed-string match on the email, so dots and pluses aren't regex.
            '--fixed-strings',
            `--author=<${author}>`,
            `--since=${from.toISOString()}`,
            `--until=${to.toISOString()}`,
            '--format=%H%x1f%aI%x1f%s',
          ],
          { cwd: repo.path },
        )
        .catch(() => ({ stdout: '' })) // a moved repo adds nothing
      const seen = new Set<string>()
      return stdout.split('\n').flatMap((line) => {
        const [hash, at, subject] = line.split('\x1f')
        if (!hash || !at || subject === undefined || seen.has(hash)) return []
        seen.add(hash)
        return [{ repo: repo.name, subject, at }]
      })
    }),
  )
  return lists.flat()
}
