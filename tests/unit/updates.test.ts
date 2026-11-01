import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewer, LATEST_RELEASE_API, parseVersion } from '../../src/shared/updates'
import type { HttpClient } from '../../src/main/services/http'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
const { UpdateService } = await import('../../src/main/services/updates')
const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const release = (tag: string, url = `https://github.com/code08-ind/devdock/releases/tag/${tag}`) =>
  Response.json({ tag_name: tag, html_url: url, draft: false, prerelease: false })

function setup(answer: () => Response | Promise<Response>, demo = false) {
  const dir = mkdtempSync(join(tmpdir(), 'devdock-upd-'))
  dirs.push(dir)
  const urls: string[] = []
  const http: HttpClient = {
    demo,
    async fetch(r) {
      urls.push(r.url)
      return answer()
    },
  }
  const notify = vi.fn()
  const deps = {
    http,
    current: '0.1.0',
    enabled: () => true,
    notify,
    onChange: vi.fn(),
    file: join(dir, 'notice.json'),
    now: () => 1_000,
  }
  return { updates: new UpdateService(deps), deps, urls, notify }
}

describe('update notice (T9)', () => {
  it('compares versions', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3-beta.1')).toBeNull()
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
  })

  it('a newer published release: its page and one notification per version', async () => {
    const { updates, deps, urls, notify } = setup(() => release('v0.2.0'))
    const status = await updates.check()
    expect(urls).toEqual([LATEST_RELEASE_API])
    expect(status).toMatchObject({
      current: '0.1.0',
      latest: '0.2.0',
      url: 'https://github.com/code08-ind/devdock/releases/tag/v0.2.0',
      error: null,
    })
    expect(updates.releaseUrl()).toBe(status.url)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'update-available', title: 'DevDock 0.2.0 is available' }),
    )
    await updates.check()
    // Said once, also after a restart.
    await new UpdateService(deps).check()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('up to date, nothing published yet, offline, or a page outside this repo', async () => {
    expect(await setup(() => release('v0.1.0')).updates.check()).toMatchObject({
      latest: '0.1.0',
      url: null,
    })
    expect(
      await setup(() => Response.json({ message: 'Not Found' }, { status: 404 })).updates.check(),
    ).toMatchObject({ noRelease: true, error: null })
    expect(
      await setup(() => {
        throw new TypeError('fetch failed')
      }).updates.check(),
    ).toMatchObject({ error: "Couldn't reach GitHub." })
    const odd = setup(() => release('v9.9.9', 'https://evil.example/download'))
    expect(await odd.updates.check()).toMatchObject({ latest: '9.9.9', url: null })
    expect(odd.updates.releaseUrl()).toBeNull()
  })

  it('demo mode makes no request', async () => {
    const { updates, urls } = setup(() => release('v0.2.0'), true)
    expect(await updates.check()).toMatchObject({ demo: true, latest: null })
    expect(urls).toEqual([])
  })

  it('updates:open opens only a newer release page', async () => {
    const { deps, handlers } = await handlerSetup()
    expect(await dispatch('updates:open', undefined, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})
