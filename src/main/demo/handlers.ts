import { http, HttpResponse, type RequestHandler } from 'msw'

/** Base host used by all demo fixtures. Adapters added in later phases register their own. */
export const DEMO_ORIGIN = 'https://demo.devdock.invalid'

export const coreHandlers: RequestHandler[] = [
  http.get(`${DEMO_ORIGIN}/ping`, () => HttpResponse.text('pong (demo)')),
]

export function demoHandlers(): RequestHandler[] {
  return [...coreHandlers]
}
