import type { HttpClient } from './http'
import {
  ServiceError,
  errorFromFetchFailure,
  errorFromResponse,
  type ServiceHints,
} from './service-error'

/** One REST API (Jira, Bitbucket, Jenkins): its user-facing name, auth header and 401/403 hints. */
export interface RestTarget {
  /** Name users see in errors ("Jira", "Bitbucket"). */
  service: string
  /** Omitted for unauthenticated probes. */
  authorization?: string
  hints: ServiceHints
  timeoutMs: number
}

export interface RestResponse {
  status: number
  headers: Headers
  /** Parsed JSON; null for 204. */
  body: unknown
}

/** Sends one request and maps every failure to a ServiceError with the target's hints. */
export async function requestJson(
  http: HttpClient,
  target: RestTarget,
  url: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<RestResponse> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await send(http, target, url, {
    // A body means POST unless told otherwise; actions without one (Cloud approve) name it.
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (res.status === 204) return { status: 204, headers: res.headers, body: null }
  return { status: res.status, headers: res.headers, body: await readJson(target, res) }
}

/**
 * Sends one request with the target's auth header and timeout; a failed fetch or non-2xx
 * status becomes a ServiceError. For APIs that aren't plain JSON (Jenkins: crumbs, text logs).
 */
export async function send(
  http: HttpClient,
  target: RestTarget,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | URLSearchParams },
): Promise<Response> {
  const headers = { ...init.headers }
  if (target.authorization) headers.Authorization = target.authorization
  const request = new Request(url, {
    method: init.method,
    headers,
    body: init.body,
    signal: AbortSignal.timeout(target.timeoutMs),
  })
  let res: Response
  try {
    res = await http.fetch(request)
  } catch (err) {
    throw errorFromFetchFailure(target.service, err)
  }
  if (!res.ok) throw await errorFromResponse(target.service, res, target.hints)
  return res
}

/** The body as JSON; a login page or proxy block page instead is `bad_response`. */
export async function readJson(target: RestTarget, res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new ServiceError(
      'bad_response',
      `${target.service} didn't return a JSON response (got something else — a proxy or login page?).`,
    )
  }
}
