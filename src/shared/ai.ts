/**
 * Bring-your-own-key AI (P7-C-B, P7.09): a few in-app features that call Claude with the user's
 * own Anthropic API key (kept in the OS keychain, like other tokens). Off until a key is added;
 * every call is prepared in main, shown to the user (what is sent, to which model, about what it
 * costs) and sent only after they confirm. Free of Node and DOM so main, renderer and tests share
 * it.
 */
import { z } from 'zod'
import { PrRefSchema } from './bitbucket'

/** The models offered in Settings → AI (current generation; prices per million tokens, USD). */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, output: 10 },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
] as const
export type AiModelId = (typeof AI_MODELS)[number]['id']
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]]
export const DEFAULT_AI_MODEL: AiModelId = 'claude-opus-5-5'

export const aiModel = (id: AiModelId) => AI_MODELS.find((m) => m.id === id)!

export const AI_FEATURES = ['pr-summary', 'lesson', 'standup'] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  'pr-summary': 'Draft a status note',
  lesson: 'Word this comment as a lesson',
  standup: 'Polish the standup',
}

/** Settings → AI. The key itself lives in the keychain (`anthropic.key`), never here. */
export const AiSettingsSchema = z
  .object({
    model: z.enum(AI_MODEL_IDS).default(DEFAULT_AI_MODEL),
  })
  .prefault({})
export type AiSettings = z.infer<typeof AiSettingsSchema>

/** What to prepare. Main loads the data itself; only a comment's text comes from the screen. */
export const AiPrepareSchema = z.discriminatedUnion('feature', [
  z.object({
    feature: z.literal('pr-summary'),
    /** The PR, as the PR lists hold it; main loads its current state. */
    ref: PrRefSchema,
  }),
  z.object({
    feature: z.literal('lesson'),
    comment: z.string().min(1).max(8000),
    /** The file or PR it was left on, for context ("web-app#412 src/Button.tsx"). */
    where: z.string().max(300).optional(),
  }),
  z.object({ feature: z.literal('standup') }),
])
export type AiPrepare = z.infer<typeof AiPrepareSchema>

/** A prepared call, shown to the user before anything is sent. */
export const AiPreviewSchema = z.object({
  /** Pass to `ai:run` to send exactly this. Expires after a few minutes. */
  id: z.string(),
  feature: z.enum(AI_FEATURES),
  model: z.enum(AI_MODEL_IDS),
  /** The instructions and the text sent, exactly as they go out. */
  system: z.string(),
  prompt: z.string(),
  /** Rough count (about 4 characters a token); the bill uses the real count. */
  estimatedInputTokens: z.number().int(),
  /** Input at the model's price plus a typical answer, USD. */
  estimatedCostUsd: z.number(),
  /** The answer can't cost more than this (its length is capped), USD. */
  maxCostUsd: z.number(),
  demo: z.boolean(),
})
export type AiPreview = z.infer<typeof AiPreviewSchema>

export const AiResultSchema = z.object({
  text: z.string(),
  /** The model that answered (a refusal fallback may answer instead of the chosen one). */
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  /** The answer hit its length cap and may end mid-sentence. */
  truncated: z.boolean(),
})
export type AiResult = z.infer<typeof AiResultSchema>

/** USD for a call, from the model's per-million prices. */
export function aiCost(model: AiModelId, inputTokens: number, outputTokens: number): number {
  const m = aiModel(model)
  return (inputTokens * m.input + outputTokens * m.output) / 1_000_000
}

/** "$0.004", "under $0.001", "$0.32". */
export function formatUsd(usd: number): string {
  if (usd < 0.001) return 'under $0.001'
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`
}
