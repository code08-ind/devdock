import type { JiraConnection, JiraIssue, JiraIssueDetail, JiraListRequest } from '@shared/jira'
import type { Settings } from '@shared/settings'
import { dayKey } from '@shared/standup'
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

  /**
   * Standup (SPEC 6.6): issues whose status I changed in the period. Jira's JQL can't find
   * issues I only commented on (that needs an add-on), so comments aren't included.
   */
  async statusChangedByMe(from: Date, to: Date): Promise<JiraIssue[]> {
    const at = (d: Date) => `"${dayKey(d).replace(/-/g, '/')} 00:00"`
    return this.client().search(
      `status CHANGED BY currentUser() DURING (${at(from)}, ${at(to)}) ORDER BY updated DESC`,
    )
  }

  /** Standup "Today": my issues in an in-progress status. */
  async inProgress(): Promise<JiraIssue[]> {
    return this.client().search(
      'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC',
    )
  }

  async issue(key: string): Promise<JiraIssueDetail> {
    return this.client().issue(key)
  }

  /** Only Start work calls this, and only when Settings → "Transition on Start work" is on. */
  async transitionToInProgress(key: string): Promise<'done' | 'unavailable'> {
    return this.client().transitionToInProgress(key)
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
