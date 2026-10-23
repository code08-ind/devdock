import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DevServerState } from '../../src/shared/devserver'
import { DEFAULT_PROTECTED, DEFAULT_TEMPLATES, type RepoConfig } from '../../src/shared/settings'
import { DevServerManager, killTree } from '../../src/main/services/process/devserver'
import { isListening } from '../fixtures/ports'

let manager: DevServerManager | undefined
let dir: string | undefined
afterEach(async () => {
  await manager?.stopAll()
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function setup(devCommand = 'npm run dev') {
  dir = mkdtempSync(join(tmpdir(), 'devdock-devserver-'))
  cpSync(join(import.meta.dirname, '../fixtures/devserver'), dir, { recursive: true })
  const states: DevServerState[][] = []
  const output: string[] = []
  manager = new DevServerManager({
    onChange: (s) => states.push(s),
    onOutput: (e) => output.push(e.chunk),
    execPath: process.execPath,
  })
  const repo: RepoConfig = {
    id: 'r1',
    path: dir,
    name: 'fixture',
    baseBranch: 'develop',
    protectedPatterns: [...DEFAULT_PROTECTED],
    branchTemplates: { ...DEFAULT_TEMPLATES },
    devCommand,
  }
  return { manager, repo, states, output }
}

const current = (m: DevServerManager, kind: 'dev' | 'baseline' = 'dev') =>
  m.list().find((s) => s.kind === kind)!

describe('dev server manager (real processes)', { timeout: 40_000 }, () => {
  it('starts npm run dev, detects the port, stops the whole tree, and the port is free', async () => {
    const { manager: m, repo, output } = setup()
    await m.start(repo, 'dev')
    await vi.waitFor(() => expect(current(m).status).toBe('running'), { timeout: 20_000 })
    const { url, port } = current(m)
    expect(url).toBe(`http://localhost:${port}/`)
    expect(await isListening(port!)).toBe(true)
    expect(output.join('')).toContain('Local:')
    expect(m.log('r1', 'dev')).not.toContain('\u001b[')

    await m.stop('r1', 'dev')
    expect(current(m).status).toBe('stopped')
    // The grandchild that held the port ignores SIGTERM: only a tree kill frees it.
    await vi.waitFor(async () => expect(await isListening(port!)).toBe(false), { timeout: 10_000 })
    expect(m.hasRunning()).toBe(false)
  })

  it('stopAll stops every server (app quit)', async () => {
    const { manager: m, repo } = setup()
    await m.start(repo, 'dev')
    await m.start(repo, 'baseline')
    await vi.waitFor(() => expect(m.list().every((s) => s.status === 'running')).toBe(true), {
      timeout: 20_000,
    })
    const ports = m.list().map((s) => s.port!)
    await m.stopAll()
    for (const port of ports) {
      await vi.waitFor(async () => expect(await isListening(port)).toBe(false), { timeout: 10_000 })
    }
  })

  it('runs scripts/baseline.mjs with the bundled Node and detects its port', async () => {
    const { manager: m, repo } = setup()
    expect(DevServerManager.hasBaseline(repo.path)).toBe(true)
    await m.start(repo, 'baseline')
    await vi.waitFor(() => expect(current(m, 'baseline').status).toBe('running'), {
      timeout: 20_000,
    })
    expect(current(m, 'baseline').url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })

  it('refuses a second start and a disallowed command', async () => {
    const { manager: m, repo } = setup()
    await m.start(repo, 'dev')
    await expect(m.start(repo, 'dev')).rejects.toThrow(/already running/)
    await expect(
      m.start({ ...repo, id: 'r2', devCommand: 'npm run dev && echo x' }, 'dev'),
    ).rejects.toThrow(/not allowed/)
  })

  it('refuses the second of two concurrent starts (no orphaned process)', async () => {
    const { manager: m, repo } = setup()
    const results = await Promise.allSettled([m.start(repo, 'dev'), m.start(repo, 'dev')])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  it.skipIf(process.platform === 'win32')(
    'kills what is left of the group when the leader exits on its own',
    async () => {
      const { manager: m, repo } = setup('node leaver.mjs')
      await m.start(repo, 'dev')
      await vi.waitFor(() => expect(current(m).port).not.toBeNull(), { timeout: 15_000 })
      const port = current(m).port!
      await vi.waitFor(() => expect(current(m).status).toBe('exited'), { timeout: 15_000 })
      await vi.waitFor(async () => expect(await isListening(port)).toBe(false), { timeout: 10_000 })
    },
  )

  it('reports a command that exits on its own', async () => {
    const { manager: m, repo } = setup('node exit3.mjs')
    await m.start(repo, 'dev')
    await vi.waitFor(() => expect(current(m).status).toBe('exited'), { timeout: 15_000 })
    expect(current(m).exitCode).toBe(3)
  })
})

describe('killTree', () => {
  it('gives up waiting when the process never reports exit (quit must not hang)', async () => {
    const stuck = Object.assign(new EventEmitter(), {
      pid: 2 ** 22 + 12345, // not a live pid
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess
    for (const platform of ['win32', 'darwin'] as const) {
      const t = Date.now()
      await killTree(stuck, platform, 50)
      expect(Date.now() - t).toBeLessThan(2_000)
    }
  })
})
