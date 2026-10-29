import { rmSync } from 'node:fs'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRepos, type Repos } from '../fixtures/git-repos'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

/** The window asking (terminals belong to the webContents that made them). */
const from = (id: number) => ({ sender: { id } }) as unknown as IpcMainInvokeEvent

let repos: Repos | undefined
afterEach(() => {
  repos?.cleanup()
  repos = undefined
})

describe('terminal IPC (P7-A)', { timeout: 30_000 }, () => {
  it('starts in a registered repo or the home folder; never at a path the renderer names', async () => {
    repos = makeRepos()
    const { handlers, ptys, deps } = await handlerSetup()
    const added = await dispatch('repos:add', { path: repos.clone }, handlers)
    if (!added.ok) throw new Error(added.error.message)
    const inRepo = await dispatch(
      'terminal:create',
      { repoId: added.data.id, cols: 80, rows: 24 },
      handlers,
      from(1),
    )
    expect(inRepo).toMatchObject({
      ok: true,
      data: { title: 'clone', repoId: added.data.id, status: 'running' },
    })
    expect(ptys[0]!.options.cwd).toBe(added.data.path)
    const home = await dispatch('terminal:create', { cols: 80, rows: 24 }, handlers, from(1))
    expect(home).toMatchObject({ ok: true, data: { title: 'Home', repoId: null } })
    expect(ptys[1]!.options.cwd).toBe(deps.home)
    // A path in the payload isn't part of the contract; an unknown repo is NOT_FOUND.
    expect(
      await dispatch('terminal:create', { repoId: 'nope', cols: 80, rows: 24 }, handlers, from(1)),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(ptys).toHaveLength(2)
  })

  it('a repo whose folder is gone gets a readable error, not a shell somewhere else', async () => {
    repos = makeRepos()
    const { handlers, ptys } = await handlerSetup()
    const added = await dispatch('repos:add', { path: repos.clone }, handlers)
    if (!added.ok) throw new Error(added.error.message)
    rmSync(repos.clone, { recursive: true, force: true })
    const r = await dispatch(
      'terminal:create',
      { repoId: added.data.id, cols: 80, rows: 24 },
      handlers,
      from(1),
    )
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', message: /folder for clone is missing/ },
    })
    expect(ptys).toHaveLength(0)
  })

  it('a window only sees and drives its own terminals', async () => {
    const { handlers, ptys, deps } = await handlerSetup()
    const made = await dispatch('terminal:create', { cols: 80, rows: 24 }, handlers, from(1))
    if (!made.ok) throw new Error(made.error.message)
    const id = made.data.id
    expect(deps.terminal.list(2)).toEqual([])
    for (const [channel, payload] of [
      ['terminal:write', { id, data: 'rm -rf ~\r' }],
      ['terminal:resize', { id, cols: 10, rows: 10 }],
      ['terminal:kill', { id }],
    ] as const) {
      expect(await dispatch(channel, payload as never, handlers, from(2))).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      })
    }
    expect(ptys[0]!.writes).toEqual([])
    expect(await dispatch('terminal:write', { id, data: 'ls\r' }, handlers, from(1))).toEqual({
      ok: true,
      data: undefined,
    })
    expect(ptys[0]!.writes).toEqual(['ls\r'])
    expect(await dispatch('terminal:kill', { id }, handlers, from(1))).toEqual({
      ok: true,
      data: undefined,
    })
    expect(deps.terminal.list(1)).toEqual([])
  })

  it('P7-C: starts an installed agent CLI with the prompt as one argument; a missing one is NOT_FOUND', async () => {
    const { handlers, ptys, deps } = await handlerSetup()
    expect(await dispatch('agents:detect', undefined, handlers)).toMatchObject({
      ok: true,
      data: [
        { id: 'claude', name: 'Claude Code', installed: true },
        { id: 'codex', name: 'Codex', installed: false },
        {},
        {},
      ],
    })
    const prompt = 'Use the bug-fixer agent. Ticket brief: docs/ai/specs/DD-7/TICKET.md.'
    const made = await dispatch(
      'terminal:create',
      { cols: 80, rows: 24, agent: { id: 'claude', prompt } },
      handlers,
      from(1),
    )
    expect(made).toMatchObject({
      ok: true,
      data: { title: 'Claude Code · Home', shell: 'Claude Code' },
    })
    expect([ptys[0]!.file, ptys[0]!.args, ptys[0]!.options.cwd]).toEqual([
      '/usr/local/bin/claude',
      [prompt],
      deps.home,
    ])
    expect(
      await dispatch(
        'terminal:create',
        { cols: 80, rows: 24, agent: { id: 'codex' } },
        handlers,
        from(1),
      ),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: /Codex isn't installed/ } })
    expect(
      await dispatch(
        'terminal:create',
        { cols: 80, rows: 24, agent: { id: 'bash' } } as never,
        handlers,
        from(1),
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(ptys).toHaveLength(1)
    // The palette window / panel hand the request (with its agent) to the main window.
    await dispatch('terminal:request', { repoId: null, agent: { id: 'claude', prompt } }, handlers)
    expect(deps.requestTerminal).toHaveBeenCalledWith({
      repoId: null,
      agent: { id: 'claude', prompt },
    })
  })

  it('rejects calls without a window and malformed payloads', async () => {
    const { handlers, ptys } = await handlerSetup()
    expect(await dispatch('terminal:create', { cols: 80, rows: 24 }, handlers, null)).toMatchObject(
      {
        ok: false,
        error: { code: 'FORBIDDEN' },
      },
    )
    for (const bad of [
      { cols: 0, rows: 24 },
      { cols: 80, rows: 9999 },
      { cols: 80, rows: 24, repoId: '' },
    ]) {
      expect(await dispatch('terminal:create', bad, handlers, from(1))).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
    for (const bad of [
      { id: '../t1', data: 'x' },
      { id: 't1', data: '' },
      { id: 't1', data: 'x'.repeat(64 * 1024 + 1) },
    ]) {
      expect(await dispatch('terminal:write', bad, handlers, from(1))).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
    expect(ptys).toHaveLength(0)
  })

  it('a request from the palette window or panel shows the main window (repo checked first)', async () => {
    const { handlers, deps } = await handlerSetup()
    expect(await dispatch('terminal:request', { repoId: null }, handlers)).toEqual({
      ok: true,
      data: undefined,
    })
    expect(deps.requestTerminal).toHaveBeenCalledWith({ repoId: null })
    expect(await dispatch('terminal:request', { repoId: 'nope' }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    expect(deps.requestTerminal).toHaveBeenCalledTimes(1)
  })
})
