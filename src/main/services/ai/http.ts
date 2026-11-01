/**
 * Plain-HTTP calls for the OpenAI and Google backends (T6, owner: no extra SDKs): JSON through
 * DevDock's HttpClient — system proxy, certificate store, demo fixtures — with the API errors
 * these providers send turned into DevDock's service errors.
 */
import type { HttpClient } from '../http'
import { readJson, send } from '../rest'
import { ServiceError } from '../service-error'

const TIMEOUT_MS = 120_000
/**
 * Tried again, twice (1 s, 2 s; a 429 waits its Retry-After, up to 10 s). A paid request (POST)
 * only when the provider says it did no work — 503 (unavailable) and 429 (rate limited): after a
 * 500/502/504 or a dropped connection the answer may already have been made and billed, and a
 * retry could bill it twice. The free models list (GET) also on those.
 */
const RETRY_STATUS = { GET: new Set([429, 500, 502, 503, 504]), POST: new Set([429, 503]) }
const RETRY_DELAYS_MS = [1_000, 2_000]
const MAX_RETRY_AFTER_S = 10

/** How long to wait before attempt `attempt + 1`, or null when it shouldn't be tried again. */
function retryDelay(method: 'GET' | 'POST', err: unknown, attempt: number): number | null {
  if (attempt >= RETRY_DELAYS_MS.length || !(err instanceof ServiceError)) return null
  const delay = RETRY_DELAYS_MS[attempt]!
  // A failed connection (no status) is safe to repeat only for the free GET.
  if (err.status === undefined) {
    return method === 'GET' && (err.kind === 'network' || err.kind === 'timeout') ? delay : null
  }
  if (!RETRY_STATUS[method].has(err.status)) return null
  if (err.status !== 429) return delay
  const after = err.retryAfterSec
  if (after === undefined) return delay
  return after <= MAX_RETRY_AFTER_S ? Math.max(delay, after * 1000) : null
}

export interface AiHttpTarget {
  /** "OpenAI", "Google": the name in error messages. */
  service: string
  /** The auth header for this key (`Authorization: Bearer …`, `x-goog-api-key: …`). */
  headers: Record<string, string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The provider's own error text in a JSON error body (`{error: {message}}`), if any. */
function apiMessage(details: string | undefined): string | undefined {
  if (!details) return undefined
  try {
    const body = JSON.parse(details) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message.slice(0, 300) : undefined
  } catch {
    return undefined
  }
}

/** The shared mapping, with words for AI keys; the rest keep the generic REST messages. */
function aiError(service: string, err: ServiceError): ServiceError {
  const message = apiMessage(err.details)
  // Google answers a bad key with 400 API_KEY_INVALID rather than 401.
  if (err.status === 401 || (err.status === 400 && /API_KEY_INVALID/.test(err.details ?? ''))) {
    return new ServiceError(
      'auth',
      `${service} rejected the API key. Check it in Settings → AI (it may have been revoked).`,
      { status: err.status, details: err.details },
    )
  }
  if (err.status === 403) {
    return new ServiceError(
      'forbidden',
      `This ${service} key isn't allowed to do this${message ? `: ${message}` : ''}. Check its permissions or pick another model in Settings → AI.`,
      { status: 403, details: err.details },
    )
  }
  if (err.status === 404) {
    return new ServiceError(
      'not_found',
      `${service} doesn't offer that model to this key. Pick another in Settings → AI.`,
      { status: 404, details: err.details },
    )
  }
  if (err.status === 429) {
    return new ServiceError(
      'rate_limited',
      `${service} is rate-limiting this key (or it is out of credit). Wait a moment and try again.`,
      { status: 429, retryAfterSec: err.retryAfterSec, details: err.details },
    )
  }
  if (err.status === 400) {
    return new ServiceError(
      'bad_response',
      `${service} couldn't accept the request${message ? `: ${message}` : '.'}`,
      { status: 400, details: err.details },
    )
  }
  return err
}

/** GET or POST JSON; a non-2xx answer or a failed fetch throws a ServiceError. */
export async function aiJson(
  http: HttpClient,
  target: AiHttpTarget,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  // `aiError` words 401/403 for API keys, so the generic REST hints stay empty.
  const rest = {
    service: target.service,
    hints: { auth: '', forbidden: '' },
    timeoutMs: TIMEOUT_MS,
  }
  const method = body === undefined ? 'GET' : 'POST'
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await send(http, rest, url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...target.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await readJson(rest, res) }
    } catch (err) {
      const delay = retryDelay(method, err, attempt)
      if (delay !== null) {
        await sleep(delay)
        continue
      }
      throw err instanceof ServiceError ? aiError(target.service, err) : err
    }
  }
}

/** The answer's JSON didn't have the shape the API documents. */
export const badShape = (service: string, what: string) =>
  new ServiceError('bad_response', `${service} sent back an answer without ${what}. Try again.`)
