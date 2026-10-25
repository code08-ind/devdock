import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftText } from '../../src/shared/standup'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

afterEach(() => vi.useRealTimers())

describe('P5.D4: standup from demo data', () => {
  it('on a Monday: Friday-to-Monday commits, PRs opened/merged, ticket moves; Today from in-progress tickets', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 26, 9, 0) }) // Monday 09:00
    const { handlers } = await handlerSetup()
    const r = await dispatch('standup:draft', undefined, handlers)
    expect(r).toEqual({
      ok: true,
      data: {
        yesterdayDate: '2026-10-23',
        yesterday: [
          'web-app: DD-101: keep focus on the trigger after a month change',
          'web-app: DD-101: regression test for month navigation',
          'design-system: Button: aria-busy while loading',
          'Opened PR web-app #412 DD-101: Fix date picker losing focus on month change',
          'Opened PR web-app #415 DD-102: Checkout summary card (Figma v3)',
          'Opened PR web-app #419 Chore: bump vite and vitest',
          // Opened Friday 01:00 and merged Saturday: both in the window.
          'Opened and merged PR web-app #401 DD-095: Remember last used repo filter',
          'DD-106 → In Review: Export orders as CSV',
          'DD-107 → Done: Add retries to the webhook sender',
        ],
        today: [
          'DD-101: Checkout total rounds wrong for 3-decimal currencies (In Progress)',
          'DD-106: Export orders as CSV (In Review)',
          'DD-108: Toast flickers when switching to dark mode (In Progress)',
        ],
        blockers: [],
        notes: [],
      },
    })
    // PR #88 (opened this morning) and #395 (merged last week) are outside the window.
    expect(r.ok && draftText(r.data)).toMatch(/^Yesterday \(Friday 23 October\)\n- web-app: DD-101/)
  })

  it('a holiday Friday moves Yesterday to Thursday', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 26, 9, 0) })
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({ standup: { holidays: ['2026-10-23'] } })
    const r = await dispatch('standup:draft', undefined, handlers)
    expect(r).toMatchObject({ ok: true, data: { yesterdayDate: '2026-10-22' } })
  })
})
