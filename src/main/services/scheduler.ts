import { log } from './logger'
import { ServiceError } from './service-error'

/**
 * Focus-aware polling (SPEC 6.3): the foreground interval while a DevDock window has focus,
 * the background one otherwise; exponential backoff with jitter after failures, and never
 * sooner than a server's `Retry-After`.
 */

/** Longest wait after repeated failures (before `Retry-After`, which may ask for longer). */
export const MAX_BACKOFF_MS = 30 * 60_000
/** A `Retry-After` beyond this is treated as this (a broken header shouldn't stop polling for good). */
export const MAX_RETRY_AFTER_MS = 6 * 3_600_000

export interface DelayInput {
  /** The interval for the current focus state. */
  intervalMs: number
  /** Failed runs in a row (0 after a success). */
  failures: number
  /** From the last failure's `Retry-After`, in seconds. */
  retryAfterSec?: number
  /** [0, 1). */
  random: number
}

/**
 * Time until the next run. Healthy: the interval ±10 %, so many clients don't hit the server
 * in step. After `n` failures: interval × 2ⁿ (capped), "equal jitter" — between half and all
 * of it — and at least the `Retry-After` wait.
 */
export function nextDelay({ intervalMs, failures, retryAfterSec, random }: DelayInput): number {
  if (failures === 0) return Math.round(intervalMs * (0.9 + 0.2 * random))
  const backoff = Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures)
  const jittered = backoff / 2 + (backoff / 2) * random
  const retryAfter = Math.min(MAX_RETRY_AFTER_MS, (retryAfterSec ?? 0) * 1000)
  return Math.round(Math.max(jittered, retryAfter))
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface SchedulerDeps {
  /** One poll. A rejection counts as a failure (a ServiceError may carry `retryAfterSec`). */
  run: () => Promise<void>
  /** Current intervals, read on every schedule so Settings changes apply at once. */
  intervalsMs: () => { foreground: number; background: number }
  name: string
  now?: () => number
  random?: () => number
  timers?: Timers
}

export class Scheduler {
  private focused = false
  private failures = 0
  private retryAfterSec: number | undefined
  private lastRunAt: number | null = null
  /** Fixed per cycle, so re-planning on focus changes doesn't re-roll the jitter. */
  private jitter = 0.5
  /** While backing off, the next run time is fixed (focus doesn't shorten it). */
  private backoffUntil: number | null = null
  /** End of the last `Retry-After` wait: nothing runs before it, manual or not. */
  private retryAfterUntil: number | null = null
  private timer: unknown = null
  private running: Promise<void> | null = null
  private again = false
  private started = false

  constructor(private readonly deps: SchedulerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private get timers(): Timers {
    return (
      this.deps.timers ?? {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
      }
    )
  }

  /** Runs once now, then keeps polling. */
  start(): void {
    if (this.started) return
    this.started = true
    void this.runNow()
  }

  stop(): void {
    this.started = false
    this.clear()
  }

  /** Focus gained: poll now if a foreground interval has passed; lost: stretch to background. */
  setFocused(focused: boolean): void {
    if (focused === this.focused) return
    this.focused = focused
    this.plan()
  }

  /** Intervals changed in Settings. */
  reschedule(): void {
    this.plan()
  }

  /**
   * Polls now (Settings changed: the user may just have fixed what was failing), skipping an
   * ordinary backoff — but never inside a server's `Retry-After` window, and never once
   * stopped. While a poll runs, exactly one more follows it.
   */
  async runNow(): Promise<void> {
    if (!this.started) return
    if (this.retryAfterUntil !== null && this.now() < this.retryAfterUntil) {
      this.plan()
      return
    }
    if (this.running) {
      this.again = true
      return this.running
    }
    this.clear()
    this.running = this.tick()
    try {
      await this.running
    } finally {
      this.running = null
    }
    if (this.again && this.started) {
      this.again = false
      return this.runNow()
    }
    this.plan()
  }

  /** For tests and diagnostics. */
  state() {
    return {
      failures: this.failures,
      backoffUntil: this.backoffUntil,
      retryAfterUntil: this.retryAfterUntil,
      lastRunAt: this.lastRunAt,
    }
  }

  private async tick(): Promise<void> {
    try {
      await this.deps.run()
      this.failures = 0
      this.retryAfterSec = undefined
    } catch (err) {
      this.failures++
      this.retryAfterSec = err instanceof ServiceError ? err.retryAfterSec : undefined
      log.warn(`${this.deps.name}: poll failed (${this.failures} in a row)`, err)
    }
    this.lastRunAt = this.now()
    this.jitter = this.deps.random?.() ?? Math.random()
    this.backoffUntil =
      this.failures > 0
        ? this.lastRunAt +
          nextDelay({
            intervalMs: this.interval(),
            failures: this.failures,
            retryAfterSec: this.retryAfterSec,
            random: this.jitter,
          })
        : null
    this.retryAfterUntil = this.retryAfterSec
      ? this.lastRunAt + Math.min(MAX_RETRY_AFTER_MS, this.retryAfterSec * 1000)
      : null
  }

  private interval(): number {
    const { foreground, background } = this.deps.intervalsMs()
    return this.focused ? foreground : background
  }

  /** (Re)arms the timer for the next run from the last run time and the current state. */
  private plan(): void {
    if (!this.started || this.running || this.lastRunAt === null) return
    this.clear()
    const due =
      this.backoffUntil ??
      this.lastRunAt + nextDelay({ intervalMs: this.interval(), failures: 0, random: this.jitter })
    const wait = Math.max(0, due - this.now())
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      void this.runNow()
    }, wait)
  }

  private clear(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }
}
