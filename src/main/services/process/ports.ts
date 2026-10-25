import { execFile } from 'node:child_process'
import type { ListeningPort, StopRequest } from '@shared/utilities'
import { groupListeners, parseLsof, parseNetstat, parsePs, parseTasklist } from './ports-parse'

/** SPEC 6.6 Ports: list listening TCP ports, stop a process (with escalation). */

export interface CommandResult {
  stdout: string
  stderr: string
  /** Null when it was killed by the timeout. */
  code: number | null
}

/** `execFile` without a shell, never throwing for a non-zero exit (injected; mocked in tests). */
export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>

export const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
        // Not installed / not on PATH: a real failure, not "no ports".
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(err)
        resolve({ stdout, stderr, code })
      },
    )
  })

/**
 * `missing-tool`: lsof/netstat/taskkill couldn't be run; `failed`: it ran and failed (or timed
 * out); `not-stopped`: the process didn't accept a polite stop (offer Force stop).
 */
export type ProcessErrorKind =
  'missing-tool' | 'failed' | 'refused' | 'changed' | 'gone' | 'permission' | 'not-stopped'

export class ProcessError extends Error {
  override readonly name = 'ProcessError'
  constructor(
    readonly kind: ProcessErrorKind,
    message: string,
    readonly details?: string,
  ) {
    super(message)
  }
}

export interface PortServiceDeps {
  platform: NodeJS.Platform
  run: CommandRunner
  /** `process.kill` (macOS/Linux): sends a signal; throws ESRCH / EPERM. */
  signal: (pid: number, sig: NodeJS.Signals) => void
  /** DevDock's own processes (main, and the Electron parent): never stopped from here. */
  ownPids: () => readonly number[]
  /** After a stop, how long to wait for the port to close (polled). */
  settleMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** Processes no one should stop from a port list (idle/system/init/kernel task). */
const SYSTEM_PIDS = new Set([0, 1, 4])

export class PortService {
  constructor(private readonly deps: PortServiceDeps) {}

  async list(): Promise<ListeningPort[]> {
    return this.deps.platform === 'win32' ? this.listWindows() : this.listUnix()
  }

  /**
   * Stops the process listening on a port (SPEC 6.6). Re-scans first: the PID must still be
   * listening on that port (PIDs are reused), and never DevDock itself or a system process.
   * Plain: SIGTERM / `taskkill /PID n /T`; `force`: SIGKILL / `taskkill … /T /F`. Then waits a
   * moment and reports whether it is still listening (the UI offers to force it).
   */
  async stop({ pid, port, force }: StopRequest): Promise<{ stillListening: boolean }> {
    if (SYSTEM_PIDS.has(pid) || this.deps.ownPids().includes(pid)) {
      throw new ProcessError(
        'refused',
        `DevDock won't stop process ${pid}: it is DevDock itself or part of the system.`,
      )
    }
    if (!(await this.listens(pid, port))) {
      throw new ProcessError(
        'changed',
        `Process ${pid} isn't listening on port ${port} any more. Refresh the list and try again.`,
      )
    }
    if (this.deps.platform === 'win32') await this.taskkill(pid, port, force)
    else this.kill(pid, force)
    return { stillListening: await this.settle(pid, port) }
  }

  private async listUnix(): Promise<ListeningPort[]> {
    // `+c 0`: the whole process name (lsof cuts it to 9 characters otherwise).
    const lsof = await this.tool('lsof', ['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN'])
    // lsof exits 1 when nothing matches.
    if (lsof.code !== 0 && lsof.code !== 1) {
      throw new ProcessError('failed', "Couldn't list ports: lsof failed.", lsof.stderr)
    }
    const listeners = parseLsof(lsof.stdout)
    const pids = [...new Set(listeners.map((l) => l.pid))]
    const commands = pids.length
      ? parsePs((await this.tool('ps', ['-o', 'pid=,args=', '-p', pids.join(',')])).stdout)
      : new Map<number, string>()
    return groupListeners(listeners, new Map(), commands)
  }

  private async listWindows(): Promise<ListeningPort[]> {
    // `-p tcp` lists IPv4 only; IPv6 listeners need `-p tcpv6`.
    const [v4, v6, tasks] = await Promise.all([
      this.tool('netstat', ['-ano', '-p', 'tcp']),
      this.tool('netstat', ['-ano', '-p', 'tcpv6']),
      this.tool('tasklist', ['/FO', 'CSV', '/NH']),
    ])
    if (v4.code !== 0) {
      throw new ProcessError('failed', "Couldn't list ports: netstat failed.", v4.stderr)
    }
    const listeners = [
      ...parseNetstat(v4.stdout),
      ...(v6.code === 0 ? parseNetstat(v6.stdout) : []),
    ]
    return groupListeners(listeners, parseTasklist(tasks.stdout), new Map())
  }

  private kill(pid: number, force: boolean): void {
    try {
      this.deps.signal(pid, force ? 'SIGKILL' : 'SIGTERM')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ESRCH') throw new ProcessError('gone', `Process ${pid} has already exited.`)
      if (code === 'EPERM') {
        throw new ProcessError(
          'permission',
          `Not allowed to stop process ${pid}: it belongs to another user or the system.`,
        )
      }
      throw err
    }
  }

  private async taskkill(pid: number, port: number, force: boolean): Promise<void> {
    const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
    const r = await this.tool('taskkill', args)
    if (r.code === 0) return
    // With /T, a child that refuses makes taskkill fail although the listener itself is gone;
    // and its messages are translated. What counts is whether it still listens.
    if (!(await this.listens(pid, port))) return
    const said = `${r.stdout}\n${r.stderr}`.trim()
    // taskkill: 128 = not found; "Access is denied" without admin rights.
    if (r.code === 128 || /not found/i.test(said)) {
      throw new ProcessError('gone', `Process ${pid} has already exited.`, said)
    }
    if (/denied/i.test(said)) {
      throw new ProcessError(
        'permission',
        `Not allowed to stop process ${pid}: it may belong to another user or need admin rights.`,
        said,
      )
    }
    // Without /F, taskkill asks the process to close; many console apps don't: say so.
    throw new ProcessError(
      force ? 'failed' : 'not-stopped',
      force
        ? `taskkill couldn't stop process ${pid}.`
        : `Process ${pid} didn't accept the request to close. Try Force stop.`,
      said,
    )
  }

  /** Polls until the PID no longer listens on the port, up to `settleMs`. */
  private async settle(pid: number, port: number): Promise<boolean> {
    const until = Date.now() + (this.deps.settleMs ?? 3_000)
    const sleep = this.deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
    for (;;) {
      const still = await this.listens(pid, port)
      if (!still || Date.now() >= until) return still
      await sleep(300)
    }
  }

  private async listens(pid: number, port: number): Promise<boolean> {
    return (await this.list()).some((p) => p.pid === pid && p.port === port)
  }

  private async tool(file: string, args: string[]): Promise<CommandResult> {
    let r: CommandResult
    try {
      r = await this.deps.run(file, args)
    } catch (err) {
      throw new ProcessError(
        'missing-tool',
        `Couldn't run ${file}. It comes with the operating system; check that it is on the PATH.`,
        err instanceof Error ? err.message : String(err),
      )
    }
    if (r.code === null) {
      throw new ProcessError('failed', `${file} didn't finish in time.`, r.stderr || undefined)
    }
    return r
  }
}
