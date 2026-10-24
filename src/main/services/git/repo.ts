import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BASELINE_SCRIPT } from '@shared/devserver'
import type { RepoStatus } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { GitError } from './errors'
import type { GitRunner } from './exec'
import { parseLeftRight, parseRemotes, parseStashList, parseStatusV2 } from './parse'

/**
 * Fetch URLs of every remote of the registered repos (Bitbucket Cloud scans their
 * bitbucket.org repos). A repo whose remotes can't be read (moved, deleted) contributes none.
 */
export async function remoteUrls(git: GitRunner, repos: RepoConfig[]): Promise<string[]> {
  const urls = await Promise.all(
    repos.map((repo) =>
      git.run(['remote', '-v'], { cwd: repo.path }).then(
        ({ stdout }) => Object.values(parseRemotes(stdout)),
        () => [],
      ),
    ),
  )
  return urls.flat()
}

/** What DevDock learns about a folder when it is added (SPEC 6.2 "Register"). */
export interface RepoInspection {
  /** Top level of the work tree (the user may pick a subfolder). */
  root: string
  name: string
  remotes: Record<string, string>
  hasUpstream: boolean
  /** Detected base branch: `develop`, falling back to `main`, then origin's default. */
  baseBranch: string
}

const BASE_PREFERENCE = ['develop', 'main', 'master']

export async function inspectRepo(git: GitRunner, folder: string): Promise<RepoInspection> {
  const top = await git.run(['rev-parse', '--show-toplevel'], { cwd: folder })
  const root = top.stdout.trim()
  const remotes = parseRemotes((await git.run(['remote', '-v'], { cwd: root })).stdout)
  const branches = await listBranches(git, root)
  const remoteBases = new Set(
    branches.remote.filter((b) => b.startsWith('origin/')).map((b) => b.slice(7)),
  )
  const known = remotes.origin ? remoteBases : new Set(branches.local)
  let baseBranch = BASE_PREFERENCE.find((b) => known.has(b))
  if (!baseBranch && remotes.origin) {
    // origin/HEAD, when the clone recorded it.
    const head = await git
      .run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
        cwd: root,
        okCodes: [1],
      })
      .catch(() => null)
    baseBranch = head?.stdout.trim().replace(/^origin\//, '') || undefined
  }
  baseBranch ??= branches.local[0] ?? 'main'
  return { root, name: basename(root), remotes, hasUpstream: 'upstream' in remotes, baseBranch }
}

export async function listBranches(
  git: GitRunner,
  cwd: string,
): Promise<{ local: string[]; remote: string[] }> {
  const out = await git.run(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], {
    cwd,
  })
  const local: string[] = []
  const remote: string[] = []
  for (const ref of out.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (ref.startsWith('refs/heads/')) local.push(ref.slice(11))
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remote.push(ref.slice(13))
  }
  return { local, remote }
}

export type Operation = 'merge' | 'rebase' | null

export interface AheadBehind {
  ahead: number
  behind: number
}

export type { RepoStatus }

export async function absoluteGitDir(git: GitRunner, cwd: string): Promise<string> {
  return (await git.run(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
}

export function operationIn(gitDir: string): Operation {
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) {
    return 'rebase'
  }
  return existsSync(join(gitDir, 'MERGE_HEAD')) ? 'merge' : null
}

async function aheadBehind(git: GitRunner, cwd: string, ref: string): Promise<AheadBehind | null> {
  try {
    const out = await git.run(['rev-list', '--left-right', '--count', `HEAD...${ref}`], { cwd })
    const { left, right } = parseLeftRight(out.stdout)
    return { ahead: left, behind: right }
  } catch (err) {
    // The ref doesn't exist (branch never pushed, or base not on origin).
    if (err instanceof GitError && err.kind === 'failed') return null
    throw err
  }
}

export async function repoStatus(git: GitRunner, repo: RepoConfig): Promise<RepoStatus> {
  const cwd = repo.path
  const tree = parseStatusV2(
    (await git.run(['status', '--porcelain=v2', '--branch', '-z'], { cwd })).stdout,
  )
  const gitDir = await absoluteGitDir(git, cwd)
  const remotes = parseRemotes((await git.run(['remote', '-v'], { cwd })).stdout)
  const branch = tree.branch.head
  const [vsUpstream, vsBase, stashOut] = await Promise.all([
    branch && remotes.origin ? aheadBehind(git, cwd, `refs/remotes/origin/${branch}`) : null,
    remotes.origin ? aheadBehind(git, cwd, `refs/remotes/origin/${repo.baseBranch}`) : null,
    git.run(['stash', 'list'], { cwd }),
  ])
  const fetchHead = join(gitDir, 'FETCH_HEAD')
  return {
    branch,
    detached: branch === null,
    vsUpstream,
    vsBase,
    dirty: tree.changed + tree.untracked + tree.conflicted.length,
    conflicted: tree.conflicted,
    stashes: parseStashList(stashOut.stdout).length,
    lastFetch: existsSync(fetchHead) ? statSync(fetchHead).mtimeMs : null,
    operation: operationIn(gitDir),
    hasUpstreamRemote: 'upstream' in remotes,
    hasBaseline: existsSync(join(cwd, BASELINE_SCRIPT)),
  }
}
