import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Throwaway git setups for integration tests: bare origin, a clone, optional upstream. */
export interface Repos {
  root: string
  /** Bare repo standing in for the team's remote. */
  origin: string
  /** The user's working copy (a clone of origin). */
  clone: string
  /** Bare repo origin was forked from (only with `upstream: true`). */
  upstream?: string
  /** Runs git synchronously in `cwd` (test setup only; the app uses GitRunner). */
  git: (cwd: string, ...args: string[]) => string
  /** Writes a file and commits it in `cwd`. */
  commit: (cwd: string, file: string, content: string, message?: string) => void
  cleanup: () => void
}

/**
 * Keep tests independent of the developer's git config (hooks, gpg signing, autocrlf, helpers)
 * and stop git from finding a repository above the temp folder. Applies to GitRunner too, which
 * inherits process.env.
 */
const emptyConfig = join(mkdtempSync(join(tmpdir(), 'devdock-gitcfg-')), 'gitconfig')
// GitRunner commits too (merge, stash, rebase): CI machines have no identity to fall back on.
writeFileSync(
  emptyConfig,
  '[user]\n\tname = DevDock Test\n\temail = test@devdock.invalid\n[commit]\n\tgpgsign = false\n',
)
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = realpathSync(tmpdir())

const IDENTITY = [
  '-c',
  'user.name=DevDock Test',
  '-c',
  'user.email=test@devdock.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
  '-c',
  'advice.detachedHead=false',
]

export function makeRepos(opts: { upstream?: boolean; base?: string } = {}): Repos {
  const base = opts.base ?? 'develop'
  const root = mkdtempSync(join(tmpdir(), 'devdock-git-'))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', [...IDENTITY, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const commit = (cwd: string, file: string, content: string, message = `edit ${file}`) => {
    writeFileSync(join(cwd, file), content)
    git(cwd, 'add', file)
    git(cwd, 'commit', '-q', '-m', message)
  }

  // Seed: one repo with main + base, pushed to the remote(s).
  const seed = join(root, 'seed')
  git(root, 'init', '-q', seed)
  commit(seed, 'README.md', '# app\n', 'initial')
  if (base !== 'main') git(seed, 'branch', base)

  const origin = join(root, 'origin.git')
  let upstream: string | undefined
  if (opts.upstream) {
    upstream = join(root, 'upstream.git')
    git(root, 'init', '-q', '--bare', upstream)
    git(seed, 'push', '-q', upstream, ...new Set(['main', base]))
    // origin is the user's fork of upstream.
    git(root, 'clone', '-q', '--bare', upstream, origin)
  } else {
    git(root, 'init', '-q', '--bare', origin)
    git(seed, 'push', '-q', origin, ...new Set(['main', base]))
  }
  // Point the bare origin's HEAD at base, like a team whose default branch is develop.
  git(origin, 'symbolic-ref', 'HEAD', `refs/heads/${base}`)

  const clone = join(root, 'clone')
  git(root, 'clone', '-q', origin, clone)
  if (upstream) git(clone, 'remote', 'add', 'upstream', upstream)

  return {
    root,
    origin,
    clone,
    upstream,
    git,
    commit,
    // Windows: a process git started (hook, alias) can outlive a timed-out git and hold the folder.
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 }),
  }
}

/** A second working copy of a bare remote, for making "someone else pushed" commits. */
export function otherClone(repos: Repos, remote: string, name = 'other'): string {
  const dir = join(repos.root, name)
  repos.git(repos.root, 'clone', '-q', remote, dir)
  return dir
}
