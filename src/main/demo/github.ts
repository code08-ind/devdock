import { http, HttpResponse, type RequestHandler } from 'msw'
import { demoDescription, demoFiles } from './changes'
import type { HostConfig } from '../services/providers/service'
import { DEMO_GITHUB } from './origin'

/**
 * Demo GitHub (P7.05), in the GitHub Enterprise Server shape (`/api/v3`): my PRs in mixed
 * states, two to review, one merged this week, and Actions runs — one passing, one failing
 * (re-run makes it pass), one running that finishes on the demo clock. Times are relative to
 * when the handlers were made.
 */
export const DEMO_GITHUB_CONFIG: { config: HostConfig; projects: string[] } = {
  config: { baseUrl: DEMO_GITHUB, token: 'demo' },
  projects: ['acme/storefront', 'acme/payments-api'],
}

const API = `${DEMO_GITHUB}/api/v3`
const ME = { login: 'demo-dev', name: 'Demo Developer', id: 1001 }
const MIN = 60_000
const HOUR = 60 * MIN

type Review = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
type Check = 'success' | 'failure' | 'running'

interface DemoPr {
  number: number
  repo: string
  title: string
  head: string
  base: string
  author: string
  state: 'open' | 'merged'
  /** Hours ago. */
  created: number
  updated: number
  reviews: [string, Review][]
  requested: string[]
  comments: number
  reviewComments: number
  unresolved: number
  mergeable: boolean
  checks: [string, Check][]
  /** A running check passes this many demo minutes after start. */
  passesAfterMin?: number
}

const PRS: DemoPr[] = [
  {
    number: 128,
    repo: 'storefront',
    title: 'DD-104: Lazy-load product images below the fold',
    head: 'feature/DD-104-lazy-images',
    base: 'main',
    author: ME.login,
    state: 'open',
    created: 30,
    updated: 1,
    reviews: [['priya-r', 'APPROVED']],
    requested: [],
    comments: 1,
    reviewComments: 2,
    unresolved: 0,
    mergeable: true,
    checks: [
      ['CI / build', 'success'],
      ['CI / test', 'success'],
    ],
  },
  {
    number: 131,
    repo: 'storefront',
    title: 'DD-105: Cart badge shows one item too many',
    head: 'bugfix/DD-105-cart-badge',
    base: 'main',
    author: ME.login,
    state: 'open',
    created: 18,
    updated: 2,
    reviews: [['sam-lead', 'CHANGES_REQUESTED']],
    requested: ['priya-r'],
    comments: 3,
    reviewComments: 4,
    unresolved: 2,
    mergeable: true,
    checks: [
      ['CI / build', 'success'],
      ['CI / test', 'failure'],
    ],
  },
  {
    number: 57,
    repo: 'payments-api',
    title: 'Retry webhook deliveries with exponential backoff',
    head: 'feature/webhook-retries',
    base: 'main',
    author: ME.login,
    state: 'open',
    created: 6,
    updated: 0.2,
    reviews: [],
    requested: ['sam-lead'],
    comments: 0,
    reviewComments: 0,
    unresolved: 0,
    mergeable: false,
    checks: [['CI / test', 'running']],
    passesAfterMin: 3,
  },
  {
    number: 133,
    repo: 'storefront',
    title: 'Upgrade to React Router 7',
    head: 'chore/react-router-7',
    base: 'main',
    author: 'alex-d',
    state: 'open',
    created: 40,
    updated: 4,
    reviews: [],
    requested: [ME.login],
    comments: 2,
    reviewComments: 0,
    unresolved: 0,
    mergeable: true,
    checks: [['CI / test', 'success']],
  },
  {
    number: 54,
    repo: 'payments-api',
    title: 'Add idempotency keys to refunds',
    head: 'feature/refund-idempotency',
    base: 'main',
    author: 'priya-r',
    state: 'open',
    created: 50,
    updated: 5,
    reviews: [[ME.login, 'COMMENTED']],
    requested: [],
    comments: 5,
    reviewComments: 6,
    unresolved: 1,
    mergeable: true,
    checks: [['CI / test', 'success']],
  },
  {
    number: 120,
    repo: 'storefront',
    title: 'DD-099: Round currency totals per line, not per order',
    head: 'bugfix/DD-099-currency-rounding',
    base: 'main',
    author: ME.login,
    state: 'merged',
    created: 80,
    updated: 48,
    reviews: [['sam-lead', 'APPROVED']],
    requested: [],
    comments: 2,
    reviewComments: 1,
    unresolved: 0,
    mergeable: true,
    checks: [['CI / test', 'success']],
  },
]

interface DemoStep {
  name: string
  fails?: boolean
}
interface DemoJob {
  id: number
  name: string
  steps: DemoStep[]
}
interface DemoRun {
  id: number
  repo: string
  name: string
  number: number
  event: 'push' | 'pull_request'
  branch: string
  title: string
  /** Minutes before the demo started. */
  agoMin: number
  /** How long it takes, in demo minutes. */
  takesMin: number
  /** Ends failed (until re-run). */
  fails: boolean
  jobs: DemoJob[]
  attempt?: number
  /** Demo minute a re-run started; it then passes. */
  rerunAt?: number
  cancelledAt?: number
}

const RUNS: DemoRun[] = [
  {
    id: 9001,
    repo: 'storefront',
    name: 'CI',
    number: 342,
    event: 'pull_request',
    branch: 'feature/DD-104-lazy-images',
    title: 'Lazy-load product images below the fold',
    agoMin: 70,
    takesMin: 6,
    fails: false,
    jobs: [
      {
        id: 70011,
        name: 'build',
        steps: [{ name: 'Set up job' }, { name: 'Install' }, { name: 'Build' }],
      },
      { id: 70012, name: 'test', steps: [{ name: 'Set up job' }, { name: 'Run unit tests' }] },
    ],
  },
  {
    id: 9002,
    repo: 'storefront',
    name: 'CI',
    number: 345,
    event: 'pull_request',
    branch: 'bugfix/DD-105-cart-badge',
    title: 'Cart badge shows one item too many',
    agoMin: 130,
    takesMin: 5,
    fails: true,
    jobs: [
      {
        id: 70021,
        name: 'build',
        steps: [{ name: 'Set up job' }, { name: 'Install' }, { name: 'Build' }],
      },
      {
        id: 70022,
        name: 'test',
        steps: [
          { name: 'Set up job' },
          { name: 'Run unit tests', fails: true },
          { name: 'Upload coverage' },
        ],
      },
    ],
  },
  {
    id: 9101,
    repo: 'payments-api',
    name: 'CI',
    number: 88,
    event: 'push',
    branch: 'feature/webhook-retries',
    title: 'Retry webhook deliveries with exponential backoff',
    agoMin: 1,
    takesMin: 4,
    fails: false,
    jobs: [
      { id: 71011, name: 'lint', steps: [{ name: 'Set up job' }, { name: 'golangci-lint' }] },
      { id: 71012, name: 'test', steps: [{ name: 'Set up job' }, { name: 'go test ./...' }] },
    ],
  },
  {
    id: 9003,
    repo: 'storefront',
    name: 'Deploy preview',
    number: 61,
    event: 'push',
    branch: 'feature/DD-104-lazy-images',
    title: 'Lazy-load product images below the fold',
    agoMin: 65,
    takesMin: 3,
    fails: false,
    jobs: [
      {
        id: 70031,
        name: 'deploy-preview',
        steps: [{ name: 'Set up job' }, { name: 'Deploy to preview' }],
      },
    ],
  },
]

const sha = (seed: string) => {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h.toString(16).padStart(8, '0') + 'a1b2c3d4e5f60718293a4b5c6d7e8f90').slice(0, 40)
}
const iso = (ms: number) => new Date(ms).toISOString()
const repoJson = (repo: string) => ({
  id: repo.length,
  name: repo,
  full_name: `acme/${repo}`,
  owner: { login: 'acme' },
  allow_merge_commit: false,
  allow_squash_merge: true,
  allow_rebase_merge: true,
})
const refused = (status: number, message: string) =>
  HttpResponse.json({ message, documentation_url: 'https://docs.github.com/rest' }, { status })

const authed = (request: Request) => /^Bearer .+/.test(request.headers.get('authorization') ?? '')

/** Fresh state per call: each app (or test) gets its own clock and PRs. */
export function githubHandlers({ speed = 1 }: { speed?: number } = {}): RequestHandler[] {
  const startedAt = Date.now()
  const demoMin = () => ((Date.now() - startedAt) * speed) / MIN
  const prs: DemoPr[] = structuredClone(PRS)
  const runs: DemoRun[] = structuredClone(RUNS)
  const find = (repo: unknown, n: unknown) =>
    prs.find((p) => p.repo === repo && p.number === Number(n))

  const checkState = (pr: DemoPr, c: Check): Check =>
    c === 'running' && pr.passesAfterMin !== undefined && demoMin() >= pr.passesAfterMin
      ? 'success'
      : c

  const pullJson = (pr: DemoPr) => {
    const now = Date.now()
    return {
      number: pr.number,
      title: pr.title,
      body: demoDescription(pr.title),
      changed_files: demoFiles(pr.title).length,
      html_url: `${DEMO_GITHUB}/acme/${pr.repo}/pull/${pr.number}`,
      state: pr.state === 'open' ? 'open' : 'closed',
      user: { login: pr.author },
      head: { ref: pr.head, sha: sha(`${pr.repo}${pr.number}${pr.head}`), repo: repoJson(pr.repo) },
      base: { ref: pr.base, repo: repoJson(pr.repo) },
      requested_reviewers: pr.requested.map((login) => ({ login })),
      comments: pr.comments,
      review_comments: pr.reviewComments,
      mergeable: pr.state === 'open' ? pr.mergeable : null,
      mergeable_state: pr.state !== 'open' ? 'unknown' : pr.mergeable ? 'clean' : 'dirty',
      draft: false,
      created_at: iso(now - pr.created * HOUR),
      updated_at: iso(now - pr.updated * HOUR),
      closed_at: pr.state === 'merged' ? iso(now - pr.updated * HOUR) : null,
      merged_at: pr.state === 'merged' ? iso(now - pr.updated * HOUR) : null,
    }
  }

  /** Where a run is on the demo clock. */
  const runTimes = (run: DemoRun) => {
    const startMin = run.rerunAt ?? -run.agoMin
    const endMin = startMin + run.takesMin
    const t = demoMin()
    const done = run.cancelledAt !== undefined || t >= endMin
    const failed = run.fails && run.rerunAt === undefined
    return { startMin, endMin: run.cancelledAt ?? endMin, done, failed, t }
  }
  const at = (demoMinute: number) => startedAt + (demoMinute * MIN) / speed
  const runJson = (run: DemoRun) => {
    const { startMin, endMin, done, failed } = runTimes(run)
    return {
      id: run.id,
      name: run.name,
      run_number: run.number,
      run_attempt: run.attempt ?? 1,
      event: run.event,
      head_branch: run.branch,
      head_sha: sha(`${run.repo}${run.branch}`),
      display_title: run.title,
      status: done ? 'completed' : 'in_progress',
      conclusion: !done
        ? null
        : run.cancelledAt !== undefined
          ? 'cancelled'
          : failed
            ? 'failure'
            : 'success',
      html_url: `${DEMO_GITHUB}/acme/${run.repo}/actions/runs/${run.id}`,
      created_at: iso(at(startMin)),
      run_started_at: iso(at(startMin)),
      updated_at: iso(done ? at(endMin) : Date.now()),
      actor: { login: ME.login },
      triggering_actor: { login: ME.login },
      repository: repoJson(run.repo),
    }
  }
  const jobJson = (run: DemoRun, job: DemoJob, index: number) => {
    const { startMin, endMin, done, failed, t } = runTimes(run)
    const slice = (endMin - startMin) / run.jobs.length
    const jobStart = startMin + slice * index
    const jobEnd = jobStart + slice
    const jobDone = done || t >= jobEnd
    const jobRunning = !jobDone && t >= jobStart
    const jobFails = failed && job.steps.some((s) => s.fails)
    return {
      id: job.id,
      run_id: run.id,
      name: job.name,
      status: jobDone ? 'completed' : jobRunning ? 'in_progress' : 'queued',
      conclusion: !jobDone
        ? null
        : run.cancelledAt !== undefined && !jobFails && t < jobEnd
          ? 'cancelled'
          : jobFails
            ? 'failure'
            : 'success',
      html_url: `${DEMO_GITHUB}/acme/${run.repo}/actions/runs/${run.id}/job/${job.id}`,
      started_at: jobRunning || jobDone ? iso(at(jobStart)) : null,
      completed_at: jobDone ? iso(at(jobEnd)) : null,
      steps: job.steps.map((s, i) => ({
        name: s.name,
        number: i + 1,
        status: jobDone ? 'completed' : jobRunning && i === 0 ? 'in_progress' : 'queued',
        conclusion: jobDone ? (failed && s.fails ? 'failure' : 'success') : null,
      })),
    }
  }
  const findRun = (repo: unknown, id: unknown) =>
    runs.find((r) => r.repo === repo && r.id === Number(id))

  const logFor = (run: DemoRun, job: DemoJob) => {
    const { failed } = runTimes(run)
    const lines = [
      `2026-10-26T09:00:00.0000000Z ##[group]Run ${job.steps[1]?.name ?? job.name}`,
      ...Array.from(
        { length: 40 },
        (_, i) =>
          `2026-10-26T09:00:${String(i).padStart(2, '0')}.0000000Z \u001b[36minfo\u001b[0m step output line ${i + 1}`,
      ),
    ]
    if (failed && job.steps.some((s) => s.fails)) {
      lines.push(
        '2026-10-26T09:01:10.0000000Z  FAIL  src/cart/Badge.test.tsx',
        '2026-10-26T09:01:10.0000000Z   ● CartBadge › counts each line item once',
        '2026-10-26T09:01:10.0000000Z     Expected: 2',
        '2026-10-26T09:01:10.0000000Z     Received: 3',
        '2026-10-26T09:01:11.0000000Z ##[error]Process completed with exit code 1.',
      )
    } else {
      lines.push('2026-10-26T09:01:10.0000000Z \u001b[32m✓\u001b[0m all checks passed')
    }
    return lines.join('\n')
  }

  return [
    http.all(`${API}/*`, ({ request }) => {
      // Every API call needs the token (demo token is "demo"); MSW tries the next handler.
      if (!authed(request)) return refused(401, 'Requires authentication')
      return undefined
    }),
    http.get(`${API}/user`, () =>
      HttpResponse.json(ME, {
        headers: {
          'x-github-enterprise-version': '3.14.2',
          'x-oauth-scopes': 'repo, workflow',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4990',
        },
      }),
    ),
    http.get(`${API}/search/issues`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      const items = prs.filter((pr) => {
        if (q.includes('is:merged')) return pr.state === 'merged' && pr.author === ME.login
        if (pr.state !== 'open') return false
        if (q.includes('review-requested:@me')) return pr.requested.includes(ME.login)
        if (q.includes('reviewed-by:@me'))
          return pr.author !== ME.login && pr.reviews.some(([who]) => who === ME.login)
        if (q.includes('author:@me')) return pr.author === ME.login
        return false
      })
      return HttpResponse.json({
        total_count: items.length,
        incomplete_results: false,
        items: items.map((pr) => ({
          number: pr.number,
          title: pr.title,
          repository_url: `${API}/repos/acme/${pr.repo}`,
          pull_request: { url: `${API}/repos/acme/${pr.repo}/pulls/${pr.number}` },
        })),
      })
    }),
    http.get(`${API}/repos/acme/:repo`, ({ params }) =>
      prs.some((p) => p.repo === params.repo)
        ? HttpResponse.json(repoJson(String(params.repo)))
        : refused(404, 'Not Found'),
    ),
    http.get(`${API}/repos/acme/:repo/pulls/:n`, ({ params }) => {
      const pr = find(params.repo, params.n)
      return pr ? HttpResponse.json(pullJson(pr)) : refused(404, 'Not Found')
    }),
    // T7: the PR's files with line counts.
    http.get(`${API}/repos/acme/:repo/pulls/:n/files`, ({ params }) => {
      const pr = find(params.repo, params.n)
      if (!pr) return refused(404, 'Not Found')
      return HttpResponse.json(
        demoFiles(pr.title).map((f) => ({
          filename: f.path,
          status: f.status,
          additions: f.added,
          deletions: f.removed,
          changes: f.added + f.removed,
        })),
      )
    }),
    http.get(`${API}/repos/acme/:repo/pulls/:n/reviews`, ({ params }) => {
      const pr = find(params.repo, params.n)
      if (!pr) return refused(404, 'Not Found')
      return HttpResponse.json(
        pr.reviews.map(([login, state], i) => ({
          id: pr.number * 10 + i,
          user: { login },
          state,
          submitted_at: iso(Date.now() - pr.updated * HOUR),
        })),
      )
    }),
    http.post(`${API}/repos/acme/:repo/pulls/:n/reviews`, async ({ params, request }) => {
      const pr = find(params.repo, params.n)
      if (!pr) return refused(404, 'Not Found')
      if (pr.author === ME.login)
        return refused(422, 'Unprocessable Entity: Can not approve your own pull request')
      const { event } = (await request.json()) as { event?: string }
      const state: Review | null =
        event === 'APPROVE' ? 'APPROVED' : event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : null
      if (!state) return refused(422, 'Unprocessable Entity')
      pr.reviews = [...pr.reviews.filter(([who]) => who !== ME.login), [ME.login, state]]
      pr.requested = pr.requested.filter((r) => r !== ME.login)
      pr.updated = 0
      return HttpResponse.json({ id: 1, user: { login: ME.login }, state })
    }),
    http.put(`${API}/repos/acme/:repo/pulls/:n/merge`, async ({ params, request }) => {
      const pr = find(params.repo, params.n)
      if (!pr) return refused(404, 'Not Found')
      const body = (await request.json()) as { sha?: string; merge_method?: string }
      if (body.merge_method === 'merge')
        return refused(405, 'Merge commits are not allowed on this repository.')
      if (body.sha && body.sha !== pullJson(pr).head.sha)
        return refused(409, 'Head branch was modified. Review and try the merge again.')
      if (!pr.mergeable) return refused(405, 'Pull Request is not mergeable')
      if (!pr.reviews.some(([, s]) => s === 'APPROVED'))
        return refused(
          405,
          'At least 1 approving review is required by reviewers with write access.',
        )
      pr.state = 'merged'
      pr.updated = 0
      return HttpResponse.json({
        merged: true,
        message: 'Pull Request successfully merged',
        sha: sha('m'),
      })
    }),
    http.get(`${API}/repos/acme/:repo/commits/:sha/check-runs`, ({ params }) => {
      const pr = prs.find((p) => p.repo === params.repo && pullJson(p).head.sha === params.sha)
      const checks = pr ? pr.checks.map(([name, c]) => [name, checkState(pr, c)] as const) : []
      return HttpResponse.json({
        total_count: checks.length,
        check_runs: checks.map(([name, c], i) => ({
          id: (pr?.number ?? 0) * 100 + i,
          name,
          status: c === 'running' ? 'in_progress' : 'completed',
          conclusion: c === 'running' ? null : c,
          html_url: `${DEMO_GITHUB}/acme/${params.repo}/runs/${(pr?.number ?? 0) * 100 + i}`,
        })),
      })
    }),
    http.get(`${API}/repos/acme/:repo/commits/:sha/status`, () =>
      HttpResponse.json({ state: 'success', statuses: [], total_count: 0 }),
    ),
    http.post(`${DEMO_GITHUB}/api/graphql`, async ({ request }) => {
      if (!authed(request)) return refused(401, 'Requires authentication')
      const { variables } = (await request.json()) as { variables?: { r?: string; n?: number } }
      const pr = find(variables?.r, variables?.n)
      const nodes = pr
        ? Array.from({ length: pr.reviewComments }, (_, i) => ({ isResolved: i >= pr.unresolved }))
        : []
      return HttpResponse.json({
        data: { repository: { pullRequest: pr ? { reviewThreads: { nodes } } : null } },
      })
    }),
    http.get(`${API}/repos/acme/:repo/actions/runs`, ({ params, request }) => {
      const actor = new URL(request.url).searchParams.get('actor')
      const list = runs
        .filter((r) => r.repo === params.repo && (!actor || actor === ME.login))
        .map(runJson)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      return HttpResponse.json({ total_count: list.length, workflow_runs: list })
    }),
    http.get(`${API}/repos/acme/:repo/actions/runs/:id`, ({ params }) => {
      const run = findRun(params.repo, params.id)
      return run ? HttpResponse.json(runJson(run)) : refused(404, 'Not Found')
    }),
    http.get(`${API}/repos/acme/:repo/actions/runs/:id/jobs`, ({ params }) => {
      const run = findRun(params.repo, params.id)
      if (!run) return refused(404, 'Not Found')
      const jobs = run.jobs.map((j, i) => jobJson(run, j, i))
      return HttpResponse.json({ total_count: jobs.length, jobs })
    }),
    http.get(`${API}/repos/acme/:repo/actions/jobs/:job/logs`, ({ params }) => {
      const run = runs.find(
        (r) => r.repo === params.repo && r.jobs.some((j) => j.id === Number(params.job)),
      )
      if (!run) return refused(404, 'Not Found')
      // Like GitHub: a redirect to short-lived storage, fetched without the token.
      return new HttpResponse(null, {
        status: 302,
        headers: {
          location: `${DEMO_GITHUB}/_blob/logs/${params.repo}/${params.job}.txt?sig=demo`,
        },
      })
    }),
    http.get(`${DEMO_GITHUB}/_blob/logs/:repo/:file`, ({ params, request }) => {
      // The storage URL is signed; a token sent here would be a leak.
      if (request.headers.get('authorization')) return refused(400, 'Authorization not allowed')
      const id = Number(String(params.file).replace(/\.txt$/, ''))
      const run = runs.find((r) => r.repo === params.repo && r.jobs.some((j) => j.id === id))
      const job = run?.jobs.find((j) => j.id === id)
      return run && job ? HttpResponse.text(logFor(run, job)) : refused(404, 'Not Found')
    }),
    http.post(`${API}/repos/acme/:repo/actions/runs/:id/rerun-failed-jobs`, ({ params }) => {
      const run = findRun(params.repo, params.id)
      if (!run) return refused(404, 'Not Found')
      const { done } = runTimes(run)
      if (!done) return refused(403, 'This workflow is already running')
      run.rerunAt = demoMin()
      run.cancelledAt = undefined
      run.attempt = (run.attempt ?? 1) + 1
      run.takesMin = 2
      return new HttpResponse(null, { status: 201 })
    }),
    http.post(`${API}/repos/acme/:repo/actions/runs/:id/cancel`, ({ params }) => {
      const run = findRun(params.repo, params.id)
      if (!run) return refused(404, 'Not Found')
      if (runTimes(run).done) return refused(409, 'Cannot cancel a workflow run that is completed.')
      run.cancelledAt = demoMin()
      return HttpResponse.json({}, { status: 202 })
    }),
  ]
}
