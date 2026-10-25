import { describe, expect, it } from 'vitest'
import { JenkinsClient, sessionCookie } from '../../src/main/services/jenkins/client'
import { ServiceError } from '../../src/main/services/service-error'
import { JENKINS, ScriptedHttp, jenkins, json, type Route } from '../fixtures/jenkins'

const CONFIG = { baseUrl: JENKINS, username: 'ada', token: 'api-token' }
const client = (http: ScriptedHttp) => new JenkinsClient(http, CONFIG)

/** Route on an exact path (query ignored) and method. */
const at =
  (path: string, respond: (r: Request) => Response | Promise<Response>, method = 'GET'): Route =>
  (r) =>
    new URL(r.url).pathname === `/jenkins${path}` && r.method === method ? respond(r) : undefined

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

const forbidden = () =>
  new Response('<html>No valid crumb was included in the request</html>', { status: 403 })

describe('Jenkins client: auth and Test connection', () => {
  it('sends Basic user:token and reports the user and the X-Jenkins version', async () => {
    const http = new ScriptedHttp([
      at('/me/api/json', () => json(jenkins.me, { headers: { 'X-Jenkins': '2.479.1' } })),
    ])
    expect(await client(http).testConnection()).toEqual({
      status: 200,
      user: { id: 'ada', fullName: 'Ada Example' },
      version: '2.479.1',
    })
    const auth = http.requests[0]!.headers.get('authorization')!
    expect(Buffer.from(auth.replace('Basic ', ''), 'base64').toString()).toBe('ada:api-token')
  })

  it('an anonymous answer means the credentials were ignored', async () => {
    const http = new ScriptedHttp([at('/me/api/json', () => json({ id: 'anonymous' }))])
    const err = await failure(client(http).testConnection())
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/anonymous/)
  })

  it('401 and 403 carry the Jenkins hints', async () => {
    const http401 = new ScriptedHttp([at('/me/api/json', () => new Response('', { status: 401 }))])
    expect((await failure(client(http401).testConnection())).message).toMatch(
      /401.*API token in Settings → Jenkins/,
    )
    const http403 = new ScriptedHttp([at('/me/api/json', () => new Response('', { status: 403 }))])
    expect((await failure(client(http403).testConnection())).message).toMatch(/Job\/Read/)
  })
})

describe('Jenkins client: job tree and last build per branch', () => {
  it('lists branch and PR jobs with their last build, decoding branch names', async () => {
    const http = new ScriptedHttp([at('/job/web-app/api/json', () => json(jenkins.webApp))])
    const builds = await client(http).branches('web-app')
    expect(
      builds.map((b) => [b.job, b.branch, b.kind, b.prId, b.lastBuild?.state ?? null]),
    ).toEqual([
      ['web-app/develop', 'develop', 'branch', null, 'success'],
      [
        'web-app/feature%2FNM-7-summary-card',
        'feature/NM-7-summary-card',
        'branch',
        null,
        'running',
      ],
      ['web-app/PR-42', 'PR-42', 'pr', 42, 'failed'],
      ['web-app/spike%2Fnothing-yet', 'spike/nothing-yet', 'branch', null, null],
    ]) // the `..` child is left out
    const running = builds[1]!
    expect(running.lastBuild).toMatchObject({ number: 5, durationMs: null, estimatedMs: 170_000 })
    // The encoded name is encoded again in links: `%2F` → `%252F`.
    expect(running.url).toBe(`${JENKINS}/job/web-app/job/feature%252FNM-7-summary-card/`)
    expect(running.lastBuild!.url).toBe(
      `${JENKINS}/job/web-app/job/feature%252FNM-7-summary-card/5/`,
    )
    expect(builds[2]!.lastBuild).toMatchObject({ durationMs: 95_000, estimatedMs: null })
    expect(new URL(http.requests[0]!.url).searchParams.get('tree')).toMatch(
      /^_class,jobs\[_class,name,lastBuild\[/,
    )
  })

  it('walks folders and organization folders two levels deep, no further', async () => {
    const folder = (names: string[], cls = 'com.cloudbees.hudson.plugins.folder.Folder') => ({
      _class: cls,
      jobs: names.map((name) => ({ _class: cls, name })),
    })
    const http = new ScriptedHttp([
      at('/job/acme/api/json', () =>
        json(folder(['web-app'], 'jenkins.branch.OrganizationFolder')),
      ),
      at('/job/acme/job/web-app/api/json', () => json(jenkins.webApp)),
      at('/job/deep/api/json', () => json(folder(['a']))),
      at('/job/deep/job/a/api/json', () => json(folder(['b']))),
    ])
    const org = await client(http).branches('acme')
    expect(org.map((b) => [b.project, b.job])).toContainEqual([
      'acme/web-app',
      'acme/web-app/PR-42',
    ])
    expect(await client(http).branches('deep')).toEqual([])
    expect(http.paths()).not.toContain('/jenkins/job/deep/job/a/job/b/api/json')
  })

  it('a wrong job path is a 404 with the base-URL hint', async () => {
    const http = new ScriptedHttp([
      at('/job/nope/api/json', () => new Response('', { status: 404 })),
    ])
    expect((await failure(client(http).branches('nope'))).kind).toBe('not_found')
  })
})

describe('Jenkins client: build, stages, console', () => {
  const buildUrl = '/job/web-app/job/PR-42/3'

  it('reads stages, parameters (never password values) and causes', async () => {
    const http = new ScriptedHttp([
      at(`${buildUrl}/api/json`, () => json(jenkins.build)),
      at(`${buildUrl}/wfapi/describe`, () => json(jenkins.describe)),
    ])
    const detail = await client(http).build({ job: 'web-app/PR-42', number: 3 })
    expect(detail.build).toMatchObject({ state: 'failed', number: 3, durationMs: 95_000 })
    expect(detail.stages?.map((s) => [s.name, s.state])).toEqual([
      ['Checkout', 'success'],
      ['Unit tests', 'failed'],
      ['Build', 'skipped'],
    ])
    expect(detail.parameters).toEqual([
      { name: 'TARGET', value: 'dev' },
      { name: 'SKIP_E2E', value: 'true' },
    ])
    expect(detail.causes).toEqual(['Pull request #42 updated'])
  })

  it('falls back to "stages unavailable" (null) when wfapi is missing', async () => {
    const http = new ScriptedHttp([
      at(`${buildUrl}/api/json`, () => json(jenkins.build)),
      at(
        `${buildUrl}/wfapi/describe`,
        () => new Response('<html>Not Found</html>', { status: 404 }),
      ),
    ])
    expect((await client(http).build({ job: 'web-app/PR-42', number: 3 })).stages).toBeNull()
  })

  it('other wfapi failures are not hidden as "unavailable"', async () => {
    const http = new ScriptedHttp([
      at(`${buildUrl}/api/json`, () => json(jenkins.build)),
      at(`${buildUrl}/wfapi/describe`, () => new Response('', { status: 401 })),
    ])
    expect((await failure(client(http).build({ job: 'web-app/PR-42', number: 3 }))).kind).toBe(
      'auth',
    )
  })

  it('a build without a number is a bad response, not a link to /undefined/', async () => {
    const http = new ScriptedHttp([
      at(`${buildUrl}/api/json`, () => json({ ...jenkins.build, number: undefined })),
      at(`${buildUrl}/wfapi/describe`, () => json(jenkins.describe)),
    ])
    expect((await failure(client(http).build({ job: 'web-app/PR-42', number: 3 }))).kind).toBe(
      'bad_response',
    )
  })

  it('console: asks from the offset and passes the progressive headers on', async () => {
    const http = new ScriptedHttp([
      at(
        `${buildUrl}/logText/progressiveText`,
        () => new Response('line 3\n', { headers: { 'X-Text-Size': '21', 'X-More-Data': 'true' } }),
      ),
    ])
    const chunk = await client(http).console({ job: 'web-app/PR-42', number: 3 }, 14)
    expect(chunk).toMatchObject({ text: 'line 3\n', nextStart: 21, more: true, reset: false })
    expect(new URL(http.requests[0]!.url).searchParams.get('start')).toBe('14')
  })
})

describe('Jenkins client: crumbs for POSTs', () => {
  const queued = () =>
    new Response(null, { status: 201, headers: { Location: `${JENKINS}/queue/item/77/` } })

  it('sends the crumb header with a POST', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => json(jenkins.crumb)),
      at('/job/web-app/job/develop/build', queued, 'POST'),
    ])
    expect(await client(http).trigger('web-app/develop', {})).toBe(`${JENKINS}/queue/item/77/`)
    const post = http.requests.find((r) => r.method === 'POST')!
    expect(post.headers.get('Jenkins-Crumb')).toBe('c0ffee')
  })

  it('a 403 fetches a fresh crumb and retries once', async () => {
    let crumbs = 0
    let posts = 0
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => json({ ...jenkins.crumb, crumb: `crumb-${++crumbs}` })),
      at('/job/web-app/job/develop/build', () => (++posts === 1 ? forbidden() : queued()), 'POST'),
    ])
    await client(http).trigger('web-app/develop', {})
    const sent = http.requests
      .filter((r) => r.method === 'POST')
      .map((r) => r.headers.get('Jenkins-Crumb'))
    expect(sent).toEqual(['crumb-1', 'crumb-2'])
  })

  it('a second 403 is the answer: no third try', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => json(jenkins.crumb)),
      at('/job/web-app/job/develop/build', forbidden, 'POST'),
    ])
    expect((await failure(client(http).trigger('web-app/develop', {}))).kind).toBe('forbidden')
    expect(http.requests.filter((r) => r.method === 'POST')).toHaveLength(2)
    expect(http.paths().filter((p) => p.endsWith('/crumbIssuer/api/json'))).toHaveLength(2)
  })

  it('reuses the crumb between POSTs until one is refused', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => json(jenkins.crumb)),
      at('/job/web-app/job/develop/build', queued, 'POST'),
    ])
    const c = client(http)
    await c.trigger('web-app/develop', {})
    await c.trigger('web-app/develop', {})
    expect(http.paths().filter((p) => p.endsWith('/crumbIssuer/api/json'))).toHaveLength(1)
  })

  it('no crumb issuer (CSRF protection off) → POST without one', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => new Response('', { status: 404 })),
      at('/job/web-app/job/develop/build', queued, 'POST'),
    ])
    await client(http).trigger('web-app/develop', {})
    expect(http.requests.find((r) => r.method === 'POST')!.headers.get('Jenkins-Crumb')).toBeNull()
  })

  it('parameters go to buildWithParameters as a form; the session cookie travels with the crumb', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () =>
        json(jenkins.crumb, {
          headers: { 'Set-Cookie': 'JSESSIONID.ab12=node0xyz; Path=/jenkins; HttpOnly' },
        }),
      ),
      at('/job/web-app/job/develop/buildWithParameters', queued, 'POST'),
    ])
    await client(http).trigger('web-app/develop', { TARGET: 'dev', NOTE: 'a&b' })
    const post = http.requests.find((r) => r.method === 'POST')!
    expect(await post.text()).toBe('TARGET=dev&NOTE=a%26b')
    expect(post.headers.get('cookie')).toBe('JSESSIONID.ab12=node0xyz')
  })

  it('a crumb field that is not a header-name token is refused', async () => {
    const http = new ScriptedHttp([
      at('/crumbIssuer/api/json', () => json({ crumb: 'x', crumbRequestField: 'Bad Header\r\n' })),
    ])
    expect((await failure(client(http).trigger('web-app/develop', {}))).kind).toBe('bad_response')
    expect(http.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('sessionCookie keeps only JSESSIONID pairs', () => {
    const headers = new Headers()
    headers.append('Set-Cookie', 'other=1; Path=/')
    headers.append('Set-Cookie', 'JSESSIONID.x=abc; HttpOnly')
    expect(sessionCookie(headers)).toBe('JSESSIONID.x=abc')
    expect(sessionCookie(new Headers())).toBeNull()
  })
})
