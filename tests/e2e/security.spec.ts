import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixtures'

/** SPEC §5 security baseline, checked in the real, built app. */
test.describe('security baseline', () => {
  test('renderer has no Node: require and process are undefined', async ({ launched }) => {
    const types = await launched.win.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      module: typeof (window as unknown as { module?: unknown }).module,
    }))
    expect(types).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' })
  })

  test('CSP blocks inline and remote scripts', async ({ launched }) => {
    const result = await launched.win.evaluate(async () => {
      const violations: string[] = []
      document.addEventListener('securitypolicyviolation', (e) =>
        violations.push(`${e.effectiveDirective} ${e.blockedURI}`),
      )
      const w = window as unknown as { __inlineRan?: boolean }

      const inline = document.createElement('script')
      inline.textContent = 'window.__inlineRan = true'
      document.body.append(inline)

      const remote = document.createElement('script')
      remote.src = 'https://example.com/evil.js'
      const remoteBlocked = new Promise<boolean>((resolve) => {
        remote.onerror = () => resolve(true)
        remote.onload = () => resolve(false)
      })
      document.body.append(remote)

      const blocked = await remoteBlocked
      await new Promise((r) => setTimeout(r, 100))
      return { inlineRan: w.__inlineRan === true, remoteBlocked: blocked, violations }
    })
    expect(result.inlineRan).toBe(false)
    expect(result.remoteBlocked).toBe(true)
    expect(result.violations.join('\n')).toMatch(/script-src.* inline/)
    expect(result.violations.join('\n')).toContain('https://example.com/evil.js')
  })

  test('navigation to an external URL is blocked', async ({ launched }) => {
    const { app, win, userData } = launched
    const before = win.url()
    await win.evaluate(() => {
      window.location.href = 'https://example.com/'
    })
    // Wait for the main process to record the block (src/main/security.ts → onBlocked).
    const log = () => readFileSync(join(userData, 'logs', 'devdock.log'), 'utf8')
    await expect.poll(log).toContain('blocked navigate: https://example.com/')
    // Asked of the main process: Playwright keeps waiting on a cancelled navigation otherwise.
    const urls = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()),
    )
    expect(urls).toContain(before)
    expect(urls.some((u) => u.includes('example.com'))).toBe(false)
  })

  test('window.open is denied and logged', async ({ launched }) => {
    const { app, win, userData } = launched
    const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const before = await count()
    expect(await win.evaluate(() => window.open('https://example.com/') === null)).toBe(true)
    const log = () => readFileSync(join(userData, 'logs', 'devdock.log'), 'utf8')
    await expect.poll(log).toContain('blocked window: https://example.com/')
    expect(await count()).toBe(before)
  })

  test('openExternal rejects file: links and hosts outside the allowlist', async ({ launched }) => {
    const r = await launched.win.evaluate(async () => [
      await window.devdock.app.openExternal({ url: 'file:///etc/passwd' }),
      await window.devdock.app.openExternal({ url: 'https://evil.example.com/' }),
      await window.devdock.app.openExternal({ url: 'javascript:alert(1)' }),
    ])
    for (const env of r) expect(env).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })

  test('invalid IPC payloads get a typed error', async ({ launched }) => {
    const r = await launched.win.evaluate(() =>
      // @ts-expect-error deliberately wrong payload
      window.devdock.notifications.pause({ minutes: 'soon' }),
    )
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
  })
})
