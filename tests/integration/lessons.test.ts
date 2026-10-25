import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRepos, type Repos } from '../fixtures/git-repos'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')
const { cloudComment } = await import('../../src/main/services/bitbucket/cloud')
const { dcComments } = await import('../../src/main/services/bitbucket/datacenter')

let repos: Repos | undefined
afterEach(() => {
  repos?.cleanup()
  repos = undefined
})

describe('agent lessons (P6-F)', { timeout: 30_000 }, () => {
  it('lessons:comments (demo Bitbucket): reviewers\' comments on my PRs, not mine, not "LGTM"', async () => {
    const { handlers } = await handlerSetup()
    const r = await dispatch('lessons:comments', undefined, handlers)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.data.length).toBeGreaterThan(3)
    expect(r.data.some((c) => c.author === 'Demo Developer')).toBe(false)
    expect(r.data.some((c) => c.text === 'LGTM')).toBe(false)
    const money = r.data.find((c) => c.text.includes('formatMoney'))
    expect(money).toMatchObject({ author: 'Priya Reviewer', path: 'src/checkout/Total.tsx' })
    expect(money?.pr).toMatch(/^[\w-]+ #\d+$/)
    // Newest first.
    const times = r.data.map((c) => Date.parse(c.createdAt ?? '0'))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('lessons:state / lessons:add write only into the repo, only what was picked', async () => {
    repos = makeRepos()
    const { handlers } = await handlerSetup()
    const added = await dispatch('repos:add', { path: repos.clone }, handlers)
    if (!added.ok) throw new Error(added.error.message)
    const repoId = added.data.id

    expect(await dispatch('lessons:state', { repoId }, handlers)).toEqual({
      ok: true,
      data: {
        path: 'docs/ai/LESSONS.md',
        exists: false,
        lessons: [],
        remoteRepos: expect.any(Array),
      },
    })
    const r = await dispatch(
      'lessons:add',
      { repoId, lessons: ['Use formatMoney for totals (web-app #415)'] },
      handlers,
    )
    expect(r).toMatchObject({ ok: true, data: { exists: true, added: 1 } })
    expect(readFileSync(join(repos.clone, 'docs/ai/LESSONS.md'), 'utf8')).toContain(
      '- Use formatMoney for totals (web-app #415)\n',
    )
    // An unknown repo is NOT_FOUND, not an internal error.
    expect(await dispatch('lessons:state', { repoId: 'nope' }, handlers)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    // Payload validation: one line each, at least one.
    for (const lessons of [[], ['two\nlines']]) {
      expect(await dispatch('lessons:add', { repoId, lessons }, handlers)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
  })

  it('reads Cloud and Data Center comment shapes (inline file, replies, deleted text)', () => {
    expect(
      cloudComment({
        id: 7,
        content: { raw: 'Use tokens' },
        user: { uuid: '{u1}', display_name: 'Priya' },
        inline: { path: 'a.css' },
        created_on: '2026-10-20T10:00:00Z',
      }),
    ).toEqual([
      {
        id: '7',
        authorId: '{u1}',
        author: 'Priya',
        text: 'Use tokens',
        path: 'a.css',
        createdAt: '2026-10-20T10:00:00Z',
      },
    ])
    expect(cloudComment({ id: 8, content: { raw: '' } })).toEqual([])
    const dc = dcComments(
      {
        id: 1,
        text: 'Root',
        author: { name: 'sam', displayName: 'Sam' },
        createdDate: Date.parse('2026-10-20T10:00:00Z'),
        comments: [{ id: 2, text: 'Reply', author: { name: 'dev', displayName: 'Me' } }],
      },
      'src/x.ts',
    )
    expect(dc.map((c) => [c.id, c.authorId, c.text, c.path])).toEqual([
      ['1', 'sam', 'Root', 'src/x.ts'],
      ['2', 'dev', 'Reply', 'src/x.ts'],
    ])
  })
})
