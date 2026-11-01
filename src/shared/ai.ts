/**
 * Bring-your-own-key AI (P7-C-B, P7.09; OpenAI and Google added in T6): a few in-app features
 * that call the user's chosen provider with their own API key (kept in the OS keychain, like
 * other tokens). One provider is active at a time (Settings → AI). Off until a key is added;
 * every call is prepared in main, shown to the user (what is sent, to which model, about what it
 * costs) and sent only after they confirm. Free of Node and DOM so main, renderer and tests share
 * it.
 */
import { z } from 'zod'
import { PrRefSchema } from './bitbucket'

export const AI_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/** Who each provider is to the user, and where its key lives (the keychain entry). */
export const AI_PROVIDER_INFO = {
  anthropic: {
    name: 'Anthropic',
    assistant: 'Claude',
    secret: 'anthropic.key',
    keyHelp: 'Create a key at console.anthropic.com → API keys.',
    origin: 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    assistant: 'GPT',
    secret: 'openai.key',
    keyHelp: 'Create a key at platform.openai.com → API keys.',
    origin: 'https://api.openai.com',
  },
  google: {
    name: 'Google',
    assistant: 'Gemini',
    secret: 'google.key',
    keyHelp: 'Create a key in Google AI Studio (aistudio.google.com) → Get API key.',
    origin: 'https://generativelanguage.googleapis.com',
  },
} as const satisfies Record<
  AiProvider,
  { name: string; assistant: string; secret: string; keyHelp: string; origin: string }
>

/**
 * The models offered in Settings → AI, per provider, best first (current generation; USD per
 * million tokens, input / output, from each provider's pricing page on 2026-11-01). A price that changes
 * on a known date has `until` (the last day, UTC) and `then` (the price after it).
 */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', input: 4, output: 20 },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    name: 'Claude Sonnet 5.5',
    input: 2,
    output: 10,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    name: 'Claude Haiku 5.5',
    input: 0.1,
    output: 0.5,
  },
  { id: 'gpt-6-astra', provider: 'openai', name: 'GPT-6 Astra', input: 10, output: 50 },
  { id: 'gpt-6.1-sol', provider: 'openai', name: 'GPT-6.1 Sol', input: 2, output: 10 },
  { id: 'gpt-6-luna', provider: 'openai', name: 'GPT-6 Luna', input: 0.1, output: 0.5 },
  {
    id: 'gemini-4-argon',
    provider: 'google',
    name: 'Gemini 4 Argon',
    input: 2,
    output: 10,
    until: '2026-11-30',
    then: { input: 4, output: 20 },
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    name: 'Gemini 3.8 Flash',
    input: 0.75,
    output: 3.75,
    until: '2026-12-31',
    then: { input: 1.5, output: 7.5 },
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'google',
    name: 'Gemini 3.1 Flash-Lite',
    input: 0.25,
    output: 1.5,
  },
] as const satisfies readonly {
  id: string
  provider: AiProvider
  name: string
  input: number
  output: number
  until?: string
  then?: { input: number; output: number }
}[]
export type AiModelId = (typeof AI_MODELS)[number]['id']
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]]
type ModelOf<P extends AiProvider> = Extract<(typeof AI_MODELS)[number], { provider: P }>['id']
const idsOf = <P extends AiProvider>(p: P) =>
  AI_MODELS.filter((m) => m.provider === p).map((m) => m.id) as [ModelOf<P>, ...ModelOf<P>[]]

/** Each provider's default model (owner, T6: Anthropic's best; the others' middle tier). */
export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.1-sol',
  google: 'gemini-3.8-flash',
} as const satisfies { [P in AiProvider]: ModelOf<P> }
export const DEFAULT_AI_MODEL: AiModelId = DEFAULT_MODELS.anthropic

export const aiModel = (id: AiModelId) => AI_MODELS.find((m) => m.id === id)!
export const modelsOf = (p: AiProvider) => AI_MODELS.filter((m) => m.provider === p)

/** An announced price change: the last day of the current price (UTC) and the price after. */
export function priceChange(
  id: AiModelId,
): { until: string; then: { input: number; output: number } } | null {
  const m = aiModel(id) as { until?: string; then?: { input: number; output: number } }
  return m.until && m.then ? { until: m.until, then: m.then } : null
}

/** The model's price on `now`'s date (UTC): after `until`, the announced new price. */
export function aiPrice(id: AiModelId, now = Date.now()): { input: number; output: number } {
  const m = aiModel(id)
  const change = priceChange(id)
  const today = new Date(now).toISOString().slice(0, 10)
  return change && today > change.until ? change.then : { input: m.input, output: m.output }
}

export const AI_FEATURES = ['pr-summary', 'lesson', 'standup'] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  'pr-summary': 'Summarise this pull request',
  lesson: 'Word this comment as a lesson',
  standup: 'Polish the standup',
}

/**
 * Settings → AI: the active provider and each provider's model (kept when switching). The keys
 * live in the keychain (`anthropic.key`, `openai.key`, `google.key`), never here.
 */
export const AiSettingsSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS).default('anthropic'),
    /** Anthropic's model (the name predates T6). */
    model: z.enum(idsOf('anthropic')).default(DEFAULT_MODELS.anthropic),
    openaiModel: z.enum(idsOf('openai')).default(DEFAULT_MODELS.openai),
    googleModel: z.enum(idsOf('google')).default(DEFAULT_MODELS.google),
  })
  .prefault({})
export type AiSettings = z.infer<typeof AiSettingsSchema>

/** Where each provider's model is kept in Settings → AI. */
const MODEL_FIELD = {
  anthropic: 'model',
  openai: 'openaiModel',
  google: 'googleModel',
} as const satisfies Record<AiProvider, keyof AiSettings>

/** The model the active provider uses. */
export const activeModel = (s: AiSettings): AiModelId => s[MODEL_FIELD[s.provider]]

/** The settings patch that picks `id` for its provider. */
export const modelPatch = (id: AiModelId): Partial<AiSettings> => ({
  [MODEL_FIELD[aiModel(id).provider]]: id,
})

/** What to prepare. Main loads the PR itself; a comment and the edited standup come from the screen. */
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
  z.object({
    feature: z.literal('standup'),
    /** The standup as the user edited it (the polish starts from their words). */
    draft: z.object({
      yesterdayDate: z.string().max(20),
      yesterday: z.array(z.string().max(500)).max(50),
      today: z.array(z.string().max(500)).max(50),
      blockers: z.array(z.string().max(500)).max(50),
    }),
  }),
])
export type AiPrepare = z.infer<typeof AiPrepareSchema>

/** Settings → AI Test connection: the provider's models list (free) answered for the saved key. */
export const AiConnectionSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  status: z.number().int(),
  /** The models the key can use, as the provider lists them. */
  models: z.array(z.string()),
})
export type AiConnection = z.infer<typeof AiConnectionSchema>

/** A prepared call, shown to the user before anything is sent. */
export const AiPreviewSchema = z.object({
  /** Pass to `ai:run` to send exactly this. Expires after a few minutes. */
  id: z.string(),
  feature: z.enum(AI_FEATURES),
  provider: z.enum(AI_PROVIDERS),
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
  /** If Claude declines, Anthropic may answer with another Claude model (Opus, Sonnet). */
  fallback: z.boolean(),
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

/** A typical answer for estimates (thinking included), in tokens. */
export const TYPICAL_OUTPUT_TOKENS = 1_200

/** USD for a call, from the model's per-million prices on `now`'s date. */
export function aiCost(
  model: AiModelId,
  inputTokens: number,
  outputTokens: number,
  now = Date.now(),
): number {
  const p = aiPrice(model, now)
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

/** "$0.004", "under $0.001", "$0.32". */
export function formatUsd(usd: number): string {
  if (usd < 0.001) return 'under $0.001'
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`
}
