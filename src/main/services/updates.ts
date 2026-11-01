/**
 * T9: checks GitHub for a newer published DevDock release, once a day while the switch
 * (Settings → General → Check for updates) is on, and on demand. One unauthenticated GET; no
 * data about the user is sent. A newer version gets one notification (per version) and a line
 * in Settings with Download. Demo mode makes no network calls, so it isn't checked there.
 */
import { z } from 'zod'
import {
  isNewer,
  LATEST_RELEASE_API,
  parseVersion,
  RELEASE_PAGE_PREFIX,
  type UpdateStatus,
} from '@shared/updates'
import type { HttpClient } from './http'
import { loadItems, saveItems } from './json-file'
import { obj, text } from './json'
import type { NotifyInput } from './notifications'
import { requestJson } from './rest'
import { ServiceError } from './service-error'

const NotifiedSchema = z.object({ version: z.string() })

export interface UpdateDeps {
  http: HttpClient
  /** The running version (`app.getVersion()`). */
  current: string
  /** Settings → General → Check for updates. */
  enabled: () => boolean
  notify: (n: NotifyInput) => void
  onChange: (status: UpdateStatus) => void
  /** Remembers the version already announced, so it is said once. */
  file: string
  now?: () => number
}

export class UpdateService {
  private status: UpdateStatus
  private notified: string | null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: UpdateDeps) {
    this.notified = loadItems(deps.file, NotifiedSchema, 'update notice')[0]?.version ?? null
    this.status = {
      current: deps.current,
      latest: null,
      url: null,
      noRelease: false,
      checkedAt: null,
      error: null,
      demo: deps.http.demo,
    }
  }

  get(): UpdateStatus {
    return this.status
  }

  /** The release page of the newer version, or null (only this repo's release pages). */
  releaseUrl(): string | null {
    const url = this.status.url
    return url && url.startsWith(RELEASE_PAGE_PREFIX) ? url : null
  }

  /** Asks GitHub now (also when the switch is off: the user asked). */
  async check(): Promise<UpdateStatus> {
    const now = (this.deps.now ?? Date.now)()
    const base = { ...this.status, demo: this.deps.http.demo, checkedAt: now }
    if (this.deps.http.demo) {
      return this.set({ ...base, latest: null, url: null, noRelease: false, error: null })
    }
    try {
      const { body } = await requestJson(
        this.deps.http,
        { service: 'GitHub', hints: { auth: '', forbidden: '' }, timeoutMs: 15_000 },
        LATEST_RELEASE_API,
      )
      const release = obj(body)
      const tag = text(release.tag_name)
      const page = text(release.html_url)
      if (!tag || !parseVersion(tag)) {
        return this.set({ ...base, error: "GitHub's answer had no version." })
      }
      const latest = tag.replace(/^v/, '')
      const newer = isNewer(latest, this.deps.current)
      const url = newer && page?.startsWith(RELEASE_PAGE_PREFIX) ? page : null
      const status = this.set({ ...base, latest, url, noRelease: false, error: null })
      if (url && this.notified !== latest) {
        this.notified = latest
        saveItems(this.deps.file, [{ version: latest }])
        this.deps.notify({
          type: 'update-available',
          title: `DevDock ${latest} is available`,
          body: `You have ${this.deps.current}. Open Settings → General to download it.`,
          view: 'settings',
        })
      }
      return status
    } catch (err) {
      // No published release yet: GitHub answers 404 for /releases/latest.
      if (err instanceof ServiceError && err.status === 404) {
        return this.set({ ...base, latest: null, url: null, noRelease: true, error: null })
      }
      const error =
        err instanceof ServiceError && err.kind === 'rate_limited'
          ? 'GitHub is rate limiting checks; trying again later.'
          : "Couldn't reach GitHub."
      return this.set({ ...base, error })
    }
  }

  /** Checks a minute after start, then once a day, while the switch is on. */
  start(firstDelayMs = 60_000, intervalMs = 24 * 60 * 60_000): void {
    const run = (delay: number) => {
      this.timer = setTimeout(() => {
        const next = () => run(intervalMs)
        if (this.deps.enabled()) void this.check().finally(next)
        else next()
      }, delay)
      this.timer.unref?.()
    }
    run(firstDelayMs)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private set(status: UpdateStatus): UpdateStatus {
    this.status = status
    this.deps.onChange(status)
    return status
  }
}
