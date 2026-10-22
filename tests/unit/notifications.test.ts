import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../src/shared/settings'
import {
  HISTORY_LIMIT,
  NotificationService,
  inQuietHours,
} from '../../src/main/services/notifications'

const at = (h: number, m = 0) => new Date(2026, 9, 22, h, m)

describe('inQuietHours', () => {
  it('handles windows that wrap midnight', () => {
    expect(inQuietHours(at(23), '19:00', '09:00')).toBe(true)
    expect(inQuietHours(at(3), '19:00', '09:00')).toBe(true)
    expect(inQuietHours(at(9), '19:00', '09:00')).toBe(false)
    expect(inQuietHours(at(12), '19:00', '09:00')).toBe(false)
  })
  it('handles same-day windows and empty windows', () => {
    expect(inQuietHours(at(13, 30), '13:00', '14:00')).toBe(true)
    expect(inQuietHours(at(14), '13:00', '14:00')).toBe(false)
    expect(inQuietHours(at(10), '10:00', '10:00')).toBe(false)
  })
})

function setup(now = at(12)) {
  const prefs = structuredClone(defaultSettings().notifications)
  const show = vi.fn()
  const file = join(mkdtempSync(join(tmpdir(), 'devdock-notif-')), 'n.json')
  let clock = now
  const svc = new NotificationService({
    file,
    getPrefs: () => prefs,
    native: { show },
    onClick: () => {},
    now: () => clock,
  })
  return { svc, prefs, show, file, setClock: (d: Date) => (clock = d) }
}

describe('NotificationService', () => {
  const n = { type: 'build-finished' as const, title: 'Build passed', body: 'feature/NM-1' }

  it('shows and records', () => {
    const { svc, show } = setup()
    const r = svc.notify(n)
    expect(r.shown).toBe(true)
    expect(show).toHaveBeenCalledOnce()
    expect(svc.list()[0]?.id).toBe(r.id)
  })

  it('suppresses per type, in quiet hours, and while paused — but keeps history', () => {
    const { svc, prefs, show, setClock } = setup()
    prefs.types['build-finished'] = false
    expect(svc.notify(n).suppressedReason).toBe('type-off')
    prefs.types['build-finished'] = true
    prefs.quietHours.enabled = true
    setClock(at(22))
    expect(svc.notify(n).suppressedReason).toBe('quiet-hours')
    setClock(at(12))
    svc.pause(60)
    expect(svc.notify(n).suppressedReason).toBe('paused')
    setClock(at(13, 1))
    expect(svc.getPausedUntil()).toBeNull()
    expect(svc.notify(n).shown).toBe(true)
    expect(show).toHaveBeenCalledOnce()
    expect(svc.list()).toHaveLength(4)
  })

  it('keeps only the last 200 and persists across restarts', () => {
    const { svc, file } = setup()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) svc.notify({ ...n, title: `#${i}` })
    expect(svc.list()).toHaveLength(HISTORY_LIMIT)
    const again = new NotificationService({
      file,
      getPrefs: () => defaultSettings().notifications,
      native: { show: () => {} },
      onClick: () => {},
    })
    expect(again.list()).toHaveLength(HISTORY_LIMIT)
    expect(again.list()[0]?.title).toBe(`#${HISTORY_LIMIT + 4}`)
  })
})
