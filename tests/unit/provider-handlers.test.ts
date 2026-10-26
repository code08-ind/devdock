import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

const FAILED = { provider: 'github', project: 'acme/storefront', id: 9002 } as const
const MR = { provider: 'gitlab', owner: 'acme', repo: 'infra-tools', id: 17 } as const

describe('provider IPC (P7-B)', () => {
  it('GitHub and GitLab are off by default: lists and runs say how to turn them on', async () => {
    const { handlers } = await handlerSetup()
    for (const provider of ['github', 'gitlab'] as const) {
      expect(await dispatch('prs:list', { provider, list: 'mine' }, handlers)).toMatchObject({
        ok: false,
        error: { code: 'NOT_CONFIGURED', message: expect.stringMatching(/turned off/) },
      })
      expect(await dispatch('ci:runs', { provider }, handlers)).toMatchObject({
        ok: false,
        error: { code: 'NOT_CONFIGURED' },
      })
    }
    // Bitbucket stays on (every install before P7 used it).
    expect(
      await dispatch('prs:list', { provider: 'bitbucket', list: 'mine' }, handlers),
    ).toMatchObject({ ok: true })
  })

  it('once on (demo): PRs, runs, a run with jobs and its log; Test connection is recorded', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ github: { enabled: true }, gitlab: { enabled: true } })
    const mine = await dispatch('prs:list', { provider: 'gitlab', list: 'mine' }, handlers)
    expect(mine.ok && mine.data.map((p) => p.ref.provider)).toEqual(['gitlab', 'gitlab'])
    const runs = await dispatch('ci:runs', { provider: 'github' }, handlers)
    expect(runs.ok && runs.data.runs.length).toBeGreaterThan(0)
    const detail = await dispatch('ci:run', FAILED, handlers)
    expect(detail.ok && detail.data.jobs.length).toBe(2)
    const log = await dispatch('ci:log', { ref: FAILED, jobId: 70022 }, handlers)
    expect(log.ok && log.data.text).toMatch(/exit code 1/)
    expect(await dispatch('github:testConnection', undefined, handlers)).toMatchObject({ ok: true })
    const report = JSON.parse(await deps.diagnostics.report())
    expect(report.lastConnectionTests.GitHub).toMatchObject({ ok: true })
  })

  it('CI actions: refused while the switch is off (nothing sent); allowed after, still confirmed', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ github: { enabled: true } })
    const fetch = vi.spyOn(deps.http, 'fetch')
    const off = await dispatch(
      'ci:action',
      { ref: FAILED, action: 'retry', confirmed: true },
      handlers,
    )
    expect(off).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED', message: expect.stringMatching(/Settings → CI actions/) },
    })
    expect(fetch).not.toHaveBeenCalled()
    // Without the confirmation the payload itself is refused.
    expect(await dispatch('ci:action', { ref: FAILED, action: 'retry' }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })

    deps.settings.update({ features: { ciActions: true } })
    expect(
      await dispatch(
        'ciwatch:add',
        { link: 'https://github.demo.devdock.invalid/acme/storefront/actions/runs/9002' },
        handlers,
      ),
    ).toMatchObject({ ok: true, data: { done: true } })
    const rerun = await dispatch(
      'ci:action',
      { ref: FAILED, action: 'retry', confirmed: true },
      handlers,
    )
    expect(rerun).toMatchObject({ ok: true, data: { state: 'running', attempt: 2 } })
    // The watch follows the re-run.
    expect(deps.ciWatcher.list()[0]).toMatchObject({ done: false, run: { attempt: 2 } })
    // A finished state is refused before anything is sent.
    expect(
      await dispatch('ci:action', { ref: FAILED, action: 'retry', confirmed: true }, handlers),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
  })

  it('PR actions on any provider are behind the same switch; GitLab has no request changes', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ gitlab: { enabled: true } })
    const approve = { ref: MR, action: 'approve', confirmed: true } as const
    expect(await dispatch('prs:action', approve, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    deps.settings.update({ features: { prActions: true } })
    const done = await dispatch('prs:action', approve, handlers)
    expect(done.ok && done.data.reviewers).toContainEqual({ name: 'demo-dev', status: 'approved' })
    expect(
      await dispatch('prs:action', { ...approve, action: 'needs_work' }, handlers),
    ).toMatchObject({ ok: false, error: { code: 'SERVICE_FORBIDDEN' } })
  })

  it('watch links: GitLab MR links once GitLab is on; other sites refused', async () => {
    const { deps, handlers } = await handlerSetup()
    const link = 'https://gitlab.demo.devdock.invalid/acme/web/checkout/-/merge_requests/45'
    expect(await dispatch('watch:add', { link }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED', message: expect.stringMatching(/Turn on GitLab/) },
    })
    deps.settings.update({ gitlab: { enabled: true } })
    expect(await dispatch('watch:add', { link }, handlers)).toMatchObject({
      ok: true,
      data: { key: 'gitlab:acme/web/checkout#45' },
    })
    expect(
      await dispatch('watch:add', { link: 'https://gitlab.com/a/b/-/merge_requests/1' }, handlers),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
  })

  it('run refs are checked like any renderer input', async () => {
    const { handlers } = await handlerSetup()
    for (const bad of [
      { provider: 'github', project: '../etc', id: 1 },
      { provider: 'github', project: 'a/b/c', id: 1 },
      { provider: 'gitlab', project: 'a', id: 1 },
      { provider: 'jenkins', project: 'a/b', id: 1 },
    ]) {
      expect(await dispatch('ci:run', bad, handlers)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
  })
})
