import { describe, expect, it } from 'vitest'
import { DEMO_GITHUB_CONFIG, githubHandlers } from '../../src/main/demo/github'
import {
  GitHubClient,
  githubApiRoot,
  githubGraphqlUrl,
  githubRateLimit,
} from '../../src/main/services/github/client'
import {
  buildStatuses,
  checkState,
  repoOfSearchHit,
  reviewersOf,
  runState,
  toJob,
  toPr,
  toRun,
} from '../../src/main/services/github/map'
import { DemoHttpClient } from '../../src/main/services/http'
import { CiActionError } from '../../src/main/services/providers/common'
import { PrActionError } from '../../src/main/services/bitbucket/client'
import { ServiceError } from '../../src/main/services/service-error'
import { ScriptedHttp, json } from '../fixtures/jira'

const NOW = Date.parse('2026-10-26T12:00:00Z')

function demoClient(speed = 1) {
  const http = new DemoHttpClient(githubHandlers({ speed }))
  return new GitHubClient(http, DEMO_GITHUB_CONFIG.config, async () => DEMO_GITHUB_CONFIG.projects)
}

describe('GitHub addresses (P7.05)', () => {
  it('github.com uses api.github.com; Enterprise Server uses /api/v3 and /api/graphql', () => {
    expect(githubApiRoot('https://github.com')).toBe('https://api.github.com')
    expect(githubApiRoot('https://www.github.com/')).toBe('https://api.github.com')
    expect(githubGraphqlUrl('https://github.com')).toBe('https://api.github.com/graphql')
    expect(githubApiRoot('https://git.corp.example/')).toBe('https://git.corp.example/api/v3')
    expect(githubGraphqlUrl('https://git.corp.example')).toBe(
      'https://git.corp.example/api/graphql',
    )
  })
})

describe('GitHub rate limits', () => {
  const res = (status: number, headers: Record<string, string>) =>
    new Response('{}', { status, headers })

  it('primary limit used up: waits until x-ratelimit-reset', () => {
    const err = githubRateLimit(
      res(403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(NOW / 1000 + 90),
        'x-ratelimit-limit': '5000',
      }),
      '',
      NOW,
    )
    expect(err).toMatchObject({ kind: 'rate_limited', retryAfterSec: 90 })
    expect(err!.message).toMatch(/5000 requests an hour/)
  })

  it('secondary limit: Retry-After, or a minute when only the body says so', () => {
    expect(githubRateLimit(res(429, { 'retry-after': '30' }), '', NOW)).toMatchObject({
      retryAfterSec: 30,
    })
    expect(
      githubRateLimit(res(403, {}), '{"message":"You have exceeded a secondary rate limit"}', NOW),
    ).toMatchObject({ retryAfterSec: 60 })
  })

  it('a plain 403 (no access) is not a rate limit', () => {
    expect(githubRateLimit(res(403, { 'x-ratelimit-remaining': '4000' }), '{}', NOW)).toBeNull()
    expect(githubRateLimit(res(404, {}), '', NOW)).toBeNull()
  })
})

describe('GitHub mapping', () => {
  it("each reviewer's latest decision; a dismissed review or a new request undoes it", () => {
    const reviews = [
      { user: { login: 'a' }, state: 'CHANGES_REQUESTED' },
      { user: { login: 'a' }, state: 'COMMENTED' },
      { user: { login: 'b' }, state: 'APPROVED' },
      { user: { login: 'c' }, state: 'APPROVED' },
      { user: { login: 'c' }, state: 'DISMISSED' },
      { user: { login: 'd' }, state: 'APPROVED' },
    ]
    expect(reviewersOf(reviews, [{ login: 'd' }, { login: 'e' }])).toEqual([
      { name: 'a', status: 'needs_work' },
      { name: 'b', status: 'approved' },
      { name: 'c', status: 'unapproved' },
      { name: 'd', status: 'unapproved' },
      { name: 'e', status: 'unapproved' },
    ])
  })

  it('a pull → the PR model (merged, conflicts, comments)', () => {
    const pr = toPr(
      {
        number: 7,
        title: 'Fix',
        html_url: 'https://github.com/acme/web/pull/7',
        state: 'closed',
        merged_at: '2026-10-25T10:00:00Z',
        user: { login: 'me' },
        head: { ref: 'fix', sha: 'abc1234' },
        base: { ref: 'main', repo: { full_name: 'acme/web' } },
        comments: 2,
        review_comments: 3,
        mergeable: false,
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      [],
    )
    expect(pr).toMatchObject({
      key: 'github:acme/web#7',
      ref: { provider: 'github', owner: 'acme', repo: 'web', id: 7 },
      state: 'merged',
      comments: 5,
      conflicts: true,
      closedAt: '2026-10-25T10:00:00Z',
      sourceCommit: 'abc1234',
    })
  })

  it('refuses a pull whose repository is unreadable (it would reach a URL path)', () => {
    expect(() => toPr({ number: 1, base: { repo: { full_name: '../../x' } } }, [])).toThrow(
      ServiceError,
    )
  })

  it('check runs and commit statuses → build statuses; one per name, skipped ones left out', () => {
    expect(checkState('in_progress', null)).toBe('running')
    expect(checkState('completed', 'timed_out')).toBe('failed')
    expect(checkState('completed', 'cancelled')).toBe('stopped')
    const builds = buildStatuses(
      {
        check_runs: [
          { name: 'test', status: 'completed', conclusion: 'failure', html_url: 'u1' },
          { name: 'test', status: 'completed', conclusion: 'success' },
          { name: 'lint', status: 'completed', conclusion: 'weird' },
        ],
      },
      { statuses: [{ context: 'jenkins', state: 'pending', target_url: 'u2' }] },
    )
    expect(builds).toEqual([
      { key: 'check:test', name: 'test', state: 'failed', url: 'u1' },
      { key: 'status:jenkins', name: 'jenkins', state: 'running', url: 'u2' },
    ])
  })

  it('Actions status + conclusion → CI state', () => {
    expect(runState('queued', null)).toBe('queued')
    expect(runState('waiting', null)).toBe('manual')
    expect(runState('in_progress', null)).toBe('running')
    expect(runState('completed', 'success')).toBe('success')
    expect(runState('completed', 'cancelled')).toBe('cancelled')
    expect(runState('completed', 'skipped')).toBe('skipped')
    expect(runState('completed', 'timed_out')).toBe('failed')
    expect(runState('completed', 'action_required')).toBe('manual')
  })

  it('a workflow run → CiRun (duration only once finished; bad ids refused)', () => {
    const run = toRun(
      {
        id: 99,
        name: 'CI',
        run_number: 12,
        run_attempt: 2,
        event: 'push',
        head_branch: 'main',
        head_sha: 'abc',
        display_title: 'First line\nsecond',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/acme/web/actions/runs/99',
        created_at: '2026-10-26T10:00:00Z',
        run_started_at: '2026-10-26T10:00:10Z',
        updated_at: '2026-10-26T10:05:10Z',
        triggering_actor: { login: 'me' },
      },
      'acme/web',
    )
    expect(run).toMatchObject({
      key: 'github:acme/web@99',
      state: 'failed',
      number: 12,
      attempt: 2,
      title: 'First line',
      actor: 'me',
      durationMs: 300_000,
    })
    expect(toRun({ id: 5, status: 'in_progress' }, 'acme/web').durationMs).toBeNull()
    expect(() => toRun({ id: -1 }, 'acme/web')).toThrow(ServiceError)
  })

  it('jobs keep their steps; a job without an id is dropped', () => {
    const job = toJob({
      id: 3,
      name: 'test',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-10-26T10:00:00Z',
      completed_at: '2026-10-26T10:01:00Z',
      steps: [
        { name: 'Set up job', status: 'completed', conclusion: 'success', number: 1 },
        { name: 'Run', status: 'completed', conclusion: 'failure', number: 2 },
      ],
    })
    expect(job).toMatchObject({ id: 3, state: 'failed', durationMs: 60_000, stage: null })
    expect(job!.steps.map((s) => s.state)).toEqual(['success', 'failed'])
    expect(toJob({ name: 'x' })).toBeNull()
  })

  it('search hits name their repository', () => {
    expect(
      repoOfSearchHit({ number: 4, repository_url: 'https://api.github.com/repos/acme/web' }),
    ).toEqual({ owner: 'acme', repo: 'web', number: 4 })
    expect(repoOfSearchHit({ number: 4, repository_url: 'nope' })).toBeNull()
  })
})

describe('GitHubClient against the demo GitHub', () => {
  it('Test connection says who and which Enterprise version', async () => {
    const c = await demoClient().testConnection()
    expect(c).toMatchObject({
      user: { displayName: 'Demo Developer', account: 'demo-dev' },
      version: '3.14.2',
      scopes: 'repo, workflow',
    })
  })

  it('lists: mine, reviewing (asked or reviewed), merged; with builds', async () => {
    const client = demoClient()
    const mine = await client.list('mine')
    expect(mine.map((p) => p.key).sort()).toEqual([
      'github:acme/payments-api#57',
      'github:acme/storefront#128',
      'github:acme/storefront#131',
    ])
    const failing = mine.find((p) => p.ref.id === 131)!
    expect(failing.build.state).toBe('failed')
    expect(failing.reviewers).toEqual([
      { name: 'sam-lead', status: 'needs_work' },
      { name: 'priya-r', status: 'unapproved' },
    ])
    expect((await client.list('reviewing')).map((p) => p.ref.id).sort()).toEqual([133, 54])
    expect((await client.list('merged')).map((p) => p.state)).toEqual(['merged'])
  })

  it('one PR counts unresolved review threads (GraphQL)', async () => {
    const pr = await demoClient().pr({
      provider: 'github',
      owner: 'acme',
      repo: 'storefront',
      id: 131,
    })
    expect(pr.unresolvedComments).toBe(2)
  })

  it('approve sends a review; merge checks the typed target and uses an allowed method', async () => {
    const client = demoClient()
    const theirs = { provider: 'github' as const, owner: 'acme', repo: 'storefront', id: 133 }
    const approved = await client.act(theirs, 'approve', undefined)
    expect(approved.actor).toBe('demo-dev')
    expect(approved.pr.reviewers).toContainEqual({ name: 'demo-dev', status: 'approved' })

    const mine = { provider: 'github' as const, owner: 'acme', repo: 'storefront', id: 128 }
    await expect(client.act(mine, 'merge', 'develop')).rejects.toBeInstanceOf(PrActionError)
    // The demo repo refuses merge commits: the client picks squash.
    const merged = await client.act(mine, 'merge', 'main')
    expect(merged.pr.state).toBe('merged')
    await expect(client.act(mine, 'approve', undefined)).rejects.toThrow(/already merged/)
  })

  it("GitHub's own words are shown when it refuses", async () => {
    const own = { provider: 'github' as const, owner: 'acme', repo: 'storefront', id: 131 }
    await expect(demoClient().act(own, 'approve', undefined)).rejects.toThrow(
      /GitHub said: “Unprocessable Entity: Can not approve your own pull request”/,
    )
  })

  it('runs for my repos, newest first; detail with jobs and steps', async () => {
    const client = demoClient()
    const { runs, projects, notes } = await client.runs()
    expect(projects).toEqual(DEMO_GITHUB_CONFIG.projects)
    expect(notes).toEqual([])
    expect(runs[0]!.ref).toEqual({ provider: 'github', project: 'acme/payments-api', id: 9101 })
    expect(runs.map((r) => r.state)).toContain('failed')
    const detail = await client.run({ provider: 'github', project: 'acme/storefront', id: 9002 })
    expect(detail.jobs.map((j) => [j.name, j.state])).toEqual([
      ['build', 'success'],
      ['test', 'failed'],
    ])
    expect(detail.jobs[1]!.steps.find((s) => s.state === 'failed')?.name).toBe('Run unit tests')
  })

  it('the log tail follows the storage redirect without the token, colours removed', async () => {
    const log = await demoClient().log(
      { provider: 'github', project: 'acme/storefront', id: 9002 },
      70022,
    )
    expect(log.truncated).toBe(false)
    expect(log.text).toMatch(/Process completed with exit code 1/)
    expect(log.text).not.toContain(String.fromCharCode(27))
  })

  it('re-run only a failed run; cancel only a running one', async () => {
    const client = demoClient()
    const failed = { provider: 'github' as const, project: 'acme/storefront', id: 9002 }
    const running = { provider: 'github' as const, project: 'acme/payments-api', id: 9101 }
    await expect(client.ciAct(failed, 'cancel')).rejects.toBeInstanceOf(CiActionError)
    const rerun = await client.ciAct(failed, 'retry')
    expect(rerun).toMatchObject({ state: 'running', attempt: 2 })
    await expect(client.ciAct(running, 'retry')).rejects.toBeInstanceOf(CiActionError)
    expect((await client.ciAct(running, 'cancel')).state).toBe('cancelled')
  })

  it('a repo without Actions access is a note, not a failed list', async () => {
    const http = new ScriptedHttp([
      (r) => (new URL(r.url).pathname === '/user' ? json({ login: 'me' }) : undefined),
      (r) =>
        r.url.includes('/repos/acme/secret/')
          ? json({ message: 'Not Found' }, { status: 404 })
          : undefined,
      (r) => (r.url.includes('/actions/runs') ? json({ workflow_runs: [] }) : undefined),
    ])
    const client = new GitHubClient(
      http,
      { baseUrl: 'https://github.com', token: 't' },
      async () => ['acme/secret', 'acme/web'],
    )
    const result = await client.runs()
    expect(result.notes).toEqual(['acme/secret: not found, or the token has no access'])
    expect(http.requests.every((r) => r.headers.get('authorization') === 'Bearer t')).toBe(true)
    expect(http.requests[0]!.headers.get('x-github-api-version')).toBe('2022-11-28')
  })
})
