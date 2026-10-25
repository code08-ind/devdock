import { describe, expect, it, vi } from 'vitest'
import type { WatchItem } from '../../src/shared/bitbucket'
import type { BuildWatch } from '../../src/shared/jenkins'

vi.mock('electron', () => ({ Menu: {}, Tray: vi.fn(), nativeImage: {}, nativeTheme: {} }))

const {
  DOT_COLORS,
  STALE_AFTER_MS,
  paintDot,
  trayMenuTemplate,
  trayStatus,
  trayTooltip,
  watchedForTray,
} = await import('../../src/main/tray')

const actions = {
  open: vi.fn(),
  togglePanel: vi.fn(),
  showBuilds: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  quit: vi.fn(),
}

const NOW = Date.parse('2026-10-25T12:00:00Z')

const watch = (over: Partial<BuildWatch>): BuildWatch => ({
  key: 'k',
  kind: 'build',
  job: 'web-app/feature%2Fx',
  site: 's',
  number: 3,
  after: null,
  branch: null,
  label: null,
  pr: null,
  addedAt: 0,
  checkedAt: 0,
  build: null,
  done: false,
  error: null,
  ...over,
})
const built = (state: NonNullable<BuildWatch['build']>['state'], startedAt = NOW - 60_000) => ({
  job: 'j',
  number: 3,
  url: '',
  state,
  startedAt,
  durationMs: state === 'running' ? null : 30_000,
  estimatedMs: null,
})
const finishedWatch = (state: 'success' | 'failed', startedAt?: number) =>
  watch({ done: true, build: built(state, startedAt) })
const w = (state: Parameters<typeof trayStatus>[0][number]['state'], finishedAt = NOW) => ({
  label: state,
  state,
  finishedAt: state === 'running' || state === 'waiting' ? null : finishedAt,
})

describe('tray status dot (SPEC 6.1)', () => {
  it('red when any fails, green when finished ones pass, grey when idle', () => {
    expect(trayStatus([], NOW)).toBe('grey')
    expect(trayStatus([w('running')], NOW)).toBe('grey')
    expect(trayStatus([w('waiting'), w('stopped')], NOW)).toBe('grey')
    expect(trayStatus([w('passed'), w('running')], NOW)).toBe('green')
    expect(trayStatus([w('passed'), w('failed')], NOW)).toBe('red')
  })

  it('finished builds stop colouring the dot after a while (back to grey when idle)', () => {
    const old = NOW - STALE_AFTER_MS - 1
    expect(trayStatus([w('failed', old)], NOW)).toBe('grey')
    expect(trayStatus([w('failed', old), w('passed')], NOW)).toBe('green')
    // PR watches have no finish time: an open PR's failed build stays red.
    expect(trayStatus([{ label: 'pr', state: 'failed', finishedAt: null }], NOW)).toBe('red')
    expect(
      trayStatus(
        watchedForTray([finishedWatch('failed', NOW - STALE_AFTER_MS - 120_000)], []),
        NOW,
      ),
    ).toBe('grey')
  })

  it('watched items: build watches by state, plus open PR watches with builds, once each', () => {
    const pr = (id: number, state: string, build: string) =>
      ({
        ref: { owner: 'DEMO', repo: 'web-app', id },
        pr: { state, ref: { repo: 'web-app', id }, build: { state: build } },
      }) as WatchItem
    expect(
      watchedForTray(
        [
          watch({
            label: 'web-app #412 pipeline',
            pr: 'demo/web-app#412',
            build: built('success'),
          }),
          watch({ build: built('unstable') }),
          watch({ build: built('aborted') }),
          watch({ number: null, kind: 'job' }),
          watch({ build: built('running') }),
        ],
        [
          pr(412, 'open', 'success'),
          pr(415, 'open', 'failed'),
          pr(416, 'open', 'none'),
          pr(417, 'merged', 'failed'),
        ],
      ).map(({ label, state }) => [label, state]),
    ).toEqual([
      ['web-app #412 pipeline #3', 'passed'],
      ['web-app › feature/x #3', 'failed'],
      ['web-app › feature/x #3', 'stopped'],
      ['web-app › feature/x', 'waiting'],
      ['web-app › feature/x #3', 'running'],
      // #412 is already listed through its pipeline watch.
      ['web-app #415', 'failed'],
    ])
    expect(watchedForTray([finishedWatch('success', NOW - 60_000)], [])[0]?.finishedAt).toBe(
      NOW - 30_000,
    )
  })

  it('menu lists watched items (first 10, then "n more…") and they open Builds', () => {
    const watched = Array.from({ length: 12 }, (_, i) => ({ ...w('running'), label: `job ${i}` }))
    const items = trayMenuTemplate({ pausedUntil: null, watched }, actions)
    const labels = items.map((i) => i.label).filter(Boolean)
    expect(labels.slice(0, 3)).toEqual(['Open DevDock', 'Watched', 'job 0 — running'])
    expect(labels).toContain('2 more…')
    expect(labels).not.toContain('job 10 — running')
    ;(items.find((i) => i.id === 'watched-0')!.click as () => void)()
    expect(actions.showBuilds).toHaveBeenCalled()
    expect(
      trayMenuTemplate({ pausedUntil: null, watched: [] }, actions).map((i) => i.id),
    ).not.toContain('watched')
  })

  it('tooltip counts', () => {
    expect(trayTooltip([])).toBe('DevDock')
    expect(trayTooltip([w('failed'), w('running'), w('passed')])).toBe(
      'DevDock — 3 watched: 1 failed, 1 running',
    )
  })

  it('paints a dot (premultiplied BGRA) bottom-right with a gap, recolouring the glyph', () => {
    const size = 32
    const px = new Uint8Array(size * size * 4)
    for (let i = 0; i < px.length; i += 4) px.set([0, 0, 0, 255], i) // a solid black glyph
    px.set([0, 0, 0, 128], 0) // one half-transparent edge pixel
    paintDot(px, size, size, DOT_COLORS.red, [255, 255, 255])
    const at = (x: number, y: number) =>
      Array.from(px.subarray((y * size + x) * 4, (y * size + x) * 4 + 4))
    expect(at(size - 4, size - 4)).toEqual([47, 36, 209, 255]) // red, as B G R A
    expect(at(2, 2)).toEqual([255, 255, 255, 255]) // glyph turned white
    expect(at(0, 0)).toEqual([128, 128, 128, 128]) // never brighter than its alpha
    // A transparent ring separates the dot from the glyph.
    const ring = Array.from({ length: size }, (_, x) => at(x, size - 8)[3]).filter((a) => a === 0)
    expect(ring.length).toBeGreaterThan(0)
  })

  it('a half-transparent dot for the macOS template stays premultiplied', () => {
    const px = new Uint8Array(16 * 16 * 4)
    paintDot(px, 16, 16, [0, 0, 0], null, 150)
    expect(Array.from(px.subarray((15 * 16 + 13) * 4, (15 * 16 + 13) * 4 + 4))).toEqual([
      0, 0, 0, 150,
    ])
  })
})
