import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HttpClient } from '../../src/main/services/http'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')
const { AiService, MAX_TOKENS } = await import('../../src/main/services/ai/service')
const { SYSTEM, prPrompt } = await import('../../src/main/services/ai/prompts')

afterEach(() => vi.useRealTimers())

/** A non-demo HttpClient that records each request and answers with `reply`. */
function fakeHttp(reply: (body: Record<string, unknown>) => Response) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const http: HttpClient = {
    demo: false,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>
      sent.push({ url: request.url, headers: request.headers, body })
      return reply(body)
    },
  }
  return { http, sent }
}

const message = (over: Record<string, unknown> = {}) =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'Ship it after the lint fix.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...over,
  })

describe('AI with your own key (P7-C-B)', () => {
  it('nothing is prepared, let alone sent, without a key', async () => {
    const { http, sent } = fakeHttp(() => message())
    const ai = new AiService({ http, key: () => undefined, model: () => 'claude-opus-5-5' })
    await expect(ai.prepare('lesson', 'Use the design tokens')).rejects.toMatchObject({
      kind: 'not_configured',
    })
    expect(sent).toEqual([])
  })

  it('sends exactly the prepared request once, with the fallback for Opus, and prices it', async () => {
    const { http, sent } = fakeHttp(() => message())
    const ai = new AiService({ http, key: () => 'sk-ant-test', model: () => 'claude-opus-5-5' })
    const preview = await ai.prepare('lesson', 'Reviewer comment:\nUse the design tokens')
    expect(preview).toMatchObject({ feature: 'lesson', model: 'claude-opus-5-5', demo: false })
    expect(preview.system).toBe(SYSTEM.lesson)
    expect(preview.maxCostUsd).toBeGreaterThan(preview.estimatedCostUsd)
    expect(sent).toEqual([])

    const result = await ai.run(preview.id)
    expect(result).toEqual({
      text: 'Ship it after the lint fix.',
      model: 'claude-opus-5-5',
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: (1000 * 4 + 200 * 20) / 1_000_000,
      truncated: false,
    })
    expect(sent).toHaveLength(1)
    const [req] = sent
    expect(req!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req!.headers.get('authorization')).toBe('Bearer sk-ant-test')
    expect(req!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(req!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: MAX_TOKENS,
      system: SYSTEM.lesson,
      messages: [{ role: 'user', content: preview.prompt }],
      output_config: { effort: 'low' },
      fallbacks: 'default',
    })
    // One preview, one send.
    await expect(ai.run(preview.id)).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('Haiku has no server-side fallback; a preview expires after ten minutes', async () => {
    vi.useFakeTimers()
    const { http, sent } = fakeHttp(() => message({ model: 'claude-haiku-5-5' }))
    const ai = new AiService({ http, key: () => 'k', model: () => 'claude-haiku-5-5' })
    await ai.run((await ai.prepare('standup', 'x')).id)
    expect(sent[0]!.body.fallbacks).toBeUndefined()
    expect(sent[0]!.headers.get('anthropic-beta')).toBeNull()
    const stale = await ai.prepare('standup', 'x')
    vi.advanceTimersByTime(10 * 60_000 + 1)
    await expect(ai.run(stale.id)).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('a rejected key, a refusal and a cut-off answer each say so', async () => {
    let reply = () =>
      Response.json(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        { status: 401 },
      )
    const { http } = fakeHttp(() => reply())
    const ai = new AiService({ http, key: () => 'bad', model: () => 'claude-opus-5-5' })
    await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
      kind: 'auth',
      message: /rejected the API key/,
    })
    reply = () =>
      message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: 'Policy.' },
      })
    await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
      kind: 'forbidden',
      message: /declined/,
      details: 'Policy.',
    })
    reply = () => message({ stop_reason: 'max_tokens' })
    expect(await ai.run((await ai.prepare('lesson', 'x')).id)).toMatchObject({ truncated: true })
  })

  it('a demo preview is never sent for real if demo mode was switched off before Send', async () => {
    const { http: real, sent } = fakeHttp(() => message())
    let demo = true
    const http: HttpClient = {
      get demo() {
        return demo
      },
      fetch: (r) => real.fetch(r),
    }
    const ai = new AiService({ http, key: () => 'sk-ant-real', model: () => 'claude-opus-5-5' })
    const preview = await ai.prepare('lesson', 'x')
    expect(preview.demo).toBe(true)
    demo = false
    await expect(ai.run(preview.id)).rejects.toMatchObject({ kind: 'conflict' })
    expect(sent).toEqual([])
  })

  it('a cut-off answer with no text says so; a fallback model is priced at its own rate', async () => {
    let reply = () => message({ content: [], stop_reason: 'max_tokens' })
    const { http } = fakeHttp(() => reply())
    const ai = new AiService({ http, key: () => 'k', model: () => 'claude-opus-5-5' })
    await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
      message: /length limit before writing an answer/,
    })
    reply = () => message({ model: 'claude-sonnet-5-5' })
    expect(await ai.run((await ai.prepare('lesson', 'x')).id)).toMatchObject({
      model: 'claude-sonnet-5-5',
      costUsd: (1000 * 2 + 200 * 10) / 1_000_000,
    })
  })

  it('ANTHROPIC_BASE_URL in the environment never redirects the key; 429 says to wait', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://evil.example')
    try {
      const { http, sent } = fakeHttp(() =>
        Response.json(
          { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
          { status: 429, headers: { 'retry-after': '0' } },
        ),
      )
      const ai = new AiService({ http, key: () => 'k', model: () => 'claude-haiku-5-5' })
      await expect(ai.run((await ai.prepare('lesson', 'x')).id)).rejects.toMatchObject({
        kind: 'rate_limited',
        retryAfterSec: 0,
      })
      // Two retries of the failed attempt, all to Anthropic.
      expect(sent.map((r) => new URL(r.url).host)).toEqual([
        'api.anthropic.com',
        'api.anthropic.com',
        'api.anthropic.com',
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('IPC in demo mode: main builds the text, the demo Claude answers, no key needed', async () => {
    const { handlers } = await handlerSetup()
    const prepared = await dispatch(
      'ai:prepare',
      { feature: 'lesson', comment: 'Please move this fetch into the hook.', where: 'web-app#412' },
      handlers,
    )
    if (!prepared.ok) throw new Error(prepared.error.message)
    expect(prepared.data).toMatchObject({ feature: 'lesson', demo: true, model: 'claude-opus-5-5' })
    expect(prepared.data.prompt).toBe(
      'Left on: web-app#412\nReviewer comment:\nPlease move this fetch into the hook.',
    )
    const ran = await dispatch('ai:run', { id: prepared.data.id }, handlers)
    expect(ran).toMatchObject({ ok: true, data: { text: expect.stringMatching(/^Demo answer/) } })
    // The renderer can only name a prepared id, never send its own text.
    expect(
      await dispatch('ai:run', { id: prepared.data.id, prompt: 'anything' } as never, handlers),
    ).toMatchObject({ ok: false })
    expect(await dispatch('ai:run', { id: prepared.data.id }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
  })

  it('the PR note is built from the PR main loads (demo PR)', async () => {
    const { handlers } = await handlerSetup()
    const list = await dispatch('prs:list', { provider: 'bitbucket', list: 'mine' }, handlers)
    if (!list.ok) throw new Error(list.error.message)
    const first = list.data[0]!
    const prepared = await dispatch(
      'ai:prepare',
      { feature: 'pr-summary', ref: first.ref },
      handlers,
    )
    if (!prepared.ok) throw new Error(prepared.error.message)
    expect(prepared.data.prompt).toMatch(/^Pull request: /)
    expect(prepared.data.prompt).toContain('Branches: ')
    // Main loads the PR's current state (the single-PR call fills unresolved threads).
    const current = await dispatch('prs:pr', first.ref, handlers)
    if (!current.ok) throw new Error(current.error.message)
    // Demo PR times move with the clock: compare everything but the Opened line.
    const facts = (p: string) => p.split('\n').filter((l) => !l.startsWith('Opened:'))
    expect(facts(prepared.data.prompt)).toEqual(facts(prPrompt(current.data)))
  })

  it('Test connection: GET /v1/models with the key (no tokens); no key or a rejected key says so', async () => {
    const seen: { method: string; url: string; auth: string | null }[] = []
    let status = 200
    const http: HttpClient = {
      demo: false,
      fetch(request) {
        seen.push({
          method: request.method,
          url: request.url,
          auth: request.headers.get('authorization'),
        })
        return Promise.resolve(
          status === 200
            ? Response.json({
                data: [
                  {
                    type: 'model',
                    id: 'claude-opus-5-5',
                    display_name: 'Claude Opus 5.5',
                    created_at: '2026-09-01T00:00:00Z',
                  },
                ],
                has_more: false,
                first_id: 'claude-opus-5-5',
                last_id: 'claude-opus-5-5',
              })
            : Response.json(
                {
                  type: 'error',
                  error: { type: 'authentication_error', message: 'invalid x-api-key' },
                },
                { status },
              ),
        )
      },
    }
    const none = new AiService({ http, key: () => undefined, model: () => 'claude-opus-5-5' })
    await expect(none.testConnection()).rejects.toMatchObject({ kind: 'not_configured' })
    expect(seen).toEqual([])

    const ai = new AiService({ http, key: () => 'sk-ant-test', model: () => 'claude-opus-5-5' })
    expect(await ai.testConnection()).toEqual({ status: 200, models: ['claude-opus-5-5'] })
    expect(seen[0]).toMatchObject({ method: 'GET', auth: 'Bearer sk-ant-test' })
    expect(seen[0]!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models\?limit=100$/)

    status = 401
    await expect(ai.testConnection()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('IPC Test connection in demo mode lists the offered models and is recorded for Diagnostics', async () => {
    const { handlers } = await handlerSetup()
    const r = await dispatch('ai:testConnection', undefined, handlers)
    expect(r).toMatchObject({
      ok: true,
      data: { status: 200, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
    })
    const report = await dispatch('diagnostics:export', undefined, handlers)
    if (!report.ok) throw new Error(report.error.message)
    expect(JSON.parse(report.data).lastConnectionTests.Anthropic).toMatchObject({ ok: true })
  })
})
