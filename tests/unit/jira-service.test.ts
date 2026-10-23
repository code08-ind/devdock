import { describe, expect, it, vi } from 'vitest'
import { demoHandlers } from '../../src/main/demo/handlers'
import { DEMO_JIRA } from '../../src/main/demo/jira'
import { DemoHttpClient } from '../../src/main/services/http'
import { JiraService } from '../../src/main/services/jira/service'
import { ServiceError } from '../../src/main/services/service-error'
import { SettingsSchema, defaultSettings, type Settings } from '../../src/shared/settings'
import { CLOUD_BASE, ScriptedHttp, cloud, json, on } from '../fixtures/jira'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

function withJira(jira: Partial<Settings['jira']>): Settings {
  const s = defaultSettings()
  return SettingsSchema.parse({ ...s, jira: { ...s.jira, ...jira } })
}

const cloudHttp = () =>
  new ScriptedHttp([
    on('/rest/api/3/myself', () => json(cloud.myself)),
    on('/rest/api/3/field', () => json(cloud.fields)),
    on('/rest/api/3/search/jql', () => json({ issues: [cloud.issue] })),
  ])

async function failure(p: Promise<unknown> | (() => unknown)): Promise<ServiceError> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

describe('JiraService', () => {
  it('says exactly what is missing before making any request', async () => {
    const http = cloudHttp()
    const svc = (jira: Partial<Settings['jira']>, token?: string) =>
      new JiraService({
        demo: DEMO_JIRA,
        http,
        settings: () => withJira(jira),
        token: () => token,
      })

    const none = await failure(() => svc({}).testConnection())
    expect(none.kind).toBe('not_configured')
    expect(none.message).toMatch(/site URL, the account email, an API token/)

    const dc = await failure(() =>
      svc({ flavor: 'datacenter', baseUrl: 'https://jira.example.com' }).testConnection(),
    )
    expect(dc.message).toMatch(/add a personal access token/)
    expect(dc.message).not.toMatch(/email/)
    expect(http.requests).toHaveLength(0)
  })

  it('uses the saved JQL, saved queries by name, and refuses unknown ones', async () => {
    const http = cloudHttp()
    const settings = withJira({
      baseUrl: CLOUD_BASE,
      email: 'ada@example.com',
      jql: 'project = NM ORDER BY updated DESC',
      savedQueries: [{ name: 'Bugs', jql: 'type = Bug' }],
    })
    const svc = new JiraService({
      demo: DEMO_JIRA,
      http,
      settings: () => settings,
      token: () => 't',
    })
    await svc.list({ list: 'mine' })
    await svc.list({ list: 'saved', name: 'Bugs' })
    const jqls = http.requests
      .filter((r) => r.url.includes('/search/jql'))
      .map((r) => new URL(r.url).searchParams.get('jql'))
    expect(jqls).toEqual(['project = NM ORDER BY updated DESC', 'type = Bug'])
    expect((await failure(svc.list({ list: 'saved', name: 'Nope' }))).kind).toBe('not_found')
  })

  it('current sprint needs a board id', async () => {
    const svc = new JiraService({
      demo: DEMO_JIRA,
      http: cloudHttp(),
      settings: () => withJira({ baseUrl: CLOUD_BASE, email: 'a@example.com' }),
      token: () => 't',
    })
    const e = await failure(svc.list({ list: 'sprint' }))
    expect(e.kind).toBe('not_configured')
    expect(e.message).toMatch(/board id/)
  })

  it('keeps one client (and its field lookup) until the config changes', async () => {
    const http = cloudHttp()
    let settings = withJira({ baseUrl: CLOUD_BASE, email: 'a@example.com' })
    const svc = new JiraService({
      demo: DEMO_JIRA,
      http,
      settings: () => settings,
      token: () => 't',
    })
    await svc.list({ list: 'mine' })
    await svc.list({ list: 'mine' })
    settings = withJira({ baseUrl: CLOUD_BASE, email: 'b@example.com' })
    await svc.list({ list: 'mine' })
    expect(http.paths().filter((p) => p.endsWith('/field'))).toHaveLength(2)
    expect(http.requests.at(-1)!.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('b@example.com:t').toString('base64')}`,
    )
  })

  it('demo mode: no settings or token needed; 8 fixtures, 7 open, 4 in the sprint', async () => {
    const svc = new JiraService({
      demo: DEMO_JIRA,
      http: new DemoHttpClient(demoHandlers()),
      settings: defaultSettings,
      token: () => undefined,
    })
    expect((await svc.testConnection()).user.displayName).toBe('Demo Developer')
    const mine = await svc.list({ list: 'mine' })
    expect(mine).toHaveLength(7)
    expect(new Set(mine.map((i) => i.type))).toEqual(new Set(['Bug', 'Story', 'Task']))
    expect((await svc.list({ list: 'sprint' })).map((i) => i.key)).toEqual([
      'DD-101',
      'DD-102',
      'DD-103',
      'DD-105',
    ])
    expect((await svc.issue('DD-107')).statusCategory).toBe('done')
    // The fixtures the Start-work classification (P2-B) relies on:
    expect((await svc.issue('DD-104')).acceptanceCriteria).toBeNull() // task, no AC
    expect((await svc.issue('DD-103')).acceptanceCriteria).toBeNull() // vague story
    expect((await svc.issue('DD-102')).links.map((l) => l.kind)).toEqual(['figma', 'confluence'])
    expect((await svc.issue('DD-106')).acceptanceCriteria).toMatch(/max 92 days/) // custom field
    expect((await failure(svc.issue('DD-999'))).kind).toBe('not_found')
  })
})

describe('jira:* IPC', () => {
  it('maps service failures to typed codes with hints and details', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { deps } = await handlerSetup()
    const { createHandlers } = await import('../../src/main/handlers')
    const http = new ScriptedHttp([
      on('/myself', () => json({ errorMessages: ['Unauthorized'] }, { status: 401 })),
      on('/field', () => new Response('', { status: 429, headers: { 'Retry-After': '12' } })),
    ])
    deps.settings.update({ jira: { baseUrl: CLOUD_BASE, email: 'a@example.com' } })
    deps.secrets.set('jira.token', 'x')
    const handlers = createHandlers({
      ...deps,
      jira: new JiraService({
        demo: DEMO_JIRA,
        http,
        settings: () => deps.settings.get(),
        token: () => deps.secrets.get('jira.token'),
      }),
    })

    const auth = await dispatch('jira:testConnection', undefined, handlers)
    expect(auth).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_AUTH', details: expect.stringContaining('Unauthorized') },
    })
    const limited = await dispatch('jira:list', { list: 'mine' }, handlers)
    expect(limited).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED', message: expect.stringMatching(/in 12 s/) },
    })
    const badKey = await dispatch('jira:issue', { key: '../admin' }, handlers)
    expect(badKey).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(http.requests.some((r) => r.url.includes('admin'))).toBe(false)
  })

  it('works end to end in demo mode', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { handlers } = await handlerSetup()
    const r = await dispatch('jira:issue', { key: 'DD-101' }, handlers)
    expect(r).toMatchObject({
      ok: true,
      data: { key: 'DD-101', type: 'Bug', sprint: 'Demo Sprint 7' },
    })
  })

  it('demo mode: links to demo issues can be opened', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { handlers } = await handlerSetup()
    const issue = await dispatch('jira:issue', { key: 'DD-102' }, handlers)
    if (!issue.ok) throw new Error(issue.error.message)
    expect(await dispatch('app:openExternal', { url: issue.data.url }, handlers)).toMatchObject({
      ok: true,
    })
  })

  it('opening a link to the configured Jira host is allowed', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    const { deps, handlers } = await handlerSetup()
    const url = 'https://jira.example.com/browse/OPS-1'
    expect(await dispatch('app:openExternal', { url }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    deps.settings.update({ jira: { flavor: 'datacenter', baseUrl: 'https://jira.example.com/' } })
    expect(await dispatch('app:openExternal', { url }, handlers)).toMatchObject({ ok: true })
    expect(deps.openExternal).toHaveBeenCalledWith(url)
  })
})

describe('jira settings', () => {
  it('base URL: trims the trailing slash, rejects credentials, query and fragment', () => {
    const parse = (baseUrl: string) =>
      SettingsSchema.safeParse({
        ...defaultSettings(),
        jira: { ...defaultSettings().jira, baseUrl },
      })
    expect(parse('https://acme.atlassian.net/').data?.jira.baseUrl).toBe(
      'https://acme.atlassian.net',
    )
    expect(parse('https://jira.example.com/jira').success).toBe(true)
    expect(parse('').success).toBe(true)
    for (const bad of [
      'https://u:p@jira.example.com',
      'https://jira.example.com/?a=1',
      'https://jira.example.com/#',
      'https://jira.example.com?',
      'ftp://jira.example.com',
      'jira.example.com',
    ]) {
      expect(parse(bad).success, bad).toBe(false)
    }
  })
})
