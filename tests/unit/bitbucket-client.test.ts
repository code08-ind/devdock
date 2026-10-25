import { describe, expect, it } from 'vitest'
import { BitbucketClient, type BitbucketConfig } from '../../src/main/services/bitbucket/client'
import { mapLimit } from '../../src/main/services/async'
import { detectBitbucket } from '../../src/main/services/bitbucket/detect'
import { ServiceError } from '../../src/main/services/service-error'
import { summariseBuilds } from '../../src/shared/bitbucket'
import {
  CLOUD_API,
  DC_BASE,
  ME_UUID,
  ScriptedHttp,
  cloud,
  dc,
  dcPage,
  json,
  type Route,
} from '../fixtures/bitbucket'

const CLOUD: BitbucketConfig = {
  flavor: 'cloud',
  baseUrl: 'https://bitbucket.org',
  username: 'ada@example.com',
  token: 'cloud-token',
}
const DC: BitbucketConfig = {
  flavor: 'datacenter',
  baseUrl: DC_BASE,
  username: '',
  token: 'dc-http-token',
}
const NOW = Date.parse('2026-10-24T12:00:00Z')
const REPOS = [{ owner: 'acme', repo: 'web-app' }]

/** Route on an exact path (query ignored). */
const at =
  (path: string, respond: (r: Request) => Response | Promise<Response>): Route =>
  (r) =>
    new URL(r.url).pathname === path ? respond(r) : undefined

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

// ---- Cloud ------------------------------------------------------------------------------------

const cloudRoutes = (extra: Route[] = []): Route[] => [
  ...extra,
  at('/2.0/user', () => json(cloud.user)),
  at('/2.0/repositories/acme/web-app/pullrequests', () =>
    json({ pagelen: 50, page: 1, size: 1, values: [cloud.pr(42)] }),
  ),
  at('/2.0/repositories/acme/web-app/pullrequests/42', () => json(cloud.pr(42))),
  at('/2.0/repositories/acme/web-app/pullrequests/42/comments', () =>
    json({ pagelen: 100, values: cloud.comments }),
  ),
  at('/2.0/repositories/acme/web-app/commit/a1b2c3d4e5f42/statuses', () =>
    json({ pagelen: 100, values: cloud.statuses }),
  ),
  // Other commits: nothing reported.
  (r) =>
    /\/commit\/[^/]+\/statuses$/.test(new URL(r.url).pathname) ? json({ values: [] }) : undefined,
]

const cloudClient = (http: ScriptedHttp, config = CLOUD, repos = REPOS) =>
  new BitbucketClient(http, config, async () => repos)

describe('Bitbucket Cloud adapter (REST 2.0)', () => {
  it('Test connection: Basic auth with user/email + token against api.bitbucket.org', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    expect(await cloudClient(http).testConnection()).toEqual({
      flavor: 'cloud',
      status: 200,
      user: { displayName: 'Ada Example', account: 'ada' },
    })
    const req = http.requests[0]!
    expect(req.url).toBe(`${CLOUD_API}/user`)
    expect(req.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('ada@example.com:cloud-token').toString('base64')}`,
    )
  })

  it('no user name → the token is an access token, sent as Bearer', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    await cloudClient(http, { ...CLOUD, username: '' }).testConnection()
    expect(http.requests[0]!.headers.get('authorization')).toBe('Bearer cloud-token')
  })

  it('My PRs: per-repo BBQL on the author UUID, participants requested, normalised + build', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    const [pr] = await cloudClient(http).list('mine', NOW)
    const listReq = new URL(http.requests.find((r) => r.url.includes('/pullrequests?'))!.url)
    expect(listReq.searchParams.get('state')).toBe('OPEN')
    expect(listReq.searchParams.get('q')).toBe(`author.uuid="${ME_UUID}"`)
    expect(listReq.searchParams.get('fields')).toBe('+values.participants')
    expect(pr).toEqual({
      key: 'acme/web-app#42',
      ref: { owner: 'acme', repo: 'web-app', id: 42 },
      title: 'Add checkout summary card #42',
      url: 'https://bitbucket.org/acme/web-app/pull-requests/42',
      author: 'Ada Example',
      sourceBranch: 'feature/NM-42-summary-card',
      targetBranch: 'develop',
      state: 'open',
      reviewers: [
        { name: 'Priya Reviewer', status: 'approved' },
        { name: 'Sam Lead', status: 'needs_work' },
      ],
      approvals: 1,
      needsWork: 1,
      comments: 5,
      unresolvedComments: null,
      conflicts: null,
      createdAt: '2026-10-20T09:15:00.000000+00:00',
      updatedAt: '2026-10-23T16:40:12.345678+00:00',
      closedAt: null,
      sourceCommit: 'a1b2c3d4e5f42',
      build: {
        state: 'running',
        statuses: [
          {
            key: 'JENKINS-WEB',
            name: 'web-app » PR-42',
            state: 'success',
            url: 'https://jenkins.example.com/job/web-app/job/PR-42/3/',
          },
          {
            key: 'LINT',
            name: 'lint',
            state: 'running',
            url: 'https://jenkins.example.com/job/lint/9/',
          },
        ],
      },
    })
  })

  it('Reviewing filters on reviewers.uuid; Recently merged on MERGED + updated in 7 days', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    const client = cloudClient(http)
    await client.list('reviewing', NOW)
    await client.list('merged', NOW)
    const lists = http.requests
      .map((r) => new URL(r.url))
      .filter((u) => u.pathname.endsWith('/pullrequests'))
    expect(lists.map((u) => [u.searchParams.get('state'), u.searchParams.get('q')])).toEqual([
      ['OPEN', `reviewers.uuid="${ME_UUID}"`],
      ['MERGED', `author.uuid="${ME_UUID}" AND updated_on >= 2026-10-17T12:00:00.000Z`],
    ])
    // The user is looked up once per client.
    expect(http.paths().filter((p) => p === '/2.0/user')).toHaveLength(1)
  })

  it('pagination: follows `next` on the API origin, refuses a `next` elsewhere', async () => {
    const page2 = `${CLOUD_API}/repositories/acme/web-app/pullrequests?page=2`
    const http = new ScriptedHttp(
      cloudRoutes([
        (r) =>
          r.url === page2
            ? json({
                values: [cloud.pr(44)],
                // A hostile `next` must not receive the token.
                next: 'https://evil.example.com/steal?page=3',
              })
            : undefined,
        at('/2.0/repositories/acme/web-app/pullrequests', () =>
          json({ values: [cloud.pr(42), cloud.pr(43)], next: page2 }),
        ),
      ]),
    )
    const prs = await cloudClient(http).list('mine', NOW)
    expect(prs.map((p) => p.ref.id).sort()).toEqual([42, 43, 44])
    expect(http.requests.some((r) => r.url.includes('evil'))).toBe(false)
  })

  it('pagination stops after 10 pages', async () => {
    let n = 0
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/web-app/pullrequests', () =>
          json({
            values: [cloud.pr(1000 + n)],
            next: `${CLOUD_API}/repositories/acme/web-app/pullrequests?page=${++n + 1}`,
          }),
        ),
      ]),
    )
    expect(await cloudClient(http).list('mine', NOW)).toHaveLength(10)
  })

  it('scans every registered repo; one the token cannot see is skipped, others kept', async () => {
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/secret/pullrequests', () =>
          json({ type: 'error', error: { message: 'Forbidden' } }, { status: 403 }),
        ),
        at('/2.0/repositories/acme/gone/pullrequests', () => json({}, { status: 404 })),
      ]),
    )
    const prs = await cloudClient(http, CLOUD, [
      ...REPOS,
      { owner: 'acme', repo: 'secret' },
      { owner: 'acme', repo: 'gone' },
    ]).list('mine', NOW)
    expect(prs.map((p) => p.key)).toEqual(['acme/web-app#42'])
  })

  it('a 401 on any repo fails the list (it is the credentials, not the repo)', async () => {
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/web-app/pullrequests', () => json({}, { status: 401 })),
      ]),
    )
    const err = await failure(cloudClient(http).list('mine', NOW))
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/Bitbucket rejected the credentials \(401\).*user name or email/)
  })

  it('no Cloud repos registered → not_configured, before any PR request', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    const err = await failure(cloudClient(http, CLOUD, []).list('mine', NOW))
    expect(err.kind).toBe('not_configured')
    expect(err.message).toMatch(/bitbucket\.org remote in Repos/)
    expect(http.paths().some((p) => p.includes('pullrequests'))).toBe(false)
  })

  it('one PR: unresolved = top-level, not deleted, not resolved', async () => {
    const http = new ScriptedHttp(cloudRoutes())
    const pr = await cloudClient(http).pr({ owner: 'acme', repo: 'web-app', id: 42 })
    // 1 (open) + 5 (inline, open); 2 is a reply, 3 resolved, 4 deleted.
    expect(pr.unresolvedComments).toBe(2)
    expect(pr.build.state).toBe('running')
  })

  it('merged/declined PRs carry a close time; SUPERSEDED reads as declined', async () => {
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/web-app/pullrequests', () =>
          json({
            values: [
              cloud.pr(50, { state: 'MERGED' }),
              cloud.pr(51, { state: 'SUPERSEDED', updated_on: '2026-10-22T00:00:00Z' }),
            ],
          }),
        ),
      ]),
    )
    const prs = await cloudClient(http).list('merged', NOW)
    expect(prs.map((p) => [p.ref.id, p.state, p.closedAt])).toEqual([
      [50, 'merged', '2026-10-23T16:40:12.345678+00:00'],
      [51, 'declined', '2026-10-22T00:00:00Z'],
    ])
  })

  it('a PR without build statuses (404 on the commit) has build "none"', async () => {
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/web-app/commit/a1b2c3d4e5f42/statuses', () =>
          json({}, { status: 404 }),
        ),
      ]),
    )
    const [pr] = await cloudClient(http).list('mine', NOW)
    expect(pr!.build).toEqual({ state: 'none', statuses: [] })
  })

  it.each([
    ['a traversal in full_name', { destination: { repository: { full_name: 'acme/..' } } }],
    [
      'a slash-free full_name with odd chars',
      { destination: { repository: { full_name: 'acme/a b' } } },
    ],
    ['a non-integer id', { id: '42' }],
  ])('refuses a PR with %s before using it in a URL', async (_label, overrides) => {
    const http = new ScriptedHttp(
      cloudRoutes([
        at('/2.0/repositories/acme/web-app/pullrequests', () =>
          json({ values: [cloud.pr(42, overrides)] }),
        ),
      ]),
    )
    expect((await failure(cloudClient(http).list('mine', NOW))).kind).toBe('bad_response')
    expect(http.paths().some((p) => p.includes('/commit/'))).toBe(false)
  })

  it('refuses a user UUID that is not a UUID (it goes into a query)', async () => {
    const http = new ScriptedHttp(
      cloudRoutes([at('/2.0/user', () => json({ ...cloud.user, uuid: '" OR 1=1' }))]),
    )
    expect((await failure(cloudClient(http).list('mine', NOW))).kind).toBe('bad_response')
  })
})

// ---- Data Center ------------------------------------------------------------------------------

const dcRoutes = (extra: Route[] = []): Route[] => [
  ...extra,
  at('/rest/api/1.0/application-properties', (r) =>
    json(dc.applicationProperties, {
      headers: r.headers.get('authorization') ? { 'X-AUSERNAME': 'ada' } : {},
    }),
  ),
  at('/rest/api/1.0/users/ada', () => json(dc.user)),
  at('/rest/api/1.0/dashboard/pull-requests', () => json(dcPage([dc.pr(7)]))),
  at('/rest/api/1.0/projects/PROJ/repos/web-app/pull-requests/7', () => json(dc.pr(7))),
  at('/rest/api/1.0/projects/PROJ/repos/web-app/pull-requests/7/activities', () =>
    json(dcPage(dc.activities)),
  ),
  at('/rest/build-status/1.0/commits/0123456789abcdef0123456789abcdef01237', () =>
    json(dcPage(dc.builds)),
  ),
  (r) =>
    new URL(r.url).pathname.startsWith('/rest/build-status/1.0/commits/')
      ? json(dcPage([]))
      : undefined,
]

const dcClient = (http: ScriptedHttp) => new BitbucketClient(http, DC, async () => [])

describe('Bitbucket Data Center adapter (REST 1.0)', () => {
  it('Test connection: Bearer token; the user comes from X-AUSERNAME', async () => {
    const http = new ScriptedHttp(dcRoutes())
    expect(await dcClient(http).testConnection()).toEqual({
      flavor: 'datacenter',
      status: 200,
      user: { displayName: 'Ada Example', account: 'ada' },
    })
    expect(http.requests[0]!.headers.get('authorization')).toBe('Bearer dc-http-token')
    expect(http.paths()).toEqual([
      '/rest/api/1.0/application-properties',
      '/rest/api/1.0/users/ada',
    ])
  })

  it('Test connection: an unreadable user page leaves the name; a network failure does not', async () => {
    const hidden = new ScriptedHttp(
      dcRoutes([at('/rest/api/1.0/users/ada', () => json({}, { status: 404 }))]),
    )
    expect((await dcClient(hidden).testConnection()).user).toEqual({
      displayName: 'ada',
      account: 'ada',
    })
    const down = new ScriptedHttp(
      dcRoutes([at('/rest/api/1.0/users/ada', () => json({}, { status: 503 }))]),
    )
    expect((await failure(dcClient(down).testConnection())).kind).toBe('server')
  })

  it('a token the server ignores (anonymous answer) is an auth failure', async () => {
    const http = new ScriptedHttp(
      dcRoutes([at('/rest/api/1.0/application-properties', () => json(dc.applicationProperties))]),
    )
    const err = await failure(dcClient(http).testConnection())
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/not as a signed-in user.*HTTP access token/)
  })

  it('lists use the dashboard: AUTHOR/REVIEWER role, OPEN/MERGED state, closedSince 7 days', async () => {
    const http = new ScriptedHttp(dcRoutes())
    const client = dcClient(http)
    await client.list('mine', NOW)
    await client.list('reviewing', NOW)
    await client.list('merged', NOW)
    const params = http.requests
      .map((r) => new URL(r.url))
      .filter((u) => u.pathname.endsWith('/dashboard/pull-requests'))
      .map((u) => Object.fromEntries(u.searchParams))
    expect(params).toEqual([
      { role: 'AUTHOR', state: 'OPEN', order: 'NEWEST', limit: '50' },
      { role: 'REVIEWER', state: 'OPEN', order: 'NEWEST', limit: '50' },
      { role: 'AUTHOR', state: 'MERGED', order: 'NEWEST', limit: '50', closedSince: '604800' },
    ])
  })

  it('normalises: reviewers + voting participants, conflicts from mergeResult, build summary', async () => {
    const http = new ScriptedHttp(dcRoutes())
    const [pr] = await dcClient(http).list('mine', NOW)
    expect(pr).toEqual({
      key: 'proj/web-app#7',
      ref: { owner: 'PROJ', repo: 'web-app', id: 7 },
      title: 'Fix date picker focus #7',
      url: `${DC_BASE}/projects/PROJ/repos/web-app/pull-requests/7`,
      author: 'Ada Example',
      sourceBranch: 'bugfix/OPS-7-focus',
      targetBranch: 'develop',
      state: 'open',
      reviewers: [
        { name: 'Priya Reviewer', status: 'approved' },
        { name: 'Sam Lead', status: 'unapproved' },
        { name: 'Lee QA', status: 'needs_work' },
      ],
      approvals: 1,
      needsWork: 1,
      comments: 6,
      unresolvedComments: null,
      conflicts: true,
      createdAt: '2026-10-21T08:00:00.000Z',
      updatedAt: '2026-10-23T12:30:00.000Z',
      closedAt: null,
      sourceCommit: '0123456789abcdef0123456789abcdef01237',
      build: {
        state: 'failed',
        statuses: [
          {
            key: 'WEB-PR',
            name: 'web-app » PR-7',
            state: 'failed',
            url: 'https://jenkins.example.com/job/web-app/job/PR-7/5/',
          },
          { key: 'SONAR', name: 'Sonar', state: 'success', url: 'https://sonar.example.com/x' },
        ],
      },
    })
  })

  it('pagination: `start=nextPageStart` until isLastPage', async () => {
    const http = new ScriptedHttp(
      dcRoutes([
        at('/rest/api/1.0/dashboard/pull-requests', (r) => {
          const start = new URL(r.url).searchParams.get('start')
          if (start === null) return json(dcPage([dc.pr(1), dc.pr(2)], 2))
          if (start === '2') return json(dcPage([dc.pr(3)], 3))
          return json(dcPage([dc.pr(4)]))
        }),
      ]),
    )
    const prs = await dcClient(http).list('mine', NOW)
    expect(prs.map((p) => p.ref.id).sort()).toEqual([1, 2, 3, 4])
    const starts = http.requests
      .filter((r) => r.url.includes('/dashboard/'))
      .map((r) => new URL(r.url).searchParams.get('start'))
    expect(starts).toEqual([null, '2', '3'])
  })

  it('Recently merged keeps only PRs closed in the last 7 days, newest first', async () => {
    const closed = (id: number, iso: string) =>
      dc.pr(id, { state: 'MERGED', closedDate: Date.parse(iso), updatedDate: Date.parse(iso) })
    const http = new ScriptedHttp(
      dcRoutes([
        at('/rest/api/1.0/dashboard/pull-requests', () =>
          json(
            dcPage([
              closed(1, '2026-10-23T09:00:00Z'),
              closed(2, '2026-10-10T09:00:00Z'), // too old
              closed(3, '2026-10-24T08:00:00Z'),
            ]),
          ),
        ),
      ]),
    )
    const prs = await dcClient(http).list('merged', NOW)
    expect(prs.map((p) => [p.ref.id, p.state, p.closedAt])).toEqual([
      [3, 'merged', '2026-10-24T08:00:00.000Z'],
      [1, 'merged', '2026-10-23T09:00:00.000Z'],
    ])
  })

  it('one PR: unresolved threads from the activity stream (threadResolved)', async () => {
    const http = new ScriptedHttp(dcRoutes())
    const pr = await dcClient(http).pr({ owner: 'PROJ', repo: 'web-app', id: 7 })
    expect(pr.unresolvedComments).toBe(2)
  })

  it('one PR on a server without thread resolution → unresolved unknown (null)', async () => {
    const http = new ScriptedHttp(
      dcRoutes([
        at('/rest/api/1.0/projects/PROJ/repos/web-app/pull-requests/7/activities', () =>
          json(
            dcPage([{ id: 1, action: 'COMMENTED', commentAction: 'ADDED', comment: { id: 1 } }]),
          ),
        ),
      ]),
    )
    const pr = await dcClient(http).pr({ owner: 'PROJ', repo: 'web-app', id: 7 })
    expect(pr.unresolvedComments).toBeNull()
  })

  it('personal repos use the ~user project key in the path', async () => {
    const http = new ScriptedHttp(
      dcRoutes([
        at('/rest/api/1.0/projects/~ada/repos/dotfiles/pull-requests/3', () =>
          json(
            dc.pr(3, {
              toRef: {
                displayId: 'main',
                repository: { slug: 'dotfiles', project: { key: '~ADA', type: 'PERSONAL' } },
              },
            }),
          ),
        ),
        at('/rest/api/1.0/projects/~ada/repos/dotfiles/pull-requests/3/activities', () =>
          json(dcPage([])),
        ),
      ]),
    )
    const pr = await dcClient(http).pr({ owner: '~ada', repo: 'dotfiles', id: 3 })
    // Same key as the parsed link `/users/ada/…` (owner `~ada`).
    expect(pr.key).toBe('~ada/dotfiles#3')
    expect(pr.unresolvedComments).toBe(0)
  })

  it.each([
    [401, 'auth', /rejected the credentials \(401\).*HTTP access token/],
    [403, 'forbidden', /refused access \(403\).*Bearer/],
    [500, 'server', /HTTP 500/],
  ] as const)('HTTP %i → %s with the DC hint', async (status, kind, message) => {
    const http = new ScriptedHttp(
      dcRoutes([
        at('/rest/api/1.0/dashboard/pull-requests', () => json({ errors: [] }, { status })),
      ]),
    )
    const err = await failure(dcClient(http).list('mine', NOW))
    expect(err.kind).toBe(kind)
    expect(err.message).toMatch(message)
  })

  it('429 carries Retry-After', async () => {
    const http = new ScriptedHttp(
      dcRoutes([
        at(
          '/rest/api/1.0/dashboard/pull-requests',
          () => new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }),
        ),
      ]),
    )
    const err = await failure(dcClient(http).list('mine', NOW))
    expect(err).toMatchObject({ kind: 'rate_limited', retryAfterSec: 30 })
  })

  it('a login page instead of JSON is a bad_response', async () => {
    const http = new ScriptedHttp(
      dcRoutes([
        at(
          '/rest/api/1.0/dashboard/pull-requests',
          () => new Response('<html>Log in</html>', { headers: { 'content-type': 'text/html' } }),
        ),
      ]),
    )
    expect((await failure(dcClient(http).list('mine', NOW))).kind).toBe('bad_response')
  })
})

// ---- Detect, helpers ----------------------------------------------------------------------------

describe('Detect (base-URL probe)', () => {
  it('bitbucket.org is Cloud without a request', async () => {
    const http = new ScriptedHttp([])
    expect(await detectBitbucket(http, 'https://bitbucket.org')).toEqual({
      flavor: 'cloud',
      version: null,
    })
    expect(http.requests).toHaveLength(0)
  })

  it('a Data Center server answers application-properties (no credentials sent)', async () => {
    const http = new ScriptedHttp(dcRoutes())
    expect(await detectBitbucket(http, DC_BASE)).toEqual({
      flavor: 'datacenter',
      version: '8.19.1',
    })
    expect(http.requests[0]!.url).toBe(`${DC_BASE}/rest/api/1.0/application-properties`)
    expect(http.requests[0]!.headers.get('authorization')).toBeNull()
  })

  it.each([401, 403])(
    'a server that wants a login for application-properties (%i) is Data Center',
    async (status) => {
      const http = new ScriptedHttp([
        at('/rest/api/1.0/application-properties', () => json({}, { status })),
      ])
      expect(await detectBitbucket(http, DC_BASE)).toEqual({ flavor: 'datacenter', version: null })
    },
  )

  it.each([
    ['404', () => json({}, { status: 404 })],
    ['an HTML page', () => new Response('<html>Jenkins</html>')],
    ['JSON from something else', () => json({ version: '2.4', displayName: 'Jenkins' })],
  ])('%s → "doesn\'t look like Bitbucket"', async (_label, respond) => {
    const http = new ScriptedHttp([at('/rest/api/1.0/application-properties', respond)])
    const err = await failure(detectBitbucket(http, 'https://ci.example.com'))
    expect(err.kind).toBe('not_found')
    expect(err.message).toMatch(/doesn't look like Bitbucket/)
  })

  it('network failures keep their own hint', async () => {
    const http = {
      demo: false,
      fetch: () => Promise.reject(new Error('net::ERR_CERT_AUTHORITY_INVALID')),
    }
    expect((await failure(detectBitbucket(http, DC_BASE))).kind).toBe('certificate')
  })
})

describe('helpers', () => {
  it('summariseBuilds: failed > running > stopped > success > none', () => {
    const s = (state: 'success' | 'failed' | 'running' | 'stopped' | 'none') => ({
      key: state,
      name: state,
      state,
      url: null,
    })
    expect(summariseBuilds([]).state).toBe('none')
    expect(summariseBuilds([s('success'), s('none')]).state).toBe('success')
    expect(summariseBuilds([s('success'), s('stopped')]).state).toBe('stopped')
    expect(summariseBuilds([s('stopped'), s('running')]).state).toBe('running')
    expect(summariseBuilds([s('running'), s('failed'), s('success')]).state).toBe('failed')
  })

  it('mapLimit keeps order and never runs more than the limit', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      peak = Math.max(peak, ++running)
      await new Promise((r) => setTimeout(r, n))
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })
})
