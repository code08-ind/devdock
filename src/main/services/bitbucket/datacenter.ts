import {
  MERGED_WINDOW_DAYS,
  prKey,
  type BuildStatus,
  type PrList,
  type PrRef,
} from '@shared/bitbucket'
import { obj, text, type JsonObject } from '../json'
import { ServiceError, type ServiceHints } from '../service-error'
import {
  badResponse,
  checkedRef,
  collect,
  latestPerKey,
  orEmpty,
  prState,
  toBuildStatus,
  voteCounts,
  type BitbucketAdapter,
  type Get,
  type Me,
  type PrBase,
} from './adapter'

export const dcHints: ServiceHints = {
  auth: "Check the HTTP access token in Settings → Credentials, and that it hasn't expired or been revoked.",
  forbidden:
    'Bitbucket Data Center needs an HTTP access token (sent as Bearer) with at least repository read permission (write for PR actions).',
}

/** Pages: `{ values, isLastPage, nextPageStart }`; the next page repeats the URL with `start`. */
function pager(url: string) {
  return (body: unknown) => {
    const o = obj(body)
    if (!Array.isArray(o.values)) throw badResponse('a page of results')
    const next =
      o.isLastPage === false && Number.isInteger(o.nextPageStart)
        ? withParam(url, 'start', String(o.nextPageStart))
        : null
    return { values: o.values, next }
  }
}

function withParam(url: string, key: string, value: string): string {
  const u = new URL(url)
  u.searchParams.set(key, value)
  return u.toString()
}

/** Bitbucket Data Center / Server REST 1.0, HTTP access token as Bearer. */
export class DataCenterAdapter implements BitbucketAdapter {
  readonly flavor = 'datacenter' as const
  private readonly api: string

  constructor(
    private readonly get: Get,
    private readonly baseUrl: string,
  ) {
    this.api = `${baseUrl}/rest/api/1.0`
  }

  /** DC has no "myself": any authenticated response names the user in `X-AUSERNAME`. */
  async myself(): Promise<Me> {
    const { status, headers } = await this.get(`${this.api}/application-properties`)
    const name = headers.get('x-ausername')
    if (!name) {
      throw new ServiceError(
        'auth',
        `Bitbucket answered, but not as a signed-in user (the token wasn't accepted). ${dcHints.auth}`,
        { status },
      )
    }
    // The display name is a nicety: a user page we can't see still leaves the name.
    const [user = {}] = await orEmpty(
      this.get(`${this.api}/users/${encodeURIComponent(name)}`).then(({ body }) => [obj(body)]),
    )
    return {
      status,
      id: name,
      user: { displayName: text(user.displayName) ?? name, account: text(user.name) ?? name },
    }
  }

  async list(list: PrList, _me: Me, since: Date): Promise<PrBase[]> {
    const params = new URLSearchParams({
      role: list === 'reviewing' ? 'REVIEWER' : 'AUTHOR',
      state: list === 'merged' ? 'MERGED' : 'OPEN',
      order: 'NEWEST',
      limit: '50',
    })
    // `closedSince` is a duration in seconds; the date filter below is the exact cut.
    if (list === 'merged') params.set('closedSince', String(MERGED_WINDOW_DAYS * 86_400))
    const url = `${this.api}/dashboard/pull-requests?${params}`
    const prs = await collect(this.get, url, pager(url), normalise)
    return list === 'merged'
      ? prs.filter((p) => p.closedAt !== null && Date.parse(p.closedAt) >= since.getTime())
      : prs
  }

  async pr(ref: PrRef): Promise<PrBase> {
    const url = `${this.api}/projects/${encodeURIComponent(ref.owner)}/repos/${encodeURIComponent(ref.repo)}/pull-requests/${ref.id}`
    const activitiesUrl = `${url}/activities?limit=100`
    const [{ body }, activities] = await Promise.all([
      this.get(url),
      collect(this.get, activitiesUrl, pager(activitiesUrl), obj, 5),
    ])
    return { ...normalise(body), unresolvedComments: unresolved(activities) }
  }

  async builds(pr: PrBase): Promise<BuildStatus[]> {
    if (!pr.sourceCommit) return []
    const url = `${this.baseUrl}/rest/build-status/1.0/commits/${encodeURIComponent(pr.sourceCommit)}?limit=100`
    const statuses = await orEmpty(collect(this.get, url, pager(url), toBuildStatus))
    return latestPerKey(statuses)
  }
}

/**
 * Open comment threads from the activity stream: root comments added (not deleted) whose
 * `threadResolved` is false. Null when the server's comments don't carry that flag (before 8.x).
 */
function unresolved(activities: JsonObject[]): number | null {
  const roots = activities
    .filter((a) => a.action === 'COMMENTED' && a.commentAction === 'ADDED')
    .map((a) => obj(a.comment))
  if (roots.length === 0) return 0
  if (!roots.some((c) => typeof c.threadResolved === 'boolean')) return null
  return roots.filter((c) => c.threadResolved === false).length
}

/** Data Center pull request JSON → model (build filled in later). */
export function normalise(raw: unknown): PrBase {
  const o = obj(raw)
  const to = obj(o.toRef)
  const repository = obj(to.repository)
  const ref = checkedRef(obj(repository.project).key, repository.slug, o.id)
  const people = [
    ...(Array.isArray(o.reviewers) ? o.reviewers : []),
    // Participants can approve or mark needs-work too.
    ...(Array.isArray(o.participants) ? o.participants : []).filter(
      (p) => obj(p).status !== 'UNAPPROVED',
    ),
  ].map(obj)
  const reviewers = people.map((p) => ({
    name: text(obj(p.user).displayName) ?? text(obj(p.user).name) ?? 'Unknown user',
    status:
      p.status === 'APPROVED'
        ? 'approved'
        : p.status === 'NEEDS_WORK'
          ? 'needs_work'
          : 'unapproved',
  })) satisfies PrBase['reviewers']
  const props = obj(o.properties)
  const outcome = obj(props.mergeResult).outcome
  const links = obj(o.links).self
  const state = prState(o.state)
  return {
    key: prKey(ref),
    ref,
    title: text(o.title) ?? '(no title)',
    url: text(obj(Array.isArray(links) ? links[0] : null).href) ?? '',
    author: text(obj(obj(o.author).user).displayName) ?? 'Unknown user',
    sourceBranch: text(obj(o.fromRef).displayId) ?? '',
    targetBranch: text(to.displayId) ?? '',
    state,
    reviewers,
    ...voteCounts(reviewers),
    comments: typeof props.commentCount === 'number' ? props.commentCount : 0,
    unresolvedComments: null,
    conflicts: outcome === 'CONFLICTED' ? true : outcome === 'CLEAN' ? false : null,
    createdAt: iso(o.createdDate) ?? '',
    updatedAt: iso(o.updatedDate) ?? '',
    closedAt: state === 'open' ? null : (iso(o.closedDate) ?? iso(o.updatedDate)),
    sourceCommit: text(obj(o.fromRef).latestCommit),
  }
}

/** DC timestamps are epoch milliseconds. */
const iso = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : null)
