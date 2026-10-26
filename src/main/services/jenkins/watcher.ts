import { prKey, refLabel, type PrRef, type PullRequest } from '@shared/bitbucket'
import type { Provider } from '@shared/providers'
import {
  BuildWatchSchema,
  MAX_BUILD_WATCHES,
  jobLabel,
  type BuildDetail,
  type BuildRef,
  type BuildWatch,
  type BuildWatchRequest,
  type JenkinsBuild,
  type JobPath,
} from '@shared/jenkins'
import { loadItems, saveItems } from '../json-file'
import type { NotifyInput } from '../notifications'
import { ServiceError } from '../service-error'
import { WatchError, prRefFromLink } from '../watch'
import type { RecentBuild } from './client'
import type { PrJobResolution } from './resolve'

/**
 * SPEC 6.4 "Watch a build/job: watch until finished, then notify", "Watch PR pipeline" and the
 * deploy watcher. A watch follows one build; a job or deploy watch first waits for the next
 * build to start (a deploy's must carry my branch as a parameter). The snapshot is saved before
 * notifying, so a restart never repeats a notification. Finished watches stay listed until
 * removed (the tray dot reads them) but are no longer polled.
 */

export interface BuildWatcherDeps {
  file: string
  jenkins: {
    site(): string
    buildInfo(ref: BuildRef): Promise<JenkinsBuild>
    build(ref: BuildRef): Promise<BuildDetail>
    recentBuilds(job: JobPath): Promise<RecentBuild[]>
    deployJob(): JobPath | null
    resolvePr(pr: PullRequest): Promise<PrJobResolution>
  }
  /** The provider hub (P7.04): a GitHub or GitLab PR's Jenkins pipeline is found the same way. */
  bitbucket: { pr(ref: PrRef): Promise<PullRequest>; site(provider: Provider): string | null }
  notify: (n: NotifyInput) => void
  onChange: () => void
  now?: () => number
}

const OTHER_SITE =
  'Not checked: this build is on a different Jenkins site from the one in Settings → Jenkins.'

/** Lower case: Jenkins looks item names up case-insensitively. */
export function buildWatchKey(
  kind: BuildWatch['kind'],
  job: JobPath,
  extra: number | string | null,
): string {
  const tail = kind === 'build' ? `#${extra}` : kind === 'deploy' ? `@${extra}` : ''
  return `${kind}:${job}${tail}`.toLowerCase()
}

/** A deploy build is "for" a branch when one of its parameters names it. */
export function deploysBranch(parameters: RecentBuild['parameters'], branch: string): boolean {
  const spellings = new Set([branch, `origin/${branch}`, `refs/heads/${branch}`])
  return parameters.some((p) => spellings.has(p.value.trim()))
}

export class BuildWatcher {
  private items: BuildWatch[]

  constructor(private readonly deps: BuildWatcherDeps) {
    this.items = loadItems(deps.file, BuildWatchSchema, 'build watch list')
  }

  /** Newest first. */
  list(): BuildWatch[] {
    return this.items
  }

  /**
   * Starts a watch, reading Jenkins now: a wrong job or missing access fails here. Watching a
   * build that has already finished lists it as done, without a notification. The same watch
   * twice returns the live one; a finished one is replaced by a fresh watch.
   */
  async add(
    request: BuildWatchRequest,
    from: { label: string; pr?: string } | null = null,
  ): Promise<BuildWatch> {
    const site = this.deps.jenkins.site()
    const job = request.kind === 'deploy' ? this.deps.jenkins.deployJob() : (request.job as JobPath)
    if (!job) {
      throw new WatchError(
        'unresolved',
        'Set a deploy job in Settings → Jenkins first (e.g. apps/deploy-dev).',
      )
    }
    const extra =
      request.kind === 'build' ? request.number : request.kind === 'deploy' ? request.branch : null
    const key = buildWatchKey(request.kind, job, extra)
    const existing = this.find(key)
    if (existing && !existing.done) return existing
    const full = () => !this.find(key) && this.items.length >= MAX_BUILD_WATCHES
    const limit = () =>
      new WatchError(
        'limit',
        `You can watch up to ${MAX_BUILD_WATCHES} builds; remove finished ones first.`,
      )
    if (full()) throw limit()

    const base: BuildWatch = {
      key,
      kind: request.kind,
      job,
      site,
      number: null,
      after: null,
      branch: request.kind === 'deploy' ? request.branch : null,
      label: from?.label ?? null,
      pr: from?.pr ?? null,
      addedAt: this.now(),
      checkedAt: this.now(),
      build: null,
      done: false,
      error: null,
    }
    let item: BuildWatch
    if (request.kind === 'build') {
      const build = await this.deps.jenkins.buildInfo({ job, number: request.number })
      item = { ...base, number: build.number, build, done: build.state !== 'running' }
    } else {
      const recent = await this.deps.jenkins.recentBuilds(job)
      const mine =
        request.kind === 'deploy'
          ? recent.filter((r) => deploysBranch(r.parameters, request.branch))
          : recent
      const running =
        request.kind === 'job' && request.next
          ? undefined
          : mine.find((r) => r.build.state === 'running')
      item = running
        ? { ...base, number: running.build.number, build: running.build }
        : { ...base, after: recent[0]?.build.number ?? 0 }
    }
    // The same watch may have been added while Jenkins was being read.
    const raced = this.find(key)
    if (raced && !raced.done && raced !== existing) return raced
    if (full()) throw limit() // other watches were added meanwhile
    this.items = [item, ...this.items.filter((w) => w.key !== key)]
    this.save()
    return item
  }

  /**
   * "Watch PR pipeline" (SPEC 6.4): PR link → PR → the job that builds it → a build watch (the
   * build its status links to, while it runs) or a job watch (its running or next build). A
   * status link to a build that has finished may predate a push Jenkins hasn't reported yet,
   * so then the job's next build is followed instead.
   */
  async addPr(link: string): Promise<BuildWatch> {
    const { ref } = prRefFromLink(link, (p) => this.deps.bitbucket.site(p))
    const pr = await this.deps.bitbucket.pr(ref)
    const found = await this.deps.jenkins.resolvePr(pr)
    if (!found.ok) throw new WatchError('unresolved', found.message)
    const from = { label: `${refLabel(pr.ref)} pipeline`, pr: prKey(pr.ref) }
    if (found.build !== null) {
      const linked = await this.deps.jenkins.buildInfo({ job: found.job, number: found.build })
      if (linked.state === 'running') {
        return this.add({ kind: 'build', job: found.job, number: found.build }, from)
      }
    }
    return this.add({ kind: 'job', job: found.job }, from)
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
   * Checks every live watch on the configured site, one at a time. A job or build that is gone
   * or hidden (404/403) is marked on its item; any other failure stops the poll and is
   * rethrown, so the scheduler backs off.
   */
  async poll(): Promise<void> {
    const live = this.items.filter((w) => !w.done)
    if (live.length === 0) return
    const site = this.deps.jenkins.site()
    const finished: BuildWatch[] = []
    let fatal: unknown = null
    let changed = false
    for (const watch of live) {
      if (watch.site !== site) {
        changed = this.update(watch.key, { error: OTHER_SITE }) || changed
        continue
      }
      try {
        const patch = await this.check(watch)
        // Removed (or removed and added again) while it was being read: this read is stale.
        // Items are replaced, never changed in place, so identity tells.
        if (this.find(watch.key) !== watch) continue
        changed =
          this.update(watch.key, { ...patch, checkedAt: this.now(), error: null }) || changed
        if (patch.done) finished.push(this.find(watch.key)!)
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
    for (const watch of finished) this.deps.notify(await this.notification(watch))
    if (fatal) throw fatal
  }

  /** The followed build now, or the build a waiting watch should start following. */
  private async check(watch: BuildWatch): Promise<Partial<BuildWatch>> {
    const { job } = watch
    if (watch.number !== null) {
      const build = await this.deps.jenkins.buildInfo({ job, number: watch.number })
      return { build, done: build.state !== 'running' }
    }
    const after = watch.after ?? 0
    const next = (await this.deps.jenkins.recentBuilds(job))
      .filter((r) => r.build.number > after)
      .filter((r) => watch.kind !== 'deploy' || deploysBranch(r.parameters, watch.branch ?? ''))
      .sort((a, b) => a.build.number - b.build.number)[0]
    if (!next) return {}
    return { number: next.build.number, build: next.build, done: next.build.state !== 'running' }
  }

  private async notification(watch: BuildWatch): Promise<NotifyInput> {
    const build = watch.build!
    const name = watch.label ?? jobLabel(watch.job)
    const lines = [
      watch.kind === 'deploy' ? `Deploy of ${watch.branch} · ${watch.job}` : watch.job,
      build.durationMs === null ? null : `Took ${duration(build.durationMs)}`,
    ]
    if (build.state === 'failed' || build.state === 'unstable') {
      // Best effort: where it failed, if the Pipeline API says.
      const stage = await this.deps.jenkins
        .build({ job: watch.job, number: build.number })
        .then((d) => d.stages?.find((s) => s.state === 'failed' || s.state === 'unstable'))
        .catch(() => undefined)
      if (stage) lines.push(`Failed at: ${stage.name}`)
    }
    return {
      type: 'job-finished',
      title: `${RESULT_WORD[build.state]} · ${name} #${build.number}`,
      body: lines.filter(Boolean).join('\n'),
      url: build.url,
      // The watch is in DevDock; the Builds view links on to Jenkins.
      view: 'builds',
    }
  }

  private find(key: string): BuildWatch | undefined {
    return this.items.find((w) => w.key === key)
  }

  /** Replaces one item's fields; false when it is gone or nothing changed. */
  private update(key: string, patch: Partial<BuildWatch>): boolean {
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

const RESULT_WORD: Record<JenkinsBuild['state'], string> = {
  success: 'Passed',
  failed: 'Failed',
  unstable: 'Unstable',
  aborted: 'Aborted',
  not_built: 'Not built',
  running: 'Running',
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
