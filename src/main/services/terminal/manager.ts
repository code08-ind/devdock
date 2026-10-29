/**
 * In-app terminal sessions (P7-A): one real PTY per tab, in the main process only. A session
 * belongs to the window (webContents id) that made it; every call names that owner, so a
 * renderer can only write to, resize or close its own terminals. Output is batched per
 * session and sent only to the owner. Every PTY is stopped when its window goes away and when
 * DevDock quits (like dev servers).
 */
import { basename } from 'node:path'
import {
  MAX_SESSIONS,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  type TerminalSession,
  type TerminalSettings,
} from '@shared/terminal'
import { OutputBatcher } from './batcher'
import { withDevdockPrompt } from './prompt'
import { resolveShell, ShellNotFoundError, type ShellSpec } from './shell'

/** The part of node-pty's IPty DevDock uses (injected, so tests can use a fake). */
export interface Pty {
  readonly pid: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtySpawn = (file: string, args: string[], options: PtySpawnOptions) => Pty

export class TerminalError extends Error {
  constructor(
    readonly kind: 'not-found' | 'limit' | 'shell' | 'failed',
    message: string,
    readonly details?: string,
  ) {
    super(message)
    this.name = 'TerminalError'
  }
}

export interface TerminalManagerOptions {
  spawn: PtySpawn
  settings: () => TerminalSettings
  onOutput: (owner: number, event: TerminalOutputEvent) => void
  onExit: (owner: number, event: TerminalExitEvent) => void
  /** Where DevDock writes its own prompt files (never the user's dotfiles). */
  promptDir: string
  platform?: NodeJS.Platform
  /** The environment shells inherit (read when each session starts). */
  env?: () => NodeJS.ProcessEnv
  appVersion?: string
  /** How long a closed shell gets to exit before it and its group are killed. */
  killGraceMs?: number
  batchMs?: number
  /** Signals a process group (macOS/Linux); injected for tests. */
  signal?: (pid: number, sig: NodeJS.Signals) => void
  /** Whether the window is still there (a shell started for a closed window is stopped). */
  ownerAlive?: (owner: number) => boolean
  /** Whether a path is a program DevDock may start (injected for tests). */
  isExecutable?: (path: string) => boolean
}

/** A program started instead of the shell (an agent CLI, P7-C): argument array, no shell. */
export interface TerminalProgram {
  file: string
  args: string[]
  /** For the tab: the program's name. */
  name: string
  /** Shown in the terminal before the program's own output. */
  note: string | null
}

interface Session {
  info: TerminalSession
  owner: number
  pty: Pty
  batcher: OutputBatcher
  exited: Promise<void>
  disposers: { dispose(): void }[]
}

/** The environment a DevDock terminal gets: the app's, minus Electron's own switches. */
export function terminalEnv(
  base: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  appVersion: string,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
  for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING'])
    delete env[k]
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'DevDock'
  env.TERM_PROGRAM_VERSION = appVersion
  // Apps opened from Finder get no locale, so zsh would print ➜ as <e2><9e><9c>.
  if (platform === 'darwin' && !env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  return env
}

const defaultSignal = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(pid, sig)
  } catch {
    // Already gone.
  }
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>()
  private counter = 0
  private readonly platform: NodeJS.Platform
  /** Creates still starting, per window (they count towards the limit). */
  private readonly starting = new Map<number, number>()
  /** Bumped each time a window's terminals are stopped (it closed or reloaded). */
  private readonly epochs = new Map<number, number>()

  constructor(private readonly opts: TerminalManagerOptions) {
    this.platform = opts.platform ?? process.platform
  }

  /** The window's current generation: a create that began in an older one is stale. */
  epoch(owner: number): number {
    return this.epochs.get(owner) ?? 0
  }

  async create(req: {
    owner: number
    cwd: string
    title: string
    repoId: string | null
    cols: number
    rows: number
    /** `epoch(owner)` when the request arrived (the caller may await before calling). */
    epoch?: number
    /** Start this instead of the user's shell. */
    program?: TerminalProgram
  }): Promise<TerminalSession> {
    const epoch = req.epoch ?? this.epoch(req.owner)
    const starting = this.starting.get(req.owner) ?? 0
    if (this.list(req.owner).length + starting >= MAX_SESSIONS) {
      throw new TerminalError(
        'limit',
        `A window can have ${MAX_SESSIONS} terminals at once. Close one to open another.`,
      )
    }
    this.starting.set(req.owner, starting + 1)
    try {
      return await this.start(req, epoch)
    } finally {
      const n = (this.starting.get(req.owner) ?? 1) - 1
      if (n > 0) this.starting.set(req.owner, n)
      else this.starting.delete(req.owner)
    }
  }

  private async start(
    req: {
      owner: number
      cwd: string
      title: string
      repoId: string | null
      cols: number
      rows: number
      program?: TerminalProgram
    },
    epoch: number,
  ): Promise<TerminalSession> {
    const s = this.opts.settings()
    const baseEnv = (this.opts.env ?? (() => process.env))()
    let spec: ShellSpec
    if (req.program) {
      spec = { file: req.program.file, kind: 'other', args: req.program.args }
    } else {
      try {
        spec = resolveShell(s.shell, {
          platform: this.platform,
          env: baseEnv,
          isExecutable: this.opts.isExecutable,
        })
      } catch (err) {
        if (err instanceof ShellNotFoundError) throw new TerminalError('shell', err.message)
        throw err
      }
    }
    const env = terminalEnv(baseEnv, this.platform, this.opts.appVersion ?? '')
    // DevDock's own folder isn't the shell's: without this, `pwd` would start from a stale $PWD.
    env.PWD = req.cwd
    delete env.OLDPWD
    let args = spec.args
    if (s.devdockPrompt && !req.program) {
      const launch = await withDevdockPrompt(spec, this.opts.promptDir, baseEnv.ZDOTDIR)
      if (launch) {
        args = launch.args
        Object.assign(env, launch.env)
      }
    }
    let pty: Pty
    try {
      pty = this.opts.spawn(spec.file, args, {
        name: 'xterm-256color',
        cols: req.cols,
        rows: req.rows,
        cwd: req.cwd,
        env,
      })
    } catch (err) {
      throw new TerminalError(
        'failed',
        `DevDock couldn't start ${basename(spec.file)}.`,
        err instanceof Error ? err.message : String(err),
      )
    }
    const id = `t${++this.counter}`
    const info: TerminalSession = {
      id,
      title: req.title,
      repoId: req.repoId,
      shell: req.program?.name ?? basename(spec.file.replace(/\\/g, '/')),
      status: 'running',
      exitCode: null,
      note: req.program?.note ?? null,
    }
    const batcher = new OutputBatcher(
      (data) => this.opts.onOutput(req.owner, { id, data }),
      this.opts.batchMs ?? 16,
    )
    let markExited!: () => void
    const exited = new Promise<void>((r) => (markExited = r))
    const session: Session = { info, owner: req.owner, pty, batcher, exited, disposers: [] }
    session.disposers.push(
      pty.onData((d) => batcher.push(d)),
      pty.onExit(({ exitCode, signal }) => {
        // Everything printed before the exit goes out first.
        batcher.flush()
        info.status = 'exited'
        info.exitCode = exitCode
        markExited()
        if (this.sessions.get(id) === session) {
          this.opts.onExit(req.owner, { id, exitCode, signal: signal || null })
        }
      }),
    )
    this.sessions.set(id, session)
    // The window closed or reloaded while the shell was starting: nobody can reach it.
    if (this.epoch(req.owner) !== epoch || !(this.opts.ownerAlive?.(req.owner) ?? true)) {
      await this.stop(session)
      throw new TerminalError('not-found', 'That window is no longer open.')
    }
    return { ...info }
  }

  /** The owner's sessions, oldest first. */
  list(owner: number): TerminalSession[] {
    return [...this.sessions.values()].filter((s) => s.owner === owner).map((s) => ({ ...s.info }))
  }

  /** Number of live PTYs (all windows), for tests and quit. */
  count(): number {
    return this.sessions.size
  }

  /** PIDs of the owner's shells (e2e hook only). */
  pids(owner?: number): number[] {
    return [...this.sessions.values()]
      .filter((s) => owner === undefined || s.owner === owner)
      .map((s) => s.pty.pid)
  }

  private own(owner: number, id: string): Session {
    const s = this.sessions.get(id)
    // Someone else's session is reported exactly like a missing one.
    if (!s || s.owner !== owner) {
      throw new TerminalError('not-found', 'That terminal is no longer open.')
    }
    return s
  }

  write(owner: number, id: string, data: string): void {
    const s = this.own(owner, id)
    if (s.info.status === 'exited') return
    s.pty.write(data)
  }

  resize(owner: number, id: string, cols: number, rows: number): void {
    const s = this.own(owner, id)
    if (s.info.status === 'exited') return
    try {
      s.pty.resize(cols, rows)
    } catch {
      // The PTY closed between the check and the call.
    }
  }

  /** Closes a tab: the shell is asked to hang up, then it and its process group are killed. */
  async kill(owner: number, id: string): Promise<void> {
    await this.stop(this.own(owner, id))
  }

  /** A window closed or reloaded: its terminals go with it. */
  async killOwner(owner: number): Promise<void> {
    this.epochs.set(owner, this.epoch(owner) + 1)
    await Promise.all(
      [...this.sessions.values()].filter((s) => s.owner === owner).map((s) => this.stop(s)),
    )
  }

  /** DevDock is quitting. */
  async killAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.stop(s)))
  }

  private async stop(s: Session): Promise<void> {
    this.sessions.delete(s.info.id)
    s.batcher.dispose()
    const grace = this.opts.killGraceMs ?? 1500
    if (s.info.status === 'running') {
      const signal = this.opts.signal ?? defaultSignal
      try {
        // macOS/Linux: SIGHUP, as when a terminal window closes. Windows: ends the console.
        s.pty.kill()
      } catch {
        // Already gone.
      }
      const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), grace).unref?.())
      const result = await Promise.race([s.exited.then(() => 'exited' as const), timer])
      if (this.platform !== 'win32') {
        // The shell was a session leader: anything left in its group goes too.
        signal(-s.pty.pid, 'SIGKILL')
        if (result === 'timeout') signal(s.pty.pid, 'SIGKILL')
      }
    }
    for (const d of s.disposers) d.dispose()
  }
}
