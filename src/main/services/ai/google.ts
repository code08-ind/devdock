/**
 * Gemini (T6) through the Gemini API's generateContent over plain HTTP. The key goes in the
 * `x-goog-api-key` header (never in the URL, where proxies and logs could see it). Thinking is
 * left at each model's default: the levels a model accepts differ between models.
 */
import type { HttpClient } from '../http'
import { num, obj, text as str } from '../json'
import { ServiceError } from '../service-error'
import type { AiBackend, AiReply, AiSend } from './backend'
import { aiJson, badShape } from './http'

/** Pinned like Anthropic's: nothing in the environment can redirect the key. */
export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'
const SERVICE = 'Google'

/** Finish reasons that mean the answer was withheld rather than written. */
const BLOCKED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
])

const auth = (key: string) => ({ service: SERVICE, headers: { 'x-goog-api-key': key } })

export class GoogleBackend implements AiBackend {
  constructor(private readonly http: HttpClient) {}

  async models(key: string): Promise<{ status: number; models: string[] }> {
    const { status, body } = await aiJson(
      this.http,
      auth(key),
      `${GEMINI_API}/models?pageSize=1000`,
    )
    const list = obj(body).models
    if (!Array.isArray(list)) throw badShape(SERVICE, 'a model list')
    // Names come as `models/gemini-…`; DevDock's ids are the part after it.
    return {
      status,
      models: list.flatMap((m) => str(obj(m).name)?.replace(/^models\//, '') ?? []),
    }
  }

  async send(req: AiSend): Promise<AiReply> {
    const { body } = await aiJson(
      this.http,
      auth(req.key),
      `${GEMINI_API}/models/${encodeURIComponent(req.model)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens },
      },
    )
    const res = obj(body)
    const blockReason = str(obj(res.promptFeedback).blockReason)
    const candidate = obj(Array.isArray(res.candidates) ? res.candidates[0] : undefined)
    const finish = str(candidate.finishReason)
    if (blockReason || (finish && BLOCKED.has(finish))) {
      throw new ServiceError(
        'forbidden',
        'Gemini declined this request. Nothing was changed; you can edit the text and try again.',
        { details: blockReason ?? finish ?? undefined },
      )
    }
    const parts = obj(candidate.content).parts
    const answer = (Array.isArray(parts) ? parts.map(obj) : [])
      // Thought summaries (`thought: true`) aren't part of the answer.
      .flatMap((p) => (p.thought === true ? [] : (str(p.text) ?? [])))
      .join('')
      .trim()
    const truncated = finish === 'MAX_TOKENS'
    if (!answer) {
      throw new ServiceError(
        'bad_response',
        truncated
          ? 'Gemini used up its length limit before writing an answer. Try again, or shorten the text.'
          : 'Gemini sent back no text. Try again.',
      )
    }
    const usage = obj(res.usageMetadata)
    const inputTokens = num(usage.promptTokenCount)
    if (inputTokens === null) throw badShape(SERVICE, 'token counts')
    return {
      text: answer,
      model: str(res.modelVersion) ?? req.model,
      inputTokens,
      // Thinking is billed at the output price, with the answer.
      outputTokens: (num(usage.candidatesTokenCount) ?? 0) + (num(usage.thoughtsTokenCount) ?? 0),
      truncated,
    }
  }
}
