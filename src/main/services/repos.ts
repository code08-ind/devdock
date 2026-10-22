import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { RepoPatch } from '@shared/repos'
import { RepoConfigSchema, type RepoConfig } from '@shared/settings'
import { GitError } from './git/errors'
import type { GitRunner } from './git/exec'
import { inspectRepo } from './git/repo'
import type { SettingsStore } from './settings'

export class RepoNotFoundError extends Error {
  constructor(id: string) {
    super(`No registered repo with id ${id}.`)
    this.name = 'RepoNotFoundError'
  }
}

const samePath = (a: string, b: string) =>
  process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()

/** The registered repos (SPEC 6.2 "Register"), stored in settings.repos. */
export class RepoService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly git: GitRunner,
    private readonly newId: () => string = randomUUID,
  ) {}

  list(): RepoConfig[] {
    return this.settings.get().repos
  }

  get(id: string): RepoConfig {
    const repo = this.list().find((r) => r.id === id)
    if (!repo) throw new RepoNotFoundError(id)
    return repo
  }

  /** Validates the folder, finds the work-tree root, remotes and base branch, then saves it. */
  async add(folder: string): Promise<RepoConfig> {
    const info = await inspectRepo(this.git, folder)
    // Resolve symlinks so /tmp/x and /private/tmp/x are recognised as the same repo.
    const real = (p: string) => {
      try {
        return realpathSync.native(p)
      } catch {
        return p
      }
    }
    const existing = this.list().find((r) => samePath(real(r.path), real(info.root)))
    if (existing) {
      throw new GitError(
        'precondition',
        info.root,
        [],
        `${existing.name} is already in your repos.`,
      )
    }
    const repo = RepoConfigSchema.parse({
      id: this.newId(),
      path: info.root,
      name: info.name,
      baseBranch: info.baseBranch,
    })
    this.save([...this.list(), repo])
    return repo
  }

  update(id: string, patch: RepoPatch): RepoConfig {
    const next = RepoConfigSchema.parse({ ...this.get(id), ...patch })
    this.save(this.list().map((r) => (r.id === id ? next : r)))
    return next
  }

  remove(id: string): void {
    this.get(id)
    this.save(this.list().filter((r) => r.id !== id))
  }

  private save(repos: RepoConfig[]): void {
    this.settings.replace({ ...this.settings.get(), repos })
  }
}
