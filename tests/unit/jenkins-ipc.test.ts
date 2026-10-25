import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

describe('jenkins:* IPC', () => {
  it('demo mode: test connection, a build with stages and its console', async () => {
    const { handlers } = await handlerSetup()
    expect(await dispatch('jenkins:testConnection', undefined, handlers)).toMatchObject({
      ok: true,
      data: { user: { id: 'dev' } },
    })
    const build = await dispatch('jenkins:build', { job: 'web-app/PR-415', number: 12 }, handlers)
    expect(build).toMatchObject({ ok: true, data: { build: { state: 'failed' } } })
    const log = await dispatch(
      'jenkins:console',
      { job: 'web-app/PR-415', number: 12, start: 0 },
      handlers,
    )
    expect(log).toMatchObject({
      ok: true,
      data: { more: false, text: expect.stringMatching(/FAIL/) },
    })
  })

  it('job paths that could change the request path are refused before any request', async () => {
    const { deps, handlers } = await handlerSetup()
    const fetch = vi.spyOn(deps.http, 'fetch')
    for (const job of ['../../script', 'a//b', 'a?x=1', 'a#b', '']) {
      const r = await dispatch('jenkins:build', { job, number: 1 }, handlers)
      expect(r, job).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    }
    const negative = await dispatch('jenkins:console', { job: 'a', number: 1, start: -1 }, handlers)
    expect(negative).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('outside demo mode, a missing setup is NOT_CONFIGURED with the fix', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ general: { demoMode: false } })
    // The fixture's client is always the demo one; the service decides by `http.demo`.
    Object.defineProperty(deps.http, 'demo', { value: false })
    expect(await dispatch('jenkins:branches', undefined, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: expect.stringMatching(/Settings → Jenkins/) },
    })
  })
})
