import type { DevServerState } from '@shared/devserver'
import { isActive } from '@shared/devserver'
import type { RepoConfig, Settings } from '@shared/settings'
import type { GitRunner } from './git/exec'
import { log } from './logger'

export interface BranchSwitchDeps {
  git: Pick<GitRunner, 'run'>
  settings: () => Pick<Settings, 'workflow' | 'repos'>
  devServers: {
    list: () => DevServerState[]
    start: (repo: RepoConfig, kind: 'dev', opts: { ifStopped?: boolean }) => Promise<DevServerState>
  }
}

/**
 * T5 "start the dev server after a branch switch": remembers each repo's branch and, when the
 * HEAD watcher reports a different one, starts the repo's dev server if Settings → Workflow
 * says so and it isn't already running (owner: never restart a running one). A detached HEAD
 * (rebase, bisect, checking out a commit) is not a switch: the branch before it is kept, so
 * finishing a rebase doesn't count either.
 */
export class BranchSwitchFollower {
  private readonly branches = new Map<string, string>()

  constructor(private readonly deps: BranchSwitchDeps) {}

  private async branchOf(repo: RepoConfig): Promise<string | null> {
    try {
      const { stdout } = await this.deps.git.run(['symbolic-ref', '--short', '-q', 'HEAD'], {
        cwd: repo.path,
      })
      return stdout.trim() || null
    } catch {
      // Detached HEAD (exit 1) or the folder is gone.
      return null
    }
  }

  /** Records the current branch of repos seen for the first time; forgets removed ones. */
  async sync(repos: readonly RepoConfig[]): Promise<void> {
    const ids = new Set(repos.map((r) => r.id))
    for (const id of [...this.branches.keys()]) if (!ids.has(id)) this.branches.delete(id)
    for (const repo of repos) {
      if (this.branches.has(repo.id)) continue
      const branch = await this.branchOf(repo)
      if (branch) this.branches.set(repo.id, branch)
    }
  }

  /** The HEAD watcher saw a change in this repo. Resolves once anything it started is started. */
  async changed(repoId: string): Promise<void> {
    const repo = this.deps.settings().repos.find((r) => r.id === repoId)
    if (!repo) return
    const branch = await this.branchOf(repo)
    if (!branch) return
    const before = this.branches.get(repoId)
    this.branches.set(repoId, branch)
    if (before === undefined || before === branch) return
    if (!this.deps.settings().workflow.devServerAfterSwitch || !repo.devCommand) return
    const server = this.deps.devServers.list().find((s) => s.repoId === repoId && s.kind === 'dev')
    if (server && isActive(server.status)) return
    try {
      await this.deps.devServers.start(repo, 'dev', { ifStopped: true })
      log.info(`dev server started for ${repo.name} after switching to ${branch}`)
    } catch (err) {
      // Shown in the repo's dev server panel (failed state) when the start itself fails.
      log.warn(`could not start the dev server for ${repo.name} after a branch switch`, err)
    }
  }
}
