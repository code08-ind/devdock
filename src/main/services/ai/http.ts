/**
 * Plain-HTTP calls for the OpenAI and Google backends (T6, owner: no extra SDKs): JSON through
 * DevDock's HttpClient — system proxy, certificate store, demo fixtures — with the API errors
 * these providers send turned into DevDock's service errors.
 */
import type { HttpClient } from '../http'
import { readJson, send } from '../rest'
import { ServiceError } from '../service-error'

const TIMEOUT_MS = 120_000
/** Server-side hiccups (500/502/503/504) are tried again, twice, like the Anthropic SDK does. */
const RETRY_STATUS = new Set([500, 502, 503, 504])
const RETRY_DELAYS_MS = [1_000, 2_000]

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
  const rest = {
    service: target.service,
    hints: { auth: '', forbidden: '' },
    timeoutMs: TIMEOUT_MS,
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await send(http, rest, url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...target.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await readJson(rest, res) }
    } catch (err) {
      const retry =
        err instanceof ServiceError &&
        err.status !== undefined &&
        RETRY_STATUS.has(err.status) &&
        attempt < RETRY_DELAYS_MS.length
      if (retry) {
        await sleep(RETRY_DELAYS_MS[attempt]!)
        continue
      }
      throw err instanceof ServiceError ? aiError(target.service, err) : err
    }
  }
}

/** The answer's JSON didn't have the shape the API documents. */
export const badShape = (service: string, what: string) =>
  new ServiceError('bad_response', `${service} sent back an answer without ${what}. Try again.`)
