import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_BITBUCKET } from '../../src/main/demo/bitbucket'
import { DEMO_JENKINS } from '../../src/main/demo/jenkins'
import { demoHandlers } from '../../src/main/demo/handlers'
import { BitbucketService } from '../../src/main/services/bitbucket/service'
import { DemoHttpClient, type HttpClient } from '../../src/main/services/http'
import { repoSlug } from '../../src/main/services/jenkins/mine'
import type { MyWork } from '../../src/main/services/jenkins/resolve'
import { JenkinsService } from '../../src/main/services/jenkins/service'
import { ServiceError } from '../../src/main/services/service-error'
import { DEFAULT_PROTECTED_JOBS } from '../../src/shared/jenkins'
import {
  SettingsPatchSchema,
  SettingsSchema,
  defaultSettings,
  type Settings,
} from '../../src/shared/settings'
import { JENKINS, ScriptedHttp, jenkins, json } from '../fixtures/jenkins'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

function withJenkins(over: Partial<Settings['jenkins']>): Settings {
  const s = defaultSettings()
  return SettingsSchema.parse({ ...s, jenkins: { ...s.jenkins, ...over } })
}

const NO_WORK: MyWork = { branches: [], prs: [] }

const service = (
  http: HttpClient,
  over: Partial<Settings['jenkins']> = {},
  token: string | null = 't',
  work: MyWork = NO_WORK,
) =>
  new JenkinsService({
    http,
    settings: () => withJenkins(over),
    token: () => token ?? undefined,
    myWork: async () => work,
    demo: DEMO_JENKINS,
  })

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError)
    return err as ServiceError
  }
  throw new Error('expected a failure')
}

describe('Settings → jenkins', () => {
  it('defaults: nothing configured, SPEC protected patterns', () => {
    expect(defaultSettings().jenkins).toEqual({
      baseUrl: '',
      username: '',
      jobs: [],
      deployJob: '',
      protectedPatterns: [...DEFAULT_PROTECTED_JOBS],
    })
  })

  it('validates job paths and URLs; a patch leaves other fields alone', () => {
    expect(() => withJenkins({ jobs: ['apps/../x'] })).toThrow()
    expect(() => withJenkins({ deployJob: 'a?b' })).toThrow()
    expect(() => withJenkins({ baseUrl: 'https://u:p@ci.example.com' })).toThrow()
    expect(() => withJenkins({ username: 'a:b' })).toThrow()
    expect(withJenkins({ baseUrl: 'https://ci.example.com/jenkins/' }).jenkins.baseUrl).toBe(
      'https://ci.example.com/jenkins',
    )
    expect(SettingsPatchSchema.parse({ jenkins: { jobs: ['web-app'] } })).toEqual({
      jenkins: { jobs: ['web-app'] },
    })
  })
})

describe('JenkinsService', () => {
  it('says exactly what is missing before making any request', async () => {
    const http = new ScriptedHttp([])
    const err = await failure(service(http, {}, null).testConnection())
    expect(err.kind).toBe('not_configured')
    expect(err.message).toMatch(
      /add the server URL, your user name, an API token in Settings → Jenkins/,
    )
    const noJobs = await failure(service(http, { baseUrl: JENKINS, username: 'ada' }).branches())
    expect(noJobs.message).toMatch(/add your multibranch pipeline jobs/)
    expect(http.requests).toHaveLength(0)
  })

  it('My branches: a configured job that is gone is listed as skipped, the rest still shown', async () => {
    const http = new ScriptedHttp([
      (r) =>
        new URL(r.url).pathname === '/jenkins/job/web-app/api/json'
          ? json(jenkins.webApp)
          : undefined,
      (r) =>
        new URL(r.url).pathname === '/jenkins/job/gone/api/json'
          ? new Response('', { status: 404 })
          : undefined,
    ])
    const result = await service(
      http,
      { baseUrl: JENKINS, username: 'ada', jobs: ['gone', 'web-app'] },
      't',
      {
        branches: [
          { repo: 'web-app', name: 'develop' },
          { repo: 'web-app', name: 'feature/NM-7-summary-card' },
        ],
        prs: [{ repo: 'web-app', id: 42, branch: 'feature/NM-7-summary-card' }],
      },
    ).branches()
    // Newest build first.
    expect(result.builds.map((b) => b.job)).toEqual([
      'web-app/feature%2FNM-7-summary-card',
      'web-app/PR-42',
      'web-app/develop',
    ])
    expect(result.skipped).toEqual([{ job: 'gone', message: expect.stringMatching(/404/) }])
  })

  it('skipped jobs come back in Settings order, whichever answered first', async () => {
    const http = new ScriptedHttp([
      async (r) => {
        const path = new URL(r.url).pathname
        if (path === '/jenkins/job/slow/api/json') await new Promise((ok) => setTimeout(ok, 20))
        return new Response('', { status: path.includes('/slow/') ? 403 : 404 })
      },
    ])
    const { skipped } = await service(http, {
      baseUrl: JENKINS,
      username: 'ada',
      jobs: ['slow', 'gone'],
    }).branches()
    expect(skipped.map((s) => s.job)).toEqual(['slow', 'gone'])
  })

  it('an auth failure fails the whole list', async () => {
    const http = new ScriptedHttp([() => new Response('', { status: 401 })])
    const err = await failure(
      service(http, { baseUrl: JENKINS, username: 'ada', jobs: ['web-app'] }).branches(),
    )
    expect(err.kind).toBe('auth')
  })

  it('repo slugs from remotes', () => {
    expect(repoSlug('git@bitbucket.org:acme/web-app.git')).toBe('web-app')
    expect(repoSlug('https://bb.example.com/scm/proj/Design-System.git')).toBe('Design-System')
    expect(repoSlug('ssh://git@bb.example.com:7999/proj/web-app')).toBe('web-app')
    expect(repoSlug('')).toBeNull()
  })
})

describe('Jenkins demo', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-25T09:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  const demo = () => {
    const http = new DemoHttpClient(demoHandlers())
    const bitbucket = new BitbucketService({
      http,
      settings: defaultSettings,
      token: () => undefined,
      repoRemotes: async () => [],
      demo: DEMO_BITBUCKET,
    })
    const myPrs = async () =>
      (await bitbucket.list('mine')).map((pr) => ({
        repo: pr.ref.repo,
        id: pr.ref.id,
        branch: pr.sourceBranch,
      }))
    const jenkinsService = new JenkinsService({
      http,
      settings: defaultSettings,
      token: () => undefined,
      myWork: async () => ({ branches: [], prs: await myPrs() }),
      demo: DEMO_JENKINS,
    })
    return { jenkins: jenkinsService, bitbucket }
  }

  it('Test connection needs no credentials in demo mode', async () => {
    expect(await demo().jenkins.testConnection()).toEqual({
      status: 200,
      user: { id: 'dev', fullName: 'Demo Developer' },
      version: '2.479.1',
    })
  })

  it('My branches = the jobs of my open demo PRs, in mixed states', async () => {
    const { builds, skipped } = await demo().jenkins.branches()
    expect(skipped).toEqual([])
    const rows = Object.fromEntries(builds.map((b) => [b.job, b.lastBuild?.state ?? null]))
    expect(rows).toEqual({
      'design-system/PR-88': 'running',
      'web-app/chore%2Fbump-tooling': 'running',
      'design-system/feature%2Fbutton-loading': 'success',
      'web-app/PR-412': 'success',
      'web-app/bugfix%2FDD-101-date-picker-focus': 'success',
      'web-app/PR-415': 'failed',
      'web-app/feature%2FDD-102-checkout-summary-card': 'failed',
    })
    // Others' PRs (410, 91) and branches nobody has locally (develop, main) are not "mine".
    expect(Object.keys(rows)).not.toContain('web-app/PR-410')
  })

  it('a running build passes after 2 minutes, with stages and a growing console', async () => {
    const { jenkins: j } = demo()
    const ref = { job: 'design-system/PR-88', number: 12 }
    const first = await j.build(ref)
    expect(first.build.state).toBe('running')
    expect(first.stages?.some((s) => s.state === 'running')).toBe(true)
    expect(first.stages?.some((s) => s.state === 'skipped')).toBe(false)

    let chunk = await j.console(ref, 0)
    expect(chunk.more).toBe(true)
    let log = chunk.text
    expect(log).toMatch(/^Started by Pull request #88 updated\n/)
    expect(log).not.toMatch(/Finished:/)

    vi.setSystemTime(Date.now() + 2 * 60_000 + 1_000)
    const done = await j.build(ref)
    expect(done.build).toMatchObject({ state: 'success' })
    expect(done.build.durationMs).toBeGreaterThan(0)
    expect(done.stages?.every((s) => s.state === 'success')).toBe(true)
    chunk = await j.console(ref, chunk.nextStart)
    log += chunk.text
    expect(chunk.more).toBe(false)
    expect(log).toMatch(
      /✓ built in 41\.2s\n.*\n\[Pipeline\] End of Pipeline\nFinished: SUCCESS\n$/s,
    )
    expect(log.includes(String.fromCharCode(27))).toBe(false) // ANSI stripped
    expect(log.match(/Started by/g)).toHaveLength(1) // nothing read twice
  })

  it('the failing fixture fails at Build after 90 s; deploy jobs have no stages', async () => {
    const { jenkins: j } = demo()
    vi.setSystemTime(Date.now() + 91_000)
    const failed = await j.build({ job: 'web-app/chore%2Fbump-tooling', number: 2 })
    expect(failed.build.state).toBe('failed')
    expect(failed.stages?.at(-1)).toMatchObject({ name: 'Build', state: 'failed' })
    const deploy = await j.build({ job: 'apps/deploy-dev', number: 57 })
    expect(deploy.stages).toBeNull()
    expect(deploy.parameters).toEqual([{ name: 'BRANCH', value: 'develop' }])
  })

  it('a demo PR resolves to its pipeline through its build status link', async () => {
    const { jenkins: j, bitbucket } = demo()
    const pr = await bitbucket.pr({ owner: 'DEMO', repo: 'design-system', id: 88 })
    expect(await j.resolvePr(pr)).toEqual({
      ok: true,
      job: 'design-system/PR-88',
      build: 12,
      via: 'build-status',
    })
    const noBuilds = await bitbucket.pr({ owner: 'DEMO', repo: 'web-app', id: 419 })
    expect(await j.resolvePr(noBuilds)).toMatchObject({
      ok: true,
      job: 'web-app/chore%2Fbump-tooling',
      via: 'branch',
    })
  })
})
