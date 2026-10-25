import {
  MERGED_WINDOW_DAYS,
  type PrAction,
  type PrList,
  type PrRef,
  type PullRequest,
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
import { GITHUB_WEB } from '@shared/providers'
import { mapLimit } from '../async'
import type { HttpClient } from '../http'
import { obj, text } from '../json'
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
import { buildStatuses, repoOfSearchHit, toJob, toPr, toRun } from './map'

/**
 * GitHub (P7.05): github.com or GitHub Enterprise Server, REST v3 (+ one GraphQL query for
 * unresolved review threads, which REST doesn't expose). Token: fine-grained PAT (Pull
 * requests, Contents, Actions — read; write only for PR actions / re-runs) or classic.
 */

export interface GitHubConfig {
  /** Web address: https://github.com, or the GitHub Enterprise Server URL. */
  baseUrl: string
  token: string
}

export const githubHints: ServiceHints = {
  auth: 'Check the personal access token in Settings → GitHub (it may have expired or been revoked).',
  forbidden:
    'A fine-grained token needs access to the repository and read permission for Pull requests, Contents and Actions; an organisation may also need to approve the token (SSO).',
}

const isPublic = (web: string) => /^https:\/\/(www\.)?github\.com$/i.test(web.replace(/\/+$/, ''))

/** REST root: api.github.com, or `<server>/api/v3` on GitHub Enterprise Server. */
export function githubApiRoot(web: string): string {
  return isPublic(web) ? 'https://api.github.com' : `${web.replace(/\/+$/, '')}/api/v3`
}

export function githubGraphqlUrl(web: string): string {
  return isPublic(web) ? 'https://api.github.com/graphql' : `${web.replace(/\/+$/, '')}/api/graphql`
}

/**
 * GitHub's rate limits (docs: "Rate limits for the REST API"): the primary limit is spent when
 * `x-ratelimit-remaining` is 0 (403 or 429; wait until `x-ratelimit-reset`, epoch seconds);
 * a secondary limit sends `retry-after`, or only says so in the body (then wait a minute).
 */
export function githubRateLimit(res: Response, body: string, now: number): ServiceError | null {
  if (res.status !== 403 && res.status !== 429) return null
  const details = body || undefined
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  if (remaining === '0' && Number.isFinite(reset) && reset > 0) {
    const wait = Math.max(1, Math.ceil(reset - now / 1000))
    const limit = res.headers.get('x-ratelimit-limit')
    return new ServiceError(
      'rate_limited',
      `GitHub's API rate limit for this token is used up${limit ? ` (${limit} requests an hour)` : ''}. DevDock pauses GitHub and tries again ${waitText(wait, now)}.`,
      { status: res.status, retryAfterSec: wait, details },
    )
  }
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'), now)
  if (retryAfter !== null || /secondary rate limit|abuse/i.test(body) || res.status === 429) {
    const wait = retryAfter ?? 60
    return new ServiceError(
      'rate_limited',
      `GitHub asked DevDock to slow down (secondary rate limit). DevDock pauses GitHub and tries again ${waitText(wait, now)}.`,
      { status: res.status, retryAfterSec: wait, details },
    )
  }
  return null
}

const SEARCH: Record<PrList, (since: string) => string[]> = {
  mine: () => ['is:pr is:open archived:false author:@me'],
  // Asked to review, or already reviewed and still open (Bitbucket's "reviewer" list).
  reviewing: () => [
    'is:pr is:open archived:false review-requested:@me',
    'is:pr is:open archived:false reviewed-by:@me -author:@me',
  ],
  merged: (since) => [`is:pr is:merged author:@me merged:>=${since}`],
}

/** PRs read in detail per list (each costs a few requests). */
const LIST_LIMIT = 30
const DETAIL_CONCURRENCY = 4
const RUNS_PER_REPO = 10
const RUNS_LIMIT = 40

interface Me {
  login: string
  name: string
}

export class GitHubClient implements HostClient {
  private readonly rest: ProviderRest
  private readonly api: string
  private readonly web: string
  private me: Promise<Me> | null = null

  constructor(
    http: HttpClient,
    config: GitHubConfig,
    /** `owner/repo` of the registered repos hosted on this GitHub. */
    private readonly projects: () => Promise<string[]>,
    opts: { timeoutMs?: number; now?: () => number } = {},
  ) {
    this.web = (config.baseUrl || GITHUB_WEB).replace(/\/+$/, '')
    this.api = githubApiRoot(this.web)
    this.rest = new ProviderRest(
      http,
      {
        service: 'GitHub',
        authorization: `Bearer ${config.token}`,
        hints: githubHints,
        timeoutMs: opts.timeoutMs ?? 20_000,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
        rateLimit: githubRateLimit,
        etags: true,
      },
      opts.now,
    )
  }

  async testConnection(): Promise<HostConnection> {
    const res = await this.rest.json(`${this.api}/user`)
    const u = obj(res.body)
    const login = text(u.login)
    if (!login) throw new ServiceError('bad_response', "GitHub didn't say who the token belongs to.")
    this.me = Promise.resolve({ login, name: text(u.name) ?? login })
    return {
      status: res.status,
      user: { displayName: text(u.name) ?? login, account: login },
      apiUrl: this.api,
      version: res.headers.get('x-github-enterprise-version'),
      scopes: res.headers.get('x-oauth-scopes'),
    }
  }

  async list(list: PrList, now = Date.now()): Promise<PullRequest[]> {
    const since = new Date(now - MERGED_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
    const hits = (
      await Promise.all(SEARCH[list](since).map((q) => this.search(q)))
    ).flat()
    const unique = [
      ...new Map(
        hits.map((h) => [`${h.owner}/${h.repo}#${h.number}`.toLowerCase(), h] as const),
      ).values(),
    ].slice(0, LIST_LIMIT)
    const prs = await mapLimit(unique, DETAIL_CONCURRENCY, (h) =>
      this.full({ provider: 'github', owner: h.owner, repo: h.repo, id: h.number }, false),
    )
    return prs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  pr(ref: PrRef): Promise<PullRequest> {
    return this.full(ref, true)
  }

  async act(ref: PrRef, action: PrAction, typedTarget: string | undefined): Promise<ActionResult> {
    const before = await this.base(ref)
    checkPrAction(before, action, typedTarget)
    const me = await this.myself()
    const pulls = `${this.repoUrl(ref)}/pulls/${ref.id}`
    try {
      if (action === 'merge') {
        // The head we checked is the one merged: a push since then makes GitHub refuse (409).
        await this.rest.json(`${pulls}/merge`, {
          method: 'PUT',
          body: { merge_method: await this.mergeMethod(ref), sha: before.sourceCommit },
        })
      } else {
        await this.rest.json(`${pulls}/reviews`, {
          method: 'POST',
          body:
            action === 'approve'
              ? { event: 'APPROVE' }
              : { event: 'REQUEST_CHANGES', body: 'Changes requested (from DevDock).' },
        })
      }
    } catch (err) {
      throw withHostWords('GitHub', err)
    }
    return { pr: await this.pr(ref), actor: me.login }
  }

  async runs(): Promise<CiRunsResult> {
    const me = await this.myself()
    const projects = await this.projects()
    const notes: string[] = []
    const perRepo = await mapLimit(projects, DETAIL_CONCURRENCY, async (project) => {
      try {
        const res = await this.rest.json(
          `${this.api}/repos/${encodePath(project)}/actions/runs?actor=${encodeURIComponent(me.login)}&per_page=${RUNS_PER_REPO}`,
        )
        const runs = obj(res.body).workflow_runs
        return (Array.isArray(runs) ? runs : []).map((r) => toRun(r, project))
      } catch (err) {
        if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
          notes.push(`${project}: ${err.kind === 'not_found' ? 'not found, or the token has no access' : 'no Actions access with this token'}`)
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
    const res = await this.rest.json(`${this.runUrl(ref)}`)
    return toRun(res.body, ref.project)
  }

  async run(ref: CiRunRef): Promise<CiRunDetail> {
    const [run, jobs] = await Promise.all([
      this.runInfo(ref),
      this.rest.json(`${this.runUrl(ref)}/jobs?filter=latest&per_page=100`),
    ])
    const list = obj(jobs.body).jobs
    return {
      run,
      jobs: (Array.isArray(list) ? list : []).flatMap((j): CiJob[] => toJob(j) ?? []),
    }
  }

  log(ref: CiRunRef, jobId: number): Promise<CiLog> {
    return this.rest.textTail(
      `${this.api}/repos/${encodePath(ref.project)}/actions/jobs/${jobId}/logs`,
      LOG_TAIL_BYTES,
    )
  }

  async ciAct(ref: CiRunRef, action: CiAction): Promise<CiRun> {
    checkCiAction('github', await this.runInfo(ref), action)
    try {
      await this.rest.json(
        `${this.runUrl(ref)}/${action === 'retry' ? 'rerun-failed-jobs' : 'cancel'}`,
        { method: 'POST' },
      )
    } catch (err) {
      throw withHostWords('GitHub', err)
    }
    return this.runInfo(ref)
  }

  // ---------------------------------------------------------------------------------------

  private async search(q: string) {
    const res = await this.rest.json(
      `${this.api}/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${LIST_LIMIT}`,
    )
    const items = obj(res.body).items
    return (Array.isArray(items) ? items : []).flatMap((i) => repoOfSearchHit(i) ?? [])
  }

  private async base(ref: PrRef): Promise<PrBase> {
    const pulls = `${this.repoUrl(ref)}/pulls/${ref.id}`
    const [pull, reviews] = await Promise.all([
      this.rest.json(pulls),
      this.rest.json(`${pulls}/reviews?per_page=100`),
    ])
    return toPr(pull.body, Array.isArray(reviews.body) ? reviews.body : [])
  }

  private async full(ref: PrRef, single: boolean): Promise<PullRequest> {
    const pr = await this.base(ref)
    const [statuses, unresolved] = await Promise.all([
      this.builds(pr),
      single ? this.unresolved(ref) : Promise.resolve(null),
    ])
    return withBuilds({ ...pr, unresolvedComments: unresolved }, statuses)
  }

  private async builds(pr: PrBase) {
    if (!pr.sourceCommit || !/^[0-9a-f]{7,64}$/i.test(pr.sourceCommit)) return []
    const commit = `${this.repoUrl(pr.ref)}/commits/${pr.sourceCommit}`
    const [checks, combined] = await Promise.all([
      this.rest.json(`${commit}/check-runs?per_page=100`).catch(hidden),
      this.rest.json(`${commit}/status`).catch(hidden),
    ])
    return buildStatuses(checks?.body, combined?.body)
  }

  /** Unresolved review threads (GraphQL only); null when it can't be read. */
  private async unresolved(ref: PrRef): Promise<number | null> {
    try {
      const res = await this.rest.json(githubGraphqlUrl(this.web), {
        method: 'POST',
        body: {
          query:
            'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}',
          variables: { o: ref.owner, r: ref.repo, n: ref.id },
        },
      })
      const nodes = obj(
        obj(obj(obj(obj(res.body).data).repository).pullRequest).reviewThreads,
      ).nodes
      if (!Array.isArray(nodes)) return null
      return nodes.filter((n) => obj(n).isResolved === false).length
    } catch (err) {
      if (err instanceof ServiceError && err.kind === 'rate_limited') throw err
      return null
    }
  }

  /** The repository's first allowed merge method (merge commit, squash, rebase). */
  private async mergeMethod(ref: PrRef): Promise<'merge' | 'squash' | 'rebase'> {
    const repo = obj((await this.rest.json(this.repoUrl(ref))).body)
    if (repo.allow_merge_commit === false) {
      if (repo.allow_squash_merge !== false) return 'squash'
      if (repo.allow_rebase_merge !== false) return 'rebase'
    }
    return 'merge'
  }

  private repoUrl(ref: { owner: string; repo: string }) {
    return `${this.api}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  }

  private runUrl(ref: CiRunRef) {
    return `${this.api}/repos/${encodePath(ref.project)}/actions/runs/${ref.id}`
  }

  private myself(): Promise<Me> {
    this.me ??= this.rest.json(`${this.api}/user`).then(
      (res) => {
        const u = obj(res.body)
        const login = text(u.login)
        if (!login) {
          throw new ServiceError('bad_response', "GitHub didn't say who the token belongs to.")
        }
        return { login, name: text(u.name) ?? login }
      },
      (err: unknown) => {
        this.me = null
        throw err
      },
    )
    return this.me
  }
}

/** Each segment encoded, slashes kept (`owner/repo`). */
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** No access to checks / statuses is "no builds", not a failure of the whole PR. */
function hidden(err: unknown): null {
  if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
    return null
  }
  throw err
}

