import { describe, expect, it, vi } from 'vitest'
import {
  ShortcutService,
  checkAccelerator,
  normalizeAccelerator,
} from '../../src/main/services/shortcut'

describe('checkAccelerator', () => {
  it('accepts the default on both OSes', () => {
    expect(checkAccelerator('CommandOrControl+Shift+Space', 'darwin').ok).toBe(true)
    expect(checkAccelerator('CommandOrControl+Shift+Space', 'win32').ok).toBe(true)
  })
  it.each([
    ['Space', 'darwin', 'modifier'],
    ['Shift+K', 'darwin', 'Shift alone'],
    ['Ctrl+Shift', 'win32', 'exactly one key'],
    ['Ctrl++', 'win32', 'not valid'],
    ['Command+Space', 'darwin', 'reserved'],
    ['CommandOrControl+Q', 'darwin', 'reserved'],
    ['Alt+Tab', 'win32', 'reserved'],
    ['Control+Alt+Delete', 'win32', 'reserved'],
  ] as const)('rejects %s on %s', (acc, platform, why) => {
    const r = checkAccelerator(acc, platform)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(why)
  })
  it('normalises aliases and order', () => {
    expect(normalizeAccelerator('Shift+CmdOrCtrl+Space', 'darwin')).toBe('cmd+shift+space')
    expect(normalizeAccelerator('Shift+CmdOrCtrl+Space', 'win32')).toBe('ctrl+shift+space')
  })
})

describe('ShortcutService', () => {
  const fakeGs = (taken: string[] = []) => {
    const registered = new Set<string>()
    return {
      registered,
      register: vi.fn((a: string) => (taken.includes(a) ? false : (registered.add(a), true))),
      unregister: vi.fn((a: string) => void registered.delete(a)),
      isRegistered: (a: string) => registered.has(a),
    }
  }

  it('registers, and on conflict keeps the previous shortcut', () => {
    const gs = fakeGs(['Alt+Shift+D'])
    const svc = new ShortcutService(gs, () => {}, 'darwin')
    expect(svc.set('CommandOrControl+Shift+Space')).toEqual({
      ok: true,
      accelerator: 'CommandOrControl+Shift+Space',
    })
    const r = svc.set('Alt+Shift+D')
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('Another app') })
    expect([...gs.registered]).toEqual(['CommandOrControl+Shift+Space'])
  })

  it('does not touch the OS for invalid input', () => {
    const gs = fakeGs()
    const svc = new ShortcutService(gs, () => {}, 'win32')
    expect(svc.set('Alt+F4').ok).toBe(false)
    expect(gs.register).not.toHaveBeenCalled()
  })
})
