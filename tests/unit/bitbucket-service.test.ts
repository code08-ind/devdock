import { describe, expect, it, vi } from 'vitest'
import { DEMO_BITBUCKET } from '../../src/main/demo/bitbucket'
import { demoHandlers } from '../../src/main/demo/handlers'
import { BitbucketService } from '../../src/main/services/bitbucket/service'
import { DemoHttpClient, type HttpClient } from '../../src/main/services/http'
import { ServiceError } from '../../src/main/services/service-error'
import { SettingsSchema, defaultSettings, type Settings } from '../../src/shared/settings'
import { ScriptedHttp, cloud, json, type Route } from '../fixtures/bitbucket'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

function withBitbucket(bitbucket: Partial<Settings['bitbucket']>): Settings {
  const s = defaultSettings()
  return SettingsSchema.parse({ ...s, bitbucket: { ...s.bitbucket, ...bitbucket } })
}

const service = (
  http: HttpClient,
  bitbucket: Partial<Settings['bitbucket']> = {},
  token: string | null = 't',
  remotes: string[] = [],
) =>
  new BitbucketService({
    http,
    settings: () => withBitbucket(bitbucket),
    token: () => token ?? undefined,
    repoRemotes: async () => remotes,
    demo: DEMO_BITBUCKET,
  })

async function failure(p: Promise<unknown> | (() => unknown)): Promise<ServiceError> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

const cloudRoutes: Route[] = [
  (r) => (new URL(r.url).pathname === '/2.0/user' ? json(cloud.user) : undefined),
  (r) => (new URL(r.url).pathname.endsWith('/pullrequests') ? json({ values: [] }) : undefined),
]

describe('BitbucketService', () => {
  it('says exactly what is missing before making any request', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    const cloudNoToken = await failure(() => service(http, {}, null).testConnection())
    expect(cloudNoToken.kind).toBe('not_configured')
    expect(cloudNoToken.message).toMatch(/add an API token, app password or access token/)
    expect(cloudNoToken.message).not.toMatch(/URL/) // Cloud defaults to bitbucket.org

    const dc = await failure(() => service(http, { flavor: 'datacenter' }, null).testConnection())
    expect(dc.message).toMatch(/add the server URL, an HTTP access token/)
    expect(http.requests).toHaveLength(0)
  })

  it('Cloud defaults to bitbucket.org and scans the registered repos’ Cloud remotes, once each', async () => {
    const http = new ScriptedHttp(cloudRoutes)
    await service(http, { username: 'ada' }, 't', [
      'git@bitbucket.org:acme/web-app.git',
      'https://ada@bitbucket.org/Acme/Web-App.git', // same repo, other case
      'git@github.com:acme/other.git',
      'https://bitbucket.org/acme/design-system',
    ]).list('mine')
    expect(http.requests[0]!.url).toBe('https://api.bitbucket.org/2.0/user')
    expect(http.paths().filter((p) => p.endsWith('/pullrequests'))).toEqual([
      '/2.0/repositories/acme/web-app/pullrequests',
      '/2.0/repositories/acme/design-system/pullrequests',
    ])
  })

  it('Data Center ignores the Cloud user name and sends the token as Bearer', async () => {
    const http = new ScriptedHttp([
      () => json({ version: '8.19.1' }, { headers: { 'X-AUSERNAME': 'ada' } }),
    ])
    await service(
      http,
      { flavor: 'datacenter', baseUrl: 'https://bb.example.com', username: 'x' },
      'pat',
    ).testConnection()
    expect(http.requests[0]!.headers.get('authorization')).toBe('Bearer pat')
  })

  it('detect: trims the trailing slash; demo mode probes the demo server', async () => {
    const http = new ScriptedHttp([() => json({ version: '9.0.0', displayName: 'Bitbucket' })])
    expect(await service(http).detect('https://bb.example.com/')).toEqual({
      flavor: 'datacenter',
      version: '9.0.0',
    })
    expect(http.requests[0]!.url).toBe('https://bb.example.com/rest/api/1.0/application-properties')

    const demo = service(new DemoHttpClient(demoHandlers()))
    expect(await demo.detect('https://anything.example.com')).toEqual({
      flavor: 'datacenter',
      version: '8.19.1',
    })
  })

  it('demo mode (P3.08): no settings or token; PRs in mixed states', async () => {
    const svc = service(new DemoHttpClient(demoHandlers()), { flavor: 'cloud' }, null)
    expect(await svc.testConnection()).toEqual({
      flavor: 'datacenter',
      status: 200,
      user: { displayName: 'Demo Developer', account: 'dev' },
    })
    const mine = await svc.list('mine')
    expect(mine).toHaveLength(4)
    expect(mine.map((p) => p.build.state).sort()).toEqual(['failed', 'none', 'running', 'success'])
    expect(mine.some((p) => p.conflicts)).toBe(true)
    expect(mine.some((p) => p.approvals === 2)).toBe(true)
    expect(mine.some((p) => p.needsWork > 0)).toBe(true)
    // Newest activity first.
    const updated = mine.map((p) => Date.parse(p.updatedAt))
    expect(updated).toEqual([...updated].sort((a, b) => b - a))

    const reviewing = await svc.list('reviewing')
    expect(reviewing.map((p) => p.key).sort()).toEqual([
      'demo/design-system#91',
      'demo/web-app#410',
    ])

    const merged = await svc.list('merged')
    expect(merged).toHaveLength(2)
    expect(merged.every((p) => p.state === 'merged' && p.closedAt)).toBe(true)

    const one = await svc.pr({ owner: 'DEMO', repo: 'web-app', id: 415 })
    expect(one).toMatchObject({ unresolvedComments: 3, needsWork: 1, build: { state: 'failed' } })
  })
})

describe('bitbucket:* IPC', () => {
  it('maps service failures to typed codes; bad refs never reach the server', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { createHandlers } = await import('../../src/main/handlers')
    const { deps } = await handlerSetup()
    const http = new ScriptedHttp([
      () => json({ errors: [{ message: 'Authentication failed' }] }, { status: 401 }),
    ])
    deps.settings.update({ bitbucket: { flavor: 'datacenter', baseUrl: 'https://bb.example.com' } })
    deps.secrets.set('bitbucket.token', 'x')
    const handlers = createHandlers({
      ...deps,
      bitbucket: new BitbucketService({
        http,
        settings: () => deps.settings.get(),
        token: () => deps.secrets.get('bitbucket.token'),
        repoRemotes: async () => [],
        demo: DEMO_BITBUCKET,
      }),
    })

    expect(await dispatch('bitbucket:testConnection', undefined, handlers)).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_AUTH', details: expect.stringContaining('Authentication failed') },
    })
    for (const bad of [
      { owner: '..', repo: 'x', id: 1 },
      { owner: 'PROJ', repo: 'a/b', id: 1 },
      { owner: 'PROJ', repo: 'x', id: -1 },
    ]) {
      expect(await dispatch('prs:pr', bad, handlers)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
    expect(
      await dispatch('prs:list', { provider: 'bitbucket', list: 'all' }, handlers),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })
    expect(
      await dispatch('bitbucket:detect', { baseUrl: 'file:///etc/passwd' }, handlers),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(http.requests).toHaveLength(1)
  })

  it('works end to end in demo mode, and demo PR links can be opened', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { handlers } = await handlerSetup()
    const r = await dispatch('prs:list', { provider: 'bitbucket', list: 'mine' }, handlers)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.data).toHaveLength(4)
    expect(await dispatch('app:openExternal', { url: r.data[0]!.url }, handlers)).toMatchObject({
      ok: true,
    })
  })

  it('opening a link to the configured Bitbucket host is allowed', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { deps, handlers } = await handlerSetup()
    const url = 'https://git.corp.example/projects/P/repos/r/pull-requests/1'
    expect(await dispatch('app:openExternal', { url }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    deps.settings.update({
      bitbucket: { flavor: 'datacenter', baseUrl: 'https://git.corp.example' },
    })
    expect(await dispatch('app:openExternal', { url }, handlers)).toMatchObject({ ok: true })
  })
})

describe('bitbucket settings', () => {
  it('defaults: Cloud, no URL, no user name; patches keep the other fields', () => {
    expect(defaultSettings().bitbucket).toEqual({
      enabled: true,
      flavor: 'cloud',
      baseUrl: '',
      username: '',
    })
  })

  it('base URL: trims the trailing slash, rejects credentials and query', () => {
    const parse = (baseUrl: string) =>
      SettingsSchema.safeParse({ ...defaultSettings(), bitbucket: { baseUrl } })
    expect(parse('https://bb.example.com/bitbucket/').data?.bitbucket.baseUrl).toBe(
      'https://bb.example.com/bitbucket',
    )
    expect(parse('https://u:p@bb.example.com').success).toBe(false)
    expect(parse('https://bb.example.com?x=1').success).toBe(false)
  })

  it('user name: a ":" would split Basic auth, so it is refused', () => {
    const parse = (username: string) =>
      SettingsSchema.safeParse({ ...defaultSettings(), bitbucket: { username } })
    expect(parse('ada@example.com').success).toBe(true)
    expect(parse('ada:secret').success).toBe(false)
  })
})
