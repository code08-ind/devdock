import { describe, expect, it, vi } from 'vitest'
import { aiCost, aiPrice, activeModel, AiSettingsSchema, modelPatch } from '../../src/shared/ai'
import type { AiModelId } from '../../src/shared/ai'
import type { HttpClient } from '../../src/main/services/http'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')
const { AiService } = await import('../../src/main/services/ai/service')
const { SYSTEM } = await import('../../src/main/services/ai/prompts')

type Sent = { method: string; url: string; headers: Headers; body: Record<string, unknown> | null }

/** A non-demo HttpClient answering each request with `reply(request, n)` (n = attempt index). */
function fakeHttp(reply: (sent: Sent, n: number) => Response) {
  const sent: Sent[] = []
  const http: HttpClient = {
    demo: false,
    async fetch(request) {
      const text = await request.text()
      const s: Sent = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      }
      sent.push(s)
      return reply(s, sent.length - 1)
    },
  }
  return { http, sent }
}

const service = (http: HttpClient, model: AiModelId, key: string | undefined = 'sk-test') =>
  new AiService({ http, key: () => key, model: () => model, now: () => Date.UTC(2026, 10, 1) })

const gptAnswer = (over: Record<string, unknown> = {}) =>
  Response.json({
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    model: 'gpt-6.1-sol-2026-10-01',
    incomplete_details: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Ship it after the lint fix.', annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
    },
    ...over,
  })

const geminiAnswer = (over: Record<string, unknown> = {}) =>
  Response.json({
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            { text: 'thinking out loud', thought: true },
            { text: 'Ship it after the lint fix.' },
          ],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 150, thoughtsTokenCount: 50 },
    modelVersion: 'gemini-3.8-flash',
    ...over,
  })

describe('AI providers (T6): OpenAI', () => {
  it('sends the prepared request to the Responses API, unstored, and prices the answer', async () => {
    const { http, sent } = fakeHttp(() => gptAnswer())
    const ai = service(http, 'gpt-6.1-sol')
    const preview = await ai.prepare('lesson', 'Reviewer comment:\nUse the design tokens')
    expect(preview).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol', fallback: false })
    expect(sent).toEqual([])
    const result = await ai.run(preview.id)
    expect(sent).toHaveLength(1)
    const [req] = sent
    expect(req!.method).toBe('POST')
    expect(req!.url).toBe('https://api.openai.com/v1/responses')
    expect(req!.headers.get('authorization')).toBe('Bearer sk-test')
    expect(req!.body).toEqual({
      model: 'gpt-6.1-sol',
      instructions: SYSTEM.lesson,
      input: 'Reviewer comment:\nUse the design tokens',
      max_output_tokens: 16_000,
      reasoning: { effort: 'low' },
      store: false,
    })
    expect(result).toEqual({
      text: 'Ship it after the lint fix.',
      model: 'gpt-6.1-sol-2026-10-01',
      inputTokens: 1000,
      outputTokens: 200,
      // $2 / $10 per million: 0.002 + 0.002.
      costUsd: 0.004,
      truncated: false,
    })
  })

  it('a refusal or content filter is "declined"; a cut-off answer is kept and marked', async () => {
    const refusal = fakeHttp(() =>
      gptAnswer({
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I can’t help.' }] }],
      }),
    )
    const ai = service(refusal.http, 'gpt-6-astra')
    await expect(ai.run((await ai.prepare('standup', 'x')).id)).rejects.toMatchObject({
      kind: 'forbidden',
      message: expect.stringMatching(/^GPT declined/),
    })
    const filtered = fakeHttp(() =>
      gptAnswer({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }),
    )
    const ai2 = service(filtered.http, 'gpt-6-luna')
    await expect(ai2.run((await ai2.prepare('standup', 'x')).id)).rejects.toMatchObject({
      kind: 'forbidden',
    })
    const cut = fakeHttp(() =>
      gptAnswer({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    )
    const ai3 = service(cut.http, 'gpt-6-luna')
    expect(await ai3.run((await ai3.prepare('standup', 'x')).id)).toMatchObject({
      truncated: true,
    })
  })

  it('a rejected key, a rate limit and a bad request say so; a 503 is tried again', async () => {
    const cases: [number, unknown, object][] = [
      [
        401,
        { error: { message: 'Incorrect API key' } },
        { kind: 'auth', message: /OpenAI rejected the API key/ },
      ],
      [429, { error: { message: 'Rate limit' } }, { kind: 'rate_limited' }],
      [
        400,
        { error: { message: 'Unsupported parameter: x' } },
        { kind: 'bad_response', message: /Unsupported parameter: x/ },
      ],
      [
        404,
        { error: { message: 'model not found' } },
        { kind: 'not_found', message: /doesn't offer that model/ },
      ],
    ]
    for (const [status, body, expected] of cases) {
      const { http } = fakeHttp(() => Response.json(body, { status }))
      const ai = service(http, 'gpt-6.1-sol')
      const run = ai.run((await ai.prepare('lesson', 'x')).id)
      await expect(run, String(status)).rejects.toMatchObject({
        ...expected,
        message: expect.stringMatching((expected as { message?: RegExp }).message ?? /./),
      })
    }
    const flaky = fakeHttp((_, n) =>
      n === 0 ? Response.json({ error: { message: 'busy' } }, { status: 503 }) : gptAnswer(),
    )
    const ai = service(flaky.http, 'gpt-6.1-sol')
    expect(await ai.run((await ai.prepare('lesson', 'x')).id)).toMatchObject({
      text: 'Ship it after the lint fix.',
    })
    expect(flaky.sent).toHaveLength(2)
  })

  it('Test connection lists the key’s models (GET /v1/models)', async () => {
    const { http, sent } = fakeHttp(() =>
      Response.json({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }),
    )
    expect(await service(http, 'gpt-6.1-sol').testConnection()).toEqual({
      provider: 'openai',
      status: 200,
      models: ['gpt-6.1-sol', 'gpt-6-luna'],
    })
    expect(sent[0]).toMatchObject({ method: 'GET', url: 'https://api.openai.com/v1/models' })
  })
})

describe('AI providers (T6): Google Gemini', () => {
  it('calls generateContent with the key in a header (never the URL); thoughts are billed, not shown', async () => {
    const { http, sent } = fakeHttp(() => geminiAnswer())
    const ai = service(http, 'gemini-3.8-flash', 'AIza-test')
    const preview = await ai.prepare('pr-summary', 'Pull request: …')
    expect(preview.provider).toBe('google')
    const result = await ai.run(preview.id)
    const [req] = sent
    expect(req!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    )
    expect(req!.url).not.toContain('AIza')
    expect(req!.headers.get('x-goog-api-key')).toBe('AIza-test')
    expect(req!.headers.get('authorization')).toBeNull()
    expect(req!.body).toEqual({
      systemInstruction: { parts: [{ text: SYSTEM['pr-summary'] }] },
      contents: [{ role: 'user', parts: [{ text: 'Pull request: …' }] }],
      generationConfig: { maxOutputTokens: 16_000 },
    })
    expect(result).toEqual({
      text: 'Ship it after the lint fix.',
      model: 'gemini-3.8-flash',
      inputTokens: 1000,
      outputTokens: 200,
      // $0.75 / $3.75 per million (intro price on 2026-11-01).
      costUsd: 0.0015,
      truncated: false,
    })
  })

  it('a blocked prompt or a safety stop is "declined"; a bad key (400 API_KEY_INVALID) is an auth error', async () => {
    for (const answer of [
      Response.json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }),
      geminiAnswer({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    ]) {
      const { http } = fakeHttp(() => answer.clone())
      const ai = service(http, 'gemini-4-argon')
      await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
        kind: 'forbidden',
        message: expect.stringMatching(/^Gemini declined/),
      })
    }
    const { http } = fakeHttp(() =>
      Response.json(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
            details: [{ reason: 'API_KEY_INVALID' }],
          },
        },
        { status: 400 },
      ),
    )
    const ai = service(http, 'gemini-3.1-flash-lite')
    await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringMatching(/Google rejected the API key/),
    })
  })

  it('Test connection lists models without their `models/` prefix', async () => {
    const { http } = fakeHttp(() =>
      Response.json({
        models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-4-argon' }],
      }),
    )
    expect(await service(http, 'gemini-3.8-flash').testConnection()).toEqual({
      provider: 'google',
      status: 200,
      models: ['gemini-3.8-flash', 'gemini-4-argon'],
    })
  })
})

describe('AI providers (T6): settings, prices, demo', () => {
  it('one active provider, each with its own model; older settings keep Claude', () => {
    const old = AiSettingsSchema.parse({ model: 'claude-haiku-5-5' })
    expect(old).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      openaiModel: 'gpt-6.1-sol',
      googleModel: 'gemini-3.8-flash',
    })
    expect(activeModel(old)).toBe('claude-haiku-5-5')
    expect(activeModel({ ...old, provider: 'google' })).toBe('gemini-3.8-flash')
    expect(modelPatch('gpt-6-astra')).toEqual({ openaiModel: 'gpt-6-astra' })
    expect(() => AiSettingsSchema.parse({ model: 'gpt-6-astra' })).toThrow()
  })

  it('a price announced to change applies from the day after `until` (UTC)', () => {
    const nov30 = Date.UTC(2026, 10, 30, 23, 59)
    const dec1 = Date.UTC(2026, 11, 1)
    expect(aiPrice('gemini-4-argon', nov30)).toEqual({ input: 2, output: 10 })
    expect(aiPrice('gemini-4-argon', dec1)).toEqual({ input: 4, output: 20 })
    expect(aiCost('gemini-4-argon', 1_000_000, 0, dec1)).toBe(4)
    expect(aiPrice('gpt-6.1-sol', dec1)).toEqual({ input: 2, output: 10 })
  })

  it('demo mode answers for every provider, with no key and no network', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ general: { demoMode: true } })
    for (const provider of ['openai', 'google', 'anthropic'] as const) {
      deps.settings.update({ ai: { provider } })
      const prepared = await dispatch(
        'ai:prepare',
        { feature: 'lesson', comment: 'Use tokens' },
        handlers,
      )
      if (!prepared.ok) throw new Error(prepared.error.message)
      expect(prepared.data).toMatchObject({ provider, demo: true })
      const ran = await dispatch('ai:run', { id: prepared.data.id }, handlers)
      expect(ran, provider).toMatchObject({
        ok: true,
        data: { text: expect.stringMatching(/^Demo answer:/) },
      })
      const test = await dispatch('ai:testConnection', undefined, handlers)
      expect(test, provider).toMatchObject({ ok: true, data: { provider, status: 200 } })
    }
  })
})
