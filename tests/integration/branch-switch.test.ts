import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DevServerState } from '../../src/shared/devserver'
import { DEFAULT_PROTECTED, DEFAULT_TEMPLATES, type RepoConfig } from '../../src/shared/settings'
import { BranchSwitchFollower } from '../../src/main/services/branch-switch'
import { GitRunner } from '../../src/main/services/git/exec'
import { makeRepos, type Repos } from '../fixtures/git-repos'

let repos: Repos | undefined
afterEach(() => {
  repos?.cleanup()
  repos = undefined
})

const state = (repoId: string, status: DevServerState['status']): DevServerState => ({
  repoId,
  kind: 'dev',
  command: 'npm run dev',
  status,
  pid: 1,
  url: null,
  port: null,
  startedAt: 0,
  exitCode: null,
  error: null,
})

function setup(opts: { on?: boolean; devCommand?: string; servers?: DevServerState[] } = {}) {
  repos = makeRepos()
  const repo: RepoConfig = {
    id: 'r1',
    path: repos.clone,
    name: 'app',
    baseBranch: 'develop',
    protectedPatterns: [...DEFAULT_PROTECTED],
    branchTemplates: { ...DEFAULT_TEMPLATES },
    devCommand: opts.devCommand ?? 'npm run dev',
    checkCommand: '',
  }
  const settings = { workflow: { devServerAfterSwitch: opts.on ?? true }, repos: [repo] }
  const start = vi.fn(async (r: RepoConfig) => state(r.id, 'starting'))
  const follower = new BranchSwitchFollower({
    git: new GitRunner(),
    settings: () => settings as never,
    devServers: { list: () => opts.servers ?? [], start },
  })
  return { r: repos, repo, follower, start, settings }
}

describe('dev server after a branch switch (T5c)', () => {
  it('starts the dev server when the branch changes, not when it stays the same', async () => {
    const { r, repo, follower, start } = setup()
    await follower.sync([repo])
    // A HEAD event without a switch (e.g. git touching HEAD): nothing.
    await follower.changed('r1')
    expect(start).not.toHaveBeenCalled()
    r.git(r.clone, 'checkout', '-q', '-b', 'feature/x')
    await follower.changed('r1')
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(repo, 'dev', { ifStopped: true })
  })

  it('off by default in Settings, without a dev command, or when one is running: nothing starts', async () => {
    for (const opts of [
      { on: false },
      { devCommand: '' },
      { servers: [state('r1', 'running')] },
      { servers: [state('r1', 'starting')] },
    ]) {
      const { r, repo, follower, start } = setup(opts)
      await follower.sync([repo])
      r.git(r.clone, 'checkout', '-q', '-b', 'feature/y')
      await follower.changed('r1')
      expect(start, JSON.stringify(opts)).not.toHaveBeenCalled()
      repos?.cleanup()
      repos = undefined
    }
  })

  it('a stopped or exited server is started again after a switch', async () => {
    const { r, repo, follower, start } = setup({ servers: [state('r1', 'exited')] })
    await follower.sync([repo])
    r.git(r.clone, 'checkout', '-q', '-b', 'feature/z')
    await follower.changed('r1')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a detached HEAD (rebase, a commit checked out) is not a switch, nor is coming back', async () => {
    const { r, repo, follower, start } = setup()
    await follower.sync([repo])
    r.git(r.clone, 'checkout', '-q', '--detach')
    await follower.changed('r1')
    r.git(r.clone, 'checkout', '-q', 'develop')
    await follower.changed('r1')
    expect(start).not.toHaveBeenCalled()
  })

  it('a repo first seen in a change event is only recorded; a removed repo is forgotten', async () => {
    const { r, follower, start, settings } = setup()
    // No sync: the first change only learns the branch.
    await follower.changed('r1')
    expect(start).not.toHaveBeenCalled()
    await follower.sync([])
    settings.repos = []
    r.git(r.clone, 'checkout', '-q', '-b', 'feature/gone')
    await follower.changed('r1')
    expect(start).not.toHaveBeenCalled()
  })
})
