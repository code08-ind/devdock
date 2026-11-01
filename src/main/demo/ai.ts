import { http, HttpResponse, type RequestHandler } from 'msw'
import { modelsOf } from '@shared/ai'
import { SYSTEM } from '../services/ai/prompts'

/**
 * Demo AI (P7-C-B; OpenAI and Google since T6): each provider's API answered in-process with a
 * fixed reply per feature (matched on the system prompt), so the AI features can be tried with
 * no key and no network. The answer says it is a demo.
 */
const REPLIES: [system: string, text: string][] = [
  [
    SYSTEM['pr-summary'],
    'Demo answer: this PR adds the change named in its title. It has one approval and one ' +
      'reviewer asking for changes; the build is failing on lint. Next step: fix the lint ' +
      'error and reply to the open thread, then ask for a re-review.',
  ],
  [
    SYSTEM.lesson,
    'Demo answer: Keep loading and error states inside the component that owns the data.',
  ],
  [
    SYSTEM.standup,
    'Demo answer:\n\n**Yesterday**\n- Fixed the date picker focus bug (DD-101)\n\n**Today**\n' +
      '- Checkout summary card (DD-102)\n\n**Blockers**\n- None',
  ],
]

const replyTo = (system: string | undefined) =>
  REPLIES.find(([s]) => s === system)?.[1] ?? 'Demo answer: (no fixture).'

const anthropicHandlers: RequestHandler[] = [
  // Test connection: the models the demo key "can use".
  http.get('https://api.anthropic.com/v1/models', () =>
    HttpResponse.json({
      data: modelsOf('anthropic').map((m) => ({
        type: 'model',
        id: m.id,
        display_name: m.name,
        created_at: '2026-09-01T00:00:00Z',
      })),
      has_more: false,
      first_id: modelsOf('anthropic')[0]!.id,
      last_id: modelsOf('anthropic').at(-1)!.id,
    }),
  ),
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = (await request.json()) as { model: string; system?: string }
    const text = replyTo(body.system)
    return HttpResponse.json({
      id: 'msg_demo',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 180, output_tokens: 60 },
    })
  }),
]

/** OpenAI's Responses API and models list, as the T6 backend reads them. */
const openaiHandlers: RequestHandler[] = [
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({
      object: 'list',
      data: modelsOf('openai').map((m) => ({ id: m.id, object: 'model', owned_by: 'openai' })),
    }),
  ),
  http.post('https://api.openai.com/v1/responses', async ({ request }) => {
    const body = (await request.json()) as { model: string; instructions?: string }
    return HttpResponse.json({
      id: 'resp_demo',
      object: 'response',
      status: 'completed',
      model: body.model,
      incomplete_details: null,
      output: [
        { type: 'reasoning', id: 'rs_demo', summary: [] },
        {
          type: 'message',
          id: 'msg_demo',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: replyTo(body.instructions), annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 180,
        output_tokens: 60,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 240,
      },
    })
  }),
]

/** The Gemini API's generateContent and models list, as the T6 backend reads them. */
const googleHandlers: RequestHandler[] = [
  http.get('https://generativelanguage.googleapis.com/v1beta/models', () =>
    HttpResponse.json({
      models: modelsOf('google').map((m) => ({ name: `models/${m.id}`, displayName: m.name })),
    }),
  ),
  http.post(
    'https://generativelanguage.googleapis.com/v1beta/models/:call',
    async ({ request, params }) => {
      const [model, method] = String(params.call).split(':')
      if (method !== 'generateContent') {
        return HttpResponse.json({ error: { code: 404, message: 'Not found' } }, { status: 404 })
      }
      const body = (await request.json()) as {
        systemInstruction?: { parts?: { text?: string }[] }
      }
      const text = replyTo(body.systemInstruction?.parts?.[0]?.text)
      return HttpResponse.json({
        candidates: [
          { content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 },
        ],
        usageMetadata: {
          promptTokenCount: 180,
          candidatesTokenCount: 60,
          thoughtsTokenCount: 20,
          totalTokenCount: 260,
        },
        modelVersion: model,
      })
    },
  ),
]

export const aiHandlers: RequestHandler[] = [
  ...anthropicHandlers,
  ...openaiHandlers,
  ...googleHandlers,
]
