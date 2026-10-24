import type { JiraConnection, JiraFlavor, JiraIssue, JiraIssueDetail } from '@shared/jira'
import { ISSUE_KEY, isInProgress } from '@shared/jira'
import type { HttpClient } from '../http'
import { requestJson } from '../rest'
import { ServiceError } from '../service-error'
import { cloud } from './cloud'
import { datacenter } from './datacenter'
import type { JiraFlavorApi } from './flavor'
import { obj, type JsonObject } from '../json'
import { normaliseDetail, normaliseIssue, type FieldIds, type RawIssue } from './model'

export interface JiraConfig {
  flavor: JiraFlavor
  baseUrl: string
  email: string
  token: string
}

const LIST_FIELDS = [
  'summary',
  'issuetype',
  'priority',
  'status',
  'fixVersions',
  'assignee',
  'updated',
]
const SPRINT_SCHEMA = 'com.pyxis.greenhopper.jira:gh-sprint'
const MAX_RESULTS = 50

/** One Jira site. Cloud and Data Center differ only in their JiraFlavorApi. */
export class JiraClient {
  private readonly api: JiraFlavorApi
  private fieldIds: Promise<FieldIds> | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly config: JiraConfig,
    private readonly timeoutMs = 20_000,
  ) {
    this.api = config.flavor === 'cloud' ? cloud : datacenter
  }

  /** "Test connection": who the credentials authenticate as. */
  async myself(): Promise<JiraConnection> {
    const { status, body } = await this.get(`${this.config.baseUrl}${this.api.api}/myself`)
    return { flavor: this.api.flavor, status, user: this.api.user(obj(body)) }
  }

  async search(jql: string): Promise<JiraIssue[]> {
    const ids = await this.fields()
    const fields = ids.sprint ? [...LIST_FIELDS, ids.sprint] : LIST_FIELDS
    const { body } = await this.get(
      this.api.searchUrl(this.config.baseUrl, jql, fields, MAX_RESULTS),
    )
    const issues = obj(body).issues
    if (!Array.isArray(issues)) throw badResponse('search results')
    return issues.map((raw) => normaliseIssue(asIssue(raw), this.config.baseUrl, ids))
  }

  /** Issues in the board's active sprint(s), via the Agile API + a JQL search. */
  async sprintIssues(boardId: number): Promise<JiraIssue[]> {
    const { body } = await this.get(
      `${this.config.baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active`,
    ).catch((err: unknown) => {
      throw boardError(err, boardId)
    })
    const values = obj(body).values
    if (!Array.isArray(values)) throw badResponse('sprint list')
    const ids = values.map((v) => obj(v).id).filter((id) => Number.isInteger(id))
    if (ids.length === 0) return []
    return this.search(`sprint in (${ids.join(',')}) ORDER BY Rank ASC`)
  }

  async issue(key: string): Promise<JiraIssueDetail> {
    if (!ISSUE_KEY.test(key)) throw new ServiceError('not_found', `"${key}" is not an issue key.`)
    const ids = await this.fields()
    const fields = [...LIST_FIELDS, 'description']
    if (ids.sprint) fields.push(ids.sprint)
    if (ids.acceptanceCriteria) fields.push(ids.acceptanceCriteria)
    const issueUrl = `${this.config.baseUrl}${this.api.api}/issue/${key}`
    // The comment list embedded in the issue may be paged oldest-first; ask for the newest 10.
    const [issue, comments] = await Promise.all([
      this.get(`${issueUrl}?fields=${fields.join(',')}`),
      this.get(`${issueUrl}/comment?orderBy=-created&maxResults=10`),
    ])
    return normaliseDetail(
      asIssue(issue.body),
      this.config.baseUrl,
      ids,
      this.api.richText,
      comments.body,
    )
  }

  /**
   * Moves the issue to "In Progress" if the workflow offers that transition from its current
   * status (SPEC 6.5 step 6). Matches the transition's name or its target status, case-insensitive.
   */
  async transitionToInProgress(key: string): Promise<'done' | 'unavailable'> {
    if (!ISSUE_KEY.test(key)) throw new ServiceError('not_found', `"${key}" is not an issue key.`)
    const url = `${this.config.baseUrl}${this.api.api}/issue/${key}/transitions`
    const { body } = await this.get(url)
    const list = obj(body).transitions
    if (!Array.isArray(list)) throw badResponse('a transition list')
    const match = list.map(obj).find((t) => {
      const names = [t.name, obj(t.to).name].map((n) => (typeof n === 'string' ? n.trim() : ''))
      return names.some(isInProgress)
    })
    if (!match) return 'unavailable'
    if (typeof match.id !== 'string' && typeof match.id !== 'number') {
      throw badResponse('a transition id')
    }
    await this.send(url, { transition: { id: String(match.id) } })
    return 'done'
  }

  /** Sprint and "Acceptance Criteria" custom field ids, looked up once per client. */
  private fields(): Promise<FieldIds> {
    this.fieldIds ??= this.get(`${this.config.baseUrl}${this.api.api}/field`).then(
      ({ body }) => {
        const list = Array.isArray(body) ? body.map(obj) : []
        const find = (pred: (f: JsonObject) => boolean) => {
          const id = list.find(pred)?.id
          return typeof id === 'string' ? id : null
        }
        return {
          sprint: find((f) => obj(f.schema).custom === SPRINT_SCHEMA),
          acceptanceCriteria: find(
            (f) => typeof f.name === 'string' && /^acceptance criteria$/i.test(f.name.trim()),
          ),
        }
      },
      (err: unknown) => {
        this.fieldIds = null // retry next time
        throw err
      },
    )
    return this.fieldIds
  }

  private get(url: string): Promise<{ status: number; body: unknown }> {
    return this.send(url)
  }

  private send(url: string, post?: unknown): Promise<{ status: number; body: unknown }> {
    return requestJson(
      this.http,
      {
        service: 'Jira',
        authorization: this.api.authorization(this.config),
        hints: this.api.hints,
        timeoutMs: this.timeoutMs,
      },
      url,
      { body: post },
    )
  }
}

function asIssue(v: unknown): RawIssue {
  const o = obj(v)
  if (typeof o.key !== 'string') throw badResponse('an issue')
  return { key: o.key, fields: obj(o.fields) }
}

const badResponse = (what: string) =>
  new ServiceError('bad_response', `Jira didn't return ${what}.`)

/** The Agile API answers 400 for boards without sprints (Kanban) and 404 for unknown boards. */
function boardError(err: unknown, boardId: number): unknown {
  if (!(err instanceof ServiceError)) return err
  if (err.status === 400) {
    return new ServiceError(
      'not_configured',
      `Board ${boardId} has no sprints (is it a Kanban board?). Use a Scrum board id in Settings → Jira.`,
      { status: 400, details: err.details },
    )
  }
  if (err.status === 404) {
    return new ServiceError(
      'not_found',
      `Board ${boardId} wasn't found, or you can't see it. Check the board id in Settings → Jira.`,
      { status: 404, details: err.details },
    )
  }
  return err
}
