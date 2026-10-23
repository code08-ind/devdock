import { describe, expect, it } from 'vitest'
import { JiraClient, type JiraConfig } from '../../src/main/services/jira/client'
import { ServiceError } from '../../src/main/services/service-error'
import {
  CLOUD_BASE,
  DC_BASE,
  ScriptedHttp,
  cloud,
  dc,
  json,
  on,
  type Route,
} from '../fixtures/jira'

const CLOUD: JiraConfig = {
  flavor: 'cloud',
  baseUrl: CLOUD_BASE,
  email: 'ada@example.com',
  token: 'cloud-token',
}
const DC: JiraConfig = { flavor: 'datacenter', baseUrl: DC_BASE, email: '', token: 'dc-pat' }

const cloudRoutes: Route[] = [
  on('/rest/api/3/myself', () => json(cloud.myself)),
  on('/rest/api/3/field', () => json(cloud.fields)),
  on('/rest/api/3/search/jql', () => json({ issues: [cloud.issue], isLast: true })),
  on('/rest/api/3/issue/NM-1234/comment', () => json(cloud.comments)),
  on('/rest/api/3/issue/NM-1234', () => json(cloud.issue)),
]
const dcRoutes: Route[] = [
  on('/rest/api/2/myself', () => json(dc.myself)),
  on('/rest/api/2/field', () => json(dc.fields)),
  on('/rest/api/2/search', () =>
    json({ startAt: 0, maxResults: 50, total: 1, issues: [dc.issue] }),
  ),
  on('/rest/api/2/issue/OPS-77/comment', () => json(dc.comments)),
  on('/rest/api/2/issue/OPS-77', () => json(dc.issue)),
]

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

describe('Jira Cloud adapter (REST v3)', () => {
  it('Test connection: Basic auth with email + token, reports the user', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    const r = await new JiraClient(http, CLOUD).myself()
    expect(r).toEqual({
      flavor: 'cloud',
      status: 200,
      user: { displayName: 'Ada Example', account: 'ada@example.com' },
    })
    const req = http.requests[0]!
    expect(req.url).toBe(`${CLOUD_BASE}/rest/api/3/myself`)
    expect(req.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('ada@example.com:cloud-token').toString('base64')}`,
    )
    expect(req.headers.get('accept')).toBe('application/json')
  })

  it('searches with /search/jql, asks for the discovered sprint field, normalises issues', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    const [issue] = await new JiraClient(http, CLOUD).search('assignee = currentUser()')
    const url = new URL(http.requests.at(-1)!.url)
    expect(url.pathname).toBe('/rest/api/3/search/jql')
    expect(url.searchParams.get('jql')).toBe('assignee = currentUser()')
    expect(url.searchParams.get('fields')!.split(',')).toContain('customfield_10020')
    expect(url.searchParams.get('maxResults')).toBe('50')
    expect(issue).toEqual({
      key: 'NM-1234',
      url: `${CLOUD_BASE}/browse/NM-1234`,
      type: 'Story',
      priority: 'Medium',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      summary: 'Show saved cards on the profile page',
      sprint: 'Sprint 42',
      fixVersions: ['2.5.0'],
      assignee: 'Ada Example',
      updated: '2026-10-20T10:15:30.000+0100',
    })
  })

  it('issue detail: ADF → Markdown, acceptance criteria section, Figma link, comments', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    const d = await new JiraClient(http, CLOUD).issue('NM-1234')
    expect(d.description).toBe(
      'Customers want to manage cards.\n\nDesign: <https://www.figma.com/file/AbC123/Profile>\n\n## Acceptance Criteria\n\n- Cards are listed',
    )
    expect(d.acceptanceCriteria).toBe('- Cards are listed')
    expect(d.links).toEqual([{ kind: 'figma', url: 'https://www.figma.com/file/AbC123/Profile' }])
    expect(d.comments).toEqual([
      { author: 'Pat Example', created: '2026-10-19T09:00:00.000+0100', body: '**LGTM**' },
    ])
  })

  it('looks up custom fields once per client', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    const client = new JiraClient(http, CLOUD)
    await client.search('x')
    await client.issue('NM-1234')
    await client.search('y')
    expect(http.paths().filter((p) => p.endsWith('/field'))).toHaveLength(1)
  })

  it('current sprint: active sprint ids from the Agile API, then a JQL search', async () => {
    const http = new ScriptedHttp([
      on('/rest/agile/1.0/board/3/sprint', (r) => {
        expect(new URL(r.url).searchParams.get('state')).toBe('active')
        return json({
          maxResults: 50,
          isLast: true,
          values: [
            { id: 12, state: 'active' },
            { id: 13, state: 'active' },
          ],
        })
      }),
      ...cloudRoutes,
    ])
    const issues = await new JiraClient(http, CLOUD).sprintIssues(3)
    expect(issues.map((i) => i.key)).toEqual(['NM-1234'])
    expect(new URL(http.requests.at(-1)!.url).searchParams.get('jql')).toBe(
      'sprint in (12,13) ORDER BY Rank ASC',
    )
  })

  it('no active sprint → empty list without a search', async () => {
    const http = new ScriptedHttp([on('/sprint', () => json({ values: [] })), ...cloudRoutes])
    expect(await new JiraClient(http, CLOUD).sprintIssues(3)).toEqual([])
    expect(http.paths().some((p) => p.includes('/search'))).toBe(false)
  })
})

describe('Jira Data Center adapter (REST v2)', () => {
  it('Test connection: PAT as Bearer, reports the user name', async () => {
    const http = new ScriptedHttp(dcRoutes)
    const r = await new JiraClient(http, DC).myself()
    expect(r).toEqual({
      flavor: 'datacenter',
      status: 200,
      user: { displayName: 'Jo Doe', account: 'jdoe' },
    })
    expect(http.requests[0]!.url).toBe(`${DC_BASE}/rest/api/2/myself`)
    expect(http.requests[0]!.headers.get('authorization')).toBe('Bearer dc-pat')
  })

  it('searches /rest/api/2/search and parses legacy sprint strings (active wins)', async () => {
    const http = new ScriptedHttp(dcRoutes)
    const [issue] = await new JiraClient(http, DC).search('project = OPS')
    expect(new URL(http.requests.at(-1)!.url).pathname).toBe('/rest/api/2/search')
    expect(issue).toMatchObject({
      key: 'OPS-77',
      type: 'Bug',
      priority: 'Highest',
      statusCategory: 'new',
      sprint: 'Ops 7',
      assignee: null,
      fixVersions: [],
    })
  })

  it('issue detail: wiki → Markdown, AC from the custom field, Confluence link, last 10 comments', async () => {
    const http = new ScriptedHttp(dcRoutes)
    const d = await new JiraClient(http, DC).issue('OPS-77')
    expect(d.description).toBe(
      '## Steps\n1. Set a PAC file\n1. Log in\n\nSee [runbook](https://wiki.example.com/confluence/display/OPS/Proxy) and `net::ERR_PROXY`.',
    )
    expect(d.acceptanceCriteria).toBe('- Login works via proxy\n- Error names the proxy')
    expect(d.links).toEqual([
      { kind: 'confluence', url: 'https://wiki.example.com/confluence/display/OPS/Proxy' },
    ])
    expect(d.comments).toHaveLength(10)
    expect(d.comments[0]).toEqual({
      author: 'Jo Doe',
      created: '2026-10-03T08:00:00.000+0000',
      body: 'comment **3**',
    })
    expect(d.comments.at(-1)!.body).toBe('comment **12**')
    const issueReq = http.requests.find((r) => new URL(r.url).pathname.endsWith('/issue/OPS-77'))!
    const fields = new URL(issueReq.url).searchParams.get('fields')!.split(',')
    expect(fields).toEqual(
      expect.arrayContaining(['description', 'customfield_10104', 'customfield_10300']),
    )
  })
})

describe.each([
  ['Cloud', CLOUD, '/rest/api/3/myself'],
  ['Data Center', DC, '/rest/api/2/myself'],
] as const)('%s error handling', (_name, config, path) => {
  const respond = (res: () => Response) =>
    new JiraClient(new ScriptedHttp([on(path, res)]), config).myself()
  const reject = (err: unknown) =>
    new JiraClient(new ScriptedHttp([() => Promise.reject(err)]), config).myself()

  it('401 → auth, with a hint about the token', async () => {
    const e = await failure(
      respond(() => json({ errorMessages: ['Unauthorized'] }, { status: 401 })),
    )
    expect(e).toMatchObject({ kind: 'auth', status: 401 })
    expect(e.message).toMatch(/401.*token/s)
    expect(e.details).toContain('Unauthorized')
  })

  it('403 → forbidden, with a hint about permissions and auth type', async () => {
    const e = await failure(respond(() => new Response('Forbidden', { status: 403 })))
    expect(e).toMatchObject({ kind: 'forbidden', status: 403 })
    expect(e.message).toMatch(/permission/)
  })

  it('404 → not_found, pointing at the base URL', async () => {
    const e = await failure(respond(() => new Response('', { status: 404 })))
    expect(e).toMatchObject({ kind: 'not_found', status: 404 })
    expect(e.message).toMatch(/base URL/)
  })

  it('429 with Retry-After seconds → rate_limited with the wait', async () => {
    const e = await failure(
      respond(() => new Response('', { status: 429, headers: { 'Retry-After': '30' } })),
    )
    expect(e).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSec: 30 })
    expect(e.message).toMatch(/in 30 s/)
  })

  it('429 with an HTTP-date Retry-After, and without one', async () => {
    const at = new Date(Date.now() + 90_000).toUTCString()
    const e = await failure(
      respond(() => new Response('', { status: 429, headers: { 'Retry-After': at } })),
    )
    expect(e.retryAfterSec).toBeGreaterThanOrEqual(88)
    expect(e.retryAfterSec).toBeLessThanOrEqual(90)
    const none = await failure(respond(() => new Response('', { status: 429 })))
    expect(none.retryAfterSec).toBeUndefined()
    expect(none.message).toMatch(/try again later/i)
  })

  it('5xx → server', async () => {
    expect(await failure(respond(() => new Response('', { status: 503 })))).toMatchObject({
      kind: 'server',
      status: 503,
    })
  })

  it('a non-JSON 200 (proxy block or login page) → bad_response', async () => {
    const e = await failure(respond(() => new Response('<html>Sign in</html>', { status: 200 })))
    expect(e.kind).toBe('bad_response')
    expect(e.message).toMatch(/proxy or login page/)
  })

  it.each([
    ['net::ERR_PROXY_CONNECTION_FAILED', 'proxy'],
    ['net::ERR_TUNNEL_CONNECTION_FAILED', 'proxy'],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'certificate'],
    ['net::ERR_CERT_DATE_INVALID', 'certificate'],
    ['net::ERR_NAME_NOT_RESOLVED', 'network'],
    ['net::ERR_CONNECTION_REFUSED', 'network'],
    ['net::ERR_TIMED_OUT', 'timeout'],
  ])('Electron net error %s → %s', async (message, kind) => {
    expect((await failure(reject(new Error(message)))).kind).toBe(kind)
  })

  it('Node-style failures: certificate cause code, timeout abort', async () => {
    const cert = new TypeError('fetch failed', {
      cause: Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      }),
    })
    expect((await failure(reject(cert))).kind).toBe('certificate')
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect((await failure(reject(timeout))).kind).toBe('timeout')
  })

  it('certificate and proxy messages carry the fix', async () => {
    expect((await failure(reject(new Error('net::ERR_CERT_AUTHORITY_INVALID')))).message).toMatch(
      /root certificate/,
    )
    expect((await failure(reject(new Error('net::ERR_PROXY_CONNECTION_FAILED')))).message).toMatch(
      /proxy/,
    )
  })
})

it('refuses a malformed issue key without making a request', async () => {
  const http = new ScriptedHttp(cloudRoutes)
  const e = await failure(new JiraClient(http, CLOUD).issue('NM-1/../../admin'))
  expect(e.kind).toBe('not_found')
  expect(http.requests).toHaveLength(0)
})

describe('review fixes', () => {
  it('asks for the newest 10 comments and shows them oldest first', async () => {
    const http = new ScriptedHttp(dcRoutes)
    const d = await new JiraClient(http, DC).issue('OPS-77')
    const req = http.requests.find((r) => r.url.includes('/comment'))!
    expect(new URL(req.url).searchParams.get('orderBy')).toBe('-created')
    expect(new URL(req.url).searchParams.get('maxResults')).toBe('10')
    expect(d.comments.map((c) => c.body)).toEqual(
      Array.from({ length: 10 }, (_, i) => `comment **${i + 3}**`),
    )
  })

  it('407 from a proxy → proxy, with the proxy hint', async () => {
    const http = new ScriptedHttp([() => new Response('', { status: 407 })])
    const e = await failure(new JiraClient(http, CLOUD).myself())
    expect(e).toMatchObject({ kind: 'proxy', status: 407 })
    expect(e.message).toMatch(/407.*proxy settings/s)
  })

  it("401/403 hints use the flavour's auth terms", async () => {
    const res = (status: number) => () => new Response('', { status })
    const msg = async (config: JiraConfig, status: number) =>
      (await failure(new JiraClient(new ScriptedHttp([res(status)]), config).myself())).message
    expect(await msg(CLOUD, 401)).toMatch(/account email and API token/)
    expect(await msg(DC, 401)).toMatch(/personal access token/)
    expect(await msg(DC, 401)).not.toMatch(/email/)
    expect(await msg(CLOUD, 403)).toMatch(/not your password/)
    expect(await msg(DC, 403)).toMatch(/Bearer/)
  })

  it('a Kanban board (400) or unknown board (404) gets an explanation', async () => {
    const board = (status: number) =>
      new JiraClient(
        new ScriptedHttp([
          on('/sprint', () =>
            json({ errorMessages: ['The board does not support sprints'] }, { status }),
          ),
        ]),
        CLOUD,
      ).sprintIssues(9)
    const kanban = await failure(board(400))
    expect(kanban).toMatchObject({ kind: 'not_configured', status: 400 })
    expect(kanban.message).toMatch(/Kanban/)
    expect((await failure(board(404))).message).toMatch(/Board 9 wasn't found/)
  })

  it('error details are redacted before they leave the main process', async () => {
    const body = 'echo: Authorization: Bearer abc.def.ghi https://x.test/?token=s3cret'
    const http = new ScriptedHttp([() => new Response(body, { status: 500 })])
    const e = await failure(new JiraClient(http, DC).myself())
    expect(e.details).not.toContain('abc.def.ghi')
    expect(e.details).not.toContain('s3cret')
    expect(e.details).toContain('[REDACTED]')
  })
})

it('refuses an issue whose key from the server is not a valid key (it becomes a file path)', async () => {
  const evil = { ...cloud.issue, key: '../../../.zshrc' }
  const http = new ScriptedHttp([
    on('/rest/api/3/field', () => json(cloud.fields)),
    on('/rest/api/3/search/jql', () => json({ issues: [evil] })),
  ])
  const e = await failure(new JiraClient(http, CLOUD).search('x'))
  expect(e.kind).toBe('bad_response')
})
