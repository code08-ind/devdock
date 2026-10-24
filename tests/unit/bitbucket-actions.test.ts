import { describe, expect, it, vi } from 'vitest'
import {
  BitbucketClient,
  PrActionError,
  type BitbucketConfig,
} from '../../src/main/services/bitbucket/client'
import { serverMessage } from '../../src/main/services/bitbucket/adapter'
import { ServiceError } from '../../src/main/services/service-error'
import { DC_BASE, ScriptedHttp, cloud, dc, json, type Route } from '../fixtures/bitbucket'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

/** Demo PRs (src/main/demo/bitbucket.ts): 412 mine, approved, green; 410 to review; 415 mine, failing. */
const DEMO = (id: number, repo = 'web-app') => ({ owner: 'DEMO', repo, id })
const DEMO_LINK = (id: number) =>
  `https://demo.devdock.invalid/bitbucket/projects/DEMO/repos/web-app/pull-requests/${id}`

/** Requests the demo server saw in the current test (see setup). */
let sent: Request[] = []
/** The ones that could change something. */
const writes = () =>
  sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${new URL(r.url).pathname}`)

async function setup(prActions: boolean) {
  const s = await handlerSetup()
  sent = []
  const fetch = s.deps.http.fetch.bind(s.deps.http)
  vi.spyOn(s.deps.http, 'fetch').mockImplementation(async (request: Request) => {
    sent.push(request.clone())
    return fetch(request)
  })
  s.deps.settings.update({ features: { prActions } })
  return s
}

describe('PR actions behind the Settings switch (P3.D3)', () => {
  it('with PR actions off, the handler rejects approve, needs work and merge called directly', async () => {
    const { deps, handlers } = await setup(false)
    expect(deps.settings.get().features.prActions).toBe(false) // the default
    for (const request of [
      { ref: DEMO(410), action: 'approve', confirmed: true },
      { ref: DEMO(410), action: 'needs_work', confirmed: true },
      { ref: DEMO(412), action: 'merge', confirmed: true, targetBranch: 'develop' },
    ] as const) {
      const r = await dispatch('bitbucket:action', request, handlers)
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'NOT_ALLOWED', message: expect.stringMatching(/turned off/) },
      })
    }
    // Not a single request reached Bitbucket.
    expect(sent).toEqual([])
  })

  it('needs the confirmation flag, and merge needs a typed target branch', async () => {
    const { handlers } = await setup(true)
    const unconfirmed = await dispatch(
      'bitbucket:action',
      { ref: DEMO(410), action: 'approve', confirmed: false } as never,
      handlers,
    )
    expect(unconfirmed).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    const untyped = await dispatch(
      'bitbucket:action',
      { ref: DEMO(412), action: 'merge', confirmed: true },
      handlers,
    )
    expect(untyped).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(sent).toEqual([])
  })

  it('on: approve and needs work send one vote as the signed-in user', async () => {
    const { handlers } = await setup(true)
    const approved = await dispatch(
      'bitbucket:action',
      { ref: DEMO(410), action: 'approve', confirmed: true },
      handlers,
    )
    expect(approved).toMatchObject({ ok: true })
    if (!approved.ok) return
    expect(approved.data.reviewers).toContainEqual({ name: 'Demo Developer', status: 'approved' })
    const needsWork = await dispatch(
      'bitbucket:action',
      { ref: DEMO(91, 'design-system'), action: 'needs_work', confirmed: true },
      handlers,
    )
    expect(needsWork).toMatchObject({ ok: true, data: { needsWork: 1 } })
    expect(writes()).toEqual([
      'PUT /bitbucket/rest/api/1.0/projects/DEMO/repos/web-app/pull-requests/410/participants/dev',
      'PUT /bitbucket/rest/api/1.0/projects/DEMO/repos/design-system/pull-requests/91/participants/dev',
    ])
  })

  it('merge: a wrongly typed target branch sends nothing; the right one merges', async () => {
    const { handlers } = await setup(true)
    for (const typed of ['main', 'Develop', 'develop2']) {
      const r = await dispatch(
        'bitbucket:action',
        { ref: DEMO(412), action: 'merge', confirmed: true, targetBranch: typed },
        handlers,
      )
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'PRECONDITION_FAILED', message: expect.stringContaining('"develop"') },
      })
    }
    expect(writes()).toEqual([])

    const merged = await dispatch(
      'bitbucket:action',
      { ref: DEMO(412), action: 'merge', confirmed: true, targetBranch: ' develop ' },
      handlers,
    )
    expect(merged).toMatchObject({ ok: true, data: { state: 'merged' } })
    expect(writes()).toEqual([
      'POST /bitbucket/rest/api/1.0/projects/DEMO/repos/web-app/pull-requests/412/merge',
    ])
    expect(sent.find((r) => r.method === 'POST')!.url).toMatch(/\?version=0$/)

    // Already merged: refused before anything is sent.
    const twice = await dispatch(
      'bitbucket:action',
      { ref: DEMO(412), action: 'merge', confirmed: true, targetBranch: 'develop' },
      handlers,
    )
    expect(twice).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED', message: 'This pull request is already merged.' },
    })
    expect(writes()).toHaveLength(1)
  })

  it('shows the server’s reasons verbatim: merge vetoes and a refused vote', async () => {
    const { handlers } = await setup(true)
    const vetoed = await dispatch(
      'bitbucket:action',
      { ref: DEMO(415), action: 'merge', confirmed: true, targetBranch: 'develop' },
      handlers,
    )
    expect(vetoed).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    if (vetoed.ok) return
    expect(vetoed.error.message).toContain(
      'A reviewer has marked this pull request as needing work.',
    )
    expect(vetoed.error.message).toContain(
      'This pull request needs a successful build before it can be merged.',
    )

    const own = await dispatch(
      'bitbucket:action',
      { ref: DEMO(412), action: 'approve', confirmed: true },
      handlers,
    )
    expect(own).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    if (own.ok) return
    expect(own.error.message).toContain(
      'Bitbucket said: “You are the author of this pull request and cannot review it.”',
    )
    // Only the refused vote was sent; the vetoed merge never POSTed.
    expect(writes()).toEqual([
      'PUT /bitbucket/rest/api/1.0/projects/DEMO/repos/web-app/pull-requests/412/participants/dev',
    ])
  })

  it('an action on a watched PR is absorbed: no notification about your own vote', async () => {
    const { deps, handlers } = await setup(true)
    const added = await dispatch('watch:add', { link: DEMO_LINK(410) }, handlers)
    expect(added).toMatchObject({ ok: true, data: { key: 'demo/web-app#410' } })
    await dispatch(
      'bitbucket:action',
      { ref: DEMO(410), action: 'approve', confirmed: true },
      handlers,
    )
    await deps.prWatcher.poll()
    expect(deps.notifications.list()).toEqual([])
    expect(deps.prWatcher.list()[0]!.pr.reviewers).toContainEqual({
      name: 'Demo Developer',
      status: 'approved',
    })
  })
})

describe('watch:* handlers', () => {
  it('adds by link, lists, removes; bad links and other sites have their own codes', async () => {
    const { handlers } = await setup(false)
    expect(await dispatch('watch:add', { link: 'not a link' }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })
    expect(
      await dispatch(
        'watch:add',
        { link: 'https://bitbucket.org/acme/web-app/pull-requests/1' },
        handlers,
      ),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
    expect(
      await dispatch('watch:add', { link: `${DEMO_LINK(999)}/overview` }, handlers),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    const added = await dispatch(
      'watch:add',
      { link: `${DEMO_LINK(88).replace('web-app', 'design-system')}/diff` },
      handlers,
    )
    expect(added).toMatchObject({
      ok: true,
      data: { key: 'demo/design-system#88', pr: { build: { state: 'running' } } },
    })
    expect(await dispatch('watch:list', undefined, handlers)).toMatchObject({
      ok: true,
      data: [{ key: 'demo/design-system#88' }],
    })
    await dispatch('watch:remove', { key: 'demo/design-system#88' }, handlers)
    expect(await dispatch('watch:list', undefined, handlers)).toEqual({ ok: true, data: [] })
  })

  it('demo: the running build on design-system #88 passes and the watcher notifies once', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] })
    try {
      const { deps, handlers } = await setup(false)
      await dispatch(
        'watch:add',
        { link: DEMO_LINK(88).replace('web-app', 'design-system') },
        handlers,
      )
      await deps.prWatcher.poll()
      expect(deps.notifications.list()).toEqual([])
      vi.setSystemTime(Date.now() + 3 * 60_000)
      await deps.prWatcher.poll()
      await deps.prWatcher.poll()
      expect(deps.notifications.list().map((n) => n.title)).toEqual([
        'Build passed · design-system #88',
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---- Request shapes per flavour -------------------------------------------------------------

const on =
  (method: string, path: string, respond: (r: Request) => Response | Promise<Response>): Route =>
  (r) =>
    r.method === method && new URL(r.url).pathname === path ? respond(r) : undefined

const CLOUD: BitbucketConfig = {
  flavor: 'cloud',
  baseUrl: 'https://bitbucket.org',
  username: 'ada@example.com',
  token: 't',
}
const DC: BitbucketConfig = { flavor: 'datacenter', baseUrl: DC_BASE, username: '', token: 't' }
const CLOUD_PR = '/2.0/repositories/acme/web-app/pullrequests/42'
const DC_PR = '/rest/api/1.0/projects/PROJ/repos/web-app/pull-requests/7'

function cloudHttp(extra: Route[] = []) {
  return new ScriptedHttp([
    ...extra,
    on('GET', '/2.0/user', () => json(cloud.user)),
    on('GET', CLOUD_PR, () => json(cloud.pr(42))),
    on('GET', `${CLOUD_PR}/comments`, () => json({ values: [] })),
    (r) => (r.method === 'GET' && r.url.includes('/statuses') ? json({ values: [] }) : undefined),
    (r) => (r.method === 'POST' ? json({}) : undefined),
  ])
}

function dcHttp(extra: Route[] = []) {
  return new ScriptedHttp([
    ...extra,
    on('GET', '/rest/api/1.0/application-properties', () =>
      json(dc.applicationProperties, { headers: { 'X-AUSERNAME': 'ada.lovelace' } }),
    ),
    on('GET', '/rest/api/1.0/users/ada.lovelace', () =>
      json({ ...dc.user, name: 'ada.lovelace', slug: 'ada_lovelace' }),
    ),
    on('GET', DC_PR, () => json(dc.pr(7, { properties: {} }))),
    on('GET', `${DC_PR}/activities`, () => json({ values: [], isLastPage: true })),
    on('GET', `${DC_PR}/merge`, () => json({ canMerge: true, conflicted: false, vetoes: [] })),
    (r) => (r.url.includes('/build-status/') ? json({ values: [], isLastPage: true }) : undefined),
    (r) => (r.method !== 'GET' ? json({}) : undefined),
  ])
}

const writesOf = (http: ScriptedHttp) =>
  http.requests
    .filter((r) => r.method !== 'GET')
    .map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`)

describe('PR action requests', () => {
  it('Cloud: approve, request-changes and merge endpoints', async () => {
    const http = cloudHttp()
    const client = new BitbucketClient(http, CLOUD, async () => [])
    const ref = { owner: 'acme', repo: 'web-app', id: 42 }
    await client.act(ref, 'approve', undefined)
    await client.act(ref, 'needs_work', undefined)
    await client.act(ref, 'merge', 'develop')
    expect(writesOf(http)).toEqual([
      `POST ${CLOUD_PR}/approve`,
      `POST ${CLOUD_PR}/request-changes`,
      `POST ${CLOUD_PR}/merge`,
    ])
    const merge = http.requests.find((r) => r.url.endsWith('/merge'))!
    expect(merge.headers.get('authorization')).toMatch(/^Basic /)
    expect(await merge.text()).toBe('{}')
  })

  it('Data Center: votes go to the user’s slug; merge sends the version it read', async () => {
    const http = dcHttp()
    const client = new BitbucketClient(http, DC, async () => [])
    const ref = { owner: 'PROJ', repo: 'web-app', id: 7 }
    await client.act(ref, 'approve', undefined)
    await client.act(ref, 'needs_work', undefined)
    await client.act(ref, 'merge', 'develop')
    expect(writesOf(http)).toEqual([
      `PUT ${DC_PR}/participants/ada_lovelace`,
      `PUT ${DC_PR}/participants/ada_lovelace`,
      `POST ${DC_PR}/merge?version=3`,
    ])
    const [approve, needsWork] = http.requests.filter((r) => r.method === 'PUT')
    expect(await approve!.json()).toEqual({
      user: { name: 'ada_lovelace' },
      approved: true,
      status: 'APPROVED',
    })
    expect(await needsWork!.json()).toMatchObject({ approved: false, status: 'NEEDS_WORK' })
  })

  it('Data Center: a vetoed or conflicted merge is refused with the server’s reasons, nothing POSTed', async () => {
    const http = dcHttp([
      on('GET', `${DC_PR}/merge`, () =>
        json({
          canMerge: false,
          conflicted: true,
          vetoes: [{ summaryMessage: 'Tasks', detailedMessage: 'Resolve 1 open task first.' }],
        }),
      ),
    ])
    const err = await new BitbucketClient(http, DC, async () => [])
      .act({ owner: 'PROJ', repo: 'web-app', id: 7 }, 'merge', 'develop')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect((err as ServiceError).kind).toBe('conflict')
    expect((err as ServiceError).message).toBe(
      "Bitbucket won't merge this pull request yet. It has merge conflicts. Resolve 1 open task first.",
    )
    expect(writesOf(http)).toEqual([])
  })

  it('a 403 keeps its hint and adds what Bitbucket said', async () => {
    const http = cloudHttp([
      on('POST', `${CLOUD_PR}/merge`, () =>
        json(
          {
            type: 'error',
            error: { message: 'You do not have permission to merge into develop.' },
          },
          { status: 403 },
        ),
      ),
    ])
    const err = (await new BitbucketClient(http, CLOUD, async () => [])
      .act({ owner: 'acme', repo: 'web-app', id: 42 }, 'merge', 'develop')
      .catch((e: unknown) => e)) as ServiceError
    expect(err.kind).toBe('forbidden')
    expect(err.message).toMatch(/^Bitbucket refused access \(403\)/)
    expect(err.message).toMatch(
      /Bitbucket said: “You do not have permission to merge into develop\.”$/,
    )
  })

  it('a closed PR or a mistyped target is refused before any write', async () => {
    const http = cloudHttp([on('GET', CLOUD_PR, () => json(cloud.pr(42, { state: 'DECLINED' })))])
    const client = new BitbucketClient(http, CLOUD, async () => [])
    const ref = { owner: 'acme', repo: 'web-app', id: 42 }
    await expect(client.act(ref, 'approve', undefined)).rejects.toBeInstanceOf(PrActionError)
    const open = cloudHttp()
    await expect(
      new BitbucketClient(open, CLOUD, async () => []).act(ref, 'merge', 'main'),
    ).rejects.toThrow('Not merged: the target branch is "develop", and "main" was typed.')
    expect([...writesOf(http), ...writesOf(open)]).toEqual([])
  })

  it('Data Center: a server-sent slug that isn’t one path segment is never used in a URL', async () => {
    for (const [name, slug, expected] of [
      ['ada.lovelace', '..', 'ada.lovelace'], // bad slug → the (valid) user name
      ['..', 'x', null], // bad name: no user lookup, no slug → refused
    ] as const) {
      const http = dcHttp([
        on('GET', '/rest/api/1.0/application-properties', () =>
          json(dc.applicationProperties, { headers: { 'X-AUSERNAME': name } }),
        ),
        on('GET', '/rest/api/1.0/users/ada.lovelace', () => json({ ...dc.user, slug })),
      ])
      const result = new BitbucketClient(http, DC, async () => [])
        .act({ owner: 'PROJ', repo: 'web-app', id: 7 }, 'approve', undefined)
        .catch((e: unknown) => e)
      if (expected) {
        await result
        expect(writesOf(http)).toEqual([`PUT ${DC_PR}/participants/${expected}`])
      } else {
        expect(await result).toMatchObject({ kind: 'bad_response' })
        expect(writesOf(http)).toEqual([])
        expect(http.paths().some((p) => p.includes('/users/'))).toBe(false)
      }
    }
  })

  it('Data Center: retargeted between the check and the merge → refused, nothing POSTed', async () => {
    let reads = 0
    const http = dcHttp([
      on('GET', DC_PR, () => {
        reads++
        // First read (the typed-branch check): develop. The adapter's own read: main.
        return json(
          reads === 1
            ? dc.pr(7, { properties: {} })
            : dc.pr(7, {
                properties: {},
                toRef: {
                  displayId: 'main',
                  repository: { slug: 'web-app', project: { key: 'PROJ' } },
                },
              }),
        )
      }),
    ])
    const err = await new BitbucketClient(http, DC, async () => [])
      .act({ owner: 'PROJ', repo: 'web-app', id: 7 }, 'merge', 'develop')
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'conflict', message: expect.stringContaining('"main"') })
    expect(writesOf(http)).toEqual([])
  })

  it('what Bitbucket said is redacted before it reaches the message', async () => {
    const http = cloudHttp([
      on('POST', `${CLOUD_PR}/approve`, () =>
        json(
          { error: { message: 'Bad header Authorization: Bearer abcdef0123456789' } },
          { status: 400 },
        ),
      ),
    ])
    const err = (await new BitbucketClient(http, CLOUD, async () => [])
      .act({ owner: 'acme', repo: 'web-app', id: 42 }, 'approve', undefined)
      .catch((e: unknown) => e)) as ServiceError
    expect(err.message).toContain('Bitbucket said:')
    expect(err.message).not.toContain('abcdef0123456789')
  })

  it('serverMessage reads both error shapes and nothing else', () => {
    expect(serverMessage('{"errors":[{"message":"A"},{"message":"B"}]}')).toBe('A B')
    expect(serverMessage('{"type":"error","error":{"message":"Nope"}}')).toBe('Nope')
    expect(serverMessage('<html>login</html>')).toBeNull()
    expect(serverMessage('{"foo":1}')).toBeNull()
    expect(serverMessage(undefined)).toBeNull()
  })
})
