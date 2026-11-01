import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PullRequest } from '../../src/shared/bitbucket'
import { issueKeyIn, sameStatusName } from '../../src/shared/jira'

vi.mock('electron', () => ({}))
const { TicketMoves } = await import('../../src/main/services/ticket-moves')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const pr = (id: number, branch: string, over: Partial<PullRequest> = {}): PullRequest =>
  ({
    key: `bitbucket|bitbucket.org|team/web-app|${id}`,
    ref: { provider: 'bitbucket', site: 'bitbucket.org', workspace: 'team', repo: 'web-app', id },
    title: `PR ${id}`,
    sourceBranch: branch,
    state: 'open',
    ...over,
  }) as unknown as PullRequest

function setup(opts: { on?: boolean; jira?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'devdock-moves-'))
  dirs.push(dir)
  let prs: PullRequest[] = [pr(1, 'feature/DD-1-old')]
  const workflow = { moveTicketOnPr: opts.on ?? true, prOpenedStatus: 'In Review' }
  const transitionToStatus = vi.fn(async () => 'done' as const)
  const notify = vi.fn()
  const onChange = vi.fn()
  const deps = {
    file: join(dir, 'moves.json'),
    settings: () => ({ workflow }) as never,
    jiraReady: () => opts.jira ?? true,
    myPrs: async () => prs,
    jira: { transitionToStatus },
    notify,
    onChange,
  }
  return {
    moves: new TicketMoves(deps),
    deps,
    setPrs: (next: PullRequest[]) => (prs = next),
    workflow,
    transitionToStatus,
    notify,
  }
}

describe('Jira keys and status names', () => {
  it('finds the first upper-case key in a branch or title', () => {
    expect(issueKeyIn('bugfix/DD-101-date-picker-focus')).toBe('DD-101')
    expect(issueKeyIn('DD-102: Checkout summary')).toBe('DD-102')
    expect(issueKeyIn('feature/NM_X-7')).toBe('NM_X-7')
    for (const none of ['release-1', 'node-18-upgrade', 'feature/dd-101', 'chore/bump'])
      expect(issueKeyIn(none), none).toBeNull()
  })

  it('compares status names ignoring case and spacing', () => {
    expect(sameStatusName(' In  review ', 'In Review')).toBe(true)
    expect(sameStatusName('In Progress', 'In Review')).toBe(false)
  })
})

describe('move the ticket when a PR opens (T5d)', () => {
  it('the first poll only records the open PRs; a new one with a key becomes an offer', async () => {
    const { moves, setPrs, notify } = setup()
    await moves.poll()
    expect(moves.list()).toEqual([])
    expect(notify).not.toHaveBeenCalled()

    setPrs([pr(1, 'feature/DD-1-old'), pr(2, 'bugfix/DD-101-focus'), pr(3, 'chore/no-key')])
    await moves.poll()
    expect(moves.list()).toMatchObject([
      { prKey: pr(2, '').key, prLabel: 'web-app #2', key: 'DD-101', status: 'In Review' },
    ])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pr-opened',
        title: 'web-app #2 opened for DD-101',
        view: 'today',
      }),
    )
    // Seen now: no second offer or notification.
    await moves.poll()
    expect(moves.list()).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('takes the key from the title when the branch has none; ignores PRs that are not open', async () => {
    const { moves, setPrs } = setup()
    await moves.poll()
    setPrs([
      pr(4, 'fix-thing', { title: 'NM-9: fix it' }),
      pr(5, 'feature/DD-5', { state: 'merged' }),
    ])
    await moves.poll()
    expect(moves.list().map((o) => o.key)).toEqual(['NM-9'])
  })

  it('off (or Jira not set up): nothing is offered, and turning it on starts fresh', async () => {
    for (const opts of [{ on: false }, { jira: false }]) {
      const { moves, setPrs, notify } = setup(opts)
      await moves.poll()
      setPrs([pr(2, 'bugfix/DD-101-focus')])
      await moves.poll()
      expect(moves.list()).toEqual([])
      expect(notify).not.toHaveBeenCalled()
    }
    const { moves, setPrs, workflow, notify } = setup()
    await moves.poll()
    setPrs([pr(2, 'bugfix/DD-101-focus')])
    await moves.poll()
    expect(moves.list()).toHaveLength(1)
    workflow.moveTicketOnPr = false
    await moves.poll()
    expect(moves.list()).toEqual([])
    // On again: PR 2 (already open) is recorded, not offered.
    workflow.moveTicketOnPr = true
    await moves.poll()
    expect(moves.list()).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('accept moves the ticket to the status offered, then drops the offer; dismiss drops it', async () => {
    const { moves, setPrs, transitionToStatus } = setup()
    await moves.poll()
    setPrs([pr(2, 'bugfix/DD-101-focus'), pr(3, 'feature/DD-102-card')])
    await moves.poll()
    expect(await moves.accept(pr(2, '').key)).toEqual({
      result: 'done',
      message: 'Moved DD-101 to In Review',
    })
    expect(transitionToStatus).toHaveBeenCalledWith('DD-101', 'In Review')
    transitionToStatus.mockResolvedValueOnce('unavailable' as never)
    expect((await moves.accept(pr(3, '').key)).message).toMatch(/has no "In Review" transition/)
    expect(moves.list()).toEqual([])
    await expect(moves.accept('nope')).rejects.toThrow(/Nothing was changed in Jira/)
    expect(transitionToStatus).toHaveBeenCalledTimes(2)
  })

  it('offers and what was seen survive a restart', async () => {
    const { moves, setPrs, deps } = setup()
    await moves.poll()
    setPrs([pr(2, 'bugfix/DD-101-focus')])
    await moves.poll()
    const again = new TicketMoves(deps)
    expect(again.list().map((o) => o.key)).toEqual(['DD-101'])
    await again.poll()
    expect(again.list()).toHaveLength(1)
    again.dismiss(pr(2, '').key)
    expect(new TicketMoves(deps).list()).toEqual([])
  })
})
