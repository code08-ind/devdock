import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { NotificationRecordSchema, type NotificationRecord } from '@shared/ipc'
import type { NotificationType, Settings } from '@shared/settings'
import { log } from './logger'

export const HISTORY_LIMIT = 200

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return h * 60 + m
}

/** Quiet hours may wrap midnight (e.g. 19:00 → 09:00). start === end means "never quiet". */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const s = minutesOf(start)
  const e = minutesOf(end)
  const n = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  return s < e ? n >= s && n < e : n >= s || n < e
}

export type Suppression = NotificationRecord['suppressedReason']

export function suppressionFor(
  type: NotificationType,
  prefs: Settings['notifications'],
  now: Date,
  pausedUntil: number | null,
): Suppression {
  if (prefs.types[type] === false) return 'type-off'
  if (pausedUntil !== null && now.getTime() < pausedUntil) return 'paused'
  if (prefs.quietHours.enabled && inQuietHours(now, prefs.quietHours.start, prefs.quietHours.end)) {
    return 'quiet-hours'
  }
  return undefined
}

export interface NotifyInput {
  type: NotificationType
  title: string
  body: string
  url?: string
}

export interface NativeNotifier {
  show(n: NotificationRecord, opts: { silent: boolean; onClick: () => void }): void
}

export interface NotificationDeps {
  file: string
  getPrefs: () => Settings['notifications']
  native: NativeNotifier
  onClick: (n: NotificationRecord) => void
  onChange?: () => void
  now?: () => Date
}

/**
 * Records every notification (last 200, persisted) and shows the OS popup unless the type is
 * off, notifications are paused, or it is quiet hours. Suppressed items still go to history.
 */
export class NotificationService {
  private history: NotificationRecord[]
  private pausedUntil: number | null = null

  constructor(private readonly deps: NotificationDeps) {
    this.history = this.load()
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private load(): NotificationRecord[] {
    if (!existsSync(this.deps.file)) return []
    try {
      return z
        .array(NotificationRecordSchema)
        .parse(JSON.parse(readFileSync(this.deps.file, 'utf8')))
        .slice(0, HISTORY_LIMIT)
    } catch (err) {
      log.warn('notification history unreadable, starting empty', err)
      return []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.deps.file), { recursive: true })
    const tmp = `${this.deps.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.history), 'utf8')
    renameSync(tmp, this.deps.file)
    this.deps.onChange?.()
  }

  notify(input: NotifyInput): NotificationRecord {
    const now = this.now()
    const prefs = this.deps.getPrefs()
    const suppressedReason = suppressionFor(input.type, prefs, now, this.pausedUntil)
    const record: NotificationRecord = {
      id: randomUUID(),
      ...input,
      at: now.getTime(),
      shown: suppressedReason === undefined,
      ...(suppressedReason ? { suppressedReason } : {}),
    }
    this.history = [record, ...this.history].slice(0, HISTORY_LIMIT)
    this.save()
    if (record.shown) {
      this.deps.native.show(record, {
        silent: !prefs.sound,
        onClick: () => this.deps.onClick(record),
      })
    }
    return record
  }

  list(): NotificationRecord[] {
    return this.history
  }

  clear(): void {
    this.history = []
    this.save()
  }

  pause(minutes: number): void {
    this.pausedUntil = this.now().getTime() + minutes * 60_000
    this.deps.onChange?.()
  }

  resume(): void {
    this.pausedUntil = null
    this.deps.onChange?.()
  }

  getPausedUntil(): number | null {
    if (this.pausedUntil !== null && this.now().getTime() >= this.pausedUntil)
      this.pausedUntil = null
    return this.pausedUntil
  }
}
