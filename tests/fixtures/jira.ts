import type { HttpClient } from '../../src/main/services/http'

/**
 * Recorded-style Jira payloads (trimmed to the fields DevDock asks for) and a scripted
 * HttpClient that records every request.
 */

export const CLOUD_BASE = 'https://acme-example.atlassian.net'
export const DC_BASE = 'https://jira.example.com'

export const cloud = {
  myself: {
    self: `${CLOUD_BASE}/rest/api/3/user?accountId=5b10ac8d82e05b22cc7d4ef5`,
    accountId: '5b10ac8d82e05b22cc7d4ef5',
    emailAddress: 'ada@example.com',
    displayName: 'Ada Example',
    active: true,
    timeZone: 'Europe/London',
  },
  fields: [
    {
      id: 'summary',
      name: 'Summary',
      custom: false,
      schema: { type: 'string', system: 'summary' },
    },
    {
      id: 'customfield_10020',
      name: 'Sprint',
      custom: true,
      schema: {
        type: 'array',
        items: 'json',
        custom: 'com.pyxis.greenhopper.jira:gh-sprint',
        customId: 10020,
      },
    },
  ],
  issue: {
    id: '10042',
    key: 'NM-1234',
    self: `${CLOUD_BASE}/rest/api/3/issue/10042`,
    fields: {
      summary: 'Show saved cards on the profile page',
      issuetype: { id: '10001', name: 'Story', subtask: false },
      priority: { id: '3', name: 'Medium' },
      status: {
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
      },
      fixVersions: [{ id: '10100', name: '2.5.0', released: false }],
      assignee: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Ada Example' },
      updated: '2026-10-20T10:15:30.000+0100',
      customfield_10020: [
        { id: 11, name: 'Sprint 41', state: 'closed', boardId: 3 },
        { id: 12, name: 'Sprint 42', state: 'active', boardId: 3 },
      ],
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Customers want to manage cards.' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Design: ' },
              { type: 'inlineCard', attrs: { url: 'https://www.figma.com/file/AbC123/Profile' } },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Acceptance Criteria' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Cards are listed' }] },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  /** GET /issue/NM-1234/comment?orderBy=-created&maxResults=10 */
  comments: {
    comments: [
      {
        author: { displayName: 'Pat Example' },
        created: '2026-10-19T09:00:00.000+0100',
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'LGTM', marks: [{ type: 'strong' }] }],
            },
          ],
        },
      },
    ],
    maxResults: 1,
    total: 1,
    startAt: 0,
  },
}

export const dc = {
  myself: {
    self: `${DC_BASE}/rest/api/2/user?username=jdoe`,
    key: 'JIRAUSER10100',
    name: 'jdoe',
    emailAddress: 'jdoe@example.com',
    displayName: 'Jo Doe',
    active: true,
  },
  fields: [
    {
      id: 'customfield_10104',
      name: 'Sprint',
      custom: true,
      schema: {
        type: 'array',
        items: 'string',
        custom: 'com.pyxis.greenhopper.jira:gh-sprint',
        customId: 10104,
      },
    },
    {
      id: 'customfield_10300',
      name: 'Acceptance Criteria',
      custom: true,
      schema: {
        type: 'string',
        custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea',
      },
    },
  ],
  issue: {
    id: '20001',
    key: 'OPS-77',
    fields: {
      summary: 'Login fails behind the corporate proxy',
      issuetype: { name: 'Bug' },
      priority: { name: 'Highest' },
      status: { name: 'Open', statusCategory: { key: 'new' } },
      fixVersions: [],
      assignee: null,
      updated: '2026-10-21T08:00:00.000+0000',
      customfield_10104: [
        'com.atlassian.greenhopper.service.sprint.Sprint@1f3a2b[id=7,rapidViewId=2,state=CLOSED,name=Ops 6,startDate=2026-09-01T00:00:00.000Z,endDate=2026-09-14T00:00:00.000Z,sequence=7]',
        'com.atlassian.greenhopper.service.sprint.Sprint@4c5d6e[id=8,rapidViewId=2,state=ACTIVE,name=Ops 7,startDate=2026-10-15T00:00:00.000Z,endDate=<null>,sequence=8]',
      ],
      customfield_10300: '* Login works via proxy\n* Error names the proxy',
      description:
        'h2. Steps\n# Set a PAC file\n# Log in\n\nSee [runbook|https://wiki.example.com/confluence/display/OPS/Proxy] and {{net::ERR_PROXY}}.',
    },
  },
  /** GET /issue/OPS-77/comment?orderBy=-created&maxResults=10: newest 10 of 12, newest first. */
  comments: {
    comments: Array.from({ length: 10 }, (_, i) => {
      const n = 12 - i
      return {
        author: { name: 'jdoe', displayName: 'Jo Doe' },
        created: `2026-10-${String(n).padStart(2, '0')}T08:00:00.000+0000`,
        body: `comment *${n}*`,
      }
    }),
    maxResults: 10,
    total: 12,
    startAt: 0,
  },
}

export type Route = (request: Request) => Response | Promise<Response> | undefined

/** HttpClient answering from routes (first match wins); records each request. */
export class ScriptedHttp implements HttpClient {
  readonly demo = false
  readonly requests: Request[] = []
  constructor(private readonly routes: Route[]) {}
  async fetch(request: Request): Promise<Response> {
    this.requests.push(request)
    for (const route of this.routes) {
      const res = await route(request)
      if (res) return res
    }
    return new Response('no route', { status: 599 })
  }
  paths(): string[] {
    return this.requests.map((r) => new URL(r.url).pathname)
  }
}

/** Route on a path suffix (and optional method). */
export const on =
  (path: string, respond: (r: Request) => Response | Promise<Response>): Route =>
  (r) =>
    new URL(r.url).pathname.endsWith(path) ? respond(r) : undefined

export const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
