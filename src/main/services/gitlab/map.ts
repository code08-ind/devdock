import { prKey, type BuildState, type BuildStatus } from '@shared/bitbucket'
import { ciRunKey, CiRunRefSchema, type CiJob, type CiRun, type CiState } from '@shared/ci'
import { num, obj, text } from '../json'
import { voteCounts, type PrBase } from '../bitbucket/adapter'
import { epoch, firstLine, serverRef } from '../providers/common'
import { ServiceError } from '../service-error'

/**
 * GitLab REST v4 JSON → DevDock's models (P7.06). Pure, so fixtures test it.
 * Field names: https://docs.gitlab.com/api/merge_requests/ , pipelines, jobs, discussions.
 */

/** `group/sub/project` and the iid from `references.full` (`group/sub/project!12`) or web_url. */
export function projectOf(mr: Record<string, unknown>, root = ''): string | null {
  const full = text(obj(mr.references).full)
  const m = full ? /^(.+)!(\d+)$/.exec(full) : null
  if (m) return m[1]!
  const web = text(mr.web_url)
  const w = web ? /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/.exec(web) : null
  if (!w) return null
  // A relative URL root (`https://host/gitlab/group/…`) is part of the link, not the project.
  const path = w[1]!
  return root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? path.slice(root.length + 1)
    : path
}

/**
 * A merge request (list or single) and its approvals → the PR model, before builds.
 * `root` is a self-managed GitLab's relative URL root, taken off web_url paths.
 */
export function toMr(raw: unknown, approvals: unknown, root = ''): PrBase {
  const mr = obj(raw)
  const project = projectOf(mr, root) ?? ''
  const parts = project.split('/')
  const ref = serverRef('gitlab', parts.slice(0, -1).join('/'), parts.at(-1), mr.iid)
  const approvedBy = obj(approvals).approved_by
  const approved = new Set(
    (Array.isArray(approvedBy) ? approvedBy : []).flatMap((a) => {
      const user = obj(obj(a).user)
      return text(user.username) ?? []
    }),
  )
  const reviewers = new Map<string, PrBase['reviewers'][number]['status']>()
  for (const r of Array.isArray(mr.reviewers) ? mr.reviewers : []) {
    const who = text(obj(r).username)
    if (who) reviewers.set(who, approved.has(who) ? 'approved' : 'unapproved')
  }
  // Approvers who aren't listed as reviewers still approved it.
  for (const who of approved) reviewers.set(who, 'approved')
  const list = [...reviewers].map(([name, status]) => ({ name, status }))
  const state = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'declined'
  return {
    key: prKey(ref),
    ref,
    title: text(mr.title) ?? `!${ref.id}`,
    url: text(mr.web_url) ?? '',
    author: text(obj(mr.author).username) ?? 'unknown',
    sourceBranch: text(mr.source_branch) ?? '',
    targetBranch: text(mr.target_branch) ?? '',
    state,
    reviewers: list,
    ...voteCounts(list),
    comments: num(mr.user_notes_count) ?? 0,
    unresolvedComments: null,
    conflicts: typeof mr.has_conflicts === 'boolean' ? mr.has_conflicts : null,
    createdAt: text(mr.created_at) ?? new Date(0).toISOString(),
    updatedAt: text(mr.updated_at) ?? text(mr.created_at) ?? new Date(0).toISOString(),
    closedAt: text(mr.merged_at) ?? text(mr.closed_at),
    sourceCommit: text(mr.sha),
  }
}

/** Pipeline / job status → CI state. */
export function glState(status: unknown): CiState {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'canceling':
      return 'cancelled'
    case 'skipped':
      return 'skipped'
    case 'manual':
    case 'scheduled':
      return 'manual'
    case 'running':
      return 'running'
    default:
      return 'queued' // created, waiting_for_resource, preparing, pending
  }
}

const BUILD: Record<CiState, BuildState> = {
  success: 'success',
  failed: 'failed',
  running: 'running',
  queued: 'running',
  cancelled: 'stopped',
  skipped: 'stopped',
  manual: 'stopped',
}

/** A single MR's `head_pipeline` → the PR card's build status (none when no pipeline ran). */
export function pipelineStatus(mr: unknown): BuildStatus[] {
  const p = obj(obj(mr).head_pipeline)
  const id = num(p.id)
  if (id === null) return []
  return [
    {
      key: 'pipeline',
      name: `Pipeline #${id}`,
      state: BUILD[glState(p.status)],
      url: text(p.web_url),
    },
  ]
}

/** Open threads: discussions with a resolvable note that isn't resolved. */
export function unresolvedThreads(discussions: unknown): number {
  return (Array.isArray(discussions) ? discussions : []).filter((d) => {
    const notes = obj(d).notes
    return (Array.isArray(notes) ? notes : []).some(
      (n) => obj(n).resolvable === true && obj(n).resolved === false,
    )
  }).length
}

/** A pipeline (list item or single) → CiRun. `project` is the namespace path. */
export function toPipeline(raw: unknown, project: string): CiRun {
  const p = obj(raw)
  const parsed = CiRunRefSchema.safeParse({ provider: 'gitlab', project, id: p.id })
  if (!parsed.success) {
    throw new ServiceError('bad_response', "GitLab didn't return a pipeline with a valid id.")
  }
  const ref = parsed.data
  const state = glState(p.status)
  const startedAt = epoch(p.started_at) ?? epoch(p.created_at)
  const duration = num(p.duration)
  const finished = epoch(p.finished_at)
  return {
    key: ciRunKey(ref),
    ref,
    name: text(p.name) ?? 'Pipeline',
    number: num(p.iid) ?? num(p.id),
    event: text(p.source) ?? 'unknown',
    branch: text(p.ref),
    sha: text(p.sha),
    title: firstLine(obj(p.commit).title),
    actor: text(obj(p.user).username),
    state,
    url: text(p.web_url) ?? '',
    createdAt: epoch(p.created_at) ?? 0,
    startedAt,
    durationMs:
      duration !== null
        ? duration * 1000
        : finished !== null && startedAt !== null
          ? finished - startedAt
          : null,
    attempt: 1,
  }
}

/** A pipeline job → CiJob (GitLab jobs have no steps; the stage groups them). */
export function toGlJob(raw: unknown): CiJob | null {
  const j = obj(raw)
  const id = num(j.id)
  if (id === null || id <= 0 || !Number.isInteger(id)) return null
  const duration = num(j.duration)
  return {
    id,
    name: text(j.name) ?? `Job ${id}`,
    stage: text(j.stage),
    state: glState(j.status),
    url: text(j.web_url),
    startedAt: epoch(j.started_at),
    durationMs: duration === null ? null : Math.round(duration * 1000),
    steps: [],
  }
}
