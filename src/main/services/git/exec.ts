import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { GitError, classifyGitFailure, messageFor } from './errors'

/** One git invocation, kept for the activity log and the "no destructive commands" test. */
export interface CommandRecord {
  cwd: string
  args: string[]
  at: number
  durationMs: number
  exitCode: number | null
}

export interface RunOptions {
  cwd: string
  timeoutMs?: number
  /** Streams stdout/stderr chunks as they arrive (activity log). */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** Exit codes that are not failures (e.g. `diff --quiet` uses 1 for "differs"). */
  okCodes?: number[]
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export const DEFAULT_TIMEOUT_MS = 60_000

/** Global options that take a separate value: `git -c k=v`, `git -C dir`. */
const GLOBAL_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace'])

/** Splits `[global options…, subcommand, args…]`; returns null for an `alias.*` override. */
function splitCommand(args: readonly string[]): { cmd: string | undefined; rest: string[] } | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    const a = args[i]!
    const value = GLOBAL_WITH_VALUE.has(a) ? args[i + 1] : a.startsWith('-c') ? a.slice(2) : ''
    // An alias defined on the command line could hide any command.
    if ((a === '-c' || a.startsWith('-c')) && /^alias\./i.test(value ?? '')) return null
    i += GLOBAL_WITH_VALUE.has(a) ? 2 : 1
  }
  return { cmd: args[i], rest: args.slice(i + 1) }
}

/** `--for`, `--force`, `--force=x` all match "force": git accepts unambiguous prefixes. */
function longOption(arg: string, ...names: string[]): boolean {
  if (!arg.startsWith('--') || arg === '--') return false
  const name = arg.slice(2).split('=')[0]!
  return name.length >= 3 && names.some((n) => n.startsWith(name))
}

const hasShortFlag = (rest: string[], flag: string) =>
  rest.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(flag))

/**
 * Commands DevDock must never run (BUILD-PROMPTS P1 Done): anything that force-updates or
 * deletes refs, or throws away work in the working copy. Checked before spawning, so a bug in
 * an action can't reach the user's repo.
 */
export function unsafeReason(args: readonly string[]): string | null {
  const split = splitCommand(args)
  if (!split) return 'alias override'
  const { cmd, rest } = split
  switch (cmd) {
    case 'push':
      if (
        hasShortFlag(rest, 'f') ||
        rest.some(
          (a) =>
            longOption(a, 'force', 'force-with-lease', 'force-if-includes') || a.startsWith('+'),
        )
      ) {
        return 'force push'
      }
      if (rest.some((a) => longOption(a, 'mirror', 'prune'))) return 'mirror/prune push'
      if (
        hasShortFlag(rest, 'd') ||
        rest.some((a) => longOption(a, 'delete') || a.startsWith(':'))
      ) {
        return 'remote branch delete'
      }
      return null
    case 'reset':
      return rest.some((a) => longOption(a, 'hard', 'merge', 'keep')) ? 'reset --hard' : null
    case 'clean':
      return 'git clean'
    case 'restore':
      return 'git restore'
    case 'checkout':
    case 'switch':
      if (hasShortFlag(rest, 'f') || rest.some((a) => longOption(a, 'force', 'discard-changes'))) {
        return `${cmd} --force`
      }
      if (
        hasShortFlag(rest, 'B') ||
        hasShortFlag(rest, 'C') ||
        rest.some((a) => longOption(a, 'force-create'))
      ) {
        return `${cmd} overwriting a branch`
      }
      // `checkout -- <paths>` / `checkout <rev> -- <paths>` discards local edits.
      return cmd === 'checkout' && rest.includes('--') ? 'checkout of paths' : null
    case 'branch':
      if (
        hasShortFlag(rest, 'D') ||
        hasShortFlag(rest, 'd') ||
        rest.some((a) => longOption(a, 'delete'))
      ) {
        return 'branch delete'
      }
      return hasShortFlag(rest, 'f') || rest.some((a) => longOption(a, 'force'))
        ? 'branch --force'
        : null
    case 'stash':
      return rest[0] === 'drop' || rest[0] === 'clear' ? `stash ${rest[0]}` : null
    default:
      return null
  }
}

/** Always-on overrides so the user's config can't change the output we parse. */
const STABLE_OUTPUT = ['-c', 'color.ui=false', '-c', 'core.quotePath=false']

/**
 * Runs git with an argument array (never a shell string), the repo as `cwd`, a timeout, and an
 * English locale so failures can be classified. Credentials come from the user's own helper;
 * terminal prompts are disabled so a missing credential fails instead of hanging.
 */
export class GitRunner {
  private readonly records: CommandRecord[] = []

  constructor(
    private readonly gitPath = 'git',
    private readonly logLimit = 500,
  ) {}

  /** Every command run so far, oldest first. */
  log(): readonly CommandRecord[] {
    return this.records
  }

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    const unsafe = unsafeReason(args)
    if (unsafe) {
      return Promise.reject(
        new GitError(
          'unsafe',
          `git ${args.join(' ')}`,
          args,
          `${messageFor('unsafe')} (${unsafe})`,
        ),
      )
    }
    // spawn reports a missing cwd as ENOENT too, which would read as "git is not installed".
    if (!existsSync(opts.cwd)) {
      return Promise.reject(
        new GitError('not-a-repo', opts.cwd, args, `The folder ${opts.cwd} no longer exists.`),
      )
    }
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.gitPath,
        [...STABLE_OUTPUT, ...args],
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            LC_ALL: 'C',
            LANG: 'C',
            GIT_TERMINAL_PROMPT: '0',
            // Read-only commands (status) must not take locks the user's own git might need.
            GIT_OPTIONAL_LOCKS: '0',
            GIT_ASKPASS: '',
            SSH_ASKPASS: '',
            GIT_EDITOR: 'true',
            GIT_MERGE_AUTOEDIT: 'no',
          },
        },
        (err, stdout, stderr) => {
          const e = err as
            (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
          const exitCode = e ? (typeof e.code === 'number' ? e.code : null) : 0
          this.record({
            cwd: opts.cwd,
            args,
            at: started,
            durationMs: Date.now() - started,
            exitCode,
          })
          if (!e || (exitCode !== null && opts.okCodes?.includes(exitCode))) {
            resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
            return
          }
          const output = `${stderr}\n${stdout}`.trim()
          let kind = classifyGitFailure(output)
          if (e.code === 'ENOENT') kind = 'git-missing'
          else if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') kind = 'failed'
          else if (e.killed) kind = 'timeout'
          reject(new GitError(kind, output || e.message, args))
        },
      )
      if (opts.onOutput) {
        child.stdout?.on('data', (d: Buffer | string) => opts.onOutput!(String(d), 'stdout'))
        child.stderr?.on('data', (d: Buffer | string) => opts.onOutput!(String(d), 'stderr'))
      }
    })
  }

  private record(r: CommandRecord): void {
    this.records.push(r)
    if (this.records.length > this.logLimit) this.records.shift()
  }
}
