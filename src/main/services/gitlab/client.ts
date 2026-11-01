import {
  MERGED_WINDOW_DAYS,
  type PrAction,
  type PrList,
  type PrRef,
  type PullRequest,
  boundChanges,
  diffLineCounts,
  MAX_PR_FILES,
  type PrChanges,
  type PrFileChange,
} from '@shared/bitbucket'
import {
  LOG_TAIL_BYTES,
  type CiAction,
  type CiJob,
  type CiLog,
  type CiRun,
  type CiRunDetail,
  type CiRunRef,
  type CiRunsResult,
} from '@shared/ci'
import type { HostConnection } from '@shared/hosting'
import { GITLAB_WEB } from '@shared/providers'
import { mapLimit } from '../async'
import type { HttpClient } from '../http'
import { num, obj, text } from '../json'
import type { PrBase } from '../bitbucket/adapter'
import type { ActionResult } from '../bitbucket/client'
import {
  checkCiAction,
  checkPrAction,
  withBuilds,
  withHostWords,
  type HostClient,
} from '../providers/common'
import { ProviderRest, waitText } from '../providers/rest'
import { ServiceError, parseRetryAfter, type ServiceHints } from '../service-error'
import { pipelineStatus, toGlJob, toMr, toPipeline, unresolvedThreads } from './map'

/**
 * GitLab (P7.06): gitlab.com or self-managed, REST v4, personal access token (`read_api`;
 * `api` only for approve / merge / retry / cancel).
 */

export interface GitLabConfig {
  /** Web address: https://gitlab.com, or the self-managed URL (may have a relative root). */
  baseUrl: string
  token: string
}

export const gitlabHints: ServiceHints = {
  auth: 'Check the personal access token in Settings → GitLab (it may have expired or been revoked).',
  forbidden:
    'The token needs the read_api scope (api for approve, merge, retry and cancel), and your role in the project must allow it.',
}

export const gitlabApiRoot = (web: string) => `${web.replace(/\/+$/, '')}/api/v4`

/** GitLab answers 429 when rate limited, with `Retry-After` and/or `RateLimit-Reset` (epoch s). */
export function gitlabRateLimit(res: Response, body: string, now: number): ServiceError | null {
  if (res.status !== 429) return null
  const reset = Number(res.headers.get('ratelimit-reset'))
  const wait =
    parseRetryAfter(res.headers.get('retry-after'), now) ??
    (Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - now / 1000)) : 60)
  return new ServiceError(
    'rate_limited',
    `GitLab is rate limiting requests (429). DevDock pauses GitLab and tries again ${waitText(wait, now)}.`,
    { status: 429, retryAfterSec: wait, details: body || undefined },
  )
}

const DETAIL_CONCURRENCY = 4
const LIST_LIMIT = 30
const RUNS_PER_REPO = 10
const RUNS_LIMIT = 40

interface Me {
  id: number
  username: string
  name: string
}

/** GitLab marks a file's change with three flags. */
function gitlabStatus(d: Record<string, unknown>): PrFileChange['status'] {
  if (d.new_file === true) return 'added'
  if (d.deleted_file === true) return 'removed'
  if (d.renamed_file === true) return 'renamed'
  return 'modified'
}

export class GitLabClient implements HostClient {
  private readonly rest: ProviderRest
  private readonly api: string
  private readonly root: string
  private me: Promise<Me> | null = null

  constructor(
    http: HttpClient,
    config: GitLabConfig,
    private readonly projects: () => Promise<string[]>,
    opts: { timeoutMs?: number; now?: () => number } = {},
  ) {
    const web = (config.baseUrl || GITLAB_WEB).replace(/\/+$/, '')
    this.api = gitlabApiRoot(web)
    this.root = new URL(web).pathname.replace(/^\/+|\/+$/g, '')
    this.rest = new ProviderRest(
      http,
      {
        service: 'GitLab',
        authorization: `Bearer ${config.token}`,
        hints: gitlabHints,
        timeoutMs: opts.timeoutMs ?? 20_000,
        rateLimit: gitlabRateLimit,
      },
      opts.now,
    )
  }

  async testConnection(): Promise<HostConnection> {
    const res = await this.rest.json(`${this.api}/user`)
    const me = readMe(res.body)
    this.me = Promise.resolve(me)
    // Needs read_api / read_user; a token without it still identified the user above.
    const version = await this.rest
      .json(`${this.api}/version`)
      .then((v) => text(obj(v.body).version))
      .catch(() => null)
    return {
      status: res.status,
      user: { displayName: me.name, account: me.username },
      apiUrl: this.api,
      version,
      scopes: null,
    }
  }

  async list(list: PrList, now = Date.now()): Promise<PullRequest[]> {
    const me = await this.myself()
    const since = new Date(now - MERGED_WINDOW_DAYS * 86_400_000).toISOString()
    const query =
      list === 'mine'
        ? 'scope=created_by_me&state=opened'
        : list === 'reviewing'
          ? `scope=all&state=opened&reviewer_username=${encodeURIComponent(me.username)}`
          : `scope=created_by_me&state=merged&updated_after=${encodeURIComponent(since)}`
    const res = await this.rest.json(
      `${this.api}/merge_requests?${query}&order_by=updated_at&sort=desc&per_page=${LIST_LIMIT}`,
    )
    const items = Array.isArray(res.body) ? res.body : []
    const prs = await mapLimit(items, DETAIL_CONCURRENCY, async (raw) => {
      const ref = toMr(raw, null, this.root).ref
      return this.full(ref, false)
    })
    return prs
      .filter((p) => list !== 'reviewing' || p.author !== me.username)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  pr(ref: PrRef): Promise<PullRequest> {
    return this.full(ref, true)
  }

  async act(ref: PrRef, action: PrAction, typedTarget: string | undefined): Promise<ActionResult> {
    const { pr: before } = await this.base(ref)
    checkPrAction(before, action, typedTarget)
    const me = await this.myself()
    const mr = this.mrUrl(ref)
    try {
      if (action === 'merge') {
        // `sha`: GitLab refuses (409) when the source branch moved since we checked.
        await this.rest.json(`${mr}/merge`, { method: 'PUT', body: { sha: before.sourceCommit } })
      } else if (action === 'approve') {
        await this.rest.json(`${mr}/approve`, {
          method: 'POST',
          body: { sha: before.sourceCommit },
        })
      } else {
        throw new ServiceError('forbidden', "GitLab's API has no “request changes”.")
      }
    } catch (err) {
      throw withHostWords('GitLab', err)
    }
    return { pr: await this.pr(ref), actor: me.username }
  }

  async runs(): Promise<CiRunsResult> {
    const me = await this.myself()
    const projects = await this.projects()
    const notes: string[] = []
    const perRepo = await mapLimit(projects, DETAIL_CONCURRENCY, async (project) => {
      try {
        const res = await this.rest.json(
          `${this.projectUrl(project)}/pipelines?username=${encodeURIComponent(me.username)}&order_by=id&sort=desc&per_page=${RUNS_PER_REPO}`,
        )
        return (Array.isArray(res.body) ? res.body : []).map((p) => toPipeline(p, project))
      } catch (err) {
        if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
          notes.push(
            `${project}: ${err.kind === 'not_found' ? 'not found, or the token has no access' : 'no pipeline access with this token'}`,
          )
          return []
        }
        throw err
      }
    })
    const runs = perRepo
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RUNS_LIMIT)
    return { runs, projects, notes }
  }

  async runInfo(ref: CiRunRef): Promise<CiRun> {
    const res = await this.rest.json(this.pipelineUrl(ref))
    return toPipeline(res.body, ref.project)
  }

  async run(ref: CiRunRef): Promise<CiRunDetail> {
    const [run, jobs] = await Promise.all([
      this.runInfo(ref),
      this.rest.json(`${this.pipelineUrl(ref)}/jobs?per_page=100`),
    ])
    return {
      run,
      jobs: (Array.isArray(jobs.body) ? jobs.body : []).flatMap((j): CiJob[] => {
        const job = toGlJob(j)
        return job ? [job] : []
      }),
    }
  }

  log(ref: CiRunRef, jobId: number): Promise<CiLog> {
    return this.rest.textTail(`${this.projectUrl(ref.project)}/jobs/${jobId}/trace`, LOG_TAIL_BYTES)
  }

  async ciAct(ref: CiRunRef, action: CiAction): Promise<CiRun> {
    checkCiAction('gitlab', await this.runInfo(ref), action)
    try {
      const res = await this.rest.json(`${this.pipelineUrl(ref)}/${action}`, { method: 'POST' })
      if (res.body) return toPipeline(res.body, ref.project)
    } catch (err) {
      throw withHostWords('GitLab', err)
    }
    return this.runInfo(ref)
  }

  // ---------------------------------------------------------------------------------------

  /**
   * T7: the MR description and up to MAX_PR_FILES files; line counts come from each file's diff
   * (empty when GitLab leaves a big diff out: then unknown). `/diffs` is GitLab 15.7+; older
   * servers answer `/changes`.
   */
  async changes(ref: PrRef): Promise<PrChanges> {
    const mr = this.mrUrl(ref)
    const [single, diffs] = await Promise.all([
      this.rest.json(mr),
      this.rest
        .json(`${mr}/diffs?per_page=${MAX_PR_FILES}`)
        .then((r) => (Array.isArray(r.body) ? r.body : []))
        .catch(async (err: unknown) => {
          if (!(err instanceof ServiceError) || err.kind !== 'not_found') throw err
          const old = await this.rest.json(`${mr}/changes`)
          const list = obj(old.body).changes
          return Array.isArray(list) ? list : []
        }),
    ])
    const m = obj(single.body)
    const files = diffs.map(obj).map((d) => {
      const diff = text(d.diff)
      const counts = diff ? diffLineCounts(diff) : null
      return {
        path: text(d.new_path) ?? text(d.old_path) ?? '(unknown)',
        status: gitlabStatus(d),
        added: counts?.added ?? null,
        removed: counts?.removed ?? null,
      }
    })
    // `changes_count` is a string: "12", or "1000+" when GitLab caps it (then at least that many).
    const count = /^(\d+)(\+?)$/.exec(text(m.changes_count) ?? '')
    const total = count ? (count[2] ? { atLeast: Number(count[1]) } : Number(count[1])) : null
    return boundChanges(text(m.description) ?? '', files, total)
  }

  private async base(ref: PrRef): Promise<{ pr: PrBase; raw: unknown }> {
    const mr = this.mrUrl(ref)
    const [single, approvals] = await Promise.all([
      this.rest.json(mr),
      this.rest.json(`${mr}/approvals`).catch(hidden),
    ])
    return { pr: toMr(single.body, approvals?.body ?? null, this.root), raw: single.body }
  }

  private async full(ref: PrRef, single: boolean): Promise<PullRequest> {
    const { pr, raw } = await this.base(ref)
    const unresolved = single
      ? await this.rest
          .json(`${this.mrUrl(ref)}/discussions?per_page=100`)
          .then((d) => unresolvedThreads(d.body))
          .catch((err: unknown) => {
            if (err instanceof ServiceError && err.kind === 'rate_limited') throw err
            return null
          })
      : null
    return withBuilds({ ...pr, unresolvedComments: unresolved }, pipelineStatus(raw))
  }

  private projectUrl(path: string) {
    return `${this.api}/projects/${encodeURIComponent(path)}`
  }

  private mrUrl(ref: PrRef) {
    return `${this.projectUrl(`${ref.owner}/${ref.repo}`)}/merge_requests/${ref.id}`
  }

  private pipelineUrl(ref: CiRunRef) {
    return `${this.projectUrl(ref.project)}/pipelines/${ref.id}`
  }

  private myself(): Promise<Me> {
    this.me ??= this.rest.json(`${this.api}/user`).then(
      (res) => readMe(res.body),
      (err: unknown) => {
        this.me = null
        throw err
      },
    )
    return this.me
  }
}

function readMe(body: unknown): Me {
  const u = obj(body)
  const username = text(u.username)
  const id = num(u.id)
  if (!username || id === null) {
    throw new ServiceError('bad_response', "GitLab didn't say who the token belongs to.")
  }
  return { id, username, name: text(u.name) ?? username }
}

/** No access to approvals (some tiers / roles) is "no approvals", not a failed MR. */
function hidden(err: unknown): null {
  if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
    return null
  }
  throw err
}
