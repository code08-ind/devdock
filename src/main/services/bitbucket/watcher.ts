import {
  MAX_WATCHES,
  WatchItemSchema,
  isLive,
  prKey,
  type PrRef,
  type PullRequest,
  type WatchItem,
} from '@shared/bitbucket'
import { loadItems, saveItems } from '../json-file'
import { WatchError, prRefFromLink } from '../watch'
import type { NotifyInput } from '../notifications'
import { ServiceError } from '../service-error'
import { voteCounts } from './adapter'
import type { ActionResult } from './client'

/**
 * SPEC 6.3 "Paste a PR link … adds the PR to Watched, and notifies on state changes".
 * Each poll compares a PR with the last snapshot; the snapshot is saved before notifying, so a
 * restart (or a crash mid-poll) never repeats a notification.
 */

export interface PrWatcherDeps {
  file: string
  bitbucket: { pr(ref: PrRef): Promise<PullRequest>; site(): string | null }
  notify: (n: NotifyInput) => void
  /** The list changed (added, removed, polled): tell the renderer. */
  onChange: () => void
  now?: () => number
}

const OTHER_SITE =
  'Not checked: this PR is on a different Bitbucket site from the one in Settings → Bitbucket.'

export class PrWatcher {
  private items: WatchItem[]
  /** Acknowledged actions per PR key (in memory: they only matter during one poll). */
  private readonly acks = new Map<string, number>()

  constructor(private readonly deps: PrWatcherDeps) {
    this.items = this.load()
  }

  /** Newest first. */
  list(): WatchItem[] {
    return this.items
  }

  /**
   * Watches the PR behind a link (both URL shapes). The PR is read now: that is the baseline
   * later changes are measured against, and a wrong link or missing access fails here.
   */
  async add(link: string): Promise<WatchItem> {
    const { ref, site } = prRefFromLink(link, this.deps.bitbucket.site())
    const key = prKey(ref)
    const existing = this.find(key)
    if (existing) return existing
    if (this.items.length >= MAX_WATCHES) {
      throw new WatchError(
        'limit',
        `You can watch up to ${MAX_WATCHES} pull requests; remove one first.`,
      )
    }
    const pr = await this.deps.bitbucket.pr(ref)
    // The same link may have been added while the PR was being read.
    const raced = this.find(key)
    if (raced) return raced
    const item: WatchItem = {
      key,
      ref: pr.ref,
      site,
      addedAt: this.now(),
      checkedAt: this.now(),
      pr,
      error: null,
    }
    this.items = [item, ...this.items]
    this.save()
    return item
  }

  /**
   * After the user's own action on a watched PR: take *their* vote (and a merge's state) into
   * the snapshot, so DevDock doesn't notify them of what they just did. Other reviewers' votes,
   * builds and comments are left for the next poll to notice.
   */
  acknowledge({ pr, actor }: ActionResult): void {
    const current = this.find(pr.key)
    if (!current) return
    // A poll already reading this PR has a pre-action copy: it must not land (see poll).
    this.acks.set(pr.key, (this.acks.get(pr.key) ?? 0) + 1)
    const mine = pr.reviewers.filter((r) => r.name === actor)
    const reviewers = [...current.pr.reviewers.filter((r) => r.name !== actor), ...mine]
    const snapshot: PullRequest = {
      ...current.pr,
      reviewers,
      ...voteCounts(reviewers),
      state: pr.state,
      closedAt: pr.closedAt,
    }
    if (this.update(pr.key, { pr: snapshot })) this.save()
  }

  remove(key: string): void {
    const before = this.items.length
    this.items = this.items.filter((w) => w.key !== key)
    if (this.items.length !== before) this.save()
  }

  /**
   * Checks every open watch on the configured site, one at a time. A PR that is gone or hidden
   * (404/403) is marked on its item; any other failure (auth, network, rate limit) stops the
   * poll and is rethrown, so the scheduler backs off.
   */
  async poll(): Promise<void> {
    const site = this.deps.bitbucket.site()
    const live = this.items.filter(isLive)
    if (live.length === 0) return
    const events: NotifyInput[] = []
    let fatal: unknown = null
    let changed = false
    for (const watch of live) {
      if (watch.site !== site) {
        changed = this.update(watch.key, { error: OTHER_SITE }) || changed
        continue
      }
      const acks = this.acks.get(watch.key)
      try {
        const pr = await this.deps.bitbucket.pr(watch.ref)
        const current = this.find(watch.key)
        if (!current) continue // removed while it was being read
        // The user acted while it was being read: this copy may predate that. Next poll.
        if (this.acks.get(watch.key) !== acks) continue
        events.push(...prChanges(current.pr, pr))
        changed = this.update(watch.key, { pr, checkedAt: this.now(), error: null }) || changed
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        changed = this.update(watch.key, { checkedAt: this.now(), error: message }) || changed
        const perItem =
          err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')
        if (!perItem) {
          fatal = err
          break
        }
      }
    }
    if (changed) this.save()
    for (const event of events) this.deps.notify(event)
    if (fatal) throw fatal
  }

  private find(key: string): WatchItem | undefined {
    return this.items.find((w) => w.key === key)
  }

  /** Replaces one item's fields; false when it is gone or nothing changed. */
  private update(key: string, patch: Partial<WatchItem>): boolean {
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

  private load(): WatchItem[] {
    return loadItems(this.deps.file, WatchItemSchema, 'watch list')
  }

  private save(): void {
    saveItems(this.deps.file, this.items)
    this.deps.onChange()
  }
}

const label = (pr: PullRequest) => `${pr.ref.repo} #${pr.ref.id}`
const finished = (s: PullRequest['build']['state']) => s === 'success' || s === 'failed'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function namesWith(pr: PullRequest, status: PullRequest['reviewers'][number]['status']) {
  return new Set(pr.reviewers.filter((r) => r.status === status).map((r) => r.name))
}

/**
 * What changed between two snapshots of one PR, as notifications (BUILD-PROMPTS P3: build
 * state, approvals, needs work, new comments, merged/declined). Pure.
 */
export function prChanges(prev: PullRequest, next: PullRequest): NotifyInput[] {
  const out: NotifyInput[] = []
  const body = `${next.title} (${label(next)})`
  const url = next.url || undefined
  const add = (type: NotifyInput['type'], title: string, text = body) =>
    out.push({ type, title, body: text, ...(url ? { url } : {}) })

  // A build that finished, or a new commit whose build finished between two polls.
  const build = next.build.state
  if (finished(build) && (build !== prev.build.state || next.sourceCommit !== prev.sourceCommit)) {
    const failed = next.build.statuses.filter((s) => s.state === 'failed').map((s) => s.name)
    add(
      'build-finished',
      build === 'success' ? `Build passed · ${label(next)}` : `Build failed · ${label(next)}`,
      failed.length ? `${body}\nFailed: ${failed.join(', ')}` : body,
    )
  }

  const approvedBefore = namesWith(prev, 'approved')
  const approvedNow = [...namesWith(next, 'approved')].filter((n) => !approvedBefore.has(n))
  if (approvedNow.length) add('pr-approval', `Approved by ${approvedNow.join(', ')}`)

  const needsWorkBefore = namesWith(prev, 'needs_work')
  const needsWorkNow = [...namesWith(next, 'needs_work')].filter((n) => !needsWorkBefore.has(n))
  if (needsWorkNow.length) add('pr-needs-work', `Needs work from ${needsWorkNow.join(', ')}`)

  const newComments = next.comments - prev.comments
  if (newComments > 0) {
    const open = next.unresolvedComments
    add(
      'pr-comment',
      `${plural(newComments, 'new comment')} · ${label(next)}`,
      open ? `${body}\n${plural(open, 'open thread')}` : body,
    )
  }

  if (prev.state === 'open' && next.state !== 'open') {
    add(
      'pr-closed',
      next.state === 'merged' ? `Merged into ${next.targetBranch}` : 'Declined',
      body,
    )
  }
  return out
}
