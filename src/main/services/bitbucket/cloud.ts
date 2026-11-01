import {
  prKey,
  type BuildStatus,
  type PrAction,
  type PrList,
  type PrRef,
  type RepoRef,
  boundChanges,
  MAX_PR_FILES,
  type PrChanges,
  type PrFileChange,
} from '@shared/bitbucket'
import { CLOUD_API, CLOUD_WEB, isCloudHost } from '@shared/prlink'
import { num, obj, text, type JsonObject } from '../json'
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

/** The API for bitbucket.org; any other base URL (tests) is used as given. */
export function cloudApiRoot(baseUrl: string): string {
  return isCloudHost(new URL(baseUrl).hostname) ? CLOUD_API : `${baseUrl}/2.0`
}

export const cloudHints: ServiceHints = {
  auth: "Check the token in Settings → Credentials and the user name or email in Settings → Bitbucket (empty for an access token), and that the token hasn't expired or been revoked.",
  forbidden:
    'Bitbucket Cloud needs the token to have read access to account, repositories and pull requests (write for PR actions).',
}

/** Basic with user name / email + app password or API token; Bearer for an access token. */
export function cloudAuthorization(username: string, token: string): string {
  return username
    ? `Basic ${Buffer.from(`${username}:${token}`, 'utf8').toString('base64')}`
    : `Bearer ${token}`
}

/** Pages: `{ values, next }`. `next` must stay on the API origin (it carries our token). */
/** Diffstat statuses (Cloud); merge conflicts and the like count as modified. */
const CLOUD_STATUS: Record<string, PrFileChange['status']> = {
  added: 'added',
  removed: 'removed',
  renamed: 'renamed',
  modified: 'modified',
}

function page(apiRoot: string) {
  const origin = new URL(apiRoot).origin
  return (body: unknown) => {
    const o = obj(body)
    if (!Array.isArray(o.values)) throw badResponse('a page of results')
    const next = text(o.next)
    return { values: o.values, next: next && new URL(next).origin === origin ? next : null }
  }
}

/**
 * Bitbucket Cloud REST 2.0. Cloud has no "pull requests I review" endpoint, so every list is a
 * per-repository query over `repos()` (the bitbucket.org remotes of the registered repos).
 */
export class CloudAdapter implements BitbucketAdapter {
  readonly flavor = 'cloud' as const
  private readonly page: ReturnType<typeof page>

  constructor(
    private readonly call: Call,
    private readonly apiRoot: string,
    private readonly repos: () => Promise<RepoRef[]>,
  ) {
    this.page = page(apiRoot)
  }

  async myself(): Promise<Me> {
    const { status, body } = await this.call(`${this.apiRoot}/user`)
    const o = obj(body)
    const id = text(o.uuid)
    // It goes into a BBQL query string: `{` hex and dashes `}` only.
    if (!id || !/^\{[0-9a-f-]+\}$/i.test(id)) throw badResponse('the signed-in user')
    return {
      status,
      id,
      user: {
        displayName: text(o.display_name) ?? 'Unknown user',
        account: text(o.nickname) ?? text(o.account_id),
      },
    }
  }

  async list(list: PrList, me: Me, since: Date): Promise<PrBase[]> {
    const repos = await this.repos()
    if (repos.length === 0) {
      throw new ServiceError(
        'not_configured',
        'Bitbucket Cloud lists pull requests per repository: add a repo with a bitbucket.org remote in Repos.',
      )
    }
    const who = list === 'reviewing' ? 'reviewers.uuid' : 'author.uuid'
    const q = [`${who}="${me.id}"`]
    if (list === 'merged') q.push(`updated_on >= ${since.toISOString()}`)
    const params = new URLSearchParams({
      state: list === 'merged' ? 'MERGED' : 'OPEN',
      q: q.join(' AND '),
      sort: '-updated_on',
      pagelen: '50',
      // Lists leave participants out unless asked.
      fields: '+values.participants',
    })
    const perRepo = await Promise.all(
      repos.map(({ owner, repo }) =>
        // A registered repo the token can't see shouldn't hide the others.
        orEmpty(
          collect(
            this.call,
            `${this.repoUrl(owner, repo)}/pullrequests?${params}`,
            this.page,
            (raw) => normalise(raw, owner, repo),
          ),
        ),
      ),
    )
    return perRepo.flat()
  }

  async pr(ref: PrRef): Promise<PrBase> {
    const url = `${this.repoUrl(ref.owner, ref.repo)}/pullrequests/${ref.id}`
    const [{ body }, comments] = await Promise.all([
      this.call(url),
      collect(this.call, `${url}/comments?pagelen=100`, this.page, obj, 5),
    ])
    const pr = normalise(body, ref.owner, ref.repo)
    // Unresolved threads: top-level, not deleted, no resolution.
    const unresolved = comments.filter((c) => !c.deleted && !c.parent && !c.resolution).length
    return { ...pr, unresolvedComments: unresolved }
  }

  async changes(ref: PrRef): Promise<PrChanges> {
    const url = `${this.repoUrl(ref.owner, ref.repo)}/pullrequests/${ref.id}`
    const [{ body }, stat] = await Promise.all([
      this.call(url),
      this.call(`${url}/diffstat?pagelen=${MAX_PR_FILES}`),
    ])
    const page = obj(stat.body)
    const files = (Array.isArray(page.values) ? page.values : []).map(obj).map((v) => ({
      path: text(obj(v.new).path) ?? text(obj(v.old).path) ?? '(unknown)',
      status: CLOUD_STATUS[String(v.status)] ?? ('modified' as const),
      added: num(v.lines_added),
      removed: num(v.lines_removed),
    }))
    return boundChanges(text(obj(body).description) ?? '', files, num(page.size))
  }

  async comments(ref: PrRef): Promise<PrComment[]> {
    const url = `${this.repoUrl(ref.owner, ref.repo)}/pullrequests/${ref.id}/comments?pagelen=100`
    const raw = await collect(this.call, url, this.page, obj, 5)
    return raw.filter((c) => !c.deleted).flatMap(cloudComment)
  }

  /** Cloud's merge takes no version: the target check in BitbucketClient.act is the last one. */
  async act(ref: PrRef, action: PrAction): Promise<void> {
    const url = `${this.repoUrl(ref.owner, ref.repo)}/pullrequests/${ref.id}`
    if (action === 'merge') {
      // No strategy named: the repository's default merge strategy applies.
      await this.call(`${url}/merge`, { method: 'POST', body: {} })
    } else {
      await this.call(`${url}/${action === 'approve' ? 'approve' : 'request-changes'}`, {
        method: 'POST',
      })
    }
  }

  async builds(pr: PrBase): Promise<BuildStatus[]> {
    if (!pr.sourceCommit) return []
    const url = `${this.repoUrl(pr.ref.owner, pr.ref.repo)}/commit/${encodeURIComponent(pr.sourceCommit)}/statuses?pagelen=100`
    const statuses = await orEmpty(collect(this.call, url, this.page, toBuildStatus))
    return latestPerKey(statuses)
  }

  private repoUrl(owner: string, repo: string): string {
    return `${this.apiRoot}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  }
}

/** Cloud pull request JSON → model (build filled in later). */
export function normalise(raw: unknown, owner: string, repo: string): PrBase {
  const o = obj(raw)
  // The PR's own repository wins over the one we asked (renames redirect).
  const fullName = text(obj(obj(o.destination).repository).full_name)?.split('/')
  const ref = checkedRef(fullName?.[0] ?? owner, fullName?.[1] ?? repo, o.id)
  const participants = Array.isArray(o.participants) ? o.participants.map(obj) : []
  const reviewers = participants
    .filter((p) => p.role === 'REVIEWER' || p.approved === true || p.state === 'changes_requested')
    .map((p) => ({
      name: text(obj(p.user).display_name) ?? 'Unknown user',
      status: reviewStatus(p),
    }))
  const state = prState(o.state)
  const updatedAt = text(o.updated_on) ?? ''
  return {
    key: prKey(ref),
    ref,
    title: text(o.title) ?? '(no title)',
    url:
      text(obj(obj(o.links).html).href) ??
      `${CLOUD_WEB}/${ref.owner}/${ref.repo}/pull-requests/${ref.id}`,
    author: text(obj(o.author).display_name) ?? 'Unknown user',
    sourceBranch: branchOf(o.source),
    targetBranch: branchOf(o.destination),
    state,
    reviewers,
    ...voteCounts(reviewers),
    comments: typeof o.comment_count === 'number' ? o.comment_count : 0,
    unresolvedComments: null,
    conflicts: null,
    createdAt: text(o.created_on) ?? '',
    updatedAt,
    // Cloud has no close time; a merged/declined PR was last updated when it closed.
    closedAt: state === 'open' ? null : updatedAt || null,
    sourceCommit: text(obj(obj(o.source).commit).hash),
  }
}

function reviewStatus(p: JsonObject): 'approved' | 'needs_work' | 'unapproved' {
  if (p.state === 'changes_requested') return 'needs_work'
  return p.approved === true || p.state === 'approved' ? 'approved' : 'unapproved'
}

const branchOf = (side: unknown) => text(obj(obj(side).branch).name) ?? ''

/** A Cloud comment (`content.raw`, `user`, `inline.path`); none when it has no text. */
export function cloudComment(c: JsonObject): PrComment[] {
  const body = text(obj(c.content).raw)
  if (!body) return []
  const user = obj(c.user)
  return [
    {
      id: String(c.id ?? ''),
      authorId: text(user.uuid),
      author: text(user.display_name) ?? text(user.nickname) ?? 'Someone',
      text: body,
      path: text(obj(c.inline).path),
      createdAt: text(c.created_on),
    },
  ]
}
