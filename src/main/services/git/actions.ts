import type { ActionOutcome, ActionRequest, PlannedCommand } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import {
  isProtectedBranch,
  isValidBranchName,
  renderBranchName,
  slugify,
  uniqueBranchName,
} from './branches'
import { GitError } from './errors'
import type { GitRunner } from './exec'
import { parseRemotes, parseStashList, parseStatusV2 } from './parse'
import { absoluteGitDir, listBranches, operationIn, type Operation } from './repo'

export type { ActionOutcome, ActionRequest, PlannedCommand }

export type OutputListener = (chunk: string, stream: 'stdout' | 'stderr') => void

type Req<A extends ActionRequest['action']> = Extract<ActionRequest, { action: A }>
type Git = (args: string[]) => Promise<{ stdout: string }>

const STASH_PREFIX = 'devdock: before updating'
const stashMessage = (branch: string, base: string) => `${STASH_PREFIX} ${branch} from ${base}`
const STATUS = ['status', '--porcelain=v2', '--branch', '-z']

interface Context {
  branch: string | null
  dirty: boolean
  operation: Operation
  hasOrigin: boolean
  hasUpstream: boolean
}

/** DevDock declined before running git: wrong branch, missing remote, busy repo, … */
function refuse(message: string): never {
  throw new GitError('precondition', '', [], message)
}

/**
 * Runs the repo actions with the safety rules from SPEC 6.2: fast-forward only where promised,
 * refuse on a dirty tree unless the user chose Stash & continue, stop on conflicts, never force.
 * `plan()` and `run()` share the same checks and command lists, so the disclosure shows what
 * will really run. Every command goes through GitRunner (destructive-command guard, command log).
 */
export class GitActions {
  /** Repos with an action in flight: one at a time per repo (stash/merge/pop must not interleave). */
  private readonly busy = new Set<string>()
  /** Stash commit DevDock created per repo, so Abort re-applies that stash and no other. */
  private readonly ourStash = new Map<string, string>()

  constructor(private readonly git: GitRunner) {}

  private async context(repo: RepoConfig): Promise<Context> {
    const cwd = repo.path
    const tree = parseStatusV2((await this.git.run(STATUS, { cwd })).stdout)
    const remotes = parseRemotes((await this.git.run(['remote', '-v'], { cwd })).stdout)
    return {
      branch: tree.branch.head,
      dirty: tree.changed + tree.untracked + tree.conflicted.length > 0,
      operation: operationIn(await absoluteGitDir(this.git, cwd)),
      hasOrigin: 'origin' in remotes,
      hasUpstream: 'upstream' in remotes,
    }
  }

  /** Preconditions shared by plan() and run(). Throws before any git command changes anything. */
  private check(repo: RepoConfig, ctx: Context, req: ActionRequest): void {
    const base = repo.baseBranch
    if (ctx.operation && req.action !== 'abort') {
      refuse(`A ${ctx.operation} is in progress. Finish it in your editor, or abort it first.`)
    }
    switch (req.action) {
      case 'fetchAll':
        return
      case 'syncBase':
      case 'newBranch':
        if (!ctx.hasOrigin) refuse('This repo has no "origin" remote.')
        return
      case 'updateBranch':
        if (!ctx.hasOrigin) refuse('This repo has no "origin" remote.')
        if (!ctx.branch) refuse('HEAD is detached. Check out a branch first.')
        if (ctx.branch === base) refuse(`You're on ${base} itself. Use Sync base to update it.`)
        if (ctx.dirty && !req.stash) {
          throw new GitError('dirty-tree', '', [], 'The working tree has uncommitted changes.')
        }
        return
      case 'abort':
        if (!ctx.operation) refuse('There is no merge or rebase to abort.')
        return
      case 'syncFork':
      case 'pushBase':
        // Pushing the base is only offered as step 3 of Sync fork (SPEC 6.2).
        if (!ctx.hasUpstream) refuse('This repo has no "upstream" remote.')
        if (!ctx.hasOrigin) refuse('This repo has no "origin" remote.')
        return
      case 'pushBranch':
        if (!ctx.branch) refuse('HEAD is detached. Check out a branch first.')
        if (ctx.branch === base || isProtectedBranch(ctx.branch, repo.protectedPatterns)) {
          throw new GitError(
            'unsafe',
            '',
            [],
            `Pushing ${ctx.branch} is blocked: it is the base branch or matches a protected pattern.`,
          )
        }
        return
    }
  }

  private async branchName(repo: RepoConfig, req: Req<'newBranch'>): Promise<string> {
    const values = { KEY: req.key?.trim() || undefined, slug: slugify(req.title) }
    const template = repo.branchTemplates[req.kind]
    if (!renderBranchName(template, values)) {
      refuse('Enter a ticket key or a title to name the branch.')
    }
    const { local, remote } = await listBranches(this.git, repo.path)
    const taken = new Set([...local, ...remote.map((r) => r.replace(/^[^/]+\//, ''))])
    const name = uniqueBranchName(template, values, taken)
    // The ticket key is free text: the final name must still be a safe, valid ref.
    if (!isValidBranchName(name)) refuse(`"${name}" is not a valid branch name.`)
    return name
  }

  /** The command list for an action; `name` is the new branch name for newBranch. */
  private commands(
    repo: RepoConfig,
    ctx: Context,
    req: ActionRequest,
    name = '',
  ): PlannedCommand[] {
    const base = repo.baseBranch
    const ff = (remote: string): PlannedCommand[] =>
      ctx.branch === base
        ? [{ args: ['fetch', remote, base] }, { args: ['merge', '--ff-only', `${remote}/${base}`] }]
        : // git updates a branch that isn't checked out only if it's a fast-forward.
          [{ args: ['fetch', remote, `${base}:${base}`] }]
    switch (req.action) {
      case 'fetchAll':
        return [{ args: ['fetch', '--all', '--prune'] }]
      case 'syncBase':
        return ff('origin')
      case 'updateBranch': {
        const stash = ctx.dirty && req.stash
        const message = stashMessage(ctx.branch ?? '', base)
        return [
          ...(stash ? [{ args: ['stash', 'push', '--include-untracked', '-m', message] }] : []),
          { args: ['fetch', 'origin', base] },
          req.strategy === 'merge'
            ? { args: ['merge', '--no-edit', `origin/${base}`] }
            : { args: ['rebase', `origin/${base}`] },
          ...(stash ? [{ args: ['stash', 'pop'], note: 'only if there are no conflicts' }] : []),
        ]
      }
      case 'abort':
        return [
          { args: [ctx.operation ?? 'merge', '--abort'] },
          { args: ['stash', 'pop'], note: 'only if DevDock stashed your changes for this update' },
        ]
      case 'syncFork':
        return [
          ...ff('upstream'),
          { args: ['fetch', 'origin', base] },
          {
            args: ['rev-list', '--count', `origin/${base}..${base}`],
            note: 'counts commits to push',
          },
        ]
      case 'pushBase':
        return [{ args: ['push', 'origin', `${base}:${base}`] }]
      case 'newBranch':
        return [
          { args: ['fetch', 'origin', base] },
          { args: ['checkout', '-b', name, '--no-track', `origin/${base}`] },
        ]
      case 'pushBranch':
        return [{ args: ['push', '-u', 'origin', ctx.branch ?? ''] }]
    }
  }

  /** The commands an action will run, for the disclosure shown before the user confirms. */
  async plan(repo: RepoConfig, req: ActionRequest): Promise<PlannedCommand[]> {
    const ctx = await this.context(repo)
    this.check(repo, ctx, req)
    const name = req.action === 'newBranch' ? await this.branchName(repo, req) : ''
    return this.commands(repo, ctx, req, name)
  }

  async run(
    repo: RepoConfig,
    req: ActionRequest,
    onOutput?: OutputListener,
  ): Promise<ActionOutcome> {
    if (this.busy.has(repo.path)) refuse('Another action is still running on this repo.')
    this.busy.add(repo.path)
    try {
      return await this.runUnlocked(repo, req, onOutput)
    } finally {
      this.busy.delete(repo.path)
    }
  }

  private async runUnlocked(
    repo: RepoConfig,
    req: ActionRequest,
    onOutput?: OutputListener,
  ): Promise<ActionOutcome> {
    const cwd = repo.path
    const base = repo.baseBranch
    const git: Git = (args) => this.git.run(args, { cwd, onOutput, timeoutMs: 120_000 })
    const runAll = async (cmds: PlannedCommand[]) => {
      for (const c of cmds) await git(c.args)
    }
    const ctx = await this.context(repo)
    this.check(repo, ctx, req)

    switch (req.action) {
      case 'fetchAll':
        await runAll(this.commands(repo, ctx, req))
        return { status: 'done', summary: 'Fetched all remotes.' }

      case 'syncBase':
        await runAll(this.commands(repo, ctx, req))
        return { status: 'done', summary: `${base} is up to date with origin/${base}.` }

      case 'updateBranch':
        return this.updateBranch(repo, ctx, req, git)

      case 'abort': {
        const op = ctx.operation!
        await git([op, '--abort'])
        const ours = this.ourStash.get(cwd)
        if (ours && (await this.topStashOid(cwd)) === ours) {
          return this.restoreStash(cwd, git, `Aborted the ${op} and restored your stashed changes.`)
        }
        return { status: 'done', summary: `Aborted the ${op}. Nothing was changed.` }
      }

      case 'syncFork': {
        const cmds = this.commands(repo, ctx, req)
        await runAll(cmds.slice(0, -1))
        const count = await git(cmds.at(-1)!.args)
        const pushable = Number(count.stdout.trim()) || 0
        return {
          status: 'done',
          pushable,
          summary:
            pushable > 0
              ? `${base} now matches upstream/${base}. ${pushable} commit(s) can be pushed to origin.`
              : `${base} matches upstream/${base}; origin is already up to date.`,
        }
      }

      case 'pushBase':
        // No force: origin rejects anything that isn't a fast-forward.
        await runAll(this.commands(repo, ctx, req))
        return { status: 'done', summary: `Pushed ${base} to origin.`, branch: base }

      case 'newBranch': {
        await git(['fetch', 'origin', base])
        // Named after fetching, so remote branches created meanwhile count as taken.
        const name = await this.branchName(repo, req)
        await git(this.commands(repo, ctx, req, name).at(-1)!.args)
        return { status: 'done', summary: `Created ${name} from origin/${base}.`, branch: name }
      }

      case 'pushBranch':
        await runAll(this.commands(repo, ctx, req))
        return { status: 'done', summary: `Pushed ${ctx.branch} to origin.`, branch: ctx.branch! }
    }
  }

  private async updateBranch(
    repo: RepoConfig,
    ctx: Context,
    req: Req<'updateBranch'>,
    git: Git,
  ): Promise<ActionOutcome> {
    const cwd = repo.path
    const base = repo.baseBranch
    const cmds = this.commands(repo, ctx, req)
    const stashed = ctx.dirty && req.stash
    if (stashed) {
      await git(cmds[0]!.args)
      this.ourStash.set(cwd, (await this.topStashOid(cwd)) ?? '')
    }
    const [fetch, integrate] = stashed ? [cmds[1]!, cmds[2]!] : [cmds[0]!, cmds[1]!]
    try {
      await git(fetch.args)
      await git(integrate.args)
    } catch (err) {
      if (err instanceof GitError && err.kind === 'conflict') {
        return {
          status: 'conflict',
          operation: req.strategy,
          files: await this.conflictedFiles(cwd),
          stashed,
          summary: `${req.strategy === 'merge' ? 'Merging' : 'Rebasing onto'} origin/${base} stopped on conflicts.`,
        }
      }
      // Fetch or merge failed for another reason: put the user's changes back before reporting.
      if (stashed) await this.putBackAfterFailure(cwd, git, err)
      throw err
    }
    const updated = `${ctx.branch} is updated from origin/${base} (${req.strategy}).`
    if (!stashed) return { status: 'done', summary: updated }
    return this.restoreStash(cwd, git, `${updated} Your stashed changes are back.`)
  }

  private async putBackAfterFailure(cwd: string, git: Git, err: unknown): Promise<void> {
    const outcome = await this.restoreStash(cwd, git, '').catch(() => null)
    if (outcome?.status === 'done' || !(err instanceof GitError)) return
    // Couldn't re-apply cleanly: say where the changes are instead of losing track of them.
    err.message += ` Your uncommitted changes are in the stash "${STASH_PREFIX} …"; run "git stash pop" when ready.`
  }

  private async conflictedFiles(cwd: string): Promise<string[]> {
    return parseStatusV2((await this.git.run(STATUS, { cwd })).stdout).conflicted
  }

  private async topStashOid(cwd: string): Promise<string | null> {
    const list = parseStashList((await this.git.run(['stash', 'list'], { cwd })).stdout)
    if (list.length === 0) return null
    return (await this.git.run(['rev-parse', 'stash@{0}'], { cwd })).stdout.trim()
  }

  /** `stash pop`; if that conflicts, git keeps the stash and we report it. */
  private async restoreStash(cwd: string, git: Git, summary: string): Promise<ActionOutcome> {
    try {
      await git(['stash', 'pop'])
      this.ourStash.delete(cwd)
      return { status: 'done', summary }
    } catch (err) {
      if (err instanceof GitError && err.kind === 'conflict') {
        this.ourStash.delete(cwd)
        return {
          status: 'conflict',
          operation: 'stash',
          files: await this.conflictedFiles(cwd),
          stashed: true,
          summary:
            'Re-applying your stashed changes conflicted. The stash is kept; resolve the files, then drop it.',
        }
      }
      throw err
    }
  }
}
