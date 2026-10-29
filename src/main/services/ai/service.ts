/**
 * Claude calls with the user's own key (P7-C-B). Two steps, so nothing leaves the machine
 * unseen: `prepare` builds the exact request and keeps it under an id; the screen shows it with
 * the model and a cost estimate; `run(id)` sends that request, unchanged, once the user confirms.
 *
 * Requests go through the official SDK with DevDock's own HttpClient as its fetch: the system
 * proxy and certificate store apply as for every other service, and demo mode answers from an
 * in-process fixture with no key and no network.
 */
import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { aiCost, type AiFeature, type AiModelId, type AiPreview, type AiResult } from '@shared/ai'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { SYSTEM } from './prompts'

/** The answer's length cap (thinking counts towards it). A short note never gets near it. */
export const MAX_TOKENS = 16_000
/** A typical answer for the estimate (thinking included), in tokens. */
const TYPICAL_OUTPUT = 1_200
/** How long a prepared call can wait for the user's confirmation. */
const PREVIEW_TTL_MS = 10 * 60_000

/** Short rewrites need little thought; the PR note weighs a few facts. */
const EFFORT: Record<AiFeature, 'low' | 'medium'> = {
  'pr-summary': 'medium',
  lesson: 'low',
  standup: 'low',
}

/** Models whose declined requests can be rescued by Anthropic's server-side fallback. */
const FALLBACK_MODELS = new Set<AiModelId>(['claude-opus-5-5', 'claude-sonnet-5-5'])

export interface AiServiceDeps {
  http: HttpClient
  /** The user's Anthropic API key from the keychain; undefined when none is saved. */
  key: () => string | undefined | Promise<string | undefined>
  model: () => AiModelId
  now?: () => number
}

interface Pending {
  preview: AiPreview
  expires: number
}

export class AiService {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly deps: AiServiceDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Builds the request for `feature` around `prompt` and holds it for confirmation. */
  async prepare(feature: AiFeature, prompt: string): Promise<AiPreview> {
    const demo = this.deps.http.demo
    if (!demo && !(await this.deps.key())) {
      throw new ServiceError(
        'not_configured',
        'Add your Anthropic API key in Settings → AI to use this. DevDock sends nothing until you do.',
      )
    }
    this.sweep()
    const model = this.deps.model()
    const system = SYSTEM[feature]
    const estimatedInputTokens = Math.ceil((system.length + prompt.length) / 4)
    const preview: AiPreview = {
      id: randomUUID(),
      feature,
      model,
      system,
      prompt,
      estimatedInputTokens,
      estimatedCostUsd: aiCost(model, estimatedInputTokens, TYPICAL_OUTPUT),
      maxCostUsd: aiCost(model, estimatedInputTokens, MAX_TOKENS),
      demo,
    }
    this.pending.set(preview.id, { preview, expires: this.now() + PREVIEW_TTL_MS })
    return preview
  }

  /** Sends a prepared request exactly as it was shown. Each preview can be sent once. */
  async run(id: string): Promise<AiResult> {
    this.sweep()
    const held = this.pending.get(id)
    if (!held) {
      throw new ServiceError(
        'not_found',
        'That request expired or was already sent. Prepare it again to see what will be sent.',
      )
    }
    this.pending.delete(id)
    const { preview } = held
    const key = held.preview.demo ? 'demo' : await this.deps.key()
    if (!key) throw new ServiceError('not_configured', 'Your Anthropic API key was removed.')
    const http = this.deps.http
    const client = new Anthropic({
      // Pinned: ANTHROPIC_BASE_URL in the user's environment must never redirect their key.
      baseURL: 'https://api.anthropic.com',
      // Sent as `Authorization: Bearer`; passing it also stops the SDK reading credentials
      // from the environment or a CLI profile.
      apiKey: key,
      maxRetries: 2,
      timeout: 120_000,
      fetch: (input, init) => http.fetch(new Request(input, init)),
    })
    const fallback = FALLBACK_MODELS.has(preview.model)
    let message: Anthropic.Beta.BetaMessage
    try {
      message = await client.beta.messages.create({
        model: preview.model,
        max_tokens: MAX_TOKENS,
        system: preview.system,
        messages: [{ role: 'user', content: preview.prompt }],
        output_config: { effort: EFFORT[preview.feature] },
        ...(fallback
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
      throw new ServiceError('bad_response', 'Claude sent back no text. Try again.')
    }
    const { input_tokens: inputTokens, output_tokens: outputTokens } = message.usage
    return {
      text,
      model: message.model,
      inputTokens,
      outputTokens,
      costUsd: aiCost(preview.model, inputTokens, outputTokens),
      truncated: message.stop_reason === 'max_tokens',
    }
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, p] of this.pending) if (p.expires <= now) this.pending.delete(id)
  }
}

/** The SDK's typed errors in DevDock's service-error kinds (most specific first). */
export function toServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err
  if (err instanceof Anthropic.AuthenticationError) {
    return new ServiceError(
      'auth',
      'Anthropic rejected the API key. Check it in Settings → AI (it may have been revoked).',
      { status: 401 },
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
