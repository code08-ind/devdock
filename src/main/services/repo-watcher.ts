import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { RepoConfig } from '@shared/settings'
import type { GitRunner } from './git/exec'
import { absoluteGitDir } from './git/repo'
import { log } from './logger'

/**
 * Watches each repo's `.git/HEAD` (SPEC 6.2: status refreshes on a HEAD watcher, plus focus and
 * every 2 minutes in the renderer). Watches the git dir rather than the file, because git
 * replaces HEAD atomically (write + rename), which ends a watch on the file itself.
 */
export class RepoWatcher {
  private readonly watchers = new Map<string, { path: string; watcher: FSWatcher }>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly git: GitRunner,
    private readonly onChange: (repoId: string) => void,
    private readonly debounceMs = 300,
  ) {}

  private queue: Promise<void> = Promise.resolve()

  /** Starts/stops watchers so they match the registered repos. Calls run one after another. */
  sync(repos: readonly RepoConfig[]): Promise<void> {
    // A failed sync must not block the ones after it.
    this.queue = this.queue
      .then(() => this.syncNow(repos))
      .catch((err) => log.warn('repo watcher sync failed', err))
    return this.queue
  }

  private async syncNow(repos: readonly RepoConfig[]): Promise<void> {
    const wanted = new Map(repos.map((r) => [r.id, r]))
    for (const [id, w] of this.watchers) {
      if (wanted.get(id)?.path !== w.path) this.stop(id)
    }
    for (const repo of repos) {
      if (this.watchers.has(repo.id)) continue
      try {
        const gitDir = await absoluteGitDir(this.git, repo.path)
        const watcher = watch(gitDir, (_event, file) => {
          // Some platforms report no file name; treat that as a possible HEAD change.
          if (!file || file === 'HEAD' || file === 'HEAD.lock') this.changed(repo.id)
        })
        watcher.on('error', (err) => {
          log.warn(`HEAD watcher for ${repo.name} stopped`, err)
          this.stop(repo.id)
        })
        this.watchers.set(repo.id, { path: repo.path, watcher })
      } catch (err) {
        // Folder moved or deleted: status calls will report it; nothing to watch.
        log.warn(`cannot watch ${join(repo.path, '.git', 'HEAD')}`, err)
      }
    }
  }

  private changed(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        this.onChange(id)
      }, this.debounceMs),
    )
  }

  private stop(id: string): void {
    this.watchers.get(id)?.watcher.close()
    this.watchers.delete(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  dispose(): void {
    for (const id of [...this.watchers.keys()]) this.stop(id)
  }

  /** Ids of the repos being watched (tests, diagnostics). */
  watchedIds(): string[] {
    return [...this.watchers.keys()]
  }
}
