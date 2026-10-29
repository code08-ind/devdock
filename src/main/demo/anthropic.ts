import { http, HttpResponse, type RequestHandler } from 'msw'
import { SYSTEM } from '../services/ai/prompts'

/**
 * Demo Claude (P7-C-B): answers `POST /v1/messages` in-process with a fixed reply per feature
 * (matched on the system prompt), so the AI features can be tried with no key and no network.
 * The answer says it is a demo.
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

export const anthropicHandlers: RequestHandler[] = [
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = (await request.json()) as { model: string; system?: string }
    const text =
      REPLIES.find(([system]) => system === body.system)?.[1] ?? 'Demo answer: (no fixture).'
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
