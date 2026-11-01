/**
 * AI calls with the user's own key (P7-C-B; OpenAI and Google since T6). Two steps, so nothing
 * leaves the machine unseen: `prepare` builds the exact request and keeps it under an id; the
 * screen shows it with the provider, the model and a cost estimate; `run(id)` sends that request,
 * unchanged, once the user confirms. Each provider is a small backend (`AiBackend`); this class
 * owns the preview, its expiry, the demo-mode checks and the pricing, the same for all.
 */
import { randomUUID } from 'node:crypto'
import {
  AI_MODEL_IDS,
  AI_PROVIDER_INFO,
  aiCost,
  aiModel,
  TYPICAL_OUTPUT_TOKENS,
  type AiConnection,
  type AiFeature,
  type AiModelId,
  type AiPreview,
  type AiProvider,
  type AiResult,
} from '@shared/ai'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { AnthropicBackend } from './anthropic'
import { MAX_TOKENS, type AiBackend } from './backend'
import { GoogleBackend } from './google'
import { OpenAiBackend } from './openai'
import { SYSTEM } from './prompts'

export { MAX_TOKENS } from './backend'
export { toServiceError } from './anthropic'

/** How long a prepared call can wait for the user's confirmation. */
const PREVIEW_TTL_MS = 10 * 60_000

/** Models whose declined requests can be rescued by Anthropic's server-side fallback. */
const FALLBACK_MODELS = new Set<AiModelId>(['claude-opus-5-5', 'claude-sonnet-5-5'])

export interface AiServiceDeps {
  http: HttpClient
  /** The user's API key for a provider, from the keychain; undefined when none is saved. */
  key: (provider: AiProvider) => string | undefined | Promise<string | undefined>
  /** The active provider's model (Settings → AI); the provider follows from it. */
  model: () => AiModelId
  now?: () => number
  /** Tests may swap a provider's backend. */
  backends?: Partial<Record<AiProvider, AiBackend>>
}

interface Pending {
  preview: AiPreview
  expires: number
}

export class AiService {
  private readonly pending = new Map<string, Pending>()
  private readonly backends: Record<AiProvider, AiBackend>

  constructor(private readonly deps: AiServiceDeps) {
    this.backends = {
      anthropic: new AnthropicBackend(deps.http),
      openai: new OpenAiBackend(deps.http),
      google: new GoogleBackend(deps.http),
      ...deps.backends,
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Builds the request for `feature` around `prompt` and holds it for confirmation. */
  async prepare(feature: AiFeature, prompt: string): Promise<AiPreview> {
    const demo = this.deps.http.demo
    const model = this.deps.model()
    const provider = aiModel(model).provider
    if (!demo && !(await this.deps.key(provider))) {
      throw new ServiceError(
        'not_configured',
        `Add your ${AI_PROVIDER_INFO[provider].name} API key in Settings → AI to use this. DevDock sends nothing until you do.`,
      )
    }
    this.sweep()
    const system = SYSTEM[feature]
    const estimatedInputTokens = Math.ceil((system.length + prompt.length) / 4)
    const now = this.now()
    const preview: AiPreview = {
      id: randomUUID(),
      feature,
      provider,
      model,
      system,
      prompt,
      estimatedInputTokens,
      estimatedCostUsd: aiCost(model, estimatedInputTokens, TYPICAL_OUTPUT_TOKENS, now),
      maxCostUsd: aiCost(model, estimatedInputTokens, MAX_TOKENS, now),
      fallback: FALLBACK_MODELS.has(model),
      demo,
    }
    this.pending.set(preview.id, { preview, expires: now + PREVIEW_TTL_MS })
    return preview
  }

  /**
   * Settings → AI and Diagnostics: checks the active provider's saved key with its models list,
   * which is free (no tokens), and lists the models it can use.
   */
  async testConnection(): Promise<AiConnection> {
    const demo = this.deps.http.demo
    const provider = aiModel(this.deps.model()).provider
    const key = demo ? 'demo' : await this.deps.key(provider)
    if (!key) {
      throw new ServiceError(
        'not_configured',
        `Add your ${AI_PROVIDER_INFO[provider].name} API key in Settings → AI first.`,
      )
    }
    return { provider, ...(await this.backends[provider].models(key)) }
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
    // The preview promised "demo: nothing is sent" (or a real send): demo mode must not have
    // been switched in between, or a demo preview would go to the real API.
    if (this.deps.http.demo !== preview.demo) {
      throw new ServiceError(
        'conflict',
        'Demo mode changed since this request was prepared. Prepare it again to see what will happen.',
      )
    }
    const key = preview.demo ? 'demo' : await this.deps.key(preview.provider)
    if (!key) {
      throw new ServiceError(
        'not_configured',
        `Your ${AI_PROVIDER_INFO[preview.provider].name} API key was removed.`,
      )
    }
    const reply = await this.backends[preview.provider].send({
      key,
      model: preview.model,
      feature: preview.feature,
      system: preview.system,
      prompt: preview.prompt,
      maxTokens: MAX_TOKENS,
      fallback: preview.fallback,
    })
    // A fallback model bills at its own price; an unknown one is priced as the chosen model.
    const priced = AI_MODEL_IDS.find((m) => m === reply.model) ?? preview.model
    return {
      text: reply.text,
      model: reply.model,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      costUsd: aiCost(priced, reply.inputTokens, reply.outputTokens, this.now()),
      truncated: reply.truncated,
    }
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, p] of this.pending) if (p.expires <= now) this.pending.delete(id)
  }
}
