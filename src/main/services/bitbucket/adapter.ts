import {
  PrRefSchema,
  type BitbucketFlavor,
  type BitbucketUser,
  type BuildState,
  type BuildStatus,
  type PrList,
  type PrRef,
  type PullRequest,
} from '@shared/bitbucket'
import { obj, text } from '../json'
import type { RestResponse } from '../rest'
import { ServiceError } from '../service-error'

/** A pull request before its build statuses are fetched. */
export type PrBase = Omit<PullRequest, 'build'>

/** The authenticated user: what Test connection shows, and the id the list queries filter on. */
export interface Me {
  status: number
  user: BitbucketUser
  /** Cloud account UUID / Data Center user name. */
  id: string
}

/** GET relative to nothing: adapters build absolute URLs. */
export type Get = (url: string) => Promise<RestResponse>

/** What differs between Bitbucket Cloud and Data Center; BitbucketClient does the rest. */
export interface BitbucketAdapter {
  readonly flavor: BitbucketFlavor
  myself(): Promise<Me>
  list(list: PrList, me: Me, since: Date): Promise<PrBase[]>
  /** One PR, with its unresolved comment count where the API exposes it. */
  pr(ref: PrRef): Promise<PrBase>
  /** Build statuses posted against the PR's head commit (by Jenkins and friends). */
  builds(pr: PrBase): Promise<BuildStatus[]>
}

/** Follows paged responses; each flavour supplies how to find the next page. */
export async function collect<T>(
  get: Get,
  first: string,
  parse: (body: unknown) => { values: unknown[]; next: string | null },
  map: (raw: unknown) => T,
  maxPages = 10,
): Promise<T[]> {
  const out: T[] = []
  let url: string | null = first
  for (let page = 0; url && page < maxPages; page++) {
    const { values, next } = parse((await get(url)).body)
    out.push(...values.map(map))
    url = next
  }
  return out
}

/** Bitbucket build-status states (Cloud and DC share the names). */
export function buildState(raw: unknown): BuildState {
  switch (raw) {
    case 'SUCCESSFUL':
      return 'success'
    case 'FAILED':
      return 'failed'
    case 'INPROGRESS':
      return 'running'
    case 'STOPPED':
    case 'CANCELLED':
      return 'stopped'
    default:
      return 'none'
  }
}

/** One build-status entry (same fields on Cloud and DC). */
export function toBuildStatus(raw: unknown): BuildStatus {
  const s = obj(raw)
  return {
    key: text(s.key) ?? '',
    name: text(s.name) ?? text(s.key) ?? 'Build',
    state: buildState(s.state),
    url: text(s.url),
  }
}

/** PR state names shared by both APIs; anything closed but not merged reads as declined. */
export const prState = (raw: unknown): PrBase['state'] =>
  raw === 'MERGED' ? 'merged' : raw === 'OPEN' ? 'open' : 'declined'

export function voteCounts(reviewers: PrBase['reviewers']) {
  return {
    approvals: reviewers.filter((r) => r.status === 'approved').length,
    needsWork: reviewers.filter((r) => r.status === 'needs_work').length,
  }
}

/** A ref read from the server: checked like renderer input before it can reach a URL path. */
export function checkedRef(owner: unknown, repo: unknown, id: unknown): PrRef {
  const ref = PrRefSchema.safeParse({ owner, repo, id })
  if (!ref.success) throw badResponse('a pull request with a valid repository and id')
  return ref.data
}

/** Keeps one status per key (the API can repeat a key); later entries win. */
export function latestPerKey(statuses: BuildStatus[]): BuildStatus[] {
  return [...new Map(statuses.map((s) => [s.key, s])).values()]
}

export const badResponse = (what: string) =>
  new ServiceError('bad_response', `Bitbucket didn't return ${what}.`)

/** Treats "can't see it" as "nothing there" (e.g. no build statuses, or a repo without access). */
export async function orEmpty<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p
  } catch (err) {
    if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
      return []
    }
    throw err
  }
}
