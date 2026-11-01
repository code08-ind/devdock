/**
 * GPT (T6) through OpenAI's Responses API over plain HTTP (`POST /v1/responses`). The request
 * is not stored on OpenAI's side (`store: false`); reasoning effort follows the feature, like
 * Claude's.
 */
import { AI_PROVIDER_INFO, type AiFeature } from '@shared/ai'
import type { HttpClient } from '../http'
import { num, obj, text as str } from '../json'
import { ServiceError } from '../service-error'
import type { AiBackend, AiReply, AiSend } from './backend'
import { aiJson, badShape } from './http'

/** Pinned like Anthropic's: nothing in the environment can redirect the key. */
export const OPENAI_API = `${AI_PROVIDER_INFO.openai.origin}/v1`
const SERVICE = 'OpenAI'

const EFFORT: Record<AiFeature, 'low' | 'medium'> = {
  'pr-summary': 'medium',
  lesson: 'low',
  standup: 'low',
}

const auth = (key: string) => ({ service: SERVICE, headers: { Authorization: `Bearer ${key}` } })

export class OpenAiBackend implements AiBackend {
  constructor(private readonly http: HttpClient) {}

  async models(key: string): Promise<{ status: number; models: string[] }> {
    const { status, body } = await aiJson(this.http, auth(key), `${OPENAI_API}/models`)
    const data = obj(body).data
    if (!Array.isArray(data)) throw badShape(SERVICE, 'a model list')
    return { status, models: data.flatMap((m) => str(obj(m).id) ?? []) }
  }

  async send(req: AiSend): Promise<AiReply> {
    const { body } = await aiJson(this.http, auth(req.key), `${OPENAI_API}/responses`, {
      model: req.model,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: req.maxTokens,
      reasoning: { effort: EFFORT[req.feature] },
      store: false,
    })
    const res = obj(body)
    const parts = (Array.isArray(res.output) ? res.output : [])
      .map(obj)
      .filter((o) => o.type === 'message')
      .flatMap((m) => (Array.isArray(m.content) ? m.content.map(obj) : []))
    const reason = str(obj(res.incomplete_details).reason)
    const refusal = parts.find((p) => p.type === 'refusal')
    if (refusal || reason === 'content_filter') {
      throw new ServiceError(
        'forbidden',
        'GPT declined this request. Nothing was changed; you can edit the text and try again.',
        { details: str(refusal?.refusal) ?? undefined },
      )
    }
    const answer = parts
      .flatMap((p) => (p.type === 'output_text' ? (str(p.text) ?? []) : []))
      .join('')
      .trim()
    const truncated = reason === 'max_output_tokens'
    if (!answer) {
      throw new ServiceError(
        'bad_response',
        truncated
          ? 'GPT used up its length limit before writing an answer. Try again, or shorten the text.'
          : 'GPT sent back no text. Try again.',
      )
    }
    const usage = obj(res.usage)
    const inputTokens = num(usage.input_tokens)
    const outputTokens = num(usage.output_tokens)
    if (inputTokens === null || outputTokens === null) throw badShape(SERVICE, 'token counts')
    return {
      text: answer,
      model: str(res.model) ?? req.model,
      inputTokens,
      // Reasoning tokens are part of output_tokens, billed at the output price.
      outputTokens,
      truncated,
    }
  }
}
