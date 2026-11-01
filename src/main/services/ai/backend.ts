/**
 * One AI provider behind the AI service (T6): sends a prepared request and lists the models a
 * key can use. The service owns everything else (preview, expiry, demo checks, pricing), so a
 * provider adds only how its API is called and what its answers and errors mean.
 */
import type { AiFeature, AiModelId } from '@shared/ai'

export interface AiSend {
  key: string
  model: AiModelId
  feature: AiFeature
  system: string
  prompt: string
  /** The answer's length cap, thinking or reasoning included. */
  maxTokens: number
  /** Anthropic only: its server-side fallback may answer a declined request. */
  fallback: boolean
}

export interface AiReply {
  /** The answer's text, trimmed; never empty (an empty answer is a ServiceError). */
  text: string
  /** The model that answered, as the provider names it. */
  model: string
  /** Billed input and output tokens (output includes thinking / reasoning). */
  inputTokens: number
  outputTokens: number
  /** The answer hit its length cap and may end mid-sentence. */
  truncated: boolean
}

export interface AiBackend {
  send(req: AiSend): Promise<AiReply>
  /** The provider's free models list for `key`: HTTP status and model ids. */
  models(key: string): Promise<{ status: number; models: string[] }>
}

/** The answer's length cap (thinking counts towards it). A short note never gets near it. */
export const MAX_TOKENS = 16_000
