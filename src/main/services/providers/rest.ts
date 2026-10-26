import type { HttpClient } from '../http'
import { readJson, type RestTarget } from '../rest'
import { ServiceError, errorFromFetchFailure, errorFromResponse } from '../service-error'

/**
 * HTTP for the GitHub and GitLab adapters (P7.05/P7.06), on the app's HttpClient (Electron
 * `net.fetch`: system proxy and certificate store; MSW in demo mode) — no other HTTP library.
 *
 * On top of `rest.ts` it adds what these APIs need:
 * - Rate limits: each provider maps its own signals (GitHub `X-RateLimit-*` and secondary
 *   limits, GitLab 429 / `RateLimit-Reset`) to a `rate_limited` ServiceError with
 *   `retryAfterSec`; until then requests are refused here without touching the network, so a
 *   list refreshing every minute doesn't dig the hole deeper.
 * - Conditional GETs (GitHub): `If-None-Match` with the last ETag; a 304 answers from the
 *   cached body and doesn't count against GitHub's rate limit.
 * - Log downloads: GitHub answers with a redirect to a signed storage URL, which is fetched
 *   without the Authorization header (the token never leaves the API host).
 */

export interface ProviderTarget extends RestTarget {
  /** Extra headers on every request (API version, Accept). */
  headers?: Record<string, string>
  /** The provider's rate-limit reading of a failed response, or null when it isn't one. */
  rateLimit: (res: Response, body: string, now: number) => ServiceError | null
  /** Keep ETags for conditional GETs. */
  etags?: boolean
}

export interface ProviderResponse {
  status: number
  headers: Headers
  /** Parsed JSON; null when the body is empty. */
  body: unknown
}

/** Responses kept for conditional requests (oldest dropped first). */
const ETAG_LIMIT = 500

export class ProviderRest {
  private readonly etags = new Map<string, { etag: string; body: unknown }>()
  private blockedUntil = 0
  private blockedBy: ServiceError | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly target: ProviderTarget,
    private readonly now: () => number = Date.now,
  ) {}

  async json(
    url: string,
    opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
  ): Promise<ProviderResponse> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST')
    const cached = method === 'GET' && this.target.etags ? this.etags.get(url) : undefined
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (cached) headers['If-None-Match'] = cached.etag
    const res = await this.fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    if (res.status === 304 && cached)
      return { status: 200, headers: res.headers, body: cached.body }
    if (!res.ok) throw await this.failure(res)
    const body = await this.body(res)
    const etag = res.headers.get('etag')
    if (method === 'GET' && this.target.etags && etag) this.remember(url, etag, body)
    return { status: res.status, headers: res.headers, body }
  }

  /**
   * The last `maxBytes` of a text resource (job logs). A redirect is followed by hand, without
   * the Authorization header; a server that hides the redirect (Chromium's opaque redirect)
   * is asked again with redirects followed — Chromium drops Authorization across origins.
   */
  async textTail(url: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    const accept = { Accept: 'text/plain, */*' }
    let res = await this.fetch(url, { method: 'GET', headers: accept, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      const next = location ? safeUrl(location, url) : null
      if (!next || next.protocol !== 'https:') {
        throw new ServiceError(
          'bad_response',
          `${this.target.service} sent the log somewhere DevDock won't follow.`,
        )
      }
      res = await this.plainFetch(next.toString())
    } else if (res.type === 'opaqueredirect' || res.status === 0) {
      res = await this.fetch(url, { method: 'GET', headers: accept })
    }
    if (!res.ok) throw await this.failure(res)
    const whole = await res.text()
    const truncated = whole.length > maxBytes
    let text = truncated ? whole.slice(-maxBytes) : whole
    // Start at a line boundary when cut.
    if (truncated) text = text.slice(text.indexOf('\n') + 1)
    return { text: stripAnsi(text), truncated }
  }

  private async fetch(
    url: string,
    init: {
      method: string
      headers: Record<string, string>
      body?: string
      redirect?: 'follow' | 'manual'
    },
  ): Promise<Response> {
    this.checkBlocked()
    const headers = { ...this.target.headers, ...init.headers }
    if (this.target.authorization) headers.Authorization = this.target.authorization
    const request = new Request(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: init.redirect ?? 'follow',
      signal: AbortSignal.timeout(this.target.timeoutMs),
    })
    try {
      return await this.http.fetch(request)
    } catch (err) {
      throw errorFromFetchFailure(this.target.service, err)
    }
  }

  /** A storage URL from a redirect: no credentials. */
  private async plainFetch(url: string): Promise<Response> {
    try {
      return await this.http.fetch(
        new Request(url, { signal: AbortSignal.timeout(this.target.timeoutMs) }),
      )
    } catch (err) {
      throw errorFromFetchFailure(this.target.service, err)
    }
  }

  private checkBlocked(): void {
    const left = Math.ceil((this.blockedUntil - this.now()) / 1000)
    if (left <= 0 || !this.blockedBy) return
    throw new ServiceError('rate_limited', this.blockedBy.message, {
      status: this.blockedBy.status,
      retryAfterSec: left,
      details: this.blockedBy.details,
    })
  }

  private async failure(res: Response): Promise<ServiceError> {
    let body = ''
    try {
      body = (await res.clone().text()).slice(0, 2000)
    } catch {
      // unreadable: the generic mapping still works on the status
    }
    const limited = this.target.rateLimit(res, body, this.now())
    if (limited) {
      if (limited.retryAfterSec) {
        this.blockedUntil = this.now() + limited.retryAfterSec * 1000
        this.blockedBy = limited
      }
      return limited
    }
    return errorFromResponse(this.target.service, res, this.target.hints)
  }

  private async body(res: Response): Promise<unknown> {
    if (res.status === 204) return null
    const raw = await res.clone().text()
    if (!raw.trim()) return null
    return readJson(this.target, res)
  }

  private remember(url: string, etag: string, body: unknown): void {
    this.etags.delete(url)
    this.etags.set(url, { etag, body })
    if (this.etags.size > ETAG_LIMIT) this.etags.delete(this.etags.keys().next().value!)
  }
}

function safeUrl(location: string, base: string): URL | null {
  try {
    return new URL(location, base)
  } catch {
    return null
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g
/** Logs carry colour codes; the tail view shows plain text. */
export const stripAnsi = (s: string) => s.replace(ANSI, '')

/** "in 42 s", "at 14:05". */
export function waitText(seconds: number, now: number): string {
  if (seconds < 120) return `in ${seconds} s`
  const at = new Date(now + seconds * 1000)
  return `at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
