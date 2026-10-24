import { http, HttpResponse, type RequestHandler } from 'msw'
import { bitbucketHandlers } from './bitbucket'
import { jiraHandlers } from './jira'
import { DEMO_ORIGIN } from './origin'

export { DEMO_ORIGIN }

export const coreHandlers: RequestHandler[] = [
  http.get(`${DEMO_ORIGIN}/ping`, () => HttpResponse.text('pong (demo)')),
]

/** Every adapter's demo fixtures. Adapters added in later phases register theirs here. */
export function demoHandlers(): RequestHandler[] {
  return [...coreHandlers, ...jiraHandlers, ...bitbucketHandlers()]
}
