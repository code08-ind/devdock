import { redact } from './logger'

/**
 * Typed failures for the HTTP adapters (Jira now; Bitbucket and Jenkins later), each with a
 * hint for the common causes (SPEC 6.7: 401, 403, proxy, certificate).
 */

export type ServiceErrorKind =
  | 'not_configured'
  | 'auth' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'rate_limited' // 429
  | 'server' // 5xx and other unexpected statuses
  | 'bad_response' // 2xx that isn't what the API documents
  | 'timeout'
  | 'proxy'
  | 'certificate'
  | 'network' // DNS, refused, offline

export class ServiceError extends Error {
  readonly status?: number
  readonly retryAfterSec?: number
  /** Response body or low-level error text, redacted (it is shown in the UI's Details). */
  readonly details?: string

  constructor(
    readonly kind: ServiceErrorKind,
    message: string,
    opts: { status?: number; retryAfterSec?: number; details?: string } = {},
  ) {
    super(message)
    this.name = 'ServiceError'
    this.status = opts.status
    this.retryAfterSec = opts.retryAfterSec
    this.details = opts.details === undefined ? undefined : redact(opts.details)
  }
}

/** Per-service wording for the hints (each adapter knows its own auth scheme). */
export interface ServiceHints {
  /** Appended to the 401 message, e.g. "Check the API token and account email in Settings → Jira." */
  auth: string
  /** Appended to the 403 message. */
  forbidden: string
}

/** `Retry-After` as seconds: delta-seconds or an HTTP date. Null if absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Maps a non-2xx response to a ServiceError. `service` is the name users see ("Jira"). */
export async function errorFromResponse(
  service: string,
  res: Response,
  hints: ServiceHints,
): Promise<ServiceError> {
  const details = await readErrorBody(res)
  const status = res.status
  switch (status) {
    case 401:
      return new ServiceError('auth', `${service} rejected the credentials (401). ${hints.auth}`, {
        status,
        details,
      })
    case 403:
      return new ServiceError(
        'forbidden',
        `${service} refused access (403). The account may lack permission. ${hints.forbidden}`,
        { status, details },
      )
    case 404:
      return new ServiceError(
        'not_found',
        `${service} returned 404. Check the base URL in Settings, or the item may not exist or not be visible to you.`,
        { status, details },
      )
    case 407:
      return new ServiceError(
        'proxy',
        proxyMessage(service, 'The proxy asked for authentication (407).'),
        {
          status,
          details,
        },
      )
    case 429: {
      const retryAfterSec = parseRetryAfter(res.headers.get('retry-after')) ?? undefined
      const wait = retryAfterSec === undefined ? 'later' : `in ${retryAfterSec} s`
      return new ServiceError(
        'rate_limited',
        `${service} is rate limiting requests (429). Try again ${wait}.`,
        { status, retryAfterSec, details },
      )
    }
    default:
      return new ServiceError('server', `${service} returned HTTP ${status}.`, { status, details })
  }
}

async function readErrorBody(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).slice(0, 2000)
    return text || undefined
  } catch {
    return undefined
  }
}

/**
 * Maps a fetch rejection to a ServiceError. Electron's `net.fetch` rejects with Chromium error
 * names (`net::ERR_…`); Node's fetch puts the cause in `err.cause.code`.
 */
export function errorFromFetchFailure(service: string, err: unknown): ServiceError {
  const text = describe(err)
  const details = text
  if (/TimeoutError|aborted due to timeout|ERR_TIMED_OUT|ETIMEDOUT/i.test(text)) {
    return new ServiceError('timeout', `${service} didn't answer in time.`, { details })
  }
  if (/ERR_(PROXY|TUNNEL)_|ERR_.*PROXY|PAC_|ERR_MANDATORY_PROXY/i.test(text)) {
    return new ServiceError('proxy', proxyMessage(service, ''), { details })
  }
  if (
    /ERR_CERT_|ERR_SSL_|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|unable to get local issuer/i.test(text)
  ) {
    return new ServiceError(
      'certificate',
      `${service}'s TLS certificate isn't trusted. On a corporate network, install your company's root certificate in the OS certificate store (Keychain / Windows certificate store) and restart DevDock.`,
      { details },
    )
  }
  return new ServiceError(
    'network',
    `Couldn't reach ${service}. Check the base URL and your network or VPN connection.`,
    { details },
  )
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  const causeText =
    cause && typeof cause === 'object'
      ? [(cause as { code?: string }).code, (cause as Error).message].filter(Boolean).join(' ')
      : ''
  return [err.name, err.message, causeText].filter(Boolean).join(': ')
}

function proxyMessage(service: string, lead: string): string {
  return `${lead ? `${lead} ` : ''}Couldn't reach ${service} through the proxy. Check the system proxy settings (or the proxy override in Settings) and that the proxy allows this host.`
}
