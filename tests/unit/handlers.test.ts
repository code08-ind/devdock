import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { createHandlers } = await import('../../src/main/handlers')
const { trayMenuTemplate, trayIconPath } = await import('../../src/main/tray')
const { SettingsStore } = await import('../../src/main/services/settings')
const { SecretStore } = await import('../../src/main/services/secrets')
const { NotificationService } = await import('../../src/main/services/notifications')
const { ShortcutService } = await import('../../src/main/services/shortcut')
const { DemoHttpClient } = await import('../../src/main/services/http')
const { demoHandlers } = await import('../../src/main/demo/handlers')

function setup(opts: { encryption?: boolean; registerOk?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'devdock-handlers-'))
  const settings = new SettingsStore(join(dir, 'settings.json'))
  const secrets = new SecretStore(
    join(dir, 'secrets.bin'),
    {
      isEncryptionAvailable: () => opts.encryption ?? true,
      encryptString: (s) => Buffer.from(s).reverse(),
      decryptString: (b) => Buffer.from(b).reverse().toString(),
    },
    'darwin',
  )
  const notifications = new NotificationService({
    file: join(dir, 'notifications.json'),
    getPrefs: () => settings.get().notifications,
    native: { show: vi.fn() },
    onClick: vi.fn(),
  })
  const shortcut = new ShortcutService(
    {
      register: () => opts.registerOk ?? true,
      unregister: vi.fn(),
      isRegistered: () => false,
    },
    vi.fn(),
    'darwin',
  )
  const deps = {
    settings,
    secrets,
    notifications,
    shortcut,
    http: new DemoHttpClient(demoHandlers()),
    logsDir: join(dir, 'logs'),
    versions: () => ({
      version: '0.0.0',
      electron: '1',
      chrome: '1',
      node: '1',
      platform: 'darwin',
      arch: 'arm64',
    }),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    showView: vi.fn(),
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    quit: vi.fn(),
  }
  return { deps, handlers: createHandlers(deps) }
}

describe('handlers', () => {
  it('opens allow-listed links and rejects others without calling shell', async () => {
    const { deps, handlers } = setup()
    expect(
      await dispatch(
        'app:openExternal',
        { url: 'https://team.atlassian.net/browse/NM-1' },
        handlers,
      ),
    ).toEqual({ ok: true, data: undefined })
    expect(deps.openExternal).toHaveBeenCalledWith('https://team.atlassian.net/browse/NM-1')

    for (const url of ['file:///etc/passwd', 'https://evil.example.com/']) {
      const r = await dispatch('app:openExternal', { url }, handlers)
      expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    }
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
  })

  it('maps unavailable encryption to SECRETS_UNAVAILABLE', async () => {
    const { handlers } = setup({ encryption: false })
    const r = await dispatch('secrets:set', { key: 'jira.token', value: 'x' }, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'SECRETS_UNAVAILABLE' } })
  })

  it('never returns secret values, only key names', async () => {
    const { handlers } = setup()
    await dispatch('secrets:set', { key: 'jira.token', value: 'hunter2-token' }, handlers)
    const r = await dispatch('secrets:list', undefined, handlers)
    expect(r).toEqual({ ok: true, data: ['jira.token'] })
    expect(JSON.stringify(r)).not.toContain('hunter2')
  })

  it('persists a shortcut only when it registered', async () => {
    const ok = setup()
    await dispatch('shortcut:set', { accelerator: 'Alt+Shift+D' }, ok.handlers)
    expect(ok.deps.settings.get().general.paletteShortcut).toBe('Alt+Shift+D')

    const taken = setup({ registerOk: false })
    const r = await dispatch('shortcut:set', { accelerator: 'Alt+Shift+D' }, taken.handlers)
    expect(r).toMatchObject({ ok: true, data: { ok: false } })
    expect(taken.deps.settings.get().general.paletteShortcut).toBe('CommandOrControl+Shift+Space')
  })

  it('reports a bad settings import as INVALID_PAYLOAD', async () => {
    const { handlers } = setup()
    const r = await dispatch('settings:import', { json: '{nope' }, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
  })

  it('surfaces a failure to open the logs folder', async () => {
    const { deps, handlers } = setup()
    deps.openPath.mockResolvedValueOnce('No application knows how to open this')
    const r = await dispatch('app:openLogsFolder', undefined, handlers)
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })

  it('settings:update changes only the fields sent (through payload validation)', async () => {
    const { deps, handlers } = setup()
    await dispatch('settings:update', { general: { closeToTray: false } }, handlers)
    await dispatch('settings:update', { appearance: { theme: 'dark' } }, handlers)
    await dispatch('settings:update', { appearance: { fontSize: 18 } }, handlers)
    await dispatch('settings:update', { general: { demoMode: false } }, handlers)
    const s = deps.settings.get()
    expect(s.appearance).toMatchObject({ theme: 'dark', fontSize: 18 })
    expect(s.general).toMatchObject({ closeToTray: false, demoMode: false })
  })

  it('answers demo:ping from fixtures', async () => {
    const { handlers } = setup()
    expect(await dispatch('demo:ping', undefined, handlers)).toEqual({
      ok: true,
      data: { status: 200, body: 'pong (demo)', demo: true },
    })
  })
})

describe('tray menu', () => {
  const click = (items: ReturnType<typeof trayMenuTemplate>, id: string) =>
    (items.find((i) => i.id === id)?.click as (() => void) | undefined)?.()
  const actions = { open: vi.fn(), pause: vi.fn(), resume: vi.fn(), quit: vi.fn() }
  it('offers Open, Pause 1h and Quit', () => {
    const items = trayMenuTemplate({ pausedUntil: null }, actions)
    expect(items.map((i) => i.id).filter(Boolean)).toEqual(['open', 'pause', 'quit'])
    click(items, 'pause')
    expect(actions.pause).toHaveBeenCalledWith(60)
  })
  it('offers Resume while paused', () => {
    const items = trayMenuTemplate({ pausedUntil: Date.now() + 60_000 }, actions)
    expect(items.some((i) => i.id === 'resume')).toBe(true)
    expect(items.some((i) => i.id === 'pause')).toBe(false)
  })
  it('uses the template PNG on macOS and the ICO on Windows', () => {
    expect(trayIconPath('/r', 'darwin')).toMatch(/trayTemplate\.png$/)
    expect(trayIconPath('/r', 'win32')).toMatch(/tray\.ico$/)
  })
})
