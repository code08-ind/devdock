import {
  MERGED_WINDOW_DAYS,
  prKey,
  type BuildStatus,
  type PrAction,
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
  type Call,
  type Me,
  type PrBase,
  type PrComment,
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
    private readonly call: Call,
    private readonly baseUrl: string,
  ) {
    this.api = `${baseUrl}/rest/api/1.0`
  }

  /** DC has no "myself": any authenticated response names the user in `X-AUSERNAME`. */
  async myself(): Promise<Me> {
    const { status, headers } = await this.call(`${this.api}/application-properties`)
    const name = headers.get('x-ausername')
    if (!name) {
      throw new ServiceError(
        'auth',
        `Bitbucket answered, but not as a signed-in user (the token wasn't accepted). ${dcHints.auth}`,
        { status },
      )
    }
    // The display name is a nicety: a user page we can't see still leaves the name. The name
    // is server-sent and goes into a path, so an odd one (`..`) skips the lookup.
    const lookup = safeSlug(name)
    const [user = {}] = lookup
      ? await orEmpty(
          this.call(`${this.api}/users/${encodeURIComponent(lookup)}`).then(({ body }) => [
            obj(body),
          ]),
        )
      : []
    return {
      status,
      id: name,
      // Goes into a URL path (votes): checked like any server-sent path segment.
      slug: safeSlug(text(user.slug)) ?? safeSlug(name) ?? undefined,
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
    const prs = await collect(this.call, url, pager(url), normalise)
    return list === 'merged'
      ? prs.filter((p) => p.closedAt !== null && Date.parse(p.closedAt) >= since.getTime())
      : prs
  }

  async pr(ref: PrRef): Promise<PrBase> {
    const url = this.prUrl(ref)
    const activitiesUrl = `${url}/activities?limit=100`
    const [{ body }, activities] = await Promise.all([
      this.call(url),
      collect(this.call, activitiesUrl, pager(activitiesUrl), obj, 5),
    ])
    return { ...normalise(body), unresolvedComments: unresolved(activities) }
  }

  async comments(ref: PrRef): Promise<PrComment[]> {
    const url = `${this.prUrl(ref)}/activities?limit=100`
    const activities = await collect(this.call, url, pager(url), obj, 5)
    return activities
      .filter((a) => a.action === 'COMMENTED' && a.commentAction === 'ADDED')
      .flatMap((a) => dcComments(obj(a.comment), text(obj(a.commentAnchor).path)))
  }

  async act(ref: PrRef, action: PrAction, me: Me, targetBranch: string): Promise<void> {
    const url = this.prUrl(ref)
    if (action !== 'merge') {
      const slug = me.slug
      if (!slug) throw badResponse('a user slug DevDock can use')
      const status = action === 'approve' ? 'APPROVED' : 'NEEDS_WORK'
      await this.call(`${url}/participants/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: { user: { name: slug }, approved: action === 'approve', status },
      })
      return
    }
    // Merge checks (approvals, builds, tasks) answer here, in the server's own words.
    const [{ body: check }, { body: current }] = await Promise.all([
      this.call(`${url}/merge`),
      this.call(url),
    ])
    const verdict = obj(check)
    if (verdict.canMerge !== true) {
      const vetoes = (Array.isArray(verdict.vetoes) ? verdict.vetoes : []).flatMap(
        (v) => text(obj(v).detailedMessage) ?? text(obj(v).summaryMessage) ?? [],
      )
      const why = verdict.conflicted === true ? ['It has merge conflicts.', ...vetoes] : vetoes
      throw new ServiceError(
        'conflict',
        `Bitbucket won't merge this pull request yet. ${why.join(' ') || 'It gave no reason.'}`,
      )
    }
    // The version guards against merging a PR that changes after this read, so the target
    // checked is the one in the same read (it may have been retargeted since the first).
    const fresh = obj(current)
    if (text(obj(fresh.toRef).displayId) !== targetBranch) {
      throw new ServiceError(
        'conflict',
        `Not merged: the target branch changed to "${text(obj(fresh.toRef).displayId) ?? '?'}".`,
      )
    }
    const version = fresh.version
    if (!Number.isInteger(version)) throw badResponse('the pull request version')
    // A JSON body (even empty) spares the XSRF check DC applies to form-like POSTs.
    await this.call(`${url}/merge?version=${String(version)}`, { method: 'POST', body: {} })
  }

  async builds(pr: PrBase): Promise<BuildStatus[]> {
    if (!pr.sourceCommit) return []
    const url = `${this.baseUrl}/rest/build-status/1.0/commits/${encodeURIComponent(pr.sourceCommit)}?limit=100`
    const statuses = await orEmpty(collect(this.call, url, pager(url), toBuildStatus))
    return latestPerKey(statuses)
  }

  private prUrl(ref: PrRef): string {
    return `${this.api}/projects/${encodeURIComponent(ref.owner)}/repos/${encodeURIComponent(ref.repo)}/pull-requests/${ref.id}`
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

/** A user slug or name usable as one URL path segment; null otherwise. */
function safeSlug(value: string | null): string | null {
  return value && /^[A-Za-z0-9_@~+-][A-Za-z0-9._@~+-]{0,254}$/.test(value) ? value : null
}

/** DC timestamps are epoch milliseconds. */
const iso = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : null)

/** A Data Center comment and its replies (`comments`), flattened; the anchor gives the file. */
export function dcComments(c: JsonObject, path: string | null): PrComment[] {
  const body = text(c.text)
  const author = obj(c.author)
  const own: PrComment[] = body
    ? [
        {
          id: String(c.id ?? ''),
          authorId: text(author.name),
          author: text(author.displayName) ?? text(author.name) ?? 'Someone',
          text: body,
          path: path ?? text(obj(c.anchor).path),
          createdAt: iso(c.createdDate),
        },
      ]
    : []
  const replies = Array.isArray(c.comments) ? c.comments : []
  return [...own, ...replies.flatMap((r) => dcComments(obj(r), path))]
}
