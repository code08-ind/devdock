import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROTECTED, DEFAULT_TEMPLATES, type RepoConfig } from '../../src/shared/settings'
import { GitActions, type ActionOutcome } from '../../src/main/services/git/actions'
import { GitError } from '../../src/main/services/git/errors'
import { GitRunner, unsafeReason, type CommandRecord } from '../../src/main/services/git/exec'
import { inspectRepo, repoStatus } from '../../src/main/services/git/repo'
import { makeRepos, otherClone, type Repos } from '../fixtures/git-repos'

/** Every command any test ran, for the P1.D4 "no destructive commands" check at the end. */
const allCommands: CommandRecord[] = []
let repos: Repos | undefined
let runner: GitRunner

afterEach(() => {
  allCommands.push(...runner.log())
  repos?.cleanup()
  repos = undefined
})

function setup(opts: { upstream?: boolean } = {}) {
  repos = makeRepos(opts)
  runner = new GitRunner()
  const repo: RepoConfig = {
    id: 'r1',
    path: repos.clone,
    name: 'app',
    baseBranch: 'develop',
    protectedPatterns: [...DEFAULT_PROTECTED],
    branchTemplates: { ...DEFAULT_TEMPLATES },
    devCommand: 'npm run dev',
  }
  return { repos, repo, actions: new GitActions(runner), git: repos.git }
}

/** Someone else pushes a commit to `branch` on `remote`. */
function pushFromElsewhere(
  r: Repos,
  remote: string,
  branch: string,
  file: string,
  content: string,
) {
  const dir = otherClone(r, remote, `other-${Math.random().toString(36).slice(2, 8)}`)
  r.git(dir, 'checkout', '-q', branch)
  r.commit(dir, file, content)
  r.git(dir, 'push', '-q', 'origin', branch)
}

const head = (r: Repos, ref = 'HEAD') => r.git(r.clone, 'rev-parse', ref).trim()
const gitError = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    if (e instanceof GitError) return e
    throw e
  }
  throw new Error('expected a GitError')
}
const done = (o: ActionOutcome) => {
  expect(o.status, o.summary).toBe('done')
  return o as Extract<ActionOutcome, { status: 'done' }>
}

describe('git actions on real repositories', { timeout: 30_000 }, () => {
  it('inspects a repo: root from a subfolder, remotes, base branch, upstream', async () => {
    const { repos: r } = setup({ upstream: true })
    mkdirSync(join(r.clone, 'src', 'deep'), { recursive: true })
    const info = await inspectRepo(runner, join(r.clone, 'src', 'deep'))
    expect(info.root.replace(/\\/g, '/').toLowerCase()).toContain('/clone')
    expect(info).toMatchObject({ name: 'clone', baseBranch: 'develop', hasUpstream: true })
    expect(Object.keys(info.remotes).sort()).toEqual(['origin', 'upstream'])
  })

  it('detects main as the base when there is no develop', async () => {
    repos = makeRepos({ base: 'main' })
    runner = new GitRunner()
    expect(await inspectRepo(runner, repos.clone)).toMatchObject({ baseBranch: 'main' })
  })

  it('reports status: branch, ahead/behind vs upstream and base, dirty, stashes, fetch time', async () => {
    const { repos: r, repo, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/x')
    r.commit(r.clone, 'f.txt', 'feature\n')
    git(r.clone, 'push', '-q', '-u', 'origin', 'feature/x')
    r.commit(r.clone, 'g.txt', 'local only\n')
    pushFromElsewhere(r, r.origin, 'develop', 'd.txt', 'base moved\n')
    git(r.clone, 'fetch', '-q')
    writeFileSync(join(r.clone, 'README.md'), 'edited\n')
    writeFileSync(join(r.clone, 'new.txt'), 'untracked\n')
    git(r.clone, 'stash', 'push', '-q', '--include-untracked')
    writeFileSync(join(r.clone, 'README.md'), 'edited again\n')

    const s = await repoStatus(runner, repo)
    expect(s).toMatchObject({
      branch: 'feature/x',
      detached: false,
      vsUpstream: { ahead: 1, behind: 0 },
      vsBase: { ahead: 2, behind: 1 },
      dirty: 1,
      conflicted: [],
      stashes: 1,
      operation: null,
      hasUpstreamRemote: false,
    })
    expect(s.lastFetch).toBeGreaterThan(Date.now() - 60_000)
  })

  it('fetch all', async () => {
    const { repos: r, repo, actions } = setup()
    pushFromElsewhere(r, r.origin, 'develop', 'x.txt', 'x\n')
    const output: string[] = []
    done(await actions.run(repo, { action: 'fetchAll' }, (c) => output.push(c)))
    expect(head(r, 'origin/develop')).not.toBe(head(r))
  })

  it('sync base: fast-forwards develop without checking it out', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/y')
    pushFromElsewhere(r, r.origin, 'develop', 'x.txt', 'x\n')
    const plan = await actions.plan(repo, { action: 'syncBase' })
    expect(plan.map((c) => c.args.join(' '))).toEqual(['fetch origin develop:develop'])
    done(await actions.run(repo, { action: 'syncBase' }))
    expect(head(r, 'develop')).toBe(head(r, 'origin/develop'))
    expect(git(r.clone, 'branch', '--show-current').trim()).toBe('feature/y')
  })

  it('sync base: refuses a non-fast-forward and changes nothing', async () => {
    const { repos: r, repo, actions, git } = setup()
    r.commit(r.clone, 'local.txt', 'local base commit\n')
    git(r.clone, 'checkout', '-q', '-b', 'feature/z')
    pushFromElsewhere(r, r.origin, 'develop', 'remote.txt', 'remote\n')
    const before = head(r, 'develop')
    const e = await gitError(actions.run(repo, { action: 'syncBase' }))
    expect(e.kind).toBe('non-fast-forward')
    expect(head(r, 'develop')).toBe(before)
  })

  it('sync base while on the base branch uses merge --ff-only', async () => {
    const { repos: r, repo, actions } = setup()
    pushFromElsewhere(r, r.origin, 'develop', 'x.txt', 'x\n')
    done(await actions.run(repo, { action: 'syncBase' }))
    expect(head(r)).toBe(head(r, 'origin/develop'))
  })

  it('update my branch: refuses a dirty tree, then Stash & continue round-trips the changes', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/w')
    r.commit(r.clone, 'mine.txt', 'mine\n')
    pushFromElsewhere(r, r.origin, 'develop', 'theirs.txt', 'theirs\n')
    writeFileSync(join(r.clone, 'mine.txt'), 'uncommitted edit\n')
    writeFileSync(join(r.clone, 'scratch.txt'), 'untracked file\n')
    const before = head(r)

    const e = await gitError(
      actions.run(repo, { action: 'updateBranch', strategy: 'merge', stash: false }),
    )
    expect(e.kind).toBe('dirty-tree')
    expect(head(r)).toBe(before)

    const out = done(
      await actions.run(repo, { action: 'updateBranch', strategy: 'merge', stash: true }),
    )
    expect(out.summary).toMatch(/stashed changes are back/)
    expect(readFileSync(join(r.clone, 'mine.txt'), 'utf8')).toBe('uncommitted edit\n')
    expect(readFileSync(join(r.clone, 'scratch.txt'), 'utf8')).toBe('untracked file\n')
    expect(readFileSync(join(r.clone, 'theirs.txt'), 'utf8')).toBe('theirs\n')
    expect(git(r.clone, 'stash', 'list').trim()).toBe('')
  })

  it('update my branch (merge): detects a conflict, lists files, aborts cleanly and restores the stash', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/c')
    r.commit(r.clone, 'README.md', 'mine\n')
    pushFromElsewhere(r, r.origin, 'develop', 'README.md', 'theirs\n')
    writeFileSync(join(r.clone, 'notes.txt'), 'work in progress\n')
    const before = head(r)

    const out = await actions.run(repo, { action: 'updateBranch', strategy: 'merge', stash: true })
    expect(out).toMatchObject({
      status: 'conflict',
      operation: 'merge',
      files: ['README.md'],
      stashed: true,
    })
    expect((await repoStatus(runner, repo)).operation).toBe('merge')
    // Other actions refuse while the merge is in progress.
    await expect(actions.run(repo, { action: 'pushBranch' })).rejects.toThrow(/in progress/)

    const plan = await actions.plan(repo, { action: 'abort' })
    expect(plan[0]!.args).toEqual(['merge', '--abort'])
    done(await actions.run(repo, { action: 'abort' }))
    const s = await repoStatus(runner, repo)
    expect(s).toMatchObject({ operation: null, conflicted: [], stashes: 0 })
    expect(head(r)).toBe(before)
    expect(readFileSync(join(r.clone, 'README.md'), 'utf8')).toBe('mine\n')
    expect(readFileSync(join(r.clone, 'notes.txt'), 'utf8')).toBe('work in progress\n')
  })

  it('update my branch (rebase): conflict, then abort returns to the original commit', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/r')
    r.commit(r.clone, 'README.md', 'mine 1\n')
    r.commit(r.clone, 'other.txt', 'mine 2\n')
    pushFromElsewhere(r, r.origin, 'develop', 'README.md', 'theirs\n')
    const before = head(r)

    const out = await actions.run(repo, {
      action: 'updateBranch',
      strategy: 'rebase',
      stash: false,
    })
    expect(out).toMatchObject({ status: 'conflict', operation: 'rebase', files: ['README.md'] })
    expect((await repoStatus(runner, repo)).operation).toBe('rebase')

    done(await actions.run(repo, { action: 'abort' }))
    expect(head(r)).toBe(before)
    expect(git(r.clone, 'branch', '--show-current').trim()).toBe('feature/r')
    expect((await repoStatus(runner, repo)).operation).toBeNull()
  })

  it('update my branch (rebase) succeeds without conflicts', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/ok')
    r.commit(r.clone, 'mine.txt', 'mine\n')
    pushFromElsewhere(r, r.origin, 'develop', 'theirs.txt', 'theirs\n')
    done(await actions.run(repo, { action: 'updateBranch', strategy: 'rebase', stash: false }))
    const s = await repoStatus(runner, repo)
    expect(s.vsBase).toEqual({ ahead: 1, behind: 0 })
  })

  it('update my branch: if the fetch fails after stashing, the changes are put back', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/net')
    writeFileSync(join(r.clone, 'README.md'), 'precious uncommitted work\n')
    git(r.clone, 'remote', 'set-url', 'origin', join(r.root, 'gone.git'))
    await expect(
      actions.run(repo, { action: 'updateBranch', strategy: 'merge', stash: true }),
    ).rejects.toBeInstanceOf(GitError)
    expect(readFileSync(join(r.clone, 'README.md'), 'utf8')).toBe('precious uncommitted work\n')
    expect(git(r.clone, 'stash', 'list').trim()).toBe('')
  })

  it('abort leaves alone a stash DevDock did not create for this update', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/s')
    r.commit(r.clone, 'README.md', 'mine\n')
    writeFileSync(join(r.clone, 'old.txt'), 'old work\n')
    // An older stash that happens to carry DevDock's message, e.g. from a previous session.
    git(
      r.clone,
      'stash',
      'push',
      '-q',
      '--include-untracked',
      '-m',
      'devdock: before updating feature/s from develop',
    )
    pushFromElsewhere(r, r.origin, 'develop', 'README.md', 'theirs\n')
    git(r.clone, 'fetch', '-q')
    expect(() => git(r.clone, 'merge', 'origin/develop')).toThrow()
    done(await actions.run(repo, { action: 'abort' }))
    expect(git(r.clone, 'stash', 'list').trim()).toMatch(/devdock: before updating/)
  })

  it('runs one action at a time per repo', async () => {
    const { repo, actions } = setup()
    const first = actions.run(repo, { action: 'fetchAll' })
    await expect(actions.run(repo, { action: 'fetchAll' })).rejects.toThrow(/still running/)
    await first
    done(await actions.run(repo, { action: 'fetchAll' }))
  })

  it('plan refuses the same things run refuses', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', 'main')
    await expect(actions.plan(repo, { action: 'pushBranch' })).rejects.toThrow(/blocked/)
    await expect(actions.plan(repo, { action: 'syncFork' })).rejects.toThrow(/upstream/)
  })

  it('refuses to update the base branch itself', async () => {
    const { repo, actions } = setup()
    await expect(
      actions.run(repo, { action: 'updateBranch', strategy: 'merge', stash: false }),
    ).rejects.toThrow(/Sync base/)
  })

  it('new branch: from a fresh origin/<base>, template name, collision suffix, no tracking', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'somewhere-else')
    r.commit(r.clone, 'local.txt', 'not on develop\n')
    pushFromElsewhere(r, r.origin, 'develop', 'fresh.txt', 'fresh\n')
    git(r.clone, 'branch', 'feature/NM-12-add-login-form')

    const req = {
      action: 'newBranch',
      kind: 'feature',
      key: 'NM-12',
      title: 'Add login form!',
    } as const
    const plan = await actions.plan(repo, req)
    expect(plan.at(-1)!.args).toEqual([
      'checkout',
      '-b',
      'feature/NM-12-add-login-form-2',
      '--no-track',
      'origin/develop',
    ])
    const out = done(await actions.run(repo, req))
    expect(out.branch).toBe('feature/NM-12-add-login-form-2')
    expect(head(r)).toBe(head(r, 'origin/develop'))
    // --no-track: the new branch must not track origin/develop.
    expect(() => git(r.clone, 'config', '--get', `branch.${out.branch}.remote`)).toThrow()
  })

  it('push branch: pushes a feature branch with upstream tracking', async () => {
    const { repos: r, repo, actions, git } = setup()
    git(r.clone, 'checkout', '-q', '-b', 'feature/push-me')
    r.commit(r.clone, 'p.txt', 'p\n')
    done(await actions.run(repo, { action: 'pushBranch' }))
    expect(git(r.origin, 'rev-parse', 'feature/push-me').trim()).toBe(head(r))
    expect((await repoStatus(runner, repo)).vsUpstream).toEqual({ ahead: 0, behind: 0 })
  })

  it.each(['develop', 'main', 'release/1.0', 'MASTER'])(
    'push branch: %s is blocked before any push runs',
    async (branch) => {
      const { repos: r, repo, actions, git } = setup()
      if (branch !== 'develop') git(r.clone, 'checkout', '-q', '-B', branch)
      const e = await gitError(actions.run(repo, { action: 'pushBranch' }))
      expect(e.kind).toBe('unsafe')
      expect(e.message).toMatch(/blocked/)
      expect(runner.log().some((c) => c.args.includes('push'))).toBe(false)
    },
  )

  it('sync fork end to end: upstream → local base → (confirmed) push to origin', async () => {
    const { repos: r, repo, actions, git } = setup({ upstream: true })
    git(r.clone, 'checkout', '-q', '-b', 'feature/f')
    pushFromElsewhere(r, r.upstream!, 'develop', 'up.txt', 'from upstream\n')
    const upstreamHead = git(r.upstream!, 'rev-parse', 'develop').trim()

    const synced = done(await actions.run(repo, { action: 'syncFork' }))
    expect(synced.pushable).toBe(1)
    expect(head(r, 'develop')).toBe(upstreamHead)
    // Nothing was pushed yet: that step needs confirmation.
    expect(git(r.origin, 'rev-parse', 'develop').trim()).not.toBe(upstreamHead)

    done(await actions.run(repo, { action: 'pushBase', confirmed: true }))
    expect(git(r.origin, 'rev-parse', 'develop').trim()).toBe(upstreamHead)
    expect(done(await actions.run(repo, { action: 'syncFork' })).pushable).toBe(0)
  })

  it('sync fork and its push both refuse without an upstream remote', async () => {
    const { repo, actions } = setup()
    await expect(actions.run(repo, { action: 'syncFork' })).rejects.toThrow(/upstream/)
    await expect(actions.run(repo, { action: 'pushBase', confirmed: true })).rejects.toThrow(
      /upstream/,
    )
    expect(runner.log().some((c) => c.args[0] === 'push')).toBe(false)
  })

  it('pushing the base after sync fork is rejected by origin if it diverged (no force)', async () => {
    const { repos: r, repo, actions, git } = setup({ upstream: true })
    git(r.clone, 'checkout', '-q', '-b', 'feature/g')
    pushFromElsewhere(r, r.upstream!, 'develop', 'up.txt', 'upstream\n')
    pushFromElsewhere(r, r.origin, 'develop', 'fork.txt', 'fork-only\n')
    done(await actions.run(repo, { action: 'syncFork' }))
    const e = await gitError(actions.run(repo, { action: 'pushBase', confirmed: true }))
    expect(e.kind).toBe('non-fast-forward')
  })
})

afterAll(() => {
  // P1.D4: across every action above, nothing destructive reached git.
  expect(allCommands.length).toBeGreaterThan(50)
  for (const c of allCommands) {
    const line = c.args.join(' ')
    expect(unsafeReason(c.args), line).toBeNull()
    expect(line).not.toMatch(/push .*(--force|-f\b|\+)|reset --hard/)
  }
})
