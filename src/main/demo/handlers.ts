import { http, HttpResponse, type RequestHandler } from 'msw'
import { anthropicHandlers } from './anthropic'
import { bitbucketHandlers } from './bitbucket'
import { githubHandlers } from './github'
import { gitlabHandlers } from './gitlab'
import { jenkinsHandlers } from './jenkins'
import { jiraHandlers } from './jira'
import { DEMO_ORIGIN } from './origin'

export { DEMO_ORIGIN }

export const coreHandlers: RequestHandler[] = [
  http.get(`${DEMO_ORIGIN}/ping`, () => HttpResponse.text('pong (demo)')),
]

/**
 * Every adapter's demo fixtures. Adapters added in later phases register theirs here.
 * `jenkinsSpeed` speeds up the demo builds, GitHub Actions runs and GitLab pipelines (e2e only).
 */
export function demoHandlers({
  jenkinsSpeed = 1,
}: { jenkinsSpeed?: number } = {}): RequestHandler[] {
  return [
    ...coreHandlers,
    ...jiraHandlers,
    ...bitbucketHandlers(),
    ...jenkinsHandlers({ speed: jenkinsSpeed }),
    ...githubHandlers({ speed: jenkinsSpeed }),
    ...gitlabHandlers({ speed: jenkinsSpeed }),
    ...anthropicHandlers,
  ]
}
