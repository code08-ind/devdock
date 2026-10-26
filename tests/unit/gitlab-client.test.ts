import { describe, expect, it } from 'vitest'
import { DEMO_GITLAB_CONFIG, gitlabHandlers } from '../../src/main/demo/gitlab'
import { GitLabClient, gitlabApiRoot, gitlabRateLimit } from '../../src/main/services/gitlab/client'
import {
  glState,
  pipelineStatus,
  projectOf,
  toGlJob,
  toMr,
  toPipeline,
  unresolvedThreads,
} from '../../src/main/services/gitlab/map'
import { DemoHttpClient } from '../../src/main/services/http'
import { CiActionError } from '../../src/main/services/providers/common'
import { PrActionError } from '../../src/main/services/bitbucket/client'
import { ScriptedHttp, json } from '../fixtures/jira'

const NOW = Date.parse('2026-10-26T12:00:00Z')

function demoClient() {
  const http = new DemoHttpClient(gitlabHandlers())
  return new GitLabClient(http, DEMO_GITLAB_CONFIG.config, async () => DEMO_GITLAB_CONFIG.projects)
}

describe('GitLab addresses and rate limits (P7.06)', () => {
  it('REST v4 under the site, relative URL root kept', () => {
    expect(gitlabApiRoot('https://gitlab.com/')).toBe('https://gitlab.com/api/v4')
    expect(gitlabApiRoot('https://corp.example/gitlab')).toBe('https://corp.example/gitlab/api/v4')
  })

  it('429: Retry-After first, then RateLimit-Reset, else a minute; other codes are not limits', () => {
    const r = (headers: Record<string, string>, status = 429) =>
      new Response('', { status, headers })
    expect(gitlabRateLimit(r({ 'retry-after': '12' }), '', NOW)).toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 12,
    })
    expect(
      gitlabRateLimit(r({ 'ratelimit-reset': String(NOW / 1000 + 300) }), '', NOW),
    ).toMatchObject({ retryAfterSec: 300 })
    expect(gitlabRateLimit(r({}), '', NOW)).toMatchObject({ retryAfterSec: 60 })
    expect(gitlabRateLimit(r({}, 403), '', NOW)).toBeNull()
  })
})

describe('GitLab mapping', () => {
  it('the project comes from references.full, else web_url without the relative root', () => {
    expect(projectOf({ references: { full: 'a/b/c!3' } })).toBe('a/b/c')
    expect(
      projectOf({ web_url: 'https://corp.example/gitlab/a/b/-/merge_requests/3' }, 'gitlab'),
    ).toBe('a/b')
  })

  it('an MR → the PR model: subgroup namespace, `!` label, approvals as reviewers', () => {
    const pr = toMr(
      {
        iid: 12,
        title: 'Thing',
        state: 'opened',
        references: { full: 'acme/web/checkout!12' },
        web_url: 'https://gitlab.com/acme/web/checkout/-/merge_requests/12',
        author: { username: 'me' },
        source_branch: 'feat',
        target_branch: 'main',
        reviewers: [{ username: 'a' }, { username: 'b' }],
        user_notes_count: 4,
        has_conflicts: true,
        sha: 'abc',
      },
      { approved_by: [{ user: { username: 'b' } }, { user: { username: 'lead' } }] },
    )
    expect(pr).toMatchObject({
      key: 'gitlab:acme/web/checkout#12',
      ref: { provider: 'gitlab', owner: 'acme/web', repo: 'checkout', id: 12 },
      state: 'open',
      conflicts: true,
      approvals: 2,
    })
    expect(pr.reviewers).toEqual([
      { name: 'a', status: 'unapproved' },
      { name: 'b', status: 'approved' },
      { name: 'lead', status: 'approved' },
    ])
  })

  it('pipeline and job statuses → CI states; head pipeline → the build pill', () => {
    expect(glState('canceled')).toBe('cancelled')
    expect(glState('manual')).toBe('manual')
    expect(glState('waiting_for_resource')).toBe('queued')
    expect(pipelineStatus({ head_pipeline: { id: 5, status: 'running', web_url: 'u' } })).toEqual([
      { key: 'pipeline', name: 'Pipeline #5', state: 'running', url: 'u' },
    ])
    expect(pipelineStatus({})).toEqual([])
  })

  it('open threads: discussions with an unresolved resolvable note', () => {
    expect(
      unresolvedThreads([
        { notes: [{ resolvable: true, resolved: false }] },
        { notes: [{ resolvable: true, resolved: true }] },
        { notes: [{ resolvable: false }] },
      ]),
    ).toBe(1)
  })

  it('pipelines and jobs: duration in seconds → ms; bad ids refused', () => {
    expect(
      toPipeline(
        { id: 9, iid: 3, status: 'success', duration: 61, ref: 'main', source: 'push' },
        'a/b',
      ),
    ).toMatchObject({ key: 'gitlab:a/b@9', number: 3, durationMs: 61_000, event: 'push' })
    expect(() => toPipeline({ id: 'x' }, 'a/b')).toThrow()
    expect(
      toGlJob({ id: 4, name: 'unit', stage: 'test', status: 'failed', duration: 1.5 }),
    ).toEqual(
      expect.objectContaining({ stage: 'test', state: 'failed', durationMs: 1500, steps: [] }),
    )
    expect(toGlJob({})).toBeNull()
  })
})

describe('GitLabClient against the demo GitLab', () => {
  it('Test connection says who and the server version', async () => {
    expect(await demoClient().testConnection()).toMatchObject({
      user: { displayName: 'Demo Developer', account: 'demo-dev' },
      version: '17.5.1-ee',
      scopes: null,
    })
  })

  it('lists: mine, reviewing (not my own), merged', async () => {
    const client = demoClient()
    expect((await client.list('mine')).map((p) => p.key).sort()).toEqual([
      'gitlab:acme/web/checkout#42',
      'gitlab:acme/web/checkout#45',
    ])
    const reviewing = await client.list('reviewing')
    expect(reviewing.map((p) => p.key)).toEqual(['gitlab:acme/infra-tools#17'])
    expect(reviewing[0]!.build.state).toBe('running')
    expect((await client.list('merged')).map((p) => p.ref.id)).toEqual([39])
  })

  it('one MR counts open threads', async () => {
    const pr = await demoClient().pr({
      provider: 'gitlab',
      owner: 'acme/web',
      repo: 'checkout',
      id: 45,
    })
    expect(pr.unresolvedComments).toBe(1)
    expect(pr.build.state).toBe('failed')
  })

  it('approve and a typed merge; request changes is refused (no API for it)', async () => {
    const client = demoClient()
    const theirs = { provider: 'gitlab' as const, owner: 'acme', repo: 'infra-tools', id: 17 }
    const approved = await client.act(theirs, 'approve', undefined)
    expect(approved.pr.reviewers).toContainEqual({ name: 'demo-dev', status: 'approved' })
    await expect(client.act(theirs, 'needs_work', undefined)).rejects.toThrow(/request changes/)

    const mine = { provider: 'gitlab' as const, owner: 'acme/web', repo: 'checkout', id: 42 }
    await expect(client.act(mine, 'merge', 'develop')).rejects.toBeInstanceOf(PrActionError)
    expect((await client.act(mine, 'merge', 'main')).pr.state).toBe('merged')
  })

  it("GitLab's own words when it refuses (merge with a failed pipeline)", async () => {
    const mine = { provider: 'gitlab' as const, owner: 'acme/web', repo: 'checkout', id: 45 }
    await expect(demoClient().act(mine, 'merge', 'main')).rejects.toThrow(
      /GitLab said: “405 Method Not Allowed”/,
    )
  })

  it('pipelines for my projects; jobs with stages; the trace tail', async () => {
    const client = demoClient()
    const { runs, notes } = await client.runs()
    expect(notes).toEqual([])
    expect(runs.map((r) => r.key)).toContain('gitlab:acme/web/checkout@5002')
    const ref = { provider: 'gitlab' as const, project: 'acme/web/checkout', id: 5002 }
    const detail = await client.run(ref)
    expect(detail.jobs.map((j) => `${j.stage}/${j.name}:${j.state}`)).toEqual([
      'build/install:success',
      'test/unit:success',
      'test/e2e:failed',
    ])
    const log = await client.log(ref, 80023)
    expect(log.text).toMatch(/Job failed: exit code 1/)
    expect(log.text).not.toContain(String.fromCharCode(27))
  })

  it('retry a failed pipeline; cancel a running one; not the other way round', async () => {
    const client = demoClient()
    const failed = { provider: 'gitlab' as const, project: 'acme/web/checkout', id: 5002 }
    const running = { provider: 'gitlab' as const, project: 'acme/infra-tools', id: 5101 }
    await expect(client.ciAct(failed, 'cancel')).rejects.toBeInstanceOf(CiActionError)
    expect((await client.ciAct(failed, 'retry')).state).toBe('running')
    await expect(client.ciAct(running, 'retry')).rejects.toBeInstanceOf(CiActionError)
    expect((await client.ciAct(running, 'cancel')).state).toBe('cancelled')
  })

  it('project paths are one encoded segment (subgroups included)', async () => {
    const http = new ScriptedHttp([
      (r) =>
        new URL(r.url).pathname.endsWith('/user') ? json({ id: 1, username: 'me' }) : undefined,
      (r) => (r.url.includes('/pipelines') ? json([]) : undefined),
    ])
    const client = new GitLabClient(
      http,
      { baseUrl: 'https://corp.example/gitlab', token: 't' },
      async () => ['acme/web/checkout'],
    )
    await client.runs()
    expect(http.requests.map((r) => r.url)).toContain(
      'https://corp.example/gitlab/api/v4/projects/acme%2Fweb%2Fcheckout/pipelines?username=me&order_by=id&sort=desc&per_page=10',
    )
  })
})
