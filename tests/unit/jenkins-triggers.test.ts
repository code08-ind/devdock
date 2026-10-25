import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

const DEMO_PR = (repo: string, id: number) =>
  `https://demo.devdock.invalid/bitbucket/projects/DEMO/repos/${repo}/pull-requests/${id}`

/** Requests the demo server saw in the current test. */
let sent: Request[] = []
const posts = () => sent.filter((r) => r.method === 'POST').map((r) => new URL(r.url).pathname)

async function setup(features: { jobTriggers?: boolean; allowedJobs?: string[] } = {}) {
  const s = await handlerSetup()
  sent = []
  const fetch = s.deps.http.fetch.bind(s.deps.http)
  vi.spyOn(s.deps.http, 'fetch').mockImplementation(async (request: Request) => {
    sent.push(request.clone())
    return fetch(request)
  })
  s.deps.settings.update({ features })
  return s
}

afterEach(() => vi.useRealTimers())

describe('job triggers behind the Settings switch, allow-list and protected patterns', () => {
  const trigger = (job: string, parameters: Record<string, string> = {}) => ({
    job,
    parameters,
    confirmed: true as const,
  })

  it('off by default: the handler refuses before anything is sent', async () => {
    const { deps, handlers } = await setup({ allowedJobs: ['apps/deploy-dev'] })
    expect(deps.settings.get().features.jobTriggers).toBe(false)
    const r = await dispatch('jenkins:trigger', trigger('apps/deploy-dev'), handlers)
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED', message: expect.stringMatching(/turned off/) },
    })
    expect(sent).toEqual([])
  })

  it('on, but the job is not allow-listed → refused', async () => {
    const { handlers } = await setup({ jobTriggers: true, allowedJobs: ['web-app/develop'] })
    const r = await dispatch('jenkins:trigger', trigger('apps/deploy-dev'), handlers)
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED', message: expect.stringMatching(/isn't on the list/) },
    })
    expect(sent).toEqual([])
  })

  it('protected jobs are refused even when switched on and allow-listed (any case, any folder)', async () => {
    const protectedJobs = [
      'apps/deploy-prod',
      'APPS/Deploy-PROD',
      'production/web',
      'apps/uat',
      'Release Train/web-app',
      'web-app/release%2F2.4',
    ]
    const { handlers } = await setup({ jobTriggers: true, allowedJobs: protectedJobs })
    for (const job of protectedJobs) {
      const r = await dispatch('jenkins:trigger', trigger(job), handlers)
      expect(r, job).toMatchObject({
        ok: false,
        error: { code: 'NOT_ALLOWED', message: expect.stringMatching(/protected pattern/) },
      })
    }
    expect(sent).toEqual([])
  })

  it('custom protected patterns from Settings apply too', async () => {
    const { deps, handlers } = await setup({ jobTriggers: true, allowedJobs: ['apps/deploy-dev'] })
    deps.settings.update({ jenkins: { protectedPatterns: ['deploy-*'] } })
    const r = await dispatch('jenkins:trigger', trigger('apps/deploy-dev'), handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    expect(sent).toEqual([])
  })

  it('no confirmation flag or a bad parameter name → invalid payload', async () => {
    const { handlers } = await setup({ jobTriggers: true, allowedJobs: ['apps/deploy-dev'] })
    for (const bad of [
      { job: 'apps/deploy-dev', parameters: {} },
      { job: 'apps/deploy-dev', parameters: { 'a b': 'x' }, confirmed: true },
      { job: 'apps/../x', parameters: {}, confirmed: true },
    ]) {
      expect(await dispatch('jenkins:trigger', bad, handlers)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
    expect(sent).toEqual([])
  })

  it('allowed (any spelling of the path): queued with the crumb and parameters; a job watch follows the build', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-25T09:00:00Z') })
    const { deps, handlers } = await setup({ jobTriggers: true, allowedJobs: ['Apps/Deploy-Dev'] })
    expect(await dispatch('jenkins:parameters', { job: 'apps/deploy-dev' }, handlers)).toEqual({
      ok: true,
      data: [
        {
          name: 'BRANCH',
          type: 'string',
          defaultValue: 'develop',
          choices: [],
          description: 'Branch to deploy',
        },
      ],
    })
    const watch = await dispatch(
      'buildwatch:add',
      { kind: 'job', job: 'apps/deploy-dev' },
      handlers,
    )
    // #58 (my branch's deploy) is running at the start of the demo, so the job watch follows it.
    expect(watch).toMatchObject({ ok: true, data: { number: 58 } })

    const r = await dispatch(
      'jenkins:trigger',
      trigger('apps/deploy-dev', { BRANCH: 'feature/x' }),
      handlers,
    )
    expect(r).toEqual({
      ok: true,
      data: { queueUrl: expect.stringMatching(/\/queue\/item\/\d+\/$/) },
    })
    expect(posts()).toEqual(['/jenkins/job/apps/job/deploy-dev/buildWithParameters'])
    const post = sent.find((q) => q.method === 'POST')!
    expect(post.headers.get('Jenkins-Crumb')).toBe('demo-crumb')
    expect(await post.text()).toBe('BRANCH=feature%2Fx')

    const deploy = await dispatch(
      'buildwatch:add',
      { kind: 'deploy', branch: 'feature/x' },
      handlers,
    )
    expect(deploy).toMatchObject({ ok: true, data: { number: 59, job: 'apps/deploy-dev' } })
    vi.setSystemTime(Date.now() + 61_000)
    await deps.buildWatcher.poll()
    const notes = deps.notifications.list().filter((n) => n.type === 'job-finished')
    expect(notes.map((n) => n.title)).toEqual(['Passed · apps › deploy-dev #59'])
  })
})

describe('Watch PR pipeline (demo)', () => {
  it('a PR link → its Jenkins build → a "passed" notification when it finishes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-25T09:00:00Z') })
    const { deps, handlers } = await setup()
    const r = await dispatch('buildwatch:addPr', { link: DEMO_PR('design-system', 88) }, handlers)
    expect(r).toMatchObject({
      ok: true,
      data: {
        kind: 'build',
        job: 'design-system/PR-88',
        number: 12,
        label: 'design-system #88 pipeline',
        done: false,
      },
    })
    await deps.buildWatcher.poll()
    expect(deps.notifications.list()).toEqual([])
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1_000)
    await deps.buildWatcher.poll()
    expect(deps.notifications.list()).toEqual([
      expect.objectContaining({
        type: 'job-finished',
        title: 'Passed · design-system #88 pipeline #12',
        url: 'https://demo.devdock.invalid/jenkins/job/design-system/job/PR-88/12/',
      }),
    ])
    expect(await dispatch('buildwatch:list', undefined, handlers)).toMatchObject({
      ok: true,
      data: [{ done: true, build: { state: 'success' } }],
    })
  })

  it('a link that isn’t a PR, or is on another site, is refused before any request', async () => {
    const { handlers } = await setup()
    expect(await dispatch('buildwatch:addPr', { link: 'hello' }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })
    expect(
      await dispatch(
        'buildwatch:addPr',
        { link: 'https://bitbucket.org/acme/web-app/pull-requests/1' },
        handlers,
      ),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
    expect(sent).toEqual([])
  })

  it('the failing demo build ends in a failed notification naming the stage', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-25T09:00:00Z') })
    const { deps, handlers } = await setup()
    await dispatch('buildwatch:add', { kind: 'job', job: 'web-app/chore%2Fbump-tooling' }, handlers)
    vi.setSystemTime(Date.now() + 91_000)
    await deps.buildWatcher.poll()
    expect(deps.notifications.list()).toEqual([
      expect.objectContaining({
        title: 'Failed · web-app › chore/bump-tooling #2',
        body: expect.stringMatching(/Failed at: Build$/),
      }),
    ])
  })
})
