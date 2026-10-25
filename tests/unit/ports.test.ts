import { describe, expect, it, vi } from 'vitest'
import {
  groupListeners,
  parseCsvLine,
  parseLsof,
  parseNetstat,
  parsePs,
  parseTasklist,
  splitHostPort,
} from '../../src/main/services/process/ports-parse'
import {
  PortService,
  ProcessError,
  type CommandResult,
  type CommandRunner,
} from '../../src/main/services/process/ports'
import { CleanRequestSchema, StopRequestSchema } from '../../src/shared/utilities'
import { LSOF, NETSTAT_DE, NETSTAT_V4, NETSTAT_V6, PS, TASKLIST } from '../fixtures/port-outputs'

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', code: 0 })

describe('port parsers: macOS (lsof + ps)', () => {
  it('reads every listener, IPv4 and IPv6 (incl. scoped addresses), with lsof’s names', () => {
    expect(parseLsof(LSOF)).toEqual([
      { address: '*', port: 49152, pid: 612, name: 'rapportd' },
      { address: '*', port: 49152, pid: 612, name: 'rapportd' },
      { address: '::1', port: 5173, pid: 41873, name: 'node' },
      { address: '127.0.0.1', port: 5173, pid: 41873, name: 'node' },
      { address: '*', port: 3000, pid: 41990, name: 'node' },
      { address: '*', port: 3000, pid: 42001, name: 'node' },
      { address: '*', port: 8080, pid: 1777, name: 'com.docke' },
      { address: 'fe80::1%lo0', port: 7000, pid: 9001, name: 'Google Chrome Helper' },
    ])
  })

  it('one row per port and PID: two processes on one port stay two rows', () => {
    const rows = groupListeners(parseLsof(LSOF), new Map(), parsePs(PS))
    expect(rows.map((r) => [r.port, r.pid, r.process, r.addresses])).toEqual([
      [3000, 41990, 'node', ['*']],
      [3000, 42001, 'node', ['*']],
      [5173, 41873, 'node', ['::1', '127.0.0.1']],
      [7000, 9001, 'Google Chrome Helper', ['fe80::1%lo0']],
      [8080, 1777, 'com.docke', ['*']],
      [49152, 612, 'rapportd', ['*']],
    ])
    expect(rows.find((r) => r.pid === 41873)?.command).toBe(
      'node /Users/developer/web-app/node_modules/.bin/vite --port 5173',
    )
    expect(rows.find((r) => r.pid === 9001)?.command).toBeNull()
  })

  it('empty output and junk lines give nothing', () => {
    expect(parseLsof('')).toEqual([])
    expect(parseLsof('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n')).toEqual([])
    expect(parseLsof('node 1 me 3u IPv4 0x1 0t0 TCP 127.0.0.1:99999 (LISTEN)')).toEqual([])
  })
})

describe('port parsers: Windows (netstat + tasklist)', () => {
  it('reads listening rows on IPv4 and IPv6, skipping established connections', () => {
    expect(parseNetstat(NETSTAT_V4)).toEqual([
      { address: '0.0.0.0', port: 135, pid: 1032, name: null },
      { address: '0.0.0.0', port: 3000, pid: 8812, name: null },
      { address: '127.0.0.1', port: 5173, pid: 9120, name: null },
    ])
    expect(parseNetstat(NETSTAT_V6)).toEqual([
      { address: '::', port: 135, pid: 1032, name: null },
      { address: '::', port: 3000, pid: 8812, name: null },
      { address: '::1', port: 8080, pid: 4410, name: null },
    ])
  })

  it('doesn’t depend on the (translated) State column', () => {
    expect(parseNetstat(NETSTAT_DE)).toEqual([
      { address: '0.0.0.0', port: 5173, pid: 9120, name: null },
    ])
  })

  it('tasklist CSV: quoted names, thousands separators in memory', () => {
    expect(parseCsvLine('"a","b,c","","say ""hi"""')).toEqual(['a', 'b,c', '', 'say "hi"'])
    expect([...parseTasklist(TASKLIST)]).toEqual([
      [0, 'System Idle Process'],
      [1032, 'svchost.exe'],
      [8812, 'node.exe'],
      [9120, 'node.exe'],
      [4410, 'java.exe'],
    ])
  })

  it('IPv4 + IPv6 of one server are one row with both addresses', () => {
    const rows = groupListeners(
      [...parseNetstat(NETSTAT_V4), ...parseNetstat(NETSTAT_V6)],
      parseTasklist(TASKLIST),
      new Map(),
    )
    expect(rows.find((r) => r.port === 3000)).toEqual({
      port: 3000,
      pid: 8812,
      process: 'node.exe',
      command: null,
      addresses: ['0.0.0.0', '::'],
    })
  })

  it('host:port splitting', () => {
    expect(splitHostPort('[::]:0')).toBeNull() // port 0 isn't a listener port
    expect(splitHostPort('[::1]:8080')).toEqual({ address: '::1', port: 8080 })
    expect(splitHostPort('*:3000')).toEqual({ address: '*', port: 3000 })
    expect(splitHostPort('nonsense')).toBeNull()
  })
})

/** A Windows machine whose commands are scripted (execFile mocked). */
function windows(script: Partial<Record<string, (args: string[]) => CommandResult>> = {}) {
  let listening = true
  const calls: string[][] = []
  const run: CommandRunner = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args])
    const scripted = script[file]
    if (scripted) {
      const r = scripted(args)
      if (file === 'taskkill' && r.code === 0) listening = false
      return r
    }
    if (file === 'netstat') {
      if (!listening) return ok('')
      return ok(args.includes('tcpv6') ? NETSTAT_V6 : NETSTAT_V4)
    }
    if (file === 'tasklist') return ok(TASKLIST)
    if (file === 'taskkill') {
      listening = false
      return ok('SUCCESS: Sent termination signal to the process with PID 8812.')
    }
    throw new Error(`unexpected ${file}`)
  })
  const service = new PortService({
    platform: 'win32',
    run,
    signal: vi.fn(),
    ownPids: () => [4242],
    settleMs: 0,
    sleep: async () => undefined,
  })
  return { service, calls, run }
}

const kills = (calls: string[][]) => calls.filter((c) => c[0] === 'taskkill')

describe('stopping a process on Windows (mocked execFile)', () => {
  it('lists with netstat (tcp + tcpv6) and tasklist, never through a shell', async () => {
    const { service, calls } = windows()
    const rows = await service.list()
    expect(rows.map((r) => r.port)).toEqual([135, 3000, 5173, 8080])
    expect(calls).toEqual(
      expect.arrayContaining([
        ['netstat', '-ano', '-p', 'tcp'],
        ['netstat', '-ano', '-p', 'tcpv6'],
        ['tasklist', '/FO', 'CSV', '/NH'],
      ]),
    )
  })

  it('stop: taskkill /PID n /T — and /F only when forced (second confirmation)', async () => {
    const first = windows()
    expect(
      await first.service.stop({ pid: 8812, port: 3000, force: false, confirmed: true }),
    ).toEqual({
      stillListening: false,
    })
    expect(kills(first.calls)).toEqual([['taskkill', '/PID', '8812', '/T']])

    const forced = windows()
    await forced.service.stop({ pid: 8812, port: 3000, force: true, confirmed: true })
    expect(kills(forced.calls)).toEqual([['taskkill', '/PID', '8812', '/T', '/F']])
  })

  it('a process that ignores the polite request: reported, so the UI can offer Force stop', async () => {
    const { service } = windows({
      taskkill: () => ({
        stdout: '',
        stderr:
          'ERROR: The process with PID 8812 could not be terminated.\nReason: This process can only be terminated forcefully (with /F option).',
        code: 1,
      }),
    })
    await expect(
      service.stop({ pid: 8812, port: 3000, force: false, confirmed: true }),
    ).rejects.toMatchObject({
      kind: 'not-stopped',
      message: expect.stringMatching(/Try Force stop/),
    })
  })

  it('access denied and already-gone are told apart', async () => {
    const denied = windows({
      taskkill: () => ({
        stdout: '',
        stderr:
          'ERROR: The process with PID 8812 could not be terminated.\nReason: Access is denied.',
        code: 1,
      }),
    })
    await expect(
      denied.service.stop({ pid: 8812, port: 3000, force: true, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'permission', message: expect.stringMatching(/admin rights/) })
    const gone = windows({
      taskkill: () => ({ stdout: '', stderr: 'ERROR: The process "8812" not found.', code: 128 }),
    })
    await expect(
      gone.service.stop({ pid: 8812, port: 3000, force: false, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'gone' })
  })

  it('refuses a PID that no longer listens on that port, DevDock itself, and system PIDs', async () => {
    const { service, calls } = windows()
    await expect(
      service.stop({ pid: 8812, port: 5173, force: false, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'changed' })
    for (const pid of [4242, 4, 1]) {
      await expect(
        service.stop({ pid, port: 3000, force: true, confirmed: true }),
      ).rejects.toBeInstanceOf(ProcessError)
    }
    expect(kills(calls)).toEqual([])
  })

  it('DevDock’s own PID is refused even while it listens on that port', async () => {
    const calls: string[][] = []
    const own = new PortService({
      platform: 'win32',
      run: async (file, args) => {
        calls.push([file, ...args])
        return file === 'tasklist'
          ? ok(TASKLIST)
          : ok(args.includes('tcpv6') ? NETSTAT_V6 : NETSTAT_V4)
      },
      signal: vi.fn(),
      ownPids: () => [8812],
    })
    await expect(
      own.stop({ pid: 8812, port: 3000, force: true, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'refused' })
    expect(kills(calls)).toEqual([])
  })

  it('still listening after the wait → stillListening: true', async () => {
    const { service } = windows({ taskkill: () => ({ stdout: 'SUCCESS', stderr: '', code: 0 }) })
    // Scripted taskkill "succeeds" but netstat keeps listing it.
    const stubborn = new PortService({
      platform: 'win32',
      run: async (file, args) =>
        file === 'taskkill'
          ? ok('SUCCESS')
          : file === 'tasklist'
            ? ok(TASKLIST)
            : ok(args.includes('tcpv6') ? NETSTAT_V6 : NETSTAT_V4),
      signal: vi.fn(),
      ownPids: () => [],
      settleMs: 0,
      sleep: async () => undefined,
    })
    void service
    expect(await stubborn.stop({ pid: 8812, port: 3000, force: false, confirmed: true })).toEqual({
      stillListening: true,
    })
  })

  it('a missing tool is a clear error, not an empty list', async () => {
    const service = new PortService({
      platform: 'win32',
      run: async () => {
        throw Object.assign(new Error('spawn netstat ENOENT'), { code: 'ENOENT' })
      },
      signal: vi.fn(),
      ownPids: () => [],
    })
    await expect(service.list()).rejects.toMatchObject({
      kind: 'missing-tool',
      message: expect.stringMatching(/Couldn't run netstat/),
    })
  })
})

describe('stopping a process on macOS (signals)', () => {
  const mac = (signal: (pid: number, sig: NodeJS.Signals) => void) => {
    let listening = true
    return new PortService({
      platform: 'darwin',
      run: async (file) =>
        file === 'lsof' ? (listening ? ok(LSOF) : { stdout: '', stderr: '', code: 1 }) : ok(PS),
      signal: (pid, sig) => {
        signal(pid, sig)
        listening = false
      },
      ownPids: () => [],
      settleMs: 0,
      sleep: async () => undefined,
    })
  }

  it('SIGTERM, or SIGKILL when forced', async () => {
    const signal = vi.fn()
    await mac(signal).stop({ pid: 41873, port: 5173, force: false, confirmed: true })
    await mac(signal).stop({ pid: 41873, port: 5173, force: true, confirmed: true })
    expect(signal.mock.calls).toEqual([
      [41873, 'SIGTERM'],
      [41873, 'SIGKILL'],
    ])
  })

  it('ESRCH → gone, EPERM → permission', async () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    await expect(
      mac(fail('ESRCH')).stop({ pid: 41873, port: 5173, force: false, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'gone' })
    await expect(
      mac(fail('EPERM')).stop({ pid: 41873, port: 5173, force: false, confirmed: true }),
    ).rejects.toMatchObject({ kind: 'permission' })
  })

  it('lsof finding nothing (exit 1) is an empty list', async () => {
    const service = new PortService({
      platform: 'darwin',
      run: async () => ({ stdout: '', stderr: '', code: 1 }),
      signal: vi.fn(),
      ownPids: () => [],
    })
    expect(await service.list()).toEqual([])
  })
})

describe('review fixes (P5-A)', () => {
  it('taskkill fails (a child refused, or translated output) but the listener is gone → stopped', async () => {
    let listening = true
    const service = new PortService({
      platform: 'win32',
      run: async (file, args) => {
        if (file === 'taskkill') {
          listening = false
          return {
            stdout: '',
            stderr: 'FEHLER: Der Prozess mit PID 9999 konnte nicht beendet werden.',
            code: 1,
          }
        }
        if (file === 'tasklist') return ok(TASKLIST)
        return ok(listening ? (args.includes('tcpv6') ? NETSTAT_V6 : NETSTAT_V4) : '')
      },
      signal: vi.fn(),
      ownPids: () => [],
      settleMs: 0,
      sleep: async () => undefined,
    })
    expect(await service.stop({ pid: 8812, port: 3000, force: false, confirmed: true })).toEqual({
      stillListening: false,
    })
  })

  it('a command that times out is `failed`, not a missing tool', async () => {
    const service = new PortService({
      platform: 'darwin',
      run: async () => ({ stdout: '', stderr: '', code: null }),
      signal: vi.fn(),
      ownPids: () => [],
    })
    await expect(service.list()).rejects.toMatchObject({
      kind: 'failed',
      message: "lsof didn't finish in time.",
    })
  })

  it('force and node_modules each need their own confirmation flag in the request', () => {
    const stop = { pid: 8812, port: 3000, confirmed: true }
    expect(StopRequestSchema.safeParse({ ...stop, force: false }).success).toBe(true)
    expect(StopRequestSchema.safeParse({ ...stop, force: true }).success).toBe(false)
    expect(
      StopRequestSchema.safeParse({ ...stop, force: true, forceConfirmed: true }).success,
    ).toBe(true)
    const clean = { id: 'r1', confirmed: true }
    expect(CleanRequestSchema.safeParse({ ...clean, includeNodeModules: true }).success).toBe(false)
    expect(
      CleanRequestSchema.safeParse({
        ...clean,
        includeNodeModules: true,
        nodeModulesConfirmed: true,
      }).success,
    ).toBe(true)
  })
})
