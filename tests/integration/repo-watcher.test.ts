import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROTECTED, DEFAULT_TEMPLATES, type RepoConfig } from '../../src/shared/settings'
import { GitRunner } from '../../src/main/services/git/exec'
import { RepoWatcher } from '../../src/main/services/repo-watcher'
import { makeRepos, type Repos } from '../fixtures/git-repos'

let repos: Repos | undefined
let watcher: RepoWatcher | undefined
afterEach(() => {
  watcher?.dispose()
  repos?.cleanup()
})

const config = (r: Repos, id = 'r1'): RepoConfig => ({
  id,
  path: r.clone,
  name: 'app',
  baseBranch: 'develop',
  protectedPatterns: [...DEFAULT_PROTECTED],
  branchTemplates: { ...DEFAULT_TEMPLATES },
  devCommand: 'npm run dev',
  checkCommand: '',
})

describe('RepoWatcher (.git/HEAD)', { timeout: 15_000 }, () => {
  it('reports a checkout once (debounced), and keeps watching after git replaces HEAD', async () => {
    repos = makeRepos()
    const onChange = vi.fn()
    watcher = new RepoWatcher(new GitRunner(), onChange, 100)
    await watcher.sync([config(repos)])
    expect(watcher.watchedIds()).toEqual(['r1'])

    repos.git(repos.clone, 'checkout', '-q', '-b', 'feature/a')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('r1'))
    await new Promise((r) => setTimeout(r, 300))
    expect(onChange).toHaveBeenCalledTimes(1)

    repos.git(repos.clone, 'checkout', '-q', 'develop')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
  })

  it('follows the repo list: removed repos stop, missing folders are skipped', async () => {
    repos = makeRepos()
    watcher = new RepoWatcher(new GitRunner(), vi.fn())
    await watcher.sync([config(repos), { ...config(repos, 'gone'), path: '/nonexistent/devdock' }])
    expect(watcher.watchedIds()).toEqual(['r1'])
    await watcher.sync([])
    expect(watcher.watchedIds()).toEqual([])
  })
})
