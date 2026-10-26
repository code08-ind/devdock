import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from '../../src/main/services/terminal/batcher'
import {
  TerminalError,
  TerminalManager,
  terminalEnv,
  type TerminalManagerOptions,
} from '../../src/main/services/terminal/manager'
import { bashRc, withDevdockPrompt, zshFiles } from '../../src/main/services/terminal/prompt'
import {
  findOnPath,
  loginArgs,
  resolveShell,
  ShellNotFoundError,
  shellKind,
} from '../../src/main/services/terminal/shell'
import {
  MAX_SESSIONS,
  TerminalSettingsSchema,
  type TerminalSettings,
} from '../../src/shared/terminal'
import { fakeSpawn } from '../fixtures/pty'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'devdock-term-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.useRealTimers()
})

const EXEC = new Set(['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/local/bin/fish', '/opt/zsh'])

function manager(
  over: Partial<Omit<TerminalManagerOptions, 'settings'>> & {
    settings?: Partial<TerminalSettings>
  } = {},
) {
  const pty = fakeSpawn()
  const events: {
    owner: number
    kind: 'out' | 'exit'
    id: string
    data?: string
    code?: number
  }[] = []
  const signals: [number, string][] = []
  const { settings, ...rest } = over
  const s = TerminalSettingsSchema.parse(settings ?? {})
  const m = new TerminalManager({
    spawn: pty.spawn,
    settings: () => s,
    onOutput: (owner, e) => events.push({ owner, kind: 'out', id: e.id, data: e.data }),
    onExit: (owner, e) => events.push({ owner, kind: 'exit', id: e.id, code: e.exitCode }),
    promptDir: over.promptDir ?? tmp(),
    platform: 'darwin',
    env: () => ({
      SHELL: '/bin/zsh',
      PATH: '/bin:/usr/bin',
      HOME: '/Users/me',
      PWD: '/elsewhere',
      OLDPWD: '/x',
      ELECTRON_RUN_AS_NODE: '1',
    }),
    appVersion: '0.1.0',
    batchMs: 5,
    killGraceMs: 20,
    signal: (pid, sig) => signals.push([pid, sig]),
    ...rest,
  })
  return { m, pty, events, signals }
}
const req = (owner = 1, extra: object = {}) => ({
  owner,
  cwd: '/repo',
  title: 'web-app',
  repoId: 'r1',
  cols: 80,
  rows: 24,
  ...extra,
})

describe('TerminalManager', () => {
  it('starts the login shell as a login shell in the folder, with a terminal environment', async () => {
    const { m, pty } = manager()
    const s = await m.create(req())
    expect(s).toEqual({
      id: 't1',
      title: 'web-app',
      repoId: 'r1',
      shell: 'zsh',
      status: 'running',
      exitCode: null,
    })
    const p = pty.ptys[0]!
    expect(p.file).toBe('/bin/zsh')
    expect(p.args).toEqual(['-l'])
    expect(p.options).toMatchObject({ cwd: '/repo', cols: 80, rows: 24, name: 'xterm-256color' })
    expect(p.options.env).toMatchObject({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'DevDock',
      PWD: '/repo',
      LANG: 'en_US.UTF-8',
    })
    expect(p.options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(p.options.env.OLDPWD).toBeUndefined()
  })

  it('sends batched output only to the owner, and the exit after the last output', async () => {
    const { m, pty, events } = manager()
    await m.create(req(7))
    const p = pty.ptys[0]!
    p.emit('hel')
    p.emit('lo')
    expect(events).toEqual([])
    await new Promise((r) => setTimeout(r, 20))
    expect(events).toEqual([{ owner: 7, kind: 'out', id: 't1', data: 'hello' }])
    p.emit('bye')
    p.exit(3)
    expect(events.slice(1)).toEqual([
      { owner: 7, kind: 'out', id: 't1', data: 'bye' },
      { owner: 7, kind: 'exit', id: 't1', code: 3 },
    ])
    expect(m.list(7)[0]).toMatchObject({ status: 'exited', exitCode: 3 })
    // Writing to an exited shell is a no-op, not an error.
    m.write(7, 't1', 'ls\r')
    expect(p.writes).toEqual([])
  })

  it("another window's terminal is reported as missing and never touched", async () => {
    const { m, pty } = manager()
    await m.create(req(1))
    for (const call of [() => m.write(2, 't1', 'rm -rf ~\r'), () => m.resize(2, 't1', 100, 30)]) {
      expect(call).toThrow(TerminalError)
    }
    await expect(m.kill(2, 't1')).rejects.toMatchObject({ kind: 'not-found' })
    expect(m.list(2)).toEqual([])
    const p = pty.ptys[0]!
    expect([p.writes, p.resizes, p.kills]).toEqual([[], [], []])
    m.write(1, 't1', 'ls\r')
    m.resize(1, 't1', 100, 30)
    expect(p.writes).toEqual(['ls\r'])
    expect(p.resizes).toEqual([[100, 30]])
  })

  it('closing a tab hangs up the shell, then kills its process group', async () => {
    const { m, pty, signals } = manager()
    await m.create(req())
    const p = pty.ptys[0]!
    await m.kill(1, 't1')
    expect(p.kills).toHaveLength(1)
    expect(signals).toEqual([[-p.pid, 'SIGKILL']])
    expect(m.count()).toBe(0)
  })

  it('a shell that ignores the hang-up is killed after the grace period', async () => {
    const pty = fakeSpawn({ exitOnKill: false })
    const { m, signals } = manager({ spawn: pty.spawn })
    await m.create(req())
    const p = pty.ptys[0]!
    await m.kill(1, 't1')
    expect(signals).toEqual([
      [-p.pid, 'SIGKILL'],
      [p.pid, 'SIGKILL'],
    ])
  })

  it('a closed or reloaded window takes its terminals; quitting takes all', async () => {
    const { m } = manager()
    await m.create(req(1))
    await m.create(req(1))
    await m.create(req(2))
    await m.killOwner(1)
    expect(m.pids(1)).toEqual([])
    expect(m.pids(2)).toHaveLength(1)
    await m.killAll()
    expect(m.count()).toBe(0)
  })

  it(`limits a window to ${MAX_SESSIONS} terminals`, async () => {
    const { m } = manager()
    for (let i = 0; i < MAX_SESSIONS; i++) await m.create(req())
    await expect(m.create(req())).rejects.toMatchObject({ kind: 'limit' })
    await expect(m.create(req(2))).resolves.toMatchObject({ status: 'running' })
  })

  it('a shell that cannot start is a typed failure', async () => {
    const { m } = manager({
      spawn: () => {
        throw new Error('posix_spawnp failed.')
      },
    })
    await expect(m.create(req())).rejects.toMatchObject({
      kind: 'failed',
      details: 'posix_spawnp failed.',
    })
    const missing = manager({ settings: { shell: '/no/such/shell' } })
    await expect(missing.m.create(req())).rejects.toMatchObject({ kind: 'shell' })
  })

  it('with the DevDock prompt, zsh gets DevDock’s ZDOTDIR and bash an rcfile; the home folder is untouched', async () => {
    const promptDir = tmp()
    const home = tmp()
    writeFileSync(join(home, '.zshrc'), '# mine\n')
    const z = manager({ promptDir, settings: { devdockPrompt: true } })
    await z.m.create(req())
    const zp = z.pty.ptys[0]!
    expect(zp.options.env.ZDOTDIR).toBe(join(promptDir, 'zsh'))
    expect(existsSync(join(promptDir, 'zsh', '.zshrc'))).toBe(true)
    const b = manager({ promptDir, settings: { devdockPrompt: true, shell: 'bash' } })
    await b.m.create(req())
    expect(b.pty.ptys[0]!.args).toEqual(['--rcfile', join(promptDir, 'bashrc'), '-i'])
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('# mine\n')
  })
})

describe('terminalEnv', () => {
  it('keeps the user’s locale and sets one only for macOS apps that have none', () => {
    expect(terminalEnv({ LANG: 'de_DE.UTF-8' }, 'darwin', '1').LANG).toBe('de_DE.UTF-8')
    expect(terminalEnv({}, 'win32', '1').LANG).toBeUndefined()
  })
})

describe('OutputBatcher', () => {
  it('joins chunks per interval and flushes early past the size cap', () => {
    vi.useFakeTimers()
    const out: string[] = []
    const b = new OutputBatcher((d) => out.push(d), 16, 10)
    b.push('abc')
    b.push('def')
    expect(out).toEqual([])
    vi.advanceTimersByTime(16)
    expect(out).toEqual(['abcdef'])
    b.push('0123456789x')
    expect(out).toEqual(['abcdef', '0123456789x'])
    b.push('late')
    b.dispose()
    vi.advanceTimersByTime(50)
    expect(out).toHaveLength(2)
  })
})

describe('shell resolution', () => {
  const env = (e: NodeJS.ProcessEnv, platform: NodeJS.Platform = 'darwin') => ({
    platform,
    env: e,
    isExecutable: (p: string) =>
      EXEC.has(p) ||
      p === 'C:\\Tools\\pwsh.exe' ||
      p === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  })
  it('uses $SHELL, then zsh/bash/sh', () => {
    expect(resolveShell('', env({ SHELL: '/usr/local/bin/fish' }))).toEqual({
      file: '/usr/local/bin/fish',
      kind: 'fish',
      args: ['-l'],
    })
    expect(resolveShell('', env({ SHELL: 'zsh' })).file).toBe('/bin/zsh')
    expect(resolveShell('', env({})).file).toBe('/bin/zsh')
  })
  it('an override is a name on PATH or an absolute path', () => {
    expect(resolveShell('bash', env({ PATH: '/usr/bin:/bin' })).file).toBe('/bin/bash')
    expect(resolveShell('/opt/zsh', env({})).file).toBe('/opt/zsh')
    expect(() => resolveShell('fish', env({ PATH: '/bin' }))).toThrow(ShellNotFoundError)
    expect(() => resolveShell('/opt/nope', env({}))).toThrow(ShellNotFoundError)
  })
  it('Windows: pwsh when installed, else Windows PowerShell', () => {
    expect(resolveShell('', env({ PATH: 'C:\\Tools' }, 'win32'))).toEqual({
      file: 'C:\\Tools\\pwsh.exe',
      kind: 'pwsh',
      args: ['-NoLogo'],
    })
    expect(resolveShell('', env({ PATH: '', SystemRoot: 'C:\\Windows' }, 'win32')).file).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
    expect(findOnPath('pwsh', env({ Path: 'C:\\Tools\\' }, 'win32'))).toBe('C:\\Tools\\pwsh.exe')
  })
  it('knows shells by file name', () => {
    expect(shellKind('C:\\x\\PowerShell.exe')).toBe('powershell')
    expect(shellKind('/bin/dash')).toBe('other')
    expect(loginArgs('cmd', 'win32')).toEqual([])
    expect(loginArgs('bash', 'win32')).toEqual([])
  })
})

describe('DevDock prompt files', () => {
  const has = (sh: string) => {
    try {
      execFileSync(sh, ['-c', 'exit 0'])
      return true
    } catch {
      return false
    }
  }
  it.skipIf(!has('zsh'))('the zsh files parse (zsh -n)', () => {
    const d = tmp()
    for (const [name, text] of Object.entries(zshFiles())) {
      writeFileSync(join(d, name), text)
      execFileSync('zsh', ['-n', join(d, name)])
    }
  })
  it.skipIf(!has('bash'))('the bash rc file parses (bash -n)', () => {
    const f = join(tmp(), 'bashrc')
    writeFileSync(f, bashRc())
    execFileSync('bash', ['-n', f])
  })
  it.skipIf(!has('bash'))('a branch name is shown, never run', () => {
    const repo = tmp()
    const marker = join(repo, 'ran')
    execFileSync('git', ['init', '-q', '-b', `x$(touch${'${IFS}'}${marker})`, repo])
    const rc = join(tmp(), 'bashrc')
    writeFileSync(rc, bashRc())
    const ps1 = execFileSync(
      'bash',
      ['--rcfile', rc, '-i', '-c', '__devdock_ps1; printf %s "$__devdock_b"'],
      {
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: tmp() },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    expect(ps1).toContain('x$(touch')
    expect(existsSync(marker)).toBe(false)
  })
  it('other shells start as usual', async () => {
    expect(
      await withDevdockPrompt(
        { file: '/usr/local/bin/fish', kind: 'fish', args: ['-l'] },
        tmp(),
        undefined,
      ),
    ).toBeNull()
  })
})
