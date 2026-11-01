import { describe, expect, it, vi } from 'vitest'
import {
  boundChanges,
  diffLineCounts,
  MAX_PR_DESCRIPTION,
  MAX_PR_FILES,
  type PrChanges,
  type PullRequest,
} from '../../src/shared/bitbucket'
import { DEMO_GITHUB_CONFIG, githubHandlers } from '../../src/main/demo/github'
import { DEMO_GITLAB_CONFIG, gitlabHandlers } from '../../src/main/demo/gitlab'
import { BitbucketClient } from '../../src/main/services/bitbucket/client'
import { GitHubClient } from '../../src/main/services/github/client'
import { GitLabClient } from '../../src/main/services/gitlab/client'
import { DemoHttpClient } from '../../src/main/services/http'
import { ScriptedHttp, json } from '../fixtures/jira'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
const { prPrompt } = await import('../../src/main/services/ai/prompts')
const { dispatch } = await import('../../src/main/ipc/registry')
const { handlerSetup } = await import('../fixtures/handler-deps')

const file = (path: string, added: number | null = 1, removed: number | null = 0) =>
  ({ path, status: 'modified', added, removed }) as const

describe('PR changes (T7): bounds and line counts', () => {
  it('counts +/- lines, not the file headers', () => {
    expect(
      diffLineCounts(
        '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n++e (a line starting with +)',
      ),
    ).toEqual({ added: 3, removed: 1 })
  })

  it('cuts the description and the file list, and says so', () => {
    const many = Array.from({ length: MAX_PR_FILES + 5 }, (_, i) => file(`f${i}.ts`))
    const c = boundChanges(` ${'x'.repeat(MAX_PR_DESCRIPTION + 10)} `, many, null)
    expect(c.description).toHaveLength(MAX_PR_DESCRIPTION)
    expect(c.descriptionCut).toBe(true)
    expect(c.files).toHaveLength(MAX_PR_FILES)
    expect(c.filesTotal).toBeNull()
    expect(boundChanges('ok', [file('a.ts')], null)).toMatchObject({
      descriptionCut: false,
      filesTotal: 1,
    })
  })
})

describe('PR changes (T7): the prompt', () => {
  const pr = {
    title: 'DD-1: Fix the date picker',
    sourceBranch: 'bugfix/DD-1',
    targetBranch: 'develop',
    state: 'open',
    reviewers: [],
    approvals: 0,
    needsWork: 0,
    comments: 0,
    unresolvedComments: 0,
    conflicts: false,
    build: { state: 'success', statuses: [] },
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  } as unknown as PullRequest

  it('adds the description and files, with totals when every file has counts', () => {
    const changes: PrChanges = {
      description: 'Keeps focus on the grid.',
      descriptionCut: false,
      files: [
        { path: 'src/DatePicker.tsx', status: 'modified', added: 12, removed: 3 },
        { path: 'src/DatePicker.test.tsx', status: 'added', added: 40, removed: 0 },
      ],
      filesTotal: 5,
    }
    const text = prPrompt(pr, changes)
    expect(text).toContain('Description:\nKeeps focus on the grid.')
    expect(text).toContain('Changed files: 5 (+52 −3 lines)')
    expect(text).toContain('- modified src/DatePicker.tsx (+12 −3)')
    expect(text).toContain('- added src/DatePicker.test.tsx (+40 −0)')
    expect(text).toContain('(and 3 more files)')
  })

  it('no counts (Data Center), a cut description, or nothing readable: said plainly', () => {
    const text = prPrompt(pr, {
      description: 'x',
      descriptionCut: true,
      files: [{ path: 'a.ts', status: 'removed', added: null, removed: null }],
      filesTotal: 1,
    })
    expect(text).toContain(`[… cut at ${MAX_PR_DESCRIPTION} characters]`)
    expect(text).toContain('Changed files: 1\n- removed a.ts')
    expect(
      prPrompt(pr, { description: '', descriptionCut: false, files: [], filesTotal: 0 }),
    ).toContain('Description:\n(none)')
    expect(prPrompt(pr, null)).toContain('Description and changed files: could not be read.')
  })
})

describe('PR changes (T7): each provider', () => {
  it('Bitbucket Cloud: description and diffstat with line counts and the total', async () => {
    const api = '/2.0/repositories/acme/web-app/pullrequests/42'
    const http = new ScriptedHttp([
      (r) =>
        new URL(r.url).pathname === `${api}/diffstat`
          ? json({
              size: 3,
              values: [
                {
                  status: 'modified',
                  lines_added: 5,
                  lines_removed: 2,
                  new: { path: 'src/a.ts' },
                  old: { path: 'src/a.ts' },
                },
                {
                  status: 'removed',
                  lines_added: 0,
                  lines_removed: 9,
                  new: null,
                  old: { path: 'src/old.ts' },
                },
                {
                  status: 'merge conflict',
                  lines_added: 1,
                  lines_removed: 1,
                  new: { path: 'src/c.ts' },
                },
              ],
            })
          : undefined,
      (r) =>
        new URL(r.url).pathname === api ? json({ description: ' Fixes focus. ' }) : undefined,
    ])
    const client = new BitbucketClient(
      http,
      { flavor: 'cloud', baseUrl: 'https://bitbucket.org', username: 'a@b.c', token: 't' },
      async () => [],
    )
    expect(await client.changes({ owner: 'acme', repo: 'web-app', id: 42 })).toEqual({
      description: 'Fixes focus.',
      descriptionCut: false,
      files: [
        { path: 'src/a.ts', status: 'modified', added: 5, removed: 2 },
        { path: 'src/old.ts', status: 'removed', added: 0, removed: 9 },
        { path: 'src/c.ts', status: 'modified', added: 1, removed: 1 },
      ],
      filesTotal: 3,
    })
    expect(
      new URL(http.requests.find((r) => r.url.includes('diffstat'))!.url).searchParams.get(
        'pagelen',
      ),
    ).toBe(String(MAX_PR_FILES))
  })

  it('GitHub (demo): body and files with additions/deletions', async () => {
    const client = new GitHubClient(
      new DemoHttpClient(githubHandlers({ speed: 1 })),
      DEMO_GITHUB_CONFIG.config,
      async () => DEMO_GITHUB_CONFIG.projects,
    )
    const c = await client.changes({
      provider: 'github',
      owner: 'acme',
      repo: 'storefront',
      id: 128,
    })
    expect(c.description).toMatch(/^Lazy-load product images below the fold\./)
    expect(c.filesTotal).toBe(4)
    expect(c.files[1]).toMatchObject({ status: 'added', removed: 0 })
    expect(c.files.every((f) => f.added !== null)).toBe(true)
  })

  it('GitLab (demo): line counts from each diff; an old server without /diffs falls back to /changes', async () => {
    const client = new GitLabClient(
      new DemoHttpClient(gitlabHandlers()),
      DEMO_GITLAB_CONFIG.config,
      async () => DEMO_GITLAB_CONFIG.projects,
    )
    const ref = { provider: 'gitlab' as const, owner: 'acme/web', repo: 'checkout', id: 42 }
    const c = await client.changes(ref)
    expect(c.description).toMatch(/^Address autocomplete on the checkout form\./)
    expect(c.filesTotal).toBe(4)
    expect(c.files[0]!.added).toBeGreaterThan(0)

    const http = new ScriptedHttp([
      (r) =>
        new URL(r.url).pathname.endsWith('/diffs')
          ? json({ message: '404 Not found' }, { status: 404 })
          : undefined,
      (r) =>
        new URL(r.url).pathname.endsWith('/changes')
          ? json({
              changes: [{ old_path: 'a', new_path: 'b', renamed_file: true, diff: '@@\n+x\n-y' }],
            })
          : undefined,
      (r) =>
        new URL(r.url).pathname.endsWith('/merge_requests/7')
          ? json({ description: null, changes_count: '1000+' })
          : undefined,
    ])
    const old = new GitLabClient(
      http,
      { baseUrl: 'https://gitlab.example', token: 't' },
      async () => [],
    )
    expect(await old.changes({ provider: 'gitlab', owner: 'g', repo: 'p', id: 7 })).toEqual({
      description: '',
      descriptionCut: false,
      files: [{ path: 'b', status: 'renamed', added: 1, removed: 1 }],
      // "1000+": at least that many (not the one file listed).
      filesTotal: 1000,
    })
  })

  it('demo end to end: the summary request carries the description and files, for every provider', async () => {
    const { deps, handlers } = await handlerSetup()
    deps.settings.update({
      general: { demoMode: true },
      github: { enabled: true },
      gitlab: { enabled: true },
    })
    const refs = [
      { owner: 'DEMO', repo: 'web-app', id: 412 },
      { provider: 'github' as const, owner: 'acme', repo: 'storefront', id: 128 },
      { provider: 'gitlab' as const, owner: 'acme/web', repo: 'checkout', id: 42 },
    ]
    for (const ref of refs) {
      const r = await dispatch('ai:prepare', { feature: 'pr-summary', ref }, handlers)
      if (!r.ok) throw new Error(`${ref.repo}: ${r.error.message}`)
      expect(r.data.prompt, ref.repo).toContain('Description:\n')
      expect(r.data.prompt, ref.repo).toMatch(/Changed files: 4/)
      expect(r.data.prompt, ref.repo).toContain('- added src/components/')
    }
  })
})
