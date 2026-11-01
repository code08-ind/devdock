import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  BASELINE_SCRIPT,
  isActive,
  type DevServerOutputEvent,
  type DevServerState,
  type ServerKind,
} from '@shared/devserver'
import { parseDevCommand } from '@shared/gitref'
import type { RepoConfig } from '@shared/settings'
import { detectUrl, stripAnsi } from './detect'

export class DevServerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DevServerError'
  }
}

export interface SpawnSpec {
  file: string
  args: string[]
  env?: Record<string, string>
  /** Windows: pass args to cmd.exe as written (already quoted). */
  verbatim?: boolean
}

/**
 * How to start the repo's dev command (SPEC 6.2) without a shell. The command was validated by
 * parseDevCommand (runner or ./script, no shell syntax). On Windows `npm` & co. are .cmd shims,
 * which Node only starts through cmd.exe; that's safe because the command has no metacharacters.
 */
export function devSpawnSpec(command: string, cwd: string, platform: NodeJS.Platform): SpawnSpec {
  const argv = parseDevCommand(command)
  if (!argv) throw new DevServerError(`The dev command "${command}" is not allowed.`)
  if (platform === 'win32') {
    // cmd.exe resolves `.\script` against the cwd (the repo), but not `./script`.
    const line = [argv[0]!.replace(/\//g, '\\'), ...argv.slice(1)].join(' ')
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
  }
  const [file, ...args] = argv as [string, ...string[]]
  return { file: file.startsWith('./') ? resolve(cwd, file) : file, args }
}

/** The baseline server runs with Electron's own Node, so it doesn't depend on PATH. */
export function baselineSpawnSpec(execPath: string): SpawnSpec {
  return { file: execPath, args: [BASELINE_SCRIPT], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

const run = (file: string, args: string[]) =>
  new Promise<void>((done) => execFile(file, args, { windowsHide: true }, () => done()))

/** Waits for `exited`, but never longer than `ms`: a stuck kill must not block app quit. */
const settle = (exited: Promise<void>, ms: number) =>
  Promise.race([exited, new Promise<void>((r) => setTimeout(r, ms).unref?.())])

/** macOS/Linux: signal the whole process group (the child was spawned as its leader). */
function signalGroup(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig)
  } catch {
    // Group already gone.
  }
}

/**
 * Kills a process and everything it started (npm → sh → node …). Windows: `taskkill /T /F`.
 * macOS/Linux: the child was started as a process-group leader, so signal the whole group,
 * escalating from SIGTERM to SIGKILL if it hasn't exited in time.
 */
export async function killTree(
  child: ChildProcess,
  platform: NodeJS.Platform,
  graceMs = 4000,
): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((r) => child.once('exit', () => r()))
  if (platform === 'win32') {
    await run('taskkill', ['/pid', String(pid), '/T', '/F'])
    await settle(exited, graceMs)
    return
  }
  signalGroup(pid, 'SIGTERM')
  const timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs)
  await settle(exited, graceMs * 2)
  clearTimeout(timer)
  // Grandchildren that ignored SIGTERM may still hold the port: make sure the group is gone.
  signalGroup(pid, 'SIGKILL')
}

interface Running {
  state: DevServerState
  child: ChildProcess
  log: string
}

export interface DevServerOptions {
  onChange: (states: DevServerState[]) => void
  onOutput: (e: DevServerOutputEvent) => void
  platform?: NodeJS.Platform
  /** Node for the baseline server (Electron's binary with ELECTRON_RUN_AS_NODE). */
  execPath?: string
  /** Resolves when PATH is ready (macOS login-shell PATH for Finder-launched apps). */
  envReady?: Promise<void>
  logLimit?: number
}

/** Dev server and baseline processes per repo: start, URL detection, logs, stop (tree kill). */
export class DevServerManager {
  private readonly servers = new Map<string, Running>()
  private readonly platform: NodeJS.Platform
  private readonly logLimit: number

  constructor(private readonly opts: DevServerOptions) {
    this.platform = opts.platform ?? process.platform
    this.logLimit = opts.logLimit ?? 200_000
  }

  private key = (repoId: string, kind: ServerKind) => `${repoId}:${kind}`

  list(): DevServerState[] {
    return [...this.servers.values()].map((s) => s.state)
  }

  log(repoId: string, kind: ServerKind): string {
    return this.servers.get(this.key(repoId, kind))?.log ?? ''
  }

  static hasBaseline(repoPath: string): boolean {
    return existsSync(join(repoPath, BASELINE_SCRIPT))
  }

  /** `ifStopped`: return the running server instead of refusing (several callers may race). */
  async start(
    repo: RepoConfig,
    kind: ServerKind,
    opts: { ifStopped?: boolean } = {},
  ): Promise<DevServerState> {
    // Wait first: from the check below to servers.set() there's no await, so two concurrent
    // starts can't both spawn.
    await this.opts.envReady
    const key = this.key(repo.id, kind)
    const existing = this.servers.get(key)
    if (existing && isActive(existing.state.status)) {
      if (opts.ifStopped) return existing.state
      throw new DevServerError(
        `The ${kind === 'dev' ? 'dev server' : 'baseline server'} is already running.`,
      )
    }
    if (kind === 'baseline' && !DevServerManager.hasBaseline(repo.path)) {
      throw new DevServerError(`${repo.name} has no ${BASELINE_SCRIPT}.`)
    }
    const spec =
      kind === 'dev'
        ? devSpawnSpec(repo.devCommand, repo.path, this.platform)
        : baselineSpawnSpec(this.opts.execPath ?? process.execPath)
    const command = kind === 'dev' ? repo.devCommand : `node ${BASELINE_SCRIPT}`

    const child = spawn(spec.file, spec.args, {
      cwd: repo.path,
      // Own process group on macOS/Linux, so the whole tree can be signalled.
      detached: this.platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim ?? false,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const entry: Running = {
      child,
      log: '',
      state: {
        repoId: repo.id,
        kind,
        command,
        status: 'starting',
        pid: child.pid ?? null,
        url: null,
        port: null,
        startedAt: Date.now(),
        exitCode: null,
        error: null,
      },
    }
    this.servers.set(key, entry)
    this.changed()

    const onData = (data: Buffer | string) => {
      const chunk = stripAnsi(String(data))
      entry.log = (entry.log + chunk).slice(-this.logLimit)
      this.opts.onOutput({ repoId: repo.id, kind, chunk })
      if (entry.state.status === 'starting') {
        // Only the new output (plus a margin for a URL split across chunks) needs scanning.
        const found = detectUrl(entry.log.slice(-(chunk.length + 512)))
        if (found) {
          entry.state = { ...entry.state, status: 'running', url: found.url, port: found.port }
          this.changed()
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => {
      entry.state = { ...entry.state, status: 'failed', error: err.message }
      this.changed()
    })
    child.on('exit', (code, signal) => {
      // npm can exit while the server it started keeps the port: end the rest of the group too.
      if (this.platform !== 'win32' && child.pid !== undefined) signalGroup(child.pid, 'SIGKILL')
      if (entry.state.status === 'failed') return
      entry.state = {
        ...entry.state,
        status: entry.state.status === 'stopping' ? 'stopped' : 'exited',
        exitCode: code ?? (signal ? -1 : null),
      }
      this.changed()
    })
    return entry.state
  }

  async stop(repoId: string, kind: ServerKind): Promise<void> {
    const entry = this.servers.get(this.key(repoId, kind))
    if (!entry || !isActive(entry.state.status)) return
    entry.state = { ...entry.state, status: 'stopping' }
    this.changed()
    await killTree(entry.child, this.platform)
  }

  /** Stops everything (app quit). */
  async stopAll(): Promise<void> {
    await Promise.all(this.list().map((s) => this.stop(s.repoId, s.kind)))
  }

  hasRunning(): boolean {
    return this.list().some((s) => isActive(s.status) || s.status === 'stopping')
  }

  private changed(): void {
    this.opts.onChange(this.list())
  }
}
