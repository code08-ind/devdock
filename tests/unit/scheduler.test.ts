import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
  Scheduler,
  nextDelay,
} from '../../src/main/services/scheduler'
import { ServiceError } from '../../src/main/services/service-error'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const FG = 60_000
const BG = 180_000

describe('nextDelay', () => {
  it('healthy: the interval ±10 %', () => {
    expect(nextDelay({ intervalMs: FG, failures: 0, random: 0 })).toBe(54_000)
    expect(nextDelay({ intervalMs: FG, failures: 0, random: 0.5 })).toBe(60_000)
    expect(nextDelay({ intervalMs: FG, failures: 0, random: 0.999999 })).toBe(66_000)
  })

  it('after failures: doubles each time with equal jitter, capped at 30 min', () => {
    // n failures → interval × 2ⁿ, then between half and all of it.
    expect(nextDelay({ intervalMs: FG, failures: 1, random: 0 })).toBe(60_000)
    expect(nextDelay({ intervalMs: FG, failures: 1, random: 0.999999 })).toBe(120_000)
    expect(nextDelay({ intervalMs: FG, failures: 2, random: 0.5 })).toBe(180_000)
    expect(nextDelay({ intervalMs: FG, failures: 3, random: 0.999999 })).toBe(480_000)
    for (const failures of [5, 10, 60]) {
      const d = nextDelay({ intervalMs: FG, failures, random: 0.999999 })
      expect(d).toBeLessThanOrEqual(MAX_BACKOFF_MS)
      expect(d).toBeGreaterThan(MAX_BACKOFF_MS - 10)
      expect(nextDelay({ intervalMs: FG, failures, random: 0 })).toBe(MAX_BACKOFF_MS / 2)
    }
  })

  it('never earlier than Retry-After; a huge one is capped', () => {
    expect(nextDelay({ intervalMs: FG, failures: 1, retryAfterSec: 600, random: 0 })).toBe(600_000)
    // A short Retry-After doesn't shorten the backoff.
    expect(nextDelay({ intervalMs: FG, failures: 3, retryAfterSec: 5, random: 0 })).toBe(240_000)
    expect(nextDelay({ intervalMs: FG, failures: 1, retryAfterSec: 10 ** 9, random: 0 })).toBe(
      MAX_RETRY_AFTER_MS,
    )
  })
})

describe('Scheduler', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  /** A scheduler whose runs are recorded as offsets from the start, in seconds. */
  function setup(outcomes: (Error | null)[] = []) {
    const start = Date.now()
    const runs: number[] = []
    const run = vi.fn(async () => {
      runs.push((Date.now() - start) / 1000)
      const outcome = outcomes.shift()
      if (outcome) throw outcome
    })
    const scheduler = new Scheduler({
      name: 'test',
      run,
      intervalsMs: () => ({ foreground: FG, background: BG }),
      random: () => 0.5, // no jitter: exact intervals
    })
    return { scheduler, runs, run }
  }

  it('polls at once, then every 3 min in the background and every 60 s in the foreground', async () => {
    const { scheduler, runs } = setup()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0])
    await vi.advanceTimersByTimeAsync(BG)
    expect(runs).toEqual([0, 180])
    scheduler.setFocused(true)
    await vi.advanceTimersByTimeAsync(0) // 0 s since the last run: not due yet
    expect(runs).toEqual([0, 180])
    await vi.advanceTimersByTimeAsync(2 * FG)
    expect(runs).toEqual([0, 180, 240, 300])
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(10 * BG)
    expect(runs).toHaveLength(4)
  })

  it('gaining focus polls straight away when a foreground interval has passed', async () => {
    const { scheduler, runs } = setup()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(90_000) // background: next run would be at 180 s
    expect(runs).toEqual([0])
    scheduler.setFocused(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0, 90])
    // Losing focus stretches the wait back to the background interval.
    scheduler.setFocused(false)
    await vi.advanceTimersByTimeAsync(FG)
    expect(runs).toEqual([0, 90])
    await vi.advanceTimersByTimeAsync(BG - FG)
    expect(runs).toEqual([0, 90, 270])
    scheduler.stop()
  })

  it('backs off exponentially on errors, honours Retry-After, and resets after a success', async () => {
    const limited = new ServiceError('rate_limited', 'slow down', { retryAfterSec: 900 })
    const { scheduler, runs } = setup([new Error('offline'), new Error('offline'), limited, null])
    scheduler.setFocused(true)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0])
    expect(scheduler.state().failures).toBe(1)
    // 1 failure: 60 s × 2 = 120 s, jitter 0.5 → 90 s.
    await vi.advanceTimersByTimeAsync(89_000)
    expect(runs).toEqual([0])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(runs).toEqual([0, 90])
    // 2 failures: 240 s → 180 s. Focus changes don't cut a backoff short.
    scheduler.setFocused(false)
    scheduler.setFocused(true)
    await vi.advanceTimersByTimeAsync(179_000)
    expect(runs).toEqual([0, 90])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(runs).toEqual([0, 90, 270])
    // 3rd failure is a 429 with Retry-After 900 s (more than the 360 s backoff).
    await vi.advanceTimersByTimeAsync(899_000)
    expect(runs).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(runs).toEqual([0, 90, 270, 1170])
    // Success: back to the plain foreground interval.
    expect(scheduler.state().failures).toBe(0)
    await vi.advanceTimersByTimeAsync(FG)
    expect(runs).toEqual([0, 90, 270, 1170, 1230])
    scheduler.stop()
  })

  it('a manual run while one is in flight queues exactly one more', async () => {
    let release: () => void = () => undefined
    const runs: number[] = []
    const scheduler = new Scheduler({
      name: 'test',
      run: () =>
        new Promise<void>((resolve) => {
          runs.push(runs.length)
          release = resolve
        }),
      intervalsMs: () => ({ foreground: FG, background: BG }),
      random: () => 0.5,
    })
    scheduler.start()
    void scheduler.runNow()
    void scheduler.runNow()
    expect(runs).toEqual([0])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0, 1])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0, 1])
    scheduler.stop()
  })

  it('a manual run skips an ordinary backoff but never a Retry-After wait, and not once stopped', async () => {
    const limited = new ServiceError('rate_limited', 'slow down', { retryAfterSec: 600 })
    const { scheduler, runs } = setup([new Error('401'), limited])
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual([0])
    // Ordinary failure (e.g. a bad token the user just fixed): Settings change → poll now.
    await vi.advanceTimersByTimeAsync(10_000)
    await scheduler.runNow()
    expect(runs).toEqual([0, 10])
    // That one hit a 429 / Retry-After 600 s: a manual run waits it out.
    await vi.advanceTimersByTimeAsync(5_000)
    await scheduler.runNow()
    expect(runs).toEqual([0, 10])
    await vi.advanceTimersByTimeAsync(595_000 - 1)
    expect(runs).toEqual([0, 10])
    await vi.advanceTimersByTimeAsync(1)
    expect(runs).toEqual([0, 10, 610])
    scheduler.stop()
    await scheduler.runNow()
    await vi.advanceTimersByTimeAsync(10 * BG)
    expect(runs).toHaveLength(3)
  })
})
