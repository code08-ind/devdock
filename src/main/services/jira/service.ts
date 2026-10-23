import type { JiraConnection, JiraIssue, JiraIssueDetail, JiraListRequest } from '@shared/jira'
import type { Settings } from '@shared/settings'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { JiraClient, type JiraConfig } from './client'

export interface JiraServiceDeps {
  http: HttpClient
  settings: () => Settings
  token: () => string | undefined
  /** Site used while demo mode is on (the MSW fixtures). */
  demo: { config: JiraConfig; boardId: number }
}

/** Jira for the app: config from Settings + the `jira.token` secret, or the demo fixtures. */
export class JiraService {
  private cached: { signature: string; client: JiraClient } | null = null

  constructor(private readonly deps: JiraServiceDeps) {}

  async testConnection(): Promise<JiraConnection> {
    return this.client().myself()
  }

  async list(request: JiraListRequest): Promise<JiraIssue[]> {
    const jira = this.deps.settings().jira
    switch (request.list) {
      case 'mine':
        return this.client().search(jira.jql)
      case 'sprint': {
        const boardId = this.deps.http.demo ? this.deps.demo.boardId : jira.boardId
        if (boardId === null) {
          throw new ServiceError(
            'not_configured',
            'Set a board id in Settings → Jira to see the current sprint.',
          )
        }
        return this.client().sprintIssues(boardId)
      }
      case 'saved': {
        const query = jira.savedQueries.find((q) => q.name === request.name)
        if (!query) throw new ServiceError('not_found', `No saved query named "${request.name}".`)
        return this.client().search(query.jql)
      }
    }
  }

  async issue(key: string): Promise<JiraIssueDetail> {
    return this.client().issue(key)
  }

  private client(): JiraClient {
    const config = this.config()
    const signature = JSON.stringify(config)
    if (this.cached?.signature !== signature) {
      this.cached = { signature, client: new JiraClient(this.deps.http, config) }
    }
    return this.cached.client
  }

  private config(): JiraConfig {
    if (this.deps.http.demo) return this.deps.demo.config
    const { flavor, baseUrl, email } = this.deps.settings().jira
    const token = this.deps.token()
    const missing = [
      !baseUrl && 'the site URL',
      flavor === 'cloud' && !email && 'the account email',
      !token && (flavor === 'cloud' ? 'an API token' : 'a personal access token'),
    ].filter(Boolean)
    if (missing.length) {
      throw new ServiceError(
        'not_configured',
        `Jira isn't set up yet: add ${missing.join(', ')} in Settings → Jira (or turn on demo mode).`,
      )
    }
    return { flavor, baseUrl, email, token: token! }
  }
}
