import {
  CiWatchSchema,
  MAX_CI_WATCHES,
  ciRunKey,
  ciRunLabel,
  isFinished,
  parseRunLink,
  type CiRun,
  type CiRunRef,
  type CiWatch,
} from '@shared/ci'
import { PROVIDER_NAMES, type CiProvider } from '@shared/providers'
import { loadItems, saveItems } from '../json-file'
import type { NotifyInput } from '../notifications'
import { ServiceError } from '../service-error'
import { WatchError } from '../watch'

/**
 * P7.05 / P7.06 "watch a run": a GitHub Actions run or GitLab pipeline is polled until it
 * finishes, then one `job-finished` notification says how it ended. The snapshot is saved before
 * notifying (no repeat after a restart); finished watches stay listed (the tray dot reads them)
 * until removed. A re-run / retry from DevDock puts the watch back to following the run.
 */

export interface CiWatcherDeps {
  file: string
  ci: {
    runInfo(ref: CiRunRef): Promise<CiRun>
    /** Where that provider's runs are read from (`siteKey` spelling); null when off. */
    site(provider: CiProvider): string | null
  }
  notify: (n: NotifyInput) => void
  onChange: () => void
  now?: () => number
}

const otherSite = (p: CiProvider) =>
  `Not checked: this run is on a different ${PROVIDER_NAMES[p]} site from the one in Settings → ${PROVIDER_NAMES[p]}.`

export class CiWatcher {
  private items: CiWatch[]

  constructor(private readonly deps: CiWatcherDeps) {
    this.items = loadItems(deps.file, CiWatchSchema, 'run watch list')
  }

  list(): CiWatch[] {
    return this.items
  }

  /** Watches a run from its ref (Builds view) or its link (palette `watch <run link>`). */
  async add(input: { ref: CiRunRef } | { link: string }): Promise<CiWatch> {
    const ref = 'ref' in input ? input.ref : this.refFromLink(input.link)
    const site = this.deps.ci.site(ref.provider)
    if (!site) {
      const name = PROVIDER_NAMES[ref.provider]
      throw new WatchError('other-site', `Set up ${name} in Settings → ${name} first.`)
    }
    const key = ciRunKey(ref)
    const existing = this.find(key)
    if (existing) return existing
    if (this.items.length >= MAX_CI_WATCHES) {
      throw new WatchError('limit', `You can watch up to ${MAX_CI_WATCHES} runs; remove one first.`)
    }
    const run = await this.deps.ci.runInfo(ref)
    const raced = this.find(key)
    if (raced) return raced
    const item: CiWatch = {
      key,
      ref: run.ref,
      site,
      addedAt: this.now(),
      checkedAt: this.now(),
      run,
      // Already finished: listed (and on the dot), nothing left to notify.
      done: isFinished(run.state),
      error: null,
    }
    this.items = [item, ...this.items]
    this.save()
    return item
  }

  /** After a re-run / retry / cancel from DevDock: follow the run again from its new state. */
  restarted(run: CiRun): void {
    const current = this.find(run.key)
    if (!current) return
    this.items = this.items.map((w) =>
      w.key === run.key
        ? { ...w, run, done: isFinished(run.state), checkedAt: this.now(), error: null }
        : w,
    )
    this.save()
  }

  remove(key: string): void {
    const before = this.items.length
    this.items = this.items.filter((w) => w.key !== key)
    if (this.items.length !== before) this.save()
  }

  clearFinished(): void {
    const before = this.items.length
    this.items = this.items.filter((w) => !w.done)
    if (this.items.length !== before) this.save()
  }

  /**
   * Checks every run still going, one at a time. A run that is gone or hidden (404/403) is
   * marked on its item; anything else (auth, network, rate limit) stops the poll and is
   * rethrown, so the scheduler backs off (honouring `retryAfterSec`).
   */
  async poll(): Promise<void> {
    const live = this.items.filter((w) => !w.done)
    if (live.length === 0) return
    const events: NotifyInput[] = []
    let fatal: unknown = null
    let changed = false
    for (const watch of live) {
      if (watch.site !== this.deps.ci.site(watch.ref.provider)) {
        changed = this.patch(watch.key, { error: otherSite(watch.ref.provider) }) || changed
        continue
      }
      try {
        const run = await this.deps.ci.runInfo(watch.ref)
        const current = this.find(watch.key)
        if (!current || current.done) continue // removed, or restarted/finished meanwhile
        const done = isFinished(run.state)
        if (done) events.push(finishedNotice(run))
        changed =
          this.patch(watch.key, { run, done, checkedAt: this.now(), error: null }) || changed
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        changed = this.patch(watch.key, { checkedAt: this.now(), error: message }) || changed
        const perItem =
          err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')
        if (!perItem) {
          fatal = err
          break
        }
      }
    }
    if (changed) this.save()
    for (const e of events) this.deps.notify(e)
    if (fatal) throw fatal
  }

  private refFromLink(link: string): CiRunRef {
    const parsed = parseRunLink(link)
    if (!parsed) {
      throw new WatchError(
        'invalid',
        "That isn't a GitHub Actions run or GitLab pipeline link.",
      )
    }
    const site = this.deps.ci.site(parsed.ref.provider)
    const name = PROVIDER_NAMES[parsed.ref.provider]
    const full = `${parsed.origin}/${parsed.ref.project}`
    if (!site || !full.toLowerCase().startsWith(`${site}/`)) {
      throw new WatchError(
        'other-site',
        site
          ? `That link is on ${parsed.origin}, but DevDock reads ${name} from ${site}. Change it in Settings → ${name}.`
          : `Set up ${name} in Settings → ${name} first.`,
      )
    }
    // A GitLab under a relative root (`https://host/gitlab`) has it in front of the group.
    return { ...parsed.ref, project: full.slice(site.length + 1) }
  }

  private find(key: string): CiWatch | undefined {
    return this.items.find((w) => w.key === key)
  }

  private patch(key: string, patch: Partial<CiWatch>): boolean {
    const current = this.find(key)
    if (!current) return false
    const next = { ...current, ...patch }
    if (JSON.stringify(next) === JSON.stringify(current)) return false
    this.items = this.items.map((w) => (w.key === key ? next : w))
    return true
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private save(): void {
    saveItems(this.deps.file, this.items)
    this.deps.onChange()
  }
}

const VERB: Record<CiRun['state'], string> = {
  success: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  running: 'Running',
  queued: 'Queued',
  manual: 'Waiting',
}

/** One notification for a finished run (opens the Builds view, like Jenkins watches). */
export function finishedNotice(run: CiRun): NotifyInput {
  return {
    type: 'job-finished',
    title: `${VERB[run.state]} · ${ciRunLabel(run)}`,
    body: [run.title, run.branch ? `on ${run.branch}` : null].filter(Boolean).join(' '),
    view: 'builds',
    ...(run.url ? { url: run.url } : {}),
  }
}
