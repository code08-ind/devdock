import type { Pty, PtySpawn, PtySpawnOptions } from '../../src/main/services/terminal/manager'

/** A fake PTY: records writes/resizes/kills; `emit` and `exit` play the shell's side. */
export class FakePty implements Pty {
  static nextPid = 50_000
  readonly pid = FakePty.nextPid++
  readonly writes: string[] = []
  readonly resizes: [number, number][] = []
  readonly kills: (string | undefined)[] = []
  private dataListeners: ((d: string) => void)[] = []
  private exitListeners: ((e: { exitCode: number; signal?: number }) => void)[] = []

  constructor(
    readonly file: string,
    readonly args: string[],
    readonly options: PtySpawnOptions,
    /** Exit straight away when killed (a shell that honours SIGHUP). */
    private readonly exitOnKill = true,
  ) {}

  onData(l: (d: string) => void) {
    this.dataListeners.push(l)
    return { dispose: () => (this.dataListeners = this.dataListeners.filter((x) => x !== l)) }
  }
  onExit(l: (e: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.push(l)
    return { dispose: () => (this.exitListeners = this.exitListeners.filter((x) => x !== l)) }
  }
  write(data: string) {
    this.writes.push(data)
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows])
  }
  kill(signal?: string) {
    this.kills.push(signal)
    if (this.exitOnKill) this.exit(0, 1)
  }
  emit(data: string) {
    for (const l of this.dataListeners) l(data)
  }
  exit(exitCode: number, signal?: number) {
    for (const l of this.exitListeners) l({ exitCode, signal })
  }
}

export function fakeSpawn(opts: { exitOnKill?: boolean } = {}): {
  spawn: PtySpawn
  ptys: FakePty[]
} {
  const ptys: FakePty[] = []
  return {
    ptys,
    spawn: (file, args, options) => {
      const p = new FakePty(file, args, options, opts.exitOnKill ?? true)
      ptys.push(p)
      return p
    },
  }
}
