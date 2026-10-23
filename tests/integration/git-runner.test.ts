import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitError } from '../../src/main/services/git/errors'
import { GitRunner } from '../../src/main/services/git/exec'
import { parseLeftRight, parseStashList, parseStatusV2 } from '../../src/main/services/git/parse'
import { makeRepos, otherClone, type Repos } from '../fixtures/git-repos'

let repos: Repos | undefined
afterEach(() => repos?.cleanup())

const failure = async (p: Promise<unknown>): Promise<GitError> => {
  try {
    await p
  } catch (err) {
    if (err instanceof GitError) return err
    throw err
  }
  throw new Error('expected a GitError')
}

// Real git processes: allow more than the default 5 s per test.
describe('GitRunner against real repositories', { timeout: 20_000 }, () => {
  it('captures output and parses real porcelain v2 status', async () => {
    repos = makeRepos()
    const r = new GitRunner()
    const { clone } = repos
    repos.commit(clone, 'a.txt', 'one\n')
    writeFileSync(join(clone, 'README.md'), 'changed\n')
    writeFileSync(join(clone, 'new.txt'), 'untracked\n')

    const out = await r.run(['status', '--porcelain=v2', '--branch'], { cwd: clone })
    const status = parseStatusV2(out.stdout)
    expect(status.branch).toMatchObject({
      head: 'develop',
      upstream: 'origin/develop',
      ahead: 1,
      behind: 0,
    })
    expect(status).toMatchObject({ changed: 1, untracked: 1, conflicted: [] })
  })

  it('parses a real stash list', async () => {
    repos = makeRepos()
    const r = new GitRunner()
    writeFileSync(join(repos.clone, 'README.md'), 'wip\n')
    await r.run(['stash', 'push', '-m', 'devdock: test stash'], { cwd: repos.clone })
    const out = await r.run(['stash', 'list'], { cwd: repos.clone })
    expect(parseStashList(out.stdout)).toEqual([
      { index: 0, ref: 'stash@{0}', branch: 'develop', message: 'devdock: test stash' },
    ])
  })

  it('streams output while running', async () => {
    repos = makeRepos()
    const chunks: string[] = []
    await new GitRunner().run(['log', '--oneline'], {
      cwd: repos.clone,
      onOutput: (c) => chunks.push(c),
    })
    expect(chunks.join('')).toContain('initial')
  })

  it('classifies "not a repository"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdock-notrepo-'))
    try {
      const e = await failure(new GitRunner().run(['status'], { cwd: dir }))
      expect(e.kind).toBe('not-a-repo')
      expect(e.details).toMatch(/not a git repository/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a deleted repo folder as not-a-repo, not as git missing', async () => {
    const e = await failure(
      new GitRunner().run(['status'], { cwd: join(tmpdir(), 'devdock-gone-0000') }),
    )
    expect(e.kind).toBe('not-a-repo')
    expect(e.message).toMatch(/no longer exists/)
  })

  it("ignores the user's color settings when producing parseable output", async () => {
    repos = makeRepos()
    repos.git(repos.clone, 'config', 'color.ui', 'always')
    repos.git(repos.clone, 'config', 'color.status', 'always')
    const out = await new GitRunner().run(['status', '--porcelain=v2', '--branch'], {
      cwd: repos.clone,
    })
    expect(out.stdout).not.toContain('\u001b[')
    expect(parseStatusV2(out.stdout).branch.head).toBe('develop')
  })

  it('classifies a missing git binary', async () => {
    repos = makeRepos()
    const e = await failure(
      new GitRunner('git-does-not-exist-devdock').run(['status'], { cwd: repos.clone }),
    )
    expect(e.kind).toBe('git-missing')
  })

  it('classifies a rejected non-fast-forward push', async () => {
    repos = makeRepos()
    const other = otherClone(repos, repos.origin)
    repos.commit(other, 'b.txt', 'theirs\n')
    repos.git(other, 'push', '-q', 'origin', 'develop')
    repos.commit(repos.clone, 'c.txt', 'mine\n')
    const e = await failure(
      new GitRunner().run(['push', 'origin', 'develop'], { cwd: repos.clone }),
    )
    expect(e.kind).toBe('non-fast-forward')
  })

  it('classifies a merge conflict', async () => {
    repos = makeRepos()
    const { clone } = repos
    repos.git(clone, 'checkout', '-q', '-b', 'feature/x')
    repos.commit(clone, 'README.md', 'mine\n')
    repos.git(clone, 'checkout', '-q', 'develop')
    repos.commit(clone, 'README.md', 'theirs\n')
    repos.git(clone, 'checkout', '-q', 'feature/x')
    const e = await failure(new GitRunner().run(['merge', 'develop'], { cwd: clone }))
    expect(e.kind).toBe('conflict')
    const status = parseStatusV2(
      (await new GitRunner().run(['status', '--porcelain=v2', '--branch'], { cwd: clone })).stdout,
    )
    expect(status.conflicted).toEqual(['README.md'])
  })

  it('parses real rev-list --left-right --count output', async () => {
    repos = makeRepos()
    const other = otherClone(repos, repos.origin)
    repos.commit(other, 'theirs.txt', '1\n')
    repos.git(other, 'push', '-q', 'origin', 'develop')
    repos.commit(repos.clone, 'mine1.txt', '1\n')
    repos.commit(repos.clone, 'mine2.txt', '2\n')
    const r = new GitRunner()
    await r.run(['fetch', 'origin'], { cwd: repos.clone })
    const out = await r.run(['rev-list', '--left-right', '--count', 'HEAD...origin/develop'], {
      cwd: repos.clone,
    })
    expect(parseLeftRight(out.stdout)).toEqual({ left: 2, right: 1 })
  })

  it('classifies a dirty tree that would be overwritten', async () => {
    repos = makeRepos()
    const { clone } = repos
    repos.git(clone, 'checkout', '-q', '-b', 'feature/x')
    repos.commit(clone, 'README.md', 'feature change\n')
    repos.git(clone, 'checkout', '-q', 'develop')
    writeFileSync(join(clone, 'README.md'), 'uncommitted local edit\n')
    const e = await failure(new GitRunner().run(['merge', 'feature/x'], { cwd: clone }))
    expect(e.kind).toBe('dirty-tree')
  })

  it('classifies an auth failure (HTTP 401) without hanging on a credential prompt', async () => {
    repos = makeRepos()
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="devdock-test"' })
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    try {
      const started = Date.now()
      const e = await failure(
        new GitRunner().run(
          // Empty helper list: the test must not depend on (or touch) the user's keychain.
          ['-c', 'credential.helper=', 'ls-remote', `http://127.0.0.1:${port}/repo.git`],
          { cwd: repos.clone, timeoutMs: 15_000 },
        ),
      )
      expect(e.kind).toBe('auth')
      expect(Date.now() - started).toBeLessThan(10_000)
    } finally {
      server.close()
    }
  })

  it('times out long commands', async () => {
    repos = makeRepos()
    // Repo config, not `-c alias.…`: the guard refuses command-line alias overrides.
    repos.git(repos.clone, 'config', 'alias.slow', '!sleep 2')
    const e = await failure(new GitRunner().run(['slow'], { cwd: repos.clone, timeoutMs: 300 }))
    expect(e.kind).toBe('timeout')
  })

  it('refuses destructive commands without spawning git, and logs everything else', async () => {
    repos = makeRepos()
    const r = new GitRunner()
    const e = await failure(r.run(['reset', '--hard', 'HEAD'], { cwd: repos.clone }))
    expect(e.kind).toBe('unsafe')
    await r.run(['status'], { cwd: repos.clone })
    expect(r.log().map((c) => c.args.join(' '))).toEqual(['status'])
    expect(r.log()[0]).toMatchObject({ cwd: repos.clone, exitCode: 0 })
  })
})
