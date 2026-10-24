import type { HttpClient } from './http'
import {
  ServiceError,
  errorFromFetchFailure,
  errorFromResponse,
  type ServiceHints,
} from './service-error'

/** One JSON REST API (Jira, Bitbucket): its user-facing name, auth header and 401/403 hints. */
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
  if (target.authorization) headers.Authorization = target.authorization
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const request = new Request(url, {
    // A body means POST unless told otherwise; actions without one (Cloud approve) name it.
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(target.timeoutMs),
  })
  let res: Response
  try {
    res = await http.fetch(request)
  } catch (err) {
    throw errorFromFetchFailure(target.service, err)
  }
  if (!res.ok) throw await errorFromResponse(target.service, res, target.hints)
  if (res.status === 204) return { status: 204, headers: res.headers, body: null }
  try {
    return { status: res.status, headers: res.headers, body: await res.json() }
  } catch {
    // A login page or proxy block page instead of JSON.
    throw new ServiceError(
      'bad_response',
      `${target.service} didn't return a JSON response (got something else — a proxy or login page?).`,
    )
  }
}
