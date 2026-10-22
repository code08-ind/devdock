import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch, IpcError } = await import('../../src/main/ipc/registry')
const { DemoHttpClient, SwitchingHttpClient, RealHttpClient } =
  await import('../../src/main/services/http')
const { DEMO_ORIGIN, demoHandlers } = await import('../../src/main/demo/handlers')

type Handlers = Parameters<typeof dispatch>[2]
const handlers = {
  'notifications:pause': vi.fn(() => undefined),
  'secrets:set': vi.fn(() => {
    throw new IpcError('SECRETS_UNAVAILABLE', 'Encryption unavailable.')
  }),
  'app:openLogsFolder': vi.fn(() => 'unexpected'),
} as unknown as Handlers

describe('dispatch', () => {
  it('rejects invalid payloads with a typed error, without calling the handler', async () => {
    const r = await dispatch('notifications:pause', { minutes: 'soon' }, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(handlers['notifications:pause']).not.toHaveBeenCalled()
  })
  it('passes valid payloads through', async () => {
    expect(await dispatch('notifications:pause', { minutes: 60 }, handlers)).toEqual({
      ok: true,
      data: undefined,
    })
  })
  it('returns IpcErrors verbatim', async () => {
    const r = await dispatch('secrets:set', { key: 'jira.token', value: 'x' }, handlers)
    expect(r).toEqual({
      ok: false,
      error: { code: 'SECRETS_UNAVAILABLE', message: 'Encryption unavailable.' },
    })
  })
  it('rejects unknown secret keys', async () => {
    const r = await dispatch('secrets:set', { key: 'aws.root', value: 'x' }, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
  })
  it('validates handler responses too', async () => {
    const r = await dispatch('app:openLogsFolder', undefined, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })
})

describe('demo-mode http', () => {
  it('answers from MSW handlers without network', async () => {
    const res = await new DemoHttpClient(demoHandlers()).fetch(new Request(`${DEMO_ORIGIN}/ping`))
    expect(await res.text()).toBe('pong (demo)')
  })
  it('returns 501 for requests without a fixture', async () => {
    const res = await new DemoHttpClient(demoHandlers()).fetch(
      new Request('https://bitbucket.org/api'),
    )
    expect(res.status).toBe(501)
  })
  it('switches clients per call', async () => {
    let demo = true
    const realFetch = vi.fn(async () => new Response('real'))
    const client = new SwitchingHttpClient(
      () => demo,
      new RealHttpClient(realFetch),
      new DemoHttpClient(demoHandlers()),
    )
    expect(await (await client.fetch(new Request(`${DEMO_ORIGIN}/ping`))).text()).toBe(
      'pong (demo)',
    )
    demo = false
    expect(await (await client.fetch(new Request(`${DEMO_ORIGIN}/ping`))).text()).toBe('real')
    expect(realFetch).toHaveBeenCalledOnce()
  })
})
