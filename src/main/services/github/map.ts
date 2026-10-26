import { prKey, type BuildState, type BuildStatus } from '@shared/bitbucket'
import { ciRunKey, CiRunRefSchema, type CiJob, type CiRun, type CiState } from '@shared/ci'
import { num, obj, text } from '../json'
import { voteCounts, type PrBase } from '../bitbucket/adapter'
import { epoch, firstLine, serverRef } from '../providers/common'
import { ServiceError } from '../service-error'

/**
 * GitHub REST v3 JSON → DevDock's models (P7.05). Pure, so fixtures from the API docs test it.
 * Field names: https://docs.github.com/rest (pulls, reviews, checks, commit statuses, actions).
 */

type Review = PrBase['reviewers'][number]

/**
 * Each reviewer's latest decision. Comments don't change a decision; a dismissed review undoes
 * it. Requested reviewers who haven't answered are `unapproved`.
 */
export function reviewersOf(reviews: unknown[], requested: unknown[]): Review[] {
  const latest = new Map<string, Review['status']>()
  for (const raw of reviews) {
    const r = obj(raw)
    const who = text(obj(r.user).login)
    if (!who) continue
    switch (r.state) {
      case 'APPROVED':
        latest.set(who, 'approved')
        break
      case 'CHANGES_REQUESTED':
        latest.set(who, 'needs_work')
        break
      case 'DISMISSED':
        latest.set(who, 'unapproved')
        break
      default:
        if (!latest.has(who)) latest.set(who, 'unapproved')
    }
  }
  for (const raw of requested) {
    const who = text(obj(raw).login)
    // Asked again after a review: the old decision no longer stands.
    if (who) latest.set(who, 'unapproved')
  }
  return [...latest].map(([name, status]) => ({ name, status }))
}

/** A pull (GET /repos/{o}/{r}/pulls/{n}) and its reviews → the PR model, before builds. */
export function toPr(raw: unknown, reviews: unknown[]): PrBase {
  const p = obj(raw)
  const base = obj(p.base)
  const head = obj(p.head)
  const full = text(obj(base.repo).full_name) ?? ''
  const [owner, repo] = full.split('/')
  const ref = serverRef('github', owner, repo, p.number)
  const requested = Array.isArray(p.requested_reviewers) ? p.requested_reviewers : []
  const reviewers = reviewersOf(reviews, requested)
  const merged = text(p.merged_at)
  return {
    key: prKey(ref),
    ref,
    title: text(p.title) ?? `#${ref.id}`,
    url: text(p.html_url) ?? '',
    author: text(obj(p.user).login) ?? 'unknown',
    sourceBranch: text(head.ref) ?? '',
    targetBranch: text(base.ref) ?? '',
    state: merged ? 'merged' : p.state === 'open' ? 'open' : 'declined',
    reviewers,
    ...voteCounts(reviewers),
    comments: (num(p.comments) ?? 0) + (num(p.review_comments) ?? 0),
    unresolvedComments: null,
    // `mergeable` is null while GitHub computes it; `dirty` means conflicts.
    conflicts:
      p.mergeable_state === 'dirty'
        ? true
        : p.mergeable === false
          ? true
          : p.mergeable === true
            ? false
            : null,
    createdAt: text(p.created_at) ?? new Date(0).toISOString(),
    updatedAt: text(p.updated_at) ?? text(p.created_at) ?? new Date(0).toISOString(),
    closedAt: merged ?? text(p.closed_at),
    sourceCommit: text(head.sha),
  }
}

/** A check run's status + conclusion → the PR card's build state. */
export function checkState(status: unknown, conclusion: unknown): BuildState {
  if (status !== 'completed') return 'running'
  switch (conclusion) {
    case 'success':
    case 'neutral':
      return 'success'
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'startup_failure':
      return 'failed'
    case 'cancelled':
    case 'skipped':
    case 'stale':
      return 'stopped'
    default:
      return 'none'
  }
}

/**
 * Check runs (Actions and other apps) plus commit statuses (older CI, e.g. Jenkins' GitHub
 * plugin) → build statuses. Skipped and unknown entries are left out of the summary.
 */
export function buildStatuses(checkRuns: unknown, combined: unknown): BuildStatus[] {
  const runs = obj(checkRuns).check_runs
  const statuses = obj(combined).statuses
  const fromChecks = (Array.isArray(runs) ? runs : []).map((raw): BuildStatus => {
    const c = obj(raw)
    const name = text(c.name) ?? 'Check'
    return {
      key: `check:${name}`,
      name,
      state: checkState(c.status, c.conclusion),
      url: text(c.html_url) ?? text(c.details_url),
    }
  })
  const fromStatuses = (Array.isArray(statuses) ? statuses : []).map((raw): BuildStatus => {
    const s = obj(raw)
    const name = text(s.context) ?? 'Status'
    const state: BuildState =
      s.state === 'success'
        ? 'success'
        : s.state === 'failure' || s.state === 'error'
          ? 'failed'
          : s.state === 'pending'
            ? 'running'
            : 'none'
    return { key: `status:${name}`, name, state, url: text(s.target_url) }
  })
  // One per name (a re-run check repeats it); the API lists newest first.
  const seen = new Set<string>()
  return [...fromChecks, ...fromStatuses].filter(
    (b) => b.state !== 'none' && !seen.has(b.key) && seen.add(b.key),
  )
}

/** Actions status + conclusion → CI state. */
export function runState(status: unknown, conclusion: unknown): CiState {
  switch (status) {
    case 'queued':
    case 'requested':
    case 'pending':
      return 'queued'
    case 'waiting':
      return 'manual'
    case 'in_progress':
      return 'running'
    case 'completed':
      break
    default:
      return 'queued'
  }
  switch (conclusion) {
    case 'success':
    case 'neutral':
      return 'success'
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
    case 'stale':
      return 'skipped'
    case 'action_required':
      return 'manual'
    default:
      return 'failed' // failure, timed_out, startup_failure
  }
}

const elapsed = (start: number | null, end: number | null) =>
  start !== null && end !== null && end >= start ? end - start : null

/** A workflow run (GET …/actions/runs[/{id}]) → CiRun. `project` is `owner/repo`. */
export function toRun(raw: unknown, project: string): CiRun {
  const r = obj(raw)
  const parsed = CiRunRefSchema.safeParse({ provider: 'github', project, id: r.id })
  if (!parsed.success) {
    throw new ServiceError('bad_response', "GitHub didn't return a workflow run with a valid id.")
  }
  const ref = parsed.data
  const state = runState(r.status, r.conclusion)
  const startedAt = epoch(r.run_started_at) ?? epoch(r.created_at)
  const finished = state !== 'queued' && state !== 'running' && state !== 'manual'
  return {
    key: ciRunKey(ref),
    ref,
    name: text(r.name) ?? text(obj(r.workflow).name) ?? 'Workflow',
    number: num(r.run_number),
    event: text(r.event) ?? 'unknown',
    branch: text(r.head_branch),
    sha: text(r.head_sha),
    title: firstLine(r.display_title) ?? firstLine(obj(r.head_commit).message),
    actor: text(obj(r.triggering_actor).login) ?? text(obj(r.actor).login),
    state,
    url: text(r.html_url) ?? '',
    createdAt: epoch(r.created_at) ?? 0,
    startedAt,
    durationMs: finished ? elapsed(startedAt, epoch(r.updated_at)) : null,
    attempt: Math.max(1, num(r.run_attempt) ?? 1),
  }
}

/** A job (GET …/runs/{id}/jobs) → CiJob with its steps. */
export function toJob(raw: unknown): CiJob | null {
  const j = obj(raw)
  const id = num(j.id)
  if (id === null || id <= 0 || !Number.isInteger(id)) return null
  const startedAt = epoch(j.started_at)
  const steps = (Array.isArray(j.steps) ? j.steps : []).map((s, i) => {
    const step = obj(s)
    return {
      name: text(step.name) ?? `Step ${i + 1}`,
      state: runState(step.status, step.conclusion),
      number: num(step.number) ?? i + 1,
    }
  })
  return {
    id,
    name: text(j.name) ?? `Job ${id}`,
    stage: null,
    state: runState(j.status, j.conclusion),
    url: text(j.html_url),
    startedAt,
    durationMs: elapsed(startedAt, epoch(j.completed_at)),
    steps,
  }
}

/** `owner/repo` from a search hit's `repository_url` (`…/repos/{owner}/{repo}`). */
export function repoOfSearchHit(
  raw: unknown,
): { owner: string; repo: string; number: number } | null {
  const hit = obj(raw)
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(text(hit.repository_url) ?? '')
  const number = num(hit.number)
  return m && number !== null
    ? { owner: decodeURIComponent(m[1]!), repo: decodeURIComponent(m[2]!), number }
    : null
}
