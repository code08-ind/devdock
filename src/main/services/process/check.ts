import { spawn } from 'node:child_process'
import { parseDevCommand } from '@shared/gitref'
import type { RepoConfig } from '@shared/settings'
import { GitError } from '../git/errors'
import { stripAnsi } from './detect'
import { devSpawnSpec, killTree } from './devserver'

export type CheckOutput = (chunk: string, stream: 'stdout' | 'stderr') => void

/** Runs a repo's check command (T5 "check before push"); resolves when it passes. */
export type CheckRunner = (repo: RepoConfig, onOutput?: CheckOutput) => Promise<void>

/** A check that runs longer than this is stopped and counts as failed. */
export const CHECK_TIMEOUT_MS = 15 * 60_000

/** How much of the output goes into the error's Details. */
const DETAILS_LIMIT = 4000

const duration = (ms: number) =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`

/** The check command as argv (same rules as the dev command), or null when it isn't allowed. */
export const checkArgv = (repo: RepoConfig): string[] | null =>
  repo.checkCommand ? parseDevCommand(repo.checkCommand) : null

/**
 * Starts the check like the dev server (no shell; own process group so a timeout stops the
 * whole tree), in the repo, streaming its output to the action's activity log. A non-zero exit,
 * a failure to start or the timeout throws a GitError, so the push after it never runs.
 */
export function makeCheckRunner(opts: {
  platform?: NodeJS.Platform
  envReady?: Promise<void>
  timeoutMs?: number
}): CheckRunner {
  const platform = opts.platform ?? process.platform
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS
  return async (repo, onOutput) => {
    await opts.envReady
    const argv = checkArgv(repo)
    if (!argv) {
      throw new GitError(
        'precondition',
        '',
        [],
        `The check command "${repo.checkCommand}" is not allowed. Change it in the repo's settings.`,
      )
    }
    const spec = devSpawnSpec(repo.checkCommand, repo.path, platform)
    const child = spawn(spec.file, spec.args, {
      cwd: repo.path,
      detached: platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim ?? false,
      env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let tail = ''
    const on = (stream: 'stdout' | 'stderr') => (data: Buffer | string) => {
      const chunk = stripAnsi(String(data))
      tail = (tail + chunk).slice(-DETAILS_LIMIT)
      onOutput?.(chunk, stream)
    }
    child.stdout?.on('data', on('stdout'))
    child.stderr?.on('data', on('stderr'))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void killTree(child, platform)
    }, timeoutMs)
    const result = await new Promise<{ code: number | null; error?: Error }>((done) => {
      child.once('error', (error) => done({ code: null, error }))
      child.once('exit', (code) => done({ code }))
    }).finally(() => clearTimeout(timer))
    const command = repo.checkCommand
    if (result.error) {
      throw new GitError(
        'failed',
        tail,
        argv,
        `The check "${command}" could not start: ${result.error.message}`,
      )
    }
    if (timedOut) {
      throw new GitError(
        'timeout',
        tail,
        argv,
        `The check "${command}" ran longer than ${duration(timeoutMs)} and was stopped. Nothing was pushed.`,
      )
    }
    if (result.code !== 0) {
      throw new GitError(
        'failed',
        tail,
        argv,
        `The check "${command}" failed (exit code ${result.code ?? '?'}). Nothing was pushed.`,
      )
    }
  }
}
