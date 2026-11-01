import {
  MERGED_WINDOW_DAYS,
  summariseBuilds,
  type BitbucketConnection,
  type BitbucketFlavor,
  type PrAction,
  type PrList,
  type PrRef,
  type PullRequest,
  type RepoRef,
  type PrChanges,
} from '@shared/bitbucket'
import { MIN_COMMENT_LENGTH, type ReviewComment } from '@shared/lessons'
import type { HttpClient } from '../http'
import { mapLimit } from '../async'
import { requestJson } from '../rest'
import { serverMessage, type BitbucketAdapter, type Call, type Me, type PrBase } from './adapter'
import { ServiceError } from '../service-error'
import { CloudAdapter, cloudApiRoot, cloudAuthorization, cloudHints } from './cloud'
import { DataCenterAdapter, dcHints } from './datacenter'

export interface BitbucketConfig {
  flavor: BitbucketFlavor
  baseUrl: string
  /** Cloud: user name or email for Basic auth; empty → Bearer. Ignored on Data Center. */
  username: string
  token: string
}

/** Build-status lookups in flight at once (one per PR). */
const BUILD_CONCURRENCY = 4
/** Lessons: PR comment reads in flight at once. */
const COMMENT_CONCURRENCY = 4
/** Lessons: comments are read from this many of my most recently updated PRs. */
export const LESSON_PRS = 15
/** …and at most this many comments are offered. */
export const LESSON_COMMENTS = 100

/** One Bitbucket site. Cloud and Data Center differ only in their BitbucketAdapter. */
export class BitbucketClient {
  private readonly adapter: BitbucketAdapter
  private me: Promise<Me> | null = null

  constructor(
    http: HttpClient,
    config: BitbucketConfig,
    /** Cloud only: `{owner, repo}` of the registered repos' bitbucket.org remotes. */
    cloudRepos: () => Promise<RepoRef[]>,
    timeoutMs = 20_000,
  ) {
    const cloud = config.flavor === 'cloud'
    const target = {
      service: 'Bitbucket',
      authorization: cloud
        ? cloudAuthorization(config.username, config.token)
        : `Bearer ${config.token}`,
      hints: cloud ? cloudHints : dcHints,
      timeoutMs,
    }
    const call: Call = (url, opts) => requestJson(http, target, url, opts)
    this.adapter = cloud
      ? new CloudAdapter(call, cloudApiRoot(config.baseUrl), cloudRepos)
      : new DataCenterAdapter(call, config.baseUrl)
  }

  /** "Test connection": who the credentials authenticate as. Always asks the server. */
  async testConnection(): Promise<BitbucketConnection> {
    const me = await this.adapter.myself()
    this.me = Promise.resolve(me)
    return { flavor: this.adapter.flavor, status: me.status, user: me.user }
  }

  /** A list with build statuses, newest activity first. */
  async list(list: PrList, now = Date.now()): Promise<PullRequest[]> {
    const since = new Date(now - MERGED_WINDOW_DAYS * 86_400_000)
    const prs = await this.adapter.list(list, await this.myself(), since)
    const unique = [...new Map(prs.map((p) => [p.key, p])).values()]
    unique.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    return mapLimit(unique, BUILD_CONCURRENCY, (pr) => this.withBuilds(pr))
  }

  async pr(ref: PrRef): Promise<PullRequest> {
    return this.withBuilds(await this.adapter.pr(ref))
  }

  /** T7: description and changed files (bounded), for the AI summary. */
  changes(ref: PrRef): Promise<PrChanges> {
    return this.adapter.changes(ref)
  }

  /**
   * One PR action, against the PR as it is now: it must still be open, and a merge must name
   * its current target branch exactly (SPEC 6.3: typed by the user). Returns the PR afterwards
   * and who acted (the watcher leaves that person's own vote out of its notifications).
   */
  async act(ref: PrRef, action: PrAction, typedTarget: string | undefined): Promise<ActionResult> {
    const before = await this.adapter.pr(ref)
    if (before.state !== 'open') {
      throw new PrActionError(`This pull request is already ${before.state}.`)
    }
    if (action === 'merge' && typedTarget?.trim() !== before.targetBranch) {
      throw new PrActionError(
        `Not merged: the target branch is "${before.targetBranch}", and "${typedTarget ?? ''}" was typed.`,
      )
    }
    const me = await this.myself()
    try {
      await this.adapter.act(ref, action, me, before.targetBranch)
    } catch (err) {
      throw withServerWords(err)
    }
    return { pr: await this.pr(ref), actor: me.user.displayName }
  }

  /**
   * Review comments on my open and recently merged PRs (P6-F lessons): other people's, longer
   * than a quick "LGTM", newest first. A PR whose comments can't be read is skipped.
   */
  async reviewComments(now = Date.now()): Promise<ReviewComment[]> {
    const me = await this.myself()
    const since = new Date(now - MERGED_WINDOW_DAYS * 86_400_000)
    const [open, merged] = await Promise.all([
      this.adapter.list('mine', me, since),
      this.adapter.list('merged', me, since),
    ])
    const prs = [...new Map([...open, ...merged].map((p) => [p.key, p])).values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, LESSON_PRS)
    // A PR whose comments can't be read is skipped; if none can be, that's the error to show.
    let failure: unknown = null
    const perPr = await mapLimit(prs, COMMENT_CONCURRENCY, async (pr) => {
      const comments = await this.adapter.comments(pr.ref).catch((err: unknown) => {
        failure ??= err
        return null
      })
      return comments
        ?.filter((c) => c.authorId !== me.id && c.text.trim().length >= MIN_COMMENT_LENGTH)
        .map((c, i): ReviewComment => ({
          // A comment without an id still gets a unique one.
          id: `${pr.key}:${c.id || `n${i}`}`,
          pr: `${pr.ref.repo} #${pr.ref.id}`,
          prTitle: pr.title,
          author: c.author,
          text: c.text.trim(),
          path: c.path,
          createdAt: c.createdAt,
        }))
    })
    if (prs.length > 0 && perPr.every((c) => c === undefined)) throw failure
    return perPr
      .flatMap((c) => c ?? [])
      .sort((a, b) => Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0'))
      .slice(0, LESSON_COMMENTS)
  }

  private async withBuilds(pr: PrBase): Promise<PullRequest> {
    return { ...pr, build: summariseBuilds(await this.adapter.builds(pr)) }
  }

  /** Looked up once per client (the lists filter on the user's id). */
  private myself(): Promise<Me> {
    this.me ??= this.adapter.myself().catch((err: unknown) => {
      this.me = null // retry next time
      throw err
    })
    return this.me
  }
}

export interface ActionResult {
  pr: PullRequest
  /** Display name of the signed-in user, as it appears in `pr.reviewers`. */
  actor: string
}

/** A PR action refused before anything was sent (closed PR, wrong typed branch). */
export class PrActionError extends Error {
  override readonly name = 'PrActionError'
}

/** Appends what Bitbucket said to a refused request (4xx), e.g. "You are not permitted to…". */
function withServerWords(err: unknown): unknown {
  if (!(err instanceof ServiceError) || !err.status || err.status >= 500) return err
  const said = serverMessage(err.details)
  if (!said) return err
  // Read from `details`, which ServiceError has already redacted.
  return new ServiceError(err.kind, `${err.message} Bitbucket said: “${said}”`, {
    status: err.status,
    retryAfterSec: err.retryAfterSec,
    details: err.details,
  })
}
