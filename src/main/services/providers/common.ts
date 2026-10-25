import {
  PrRefSchema,
  summariseBuilds,
  type BuildStatus,
  type PrAction,
  type PrList,
  type PrRef,
  type PullRequest,
} from '@shared/bitbucket'
import {
  ciActionAllowed,
  CI_ACTION_COPY,
  type CiAction,
  type CiLog,
  type CiRun,
  type CiRunDetail,
  type CiRunRef,
  type CiRunsResult,
} from '@shared/ci'
import type { HostConnection } from '@shared/hosting'
import type { CiProvider } from '@shared/providers'
import { obj, text } from '../json'
import type { PrBase } from '../bitbucket/adapter'
import { PrActionError, type ActionResult } from '../bitbucket/client'
import { ServiceError } from '../service-error'

/** What the GitHub and GitLab clients both offer: PRs (P7.04) and CI runs (P7.05/P7.06). */
export interface HostClient {
  testConnection(): Promise<HostConnection>
  list(list: PrList, now?: number): Promise<PullRequest[]>
  pr(ref: PrRef): Promise<PullRequest>
  /** Checked against the PR as it is now (open; merge names its target), then sent. */
  act(ref: PrRef, action: PrAction, typedTarget: string | undefined): Promise<ActionResult>
  /** My recent runs on the registered repos hosted there. */
  runs(): Promise<CiRunsResult>
  runInfo(ref: CiRunRef): Promise<CiRun>
  run(ref: CiRunRef): Promise<CiRunDetail>
  log(ref: CiRunRef, jobId: number): Promise<CiLog>
  ciAct(ref: CiRunRef, action: CiAction): Promise<CiRun>
}

/** A PR ref read from the server: checked like renderer input before it reaches a URL. */
export function serverRef(
  provider: 'github' | 'gitlab',
  owner: unknown,
  repo: unknown,
  id: unknown,
): PrRef {
  const ref = PrRefSchema.safeParse({ provider, owner, repo, id })
  if (!ref.success) {
    throw new ServiceError(
      'bad_response',
      `${provider === 'github' ? 'GitHub' : 'GitLab'} didn't return a pull request with a valid repository and id.`,
    )
  }
  return ref.data
}

export const withBuilds = (pr: PrBase, statuses: BuildStatus[]): PullRequest => ({
  ...pr,
  build: summariseBuilds(statuses),
})

/** SPEC 6.3: the PR must still be open, and a merge must name its current target exactly. */
export function checkPrAction(before: PrBase, action: PrAction, typedTarget: string | undefined) {
  if (before.state !== 'open') {
    throw new PrActionError(`This pull request is already ${before.state}.`)
  }
  if (action === 'merge' && typedTarget?.trim() !== before.targetBranch) {
    throw new PrActionError(
      `Not merged: the target branch is "${before.targetBranch}", and "${typedTarget ?? ''}" was typed.`,
    )
  }
}

/** A CI action refused before anything was sent (the run's state doesn't allow it). */
export class CiActionError extends Error {
  override readonly name = 'CiActionError'
}

export function checkCiAction(provider: CiProvider, run: CiRun, action: CiAction) {
  if (!ciActionAllowed(action, run.state)) {
    throw new CiActionError(
      `“${CI_ACTION_COPY[provider][action]}” isn't possible: this run is ${run.state}.`,
    )
  }
}

/**
 * The server's own words for a refused request (SPEC 6.3: shown verbatim): GitHub
 * `{message, errors:[{message}|string]}`, GitLab `{message: string | {field: [..]}}` or
 * `{error}`. Null for anything else.
 */
export function hostMessage(details: string | undefined): string | null {
  if (!details) return null
  let body: Record<string, unknown>
  try {
    body = obj(JSON.parse(details))
  } catch {
    return null
  }
  const parts: string[] = []
  const message = body.message
  if (typeof message === 'string') parts.push(message)
  else if (message && typeof message === 'object') {
    for (const [field, v] of Object.entries(message)) {
      const said = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : text(v)
      if (said) parts.push(`${field} ${said}`)
    }
  }
  if (Array.isArray(body.errors)) {
    for (const e of body.errors) {
      const said = typeof e === 'string' ? e : text(obj(e).message)
      if (said) parts.push(said)
    }
  }
  const error = text(body.error_description) ?? text(body.error)
  if (error && parts.length === 0) parts.push(error)
  const joined = parts.join(' ').trim()
  return joined || null
}

/** Appends what the server said to a refused request (4xx). */
export function withHostWords(service: string, err: unknown): unknown {
  if (!(err instanceof ServiceError) || !err.status || err.status >= 500) return err
  if (err.kind === 'rate_limited') return err
  const said = hostMessage(err.details)
  if (!said) return err
  return new ServiceError(err.kind, `${err.message} ${service} said: “${said}”`, {
    status: err.status,
    retryAfterSec: err.retryAfterSec,
    details: err.details,
  })
}

/** Epoch ms from an ISO time; null when absent. */
export function epoch(v: unknown): number | null {
  const s = text(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/** Collapses a commit message to its first line. */
export const firstLine = (v: unknown) => text(v)?.split('\n')[0]?.trim() || null
