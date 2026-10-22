import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { makeRepos, type Repos } from '../fixtures/git-repos'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

let repos: Repos | undefined
/** Every git command these tests ran, for the destructive-command check at the end. */
const commands: string[][] = []
let lastGit: { log(): readonly { args: string[] }[] } | undefined
afterEach(() => {
  commands.push(...(lastGit?.log().map((c) => c.args) ?? []))
  lastGit = undefined
  repos?.cleanup()
  repos = undefined
})
afterAll(async () => {
  const { unsafeReason } = await import('../../src/main/services/git/exec')
  expect(commands.length).toBeGreaterThan(10)
  for (const args of commands) expect(unsafeReason(args), args.join(' ')).toBeNull()
})

async function withRepo() {
  repos = makeRepos()
  const s = await handlerSetup()
  lastGit = s.git
  const added = await dispatch('repos:add', { path: repos.clone }, s.handlers)
  if (!added.ok) throw new Error(added.error.message)
  return { ...s, repos, id: added.data.id }
}

describe('repos IPC with real repositories', { timeout: 30_000 }, () => {
  it('adds a repo from a subfolder, detects the base, persists it, refuses duplicates', async () => {
    repos = makeRepos()
    const { handlers, deps } = await handlerSetup()
    mkdirSync(join(repos.clone, 'packages', 'web'), { recursive: true })
    const r = await dispatch('repos:add', { path: join(repos.clone, 'packages', 'web') }, handlers)
    expect(r).toMatchObject({ ok: true, data: { name: 'clone', baseBranch: 'develop' } })
    expect(deps.settings.get().repos).toHaveLength(1)
    expect(deps.settings.get().repos[0]!.protectedPatterns).toEqual([
      'main',
      'master',
      'develop',
      'release/*',
    ])

    const again = await dispatch('repos:add', { path: repos.clone }, handlers)
    expect(again).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
    expect(again.ok ? '' : again.error.message).toMatch(/already/)
  })

  it('rejects a folder that is not a git repo with NOT_A_REPO', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdock-plain-'))
    try {
      const { handlers } = await handlerSetup()
      const r = await dispatch('repos:add', { path: dir }, handlers)
      expect(r).toMatchObject({ ok: false, error: { code: 'NOT_A_REPO' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns status that matches the contract', async () => {
    const { handlers, id } = await withRepo()
    const r = await dispatch('repos:status', { id }, handlers)
    expect(r).toMatchObject({
      ok: true,
      data: { branch: 'develop', dirty: 0, operation: null, vsBase: { ahead: 0, behind: 0 } },
    })
  })

  it('plans, runs and streams output tagged with the run id', async () => {
    const { handlers, id, output } = await withRepo()
    const plan = await dispatch('repos:plan', { id, request: { action: 'fetchAll' } }, handlers)
    expect(plan).toEqual({ ok: true, data: [{ args: ['fetch', '--all', '--prune'] }] })
    const run = await dispatch(
      'repos:run',
      {
        id,
        runId: 'run-1',
        request: { action: 'newBranch', kind: 'bugfix', key: 'NM-7', title: 'Crash' },
      },
      handlers,
    )
    expect(run).toMatchObject({ ok: true, data: { status: 'done', branch: 'bugfix/NM-7-crash' } })
    expect(output.length).toBeGreaterThan(0)
    expect(output.every((o) => o.runId === 'run-1')).toBe(true)
  })

  it('maps a dirty tree to DIRTY_TREE so the UI can offer Stash & continue', async () => {
    const { handlers, id, repos: r } = await withRepo()
    r.git(r.clone, 'checkout', '-q', '-b', 'feature/d')
    writeFileSync(join(r.clone, 'README.md'), 'dirty\n')
    const res = await dispatch(
      'repos:run',
      { id, runId: 'x', request: { action: 'updateBranch', strategy: 'merge', stash: false } },
      handlers,
    )
    expect(res).toMatchObject({ ok: false, error: { code: 'DIRTY_TREE' } })
  })

  it('the handler rejects pushing a protected branch (NOT_ALLOWED) and origin is untouched', async () => {
    const { handlers, id, repos: r, git } = await withRepo()
    r.git(r.clone, 'checkout', '-q', 'main')
    r.commit(r.clone, 'm.txt', 'local main commit\n')
    const originMain = r.git(r.origin, 'rev-parse', 'main').trim()
    const res = await dispatch(
      'repos:run',
      { id, runId: 'p', request: { action: 'pushBranch' } },
      handlers,
    )
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    expect(r.git(r.origin, 'rev-parse', 'main').trim()).toBe(originMain)
    expect(git.log().some((c) => c.args[0] === 'push')).toBe(false)
  })

  it('pushBase without explicit confirmation is rejected by validation', async () => {
    const { handlers, id } = await withRepo()
    for (const confirmed of [false, undefined, 'yes']) {
      const res = await dispatch(
        'repos:run',
        { id, runId: 'p', request: { action: 'pushBase', confirmed } as never },
        handlers,
      )
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    }
  })

  it('rejects a base branch that git could read as an option', async () => {
    const { handlers, id } = await withRepo()
    for (const baseBranch of ['--upload-pack=touch /tmp/x', '-x', 'a..b', 'with space']) {
      const r = await dispatch('repos:update', { id, patch: { baseBranch } }, handlers)
      expect(r, baseBranch).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    }
  })

  it('only accepts known editor launchers as the editor path', async () => {
    const { handlers } = await handlerSetup()
    for (const editorPath of ['/bin/sh', 'calc.exe', 'C:\\x\\code.cmd" & calc', 'code%PATH%']) {
      const r = await dispatch('settings:update', { git: { editorPath } }, handlers)
      expect(r, editorPath).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    }
    for (const editorPath of [
      'code',
      '/usr/local/bin/code',
      'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
      'cursor',
    ]) {
      const r = await dispatch('settings:update', { git: { editorPath } }, handlers)
      expect(r, editorPath).toMatchObject({ ok: true })
    }
  })

  it('updates only the fields sent, and removes', async () => {
    const { handlers, id, deps } = await withRepo()
    const upd = await dispatch(
      'repos:update',
      { id, patch: { protectedPatterns: ['main', 'hotfix/*'] } },
      handlers,
    )
    expect(upd).toMatchObject({
      ok: true,
      data: {
        protectedPatterns: ['main', 'hotfix/*'],
        baseBranch: 'develop',
        devCommand: 'npm run dev',
        name: 'clone',
      },
    })
    const bad = await dispatch(
      'repos:update',
      { id, patch: { branchTemplates: { feature: 'feature/', bugfix: 'b/{slug}' } } },
      handlers,
    )
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })

    expect(await dispatch('repos:remove', { id }, handlers)).toEqual({ ok: true, data: undefined })
    expect(deps.settings.get().repos).toEqual([])
    expect(await dispatch('repos:status', { id }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
  })
})
