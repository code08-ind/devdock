/**
 * Claude (P7-C-B) through the official SDK, with DevDock's own HttpClient as its fetch: the
 * system proxy and certificate store apply as for every other service, and demo mode answers
 * from an in-process fixture.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { AiFeature } from '@shared/ai'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import type { AiBackend, AiReply, AiSend } from './backend'

/** Short rewrites need little thought; the PR note weighs a few facts. */
const EFFORT: Record<AiFeature, NonNullable<Anthropic.Beta.BetaOutputConfig['effort']>> = {
  'pr-summary': 'medium',
  lesson: 'low',
  standup: 'low',
}

export class AnthropicBackend implements AiBackend {
  constructor(private readonly http: HttpClient) {}

  private client(key: string): Anthropic {
    const http = this.http
    return new Anthropic({
      // Pinned: ANTHROPIC_BASE_URL in the user's environment must never redirect their key.
      baseURL: 'https://api.anthropic.com',
      // Sent as `Authorization: Bearer`; passing it also stops the SDK reading credentials
      // from the environment or a CLI profile.
      apiKey: key,
      // A failed attempt (429, 5xx, network) is retried twice; failed attempts aren't billed.
      maxRetries: 2,
      timeout: 120_000,
      fetch: (input, init) => http.fetch(new Request(input, init)),
    })
  }

  async models(key: string): Promise<{ status: number; models: string[] }> {
    try {
      const { data: page, response } = await this.client(key)
        .models.list({ limit: 100 })
        .withResponse()
      return { status: response.status, models: page.data.map((m) => m.id) }
    } catch (err) {
      throw toServiceError(err)
    }
  }

  async send(req: AiSend): Promise<AiReply> {
    let message: Anthropic.Beta.BetaMessage
    try {
      message = await this.client(req.key).beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: EFFORT[req.feature] },
        ...(req.fallback
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      })
    } catch (err) {
      throw toServiceError(err)
    }
    if (message.stop_reason === 'refusal') {
      throw new ServiceError(
        'forbidden',
        'Claude declined this request. Nothing was changed; you can edit the text and try again.',
        { details: message.stop_details?.explanation ?? undefined },
      )
    }
    const text = message.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim()
    if (!text) {
      throw new ServiceError(
        'bad_response',
        message.stop_reason === 'max_tokens'
          ? 'Claude used up its length limit before writing an answer. Try again, or shorten the text.'
          : 'Claude sent back no text. Try again.',
      )
    }
    return {
      text,
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      truncated: message.stop_reason === 'max_tokens',
    }
  }
}

/** The SDK's typed errors in DevDock's service-error kinds (most specific first). */
export function toServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err
  if (err instanceof Anthropic.AuthenticationError) {
    return new ServiceError(
      'auth',
      'Anthropic rejected the API key. Check it in Settings → AI (it may have been revoked).',
      { status: 401, details: err.message },
    )
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ServiceError(
      'forbidden',
      "This API key isn't allowed to use that model. Pick another in Settings → AI.",
      { status: 403, details: err.message },
    )
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retry = Number(err.headers?.get('retry-after'))
    return new ServiceError(
      'rate_limited',
      'Anthropic is rate-limiting this key. Wait a moment and try again.',
      { status: 429, retryAfterSec: Number.isFinite(retry) ? retry : undefined },
    )
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ServiceError('timeout', 'Claude took too long to answer. Try again.')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    // HttpClient failures (proxy, certificate, offline) arrive wrapped as the cause.
    const cause = (err as { cause?: unknown }).cause
    if (cause instanceof ServiceError) return cause
    return new ServiceError('network', "DevDock couldn't reach Anthropic. Check your connection.", {
      details: err.message,
    })
  }
  if (err instanceof Anthropic.APIError) {
    return new ServiceError(
      err.status !== undefined && err.status >= 500 ? 'server' : 'bad_response',
      `Anthropic returned an error${err.status ? ` (HTTP ${err.status})` : ''}. Try again.`,
      { status: err.status, details: err.message },
    )
  }
  return new ServiceError('network', "DevDock couldn't reach Anthropic.", {
    details: err instanceof Error ? err.message : String(err),
  })
}
