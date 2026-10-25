import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  prKey,
  summariseBuilds,
  type BuildStatus,
  type PrRef,
  type PullRequest,
} from '../../src/shared/bitbucket'
import type { NotifyInput } from '../../src/main/services/notifications'
import { PrWatcher, prChanges } from '../../src/main/services/bitbucket/watcher'
import { WatchError } from '../../src/main/services/watch'
import { ServiceError } from '../../src/main/services/service-error'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const SITE = 'https://bitbucket.example.com'
const LINK = `${SITE}/projects/WEB/repos/web-app/pull-requests/42/overview?tab=diff`
const REF: PrRef = { owner: 'WEB', repo: 'web-app', id: 42 }
const URL42 = `${SITE}/projects/WEB/repos/web-app/pull-requests/42/overview`

const build = (state: BuildStatus['state'], name = 'web-app » PR-42'): BuildStatus => ({
  key: name,
  name,
  state,
  url: null,
})

/** PR 42 as Bitbucket would report it; each poll in a test is one of these. */
function pr(over: Partial<PullRequest> = {}, ref: PrRef = REF): PullRequest {
  return {
    key: prKey(ref),
    ref,
    title: 'NM-42: Checkout summary card',
    url: URL42,
    author: 'Ada Example',
    sourceBranch: 'feature/NM-42-summary',
    targetBranch: 'develop',
    state: 'open',
    reviewers: [
      { name: 'Priya Reviewer', status: 'unapproved' },
      { name: 'Sam Lead', status: 'unapproved' },
    ],
    approvals: 0,
    needsWork: 0,
    comments: 0,
    unresolvedComments: 0,
    conflicts: false,
    createdAt: '2026-10-24T08:00:00.000Z',
    updatedAt: '2026-10-24T08:00:00.000Z',
    closedAt: null,
    sourceCommit: 'aaa111',
    build: summariseBuilds([build('running')]),
    ...over,
  }
}

const votes = (priya: string, sam: string) => {
  const reviewers = [
    { name: 'Priya Reviewer', status: priya },
    { name: 'Sam Lead', status: sam },
  ] as PullRequest['reviewers']
  return {
    reviewers,
    approvals: reviewers.filter((r) => r.status === 'approved').length,
    needsWork: reviewers.filter((r) => r.status === 'needs_work').length,
  }
}

/** A watcher over a scripted Bitbucket: each `pr()` call takes the next answer. */
function setup(dir = mkdtempSync(join(tmpdir(), 'devdock-watch-'))) {
  const answers: (PullRequest | Error)[] = []
  const notified: NotifyInput[] = []
  const bitbucket = {
    site: vi.fn<() => string | null>(() => SITE),
    pr: vi.fn(async (_ref: PrRef) => {
      const next = answers.shift()
      if (!next) throw new Error('no scripted answer left')
      if (next instanceof Error) throw next
      return next
    }),
  }
  const onChange = vi.fn()
  const file = join(dir, 'watches.json')
  const make = () =>
    new PrWatcher({ file, bitbucket, notify: (n) => notified.push(n), onChange, now: () => 1000 })
  return { dir, file, answers, notified, bitbucket, onChange, watcher: make(), restart: make }
}

const titles = (ns: NotifyInput[]) => ns.map((n) => `${n.type}: ${n.title}`)

describe('PrWatcher (P3.D2)', () => {
  it('a sequence of snapshots produces exactly the expected notifications', async () => {
    const t = setup()
    t.answers.push(pr()) // baseline when added: nothing is notified
    const item = await t.watcher.add(LINK)
    expect(item).toMatchObject({ key: 'web/web-app#42', site: SITE, error: null })
    expect(t.notified).toEqual([])

    const steps: [PullRequest, string[]][] = [
      // Nothing changed.
      [pr(), []],
      // Build passes; Priya approves.
      [
        pr({ build: summariseBuilds([build('success')]), ...votes('approved', 'unapproved') }),
        ['build-finished: Build passed · web-app #42', 'pr-approval: Approved by Priya Reviewer'],
      ],
      // Same state again: no repeats.
      [pr({ build: summariseBuilds([build('success')]), ...votes('approved', 'unapproved') }), []],
      // Sam marks needs work and leaves 2 comments.
      [
        pr({
          build: summariseBuilds([build('success')]),
          ...votes('approved', 'needs_work'),
          comments: 2,
          unresolvedComments: 2,
        }),
        ['pr-needs-work: Needs work from Sam Lead', 'pr-comment: 2 new comments · web-app #42'],
      ],
      // New commit: its build is running — nothing yet. A comment is deleted — nothing.
      [
        pr({
          sourceCommit: 'bbb222',
          build: summariseBuilds([build('running')]),
          ...votes('approved', 'needs_work'),
          comments: 1,
          unresolvedComments: 1,
        }),
        [],
      ],
      // The new build fails (two statuses, one failed).
      [
        pr({
          sourceCommit: 'bbb222',
          build: summariseBuilds([build('failed'), build('success', 'visual-tests')]),
          ...votes('approved', 'needs_work'),
          comments: 1,
          unresolvedComments: 1,
        }),
        ['build-finished: Build failed · web-app #42'],
      ],
      // Another commit whose build finished (failed again) between two polls.
      [
        pr({
          sourceCommit: 'ccc333',
          build: summariseBuilds([build('failed')]),
          ...votes('approved', 'needs_work'),
          comments: 1,
        }),
        ['build-finished: Build failed · web-app #42'],
      ],
      // Sam approves and it's merged.
      [
        pr({
          sourceCommit: 'ccc333',
          build: summariseBuilds([build('success')]),
          ...votes('approved', 'approved'),
          comments: 1,
          state: 'merged',
          closedAt: '2026-10-24T12:00:00.000Z',
        }),
        [
          'build-finished: Build passed · web-app #42',
          'pr-approval: Approved by Sam Lead',
          'pr-closed: Merged into develop',
        ],
      ],
    ]
    for (const [snapshot, expected] of steps) {
      t.notified.length = 0
      t.answers.push(snapshot)
      await t.watcher.poll()
      expect(titles(t.notified)).toEqual(expected)
    }
    // Merged: no longer polled.
    t.notified.length = 0
    await t.watcher.poll()
    expect(t.bitbucket.pr).toHaveBeenCalledTimes(steps.length + 1)
    expect(t.watcher.list()[0]!.pr.state).toBe('merged')
  })

  it('notifications carry the PR link, title and the failing builds', async () => {
    const before = pr()
    const after = pr({
      build: summariseBuilds([build('failed'), build('success', 'visual-tests')]),
      comments: 3,
      unresolvedComments: 1,
    })
    expect(prChanges(before, after)).toEqual([
      {
        type: 'build-finished',
        title: 'Build failed · web-app #42',
        body: 'NM-42: Checkout summary card (web-app #42)\nFailed: web-app » PR-42',
        url: URL42,
      },
      {
        type: 'pr-comment',
        title: '3 new comments · web-app #42',
        body: 'NM-42: Checkout summary card (web-app #42)\n1 open thread',
        url: URL42,
      },
    ])
    expect(prChanges(before, pr({ state: 'declined' }))).toMatchObject([
      { type: 'pr-closed', title: 'Declined' },
    ])
  })

  it('no duplicates after a restart: the last snapshot is persisted', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    const passed = pr({ build: summariseBuilds([build('success')]) })
    t.answers.push(passed)
    await t.watcher.poll()
    expect(titles(t.notified)).toEqual(['build-finished: Build passed · web-app #42'])

    // A new process reads the file and sees the same state: nothing to say.
    const again = t.restart()
    expect(again.list().map((w) => w.key)).toEqual(['web/web-app#42'])
    t.answers.push(passed)
    await again.poll()
    expect(t.notified).toHaveLength(1)
    // …but a real change after the restart is still noticed.
    t.answers.push({ ...passed, ...votes('approved', 'unapproved') })
    await again.poll()
    expect(titles(t.notified.slice(1))).toEqual(['pr-approval: Approved by Priya Reviewer'])
  })

  it('saves the new snapshot before notifying (a crash in between cannot repeat it)', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    const seen: string[] = []
    const watcher = new PrWatcher({
      file: t.file,
      bitbucket: t.bitbucket,
      onChange: vi.fn(),
      notify: () => {
        const saved = JSON.parse(readFileSync(t.file, 'utf8')) as {
          items: { pr: PullRequest }[]
        }
        seen.push(saved.items[0]!.pr.build.state)
      },
    })
    t.answers.push(pr({ build: summariseBuilds([build('success')]) }))
    await watcher.poll()
    expect(seen).toEqual(['success'])
  })

  it('a missing PR is marked on its item; an auth or network failure stops the poll for backoff', async () => {
    const t = setup()
    const other: PrRef = { owner: 'WEB', repo: 'web-app', id: 43 }
    t.answers.push(pr({}, other), pr())
    await t.watcher.add(LINK.replace('/42/', '/43/'))
    await t.watcher.add(LINK)
    // Newest first: #42 is checked first.
    const gone = new ServiceError('not_found', 'Bitbucket returned 404.', { status: 404 })
    t.answers.push(gone, pr({}, other))
    await t.watcher.poll()
    expect(t.watcher.list().map((w) => [w.ref.id, w.error])).toEqual([
      [42, 'Bitbucket returned 404.'],
      [43, null],
    ])

    const auth = new ServiceError('auth', 'Bitbucket rejected the credentials (401).')
    t.answers.push(auth)
    await expect(t.watcher.poll()).rejects.toBe(auth)
    // #43 wasn't tried after the 401.
    expect(t.answers).toHaveLength(0)
    expect(t.bitbucket.pr).toHaveBeenCalledTimes(5)
    expect(t.watcher.list()[0]!.error).toMatch(/401/)
  })

  it('makes no requests with nothing live to watch', async () => {
    const t = setup()
    await t.watcher.poll()
    expect(t.bitbucket.pr).not.toHaveBeenCalled()
  })

  it('refuses bad links, other sites and a full list before asking Bitbucket', async () => {
    const t = setup()
    await expect(t.watcher.add('https://github.com/a/b/pull/1')).rejects.toMatchObject({
      kind: 'invalid',
    })
    await expect(
      t.watcher.add('https://bitbucket.org/acme/web-app/pull-requests/1'),
    ).rejects.toMatchObject({ kind: 'other-site', message: expect.stringContaining(SITE) })
    t.bitbucket.site.mockReturnValueOnce(null)
    await expect(t.watcher.add(LINK)).rejects.toMatchObject({
      kind: 'other-site',
      message: expect.stringMatching(/server URL/),
    })
    expect(t.bitbucket.pr).not.toHaveBeenCalled()

    // Same PR spelled differently (user repo case, context path case): one watch.
    t.answers.push(pr())
    const first = await t.watcher.add(LINK)
    const again = await t.watcher.add(
      `${SITE.toUpperCase().replace('HTTPS', 'https')}/projects/web/repos/WEB-APP/pull-requests/42`,
    )
    expect(again).toBe(first)
    expect(t.bitbucket.pr).toHaveBeenCalledTimes(1)

    for (let id = 100; t.watcher.list().length < 50; id++) {
      t.answers.push(pr({}, { ...REF, id }))
      await t.watcher.add(LINK.replace('/42/', `/${id}/`))
    }
    const full = await t.watcher.add(LINK.replace('/42/', '/999/')).catch((e: unknown) => e)
    expect(full).toBeInstanceOf(WatchError)
    expect(full).toMatchObject({ kind: 'limit' })
  })

  it('watches on another site are kept but not polled while Settings point elsewhere', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    t.bitbucket.site.mockReturnValue('https://bitbucket.org')
    await t.watcher.poll()
    expect(t.bitbucket.pr).toHaveBeenCalledTimes(1)
    expect(t.watcher.list()[0]!.error).toMatch(/different Bitbucket site/)
  })

  it('the user’s own action is absorbed silently; other changes still notify', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    // I (Sam) marked needs work (bitbucket:action) — and meanwhile Priya approved and the
    // build passed. Only my own vote is absorbed.
    const after = pr({
      ...votes('approved', 'needs_work'),
      build: summariseBuilds([build('success')]),
    })
    t.watcher.acknowledge({ pr: after, actor: 'Sam Lead' })
    expect(t.watcher.list()[0]!.pr).toMatchObject({ approvals: 0, needsWork: 1 })
    t.answers.push(after)
    await t.watcher.poll()
    expect(titles(t.notified)).toEqual([
      'build-finished: Build passed · web-app #42',
      'pr-approval: Approved by Priya Reviewer',
    ])
  })

  it('a poll that read the PR before the user acted doesn’t overwrite the acknowledgement', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    // The poll's read is in flight (pre-approval copy) when the approval is acknowledged.
    let release: (p: PullRequest) => void = () => undefined
    t.bitbucket.pr.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const polling = t.watcher.poll()
    const approved = pr(votes('unapproved', 'approved'))
    t.watcher.acknowledge({ pr: approved, actor: 'Sam Lead' })
    release(pr())
    await polling
    expect(t.watcher.list()[0]!.pr.approvals).toBe(1)
    // The next poll sees the approval as already known.
    t.answers.push(approved)
    await t.watcher.poll()
    expect(t.notified).toEqual([])
  })

  it('my own merge is absorbed: no "Merged" notification', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    const merged = pr({ state: 'merged', closedAt: '2026-10-24T12:00:00.000Z' })
    t.watcher.acknowledge({ pr: merged, actor: 'Ada Example' })
    await t.watcher.poll() // merged: not polled any more
    expect(t.notified).toEqual([])
    expect(t.watcher.list()[0]!.pr.state).toBe('merged')
  })

  it('remove forgets it (and persists that); an unreadable file is kept aside', async () => {
    const t = setup()
    t.answers.push(pr())
    await t.watcher.add(LINK)
    t.watcher.remove('web/web-app#42')
    expect(t.restart().list()).toEqual([])
    expect(t.onChange).toHaveBeenCalledTimes(2)

    writeFileSync(t.file, '{ not json')
    expect(t.restart().list()).toEqual([])
    expect(existsSync(`${t.file}.unreadable`)).toBe(true)
  })
})
