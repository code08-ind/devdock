import { http, HttpResponse, type RequestHandler } from 'msw'
import type { HostConfig } from '../services/providers/service'
import { DEMO_GITLAB } from './origin'

/**
 * Demo GitLab (P7.06), self-managed shape (`/api/v4`): my merge requests (one approved and
 * green, one with a failed pipeline and an open thread), one to review whose pipeline is still
 * running, one merged this week; pipelines with stages and jobs — one passing, one failing
 * (retry makes it pass), one running that finishes on the demo clock. One project sits in a
 * subgroup (`acme/web/checkout`), so namespaces with `/` are exercised.
 */
export const DEMO_GITLAB_CONFIG: { config: HostConfig; projects: string[] } = {
  config: { baseUrl: DEMO_GITLAB, token: 'demo' },
  projects: ['acme/web/checkout', 'acme/infra-tools'],
}

const API = `${DEMO_GITLAB}/api/v4`
const ME = { id: 2002, username: 'demo-dev', name: 'Demo Developer' }
const MIN = 60_000
const HOUR = 60 * MIN

interface DemoMr {
  iid: number
  project: string
  title: string
  source: string
  target: string
  author: string
  state: 'opened' | 'merged'
  /** Hours ago. */
  created: number
  updated: number
  reviewers: string[]
  approvedBy: string[]
  notes: number
  /** Discussions still open. */
  unresolved: number
  conflicts: boolean
  /** The pipeline on its head commit. */
  pipeline: number
}

const MRS: DemoMr[] = [
  {
    iid: 42,
    project: 'acme/web/checkout',
    title: 'DD-106: Address autocomplete on the checkout form',
    source: 'feature/DD-106-address-autocomplete',
    target: 'main',
    author: ME.username,
    state: 'opened',
    created: 26,
    updated: 1.5,
    reviewers: ['priya-r'],
    approvedBy: ['priya-r'],
    notes: 3,
    unresolved: 0,
    conflicts: false,
    pipeline: 5001,
  },
  {
    iid: 45,
    project: 'acme/web/checkout',
    title: 'DD-107: Show the delivery estimate before payment',
    source: 'feature/DD-107-delivery-estimate',
    target: 'main',
    author: ME.username,
    state: 'opened',
    created: 9,
    updated: 3,
    reviewers: ['sam-lead'],
    approvedBy: [],
    notes: 4,
    unresolved: 1,
    conflicts: false,
    pipeline: 5002,
  },
  {
    iid: 17,
    project: 'acme/infra-tools',
    title: 'Terraform: bump the AWS provider to 6.x',
    source: 'chore/aws-provider-6',
    target: 'main',
    author: 'alex-d',
    state: 'opened',
    created: 20,
    updated: 0.5,
    reviewers: [ME.username],
    approvedBy: [],
    notes: 1,
    unresolved: 0,
    conflicts: false,
    pipeline: 5101,
  },
  {
    iid: 39,
    project: 'acme/web/checkout',
    title: 'DD-100: Keep the basket when signing in',
    source: 'bugfix/DD-100-keep-basket',
    target: 'main',
    author: ME.username,
    state: 'merged',
    created: 90,
    updated: 52,
    reviewers: ['sam-lead'],
    approvedBy: ['sam-lead'],
    notes: 2,
    unresolved: 0,
    conflicts: false,
    pipeline: 4990,
  },
]

interface DemoJob {
  id: number
  name: string
  stage: string
  fails?: boolean
}
interface DemoPipeline {
  id: number
  iid: number
  project: string
  branch: string
  source: 'push' | 'merge_request_event'
  user: string
  /** Minutes before the demo started. */
  agoMin: number
  /** How long it takes, in demo minutes. */
  takesMin: number
  /** Ends failed (until retried). */
  fails: boolean
  jobs: DemoJob[]
  retriedAt?: number
  cancelledAt?: number
}

const STAGES = (base: number, failing?: string): DemoJob[] => [
  { id: base + 1, name: 'install', stage: 'build' },
  { id: base + 2, name: 'unit', stage: 'test' },
  { id: base + 3, name: 'e2e', stage: 'test', fails: failing === 'e2e' },
]

const PIPELINES: DemoPipeline[] = [
  {
    id: 5001,
    iid: 211,
    project: 'acme/web/checkout',
    branch: 'feature/DD-106-address-autocomplete',
    source: 'merge_request_event',
    user: ME.username,
    agoMin: 95,
    takesMin: 7,
    fails: false,
    jobs: STAGES(80010),
  },
  {
    id: 5002,
    iid: 214,
    project: 'acme/web/checkout',
    branch: 'feature/DD-107-delivery-estimate',
    source: 'merge_request_event',
    user: ME.username,
    agoMin: 180,
    takesMin: 6,
    fails: true,
    jobs: STAGES(80020, 'e2e'),
  },
  {
    id: 5101,
    iid: 77,
    project: 'acme/infra-tools',
    branch: 'chore/aws-provider-6',
    source: 'push',
    user: ME.username,
    agoMin: 1,
    takesMin: 4,
    fails: false,
    jobs: [
      { id: 81011, name: 'fmt', stage: 'validate' },
      { id: 81012, name: 'plan', stage: 'plan' },
    ],
  },
  {
    id: 4990,
    iid: 205,
    project: 'acme/web/checkout',
    branch: 'bugfix/DD-100-keep-basket',
    source: 'merge_request_event',
    user: ME.username,
    agoMin: 3200,
    takesMin: 6,
    fails: false,
    jobs: STAGES(79900),
  },
]

const sha = (seed: string) => {
  let h = 7
  for (const c of seed) h = (h * 33 + c.charCodeAt(0)) >>> 0
  return (h.toString(16).padStart(8, '0') + '0f1e2d3c4b5a69788796a5b4c3d2e1f0').slice(0, 40)
}
const iso = (ms: number) => new Date(ms).toISOString()
const refused = (status: number, message: unknown) => HttpResponse.json({ message }, { status })
const authed = (request: Request) => /^Bearer .+/.test(request.headers.get('authorization') ?? '')
/** MSW hands `:id` over as written; GitLab project ids in paths are URL-encoded. */
const decode = (v: unknown) => {
  try {
    return decodeURIComponent(String(v))
  } catch {
    return String(v)
  }
}

/** Fresh state per call: each app (or test) gets its own clock, MRs and pipelines. */
export function gitlabHandlers({ speed = 1 }: { speed?: number } = {}): RequestHandler[] {
  const startedAt = Date.now()
  const demoMin = () => ((Date.now() - startedAt) * speed) / MIN
  const at = (demoMinute: number) => startedAt + (demoMinute * MIN) / speed
  const mrs: DemoMr[] = structuredClone(MRS)
  const pipelines: DemoPipeline[] = structuredClone(PIPELINES)

  const findMr = (project: unknown, iid: unknown) =>
    mrs.find((m) => m.project === decode(project) && m.iid === Number(iid))
  const findPipeline = (project: unknown, id: unknown) =>
    pipelines.find((p) => p.project === decode(project) && p.id === Number(id))

  /** Where a pipeline is on the demo clock. */
  const times = (p: DemoPipeline) => {
    const startMin = p.retriedAt ?? -p.agoMin
    const endMin = startMin + p.takesMin
    const t = demoMin()
    const done = p.cancelledAt !== undefined || t >= endMin
    const failed = p.fails && p.retriedAt === undefined
    return { startMin, endMin: p.cancelledAt ?? endMin, done, failed, t }
  }
  const status = (p: DemoPipeline) => {
    const { done, failed } = times(p)
    if (p.cancelledAt !== undefined) return 'canceled'
    if (!done) return 'running'
    return failed ? 'failed' : 'success'
  }
  const webOf = (p: DemoPipeline) => `${DEMO_GITLAB}/${p.project}/-/pipelines/${p.id}`

  const pipelineJson = (p: DemoPipeline) => {
    const { startMin, endMin, done } = times(p)
    return {
      id: p.id,
      iid: p.iid,
      project_id: p.project.length,
      name: null,
      sha: sha(`${p.project}${p.branch}`),
      ref: p.branch,
      status: status(p),
      source: p.source,
      created_at: iso(at(startMin)),
      updated_at: iso(done ? at(endMin) : Date.now()),
      started_at: iso(at(startMin)),
      finished_at: done ? iso(at(endMin)) : null,
      duration: done ? Math.round(((endMin - startMin) * MIN) / speed / 1000) : null,
      web_url: webOf(p),
      user: { id: ME.id, username: p.user, name: ME.name },
    }
  }

  const jobJson = (p: DemoPipeline, job: DemoJob, index: number) => {
    const { startMin, endMin, done, failed, t } = times(p)
    const slice = (endMin - startMin) / p.jobs.length
    const jobStart = startMin + slice * index
    const jobEnd = jobStart + slice
    const jobDone = done || t >= jobEnd
    const jobRunning = !jobDone && t >= jobStart
    const cancelled = p.cancelledAt !== undefined && t >= p.cancelledAt && !(t >= jobEnd)
    const state = cancelled
      ? 'canceled'
      : !jobDone
        ? jobRunning
          ? 'running'
          : 'pending'
        : failed && job.fails
          ? 'failed'
          : 'success'
    return {
      id: job.id,
      name: job.name,
      stage: job.stage,
      status: state,
      web_url: `${DEMO_GITLAB}/${p.project}/-/jobs/${job.id}`,
      started_at: jobRunning || jobDone ? iso(at(jobStart)) : null,
      finished_at: jobDone ? iso(at(jobEnd)) : null,
      duration: jobDone ? Math.round(((jobEnd - jobStart) * MIN) / speed / 1000) : null,
    }
  }

  const mrJson = (mr: DemoMr, single: boolean) => {
    const now = Date.now()
    const pipeline = pipelines.find((p) => p.id === mr.pipeline)
    return {
      id: mr.iid * 100,
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      web_url: `${DEMO_GITLAB}/${mr.project}/-/merge_requests/${mr.iid}`,
      references: { full: `${mr.project}!${mr.iid}` },
      author: { username: mr.author },
      source_branch: mr.source,
      target_branch: mr.target,
      reviewers: mr.reviewers.map((username) => ({ username })),
      user_notes_count: mr.notes,
      has_conflicts: mr.conflicts,
      created_at: iso(now - mr.created * HOUR),
      updated_at: iso(now - mr.updated * HOUR),
      merged_at: mr.state === 'merged' ? iso(now - mr.updated * HOUR) : null,
      closed_at: null,
      sha: sha(`${mr.project}${mr.iid}${mr.source}`),
      ...(single && pipeline
        ? {
            head_pipeline: {
              id: pipeline.id,
              status: status(pipeline),
              web_url: webOf(pipeline),
            },
          }
        : {}),
    }
  }

  const traceFor = (p: DemoPipeline, job: DemoJob) => {
    const { failed } = times(p)
    const lines = [
      `\u001b[0KRunning with gitlab-runner 17.5.0 (demo)`,
      `\u001b[0K\u001b[36;1mExecuting "step_script" stage of the job script\u001b[0;m`,
      `$ npm run ${job.name}`,
      ...Array.from({ length: 40 }, (_, i) => `[${job.stage}] output line ${i + 1}`),
    ]
    if (failed && job.fails) {
      lines.push(
        '  1) checkout › delivery estimate › shows a date before payment',
        "     Error: expect(locator).toHaveText(expected) — Expected: 'Arrives Thu 29 Oct'",
        "     Received: 'Arrives —'",
        '\u001b[31;1mERROR: Job failed: exit code 1\u001b[0;m',
      )
    } else {
      lines.push('\u001b[32;1mJob succeeded\u001b[0;m')
    }
    return lines.join('\n')
  }

  return [
    http.all(`${API}/*`, ({ request }) => {
      if (!authed(request)) return refused(401, '401 Unauthorized')
      return undefined
    }),
    http.get(`${API}/user`, () => HttpResponse.json(ME)),
    http.get(`${API}/version`, () => HttpResponse.json({ version: '17.5.1-ee', revision: 'demo' })),
    http.get(`${API}/merge_requests`, ({ request }) => {
      const q = new URL(request.url).searchParams
      const state = q.get('state')
      const reviewer = q.get('reviewer_username')
      const items = mrs.filter((mr) => {
        if (state && mr.state !== state) return false
        if (reviewer) return mr.reviewers.includes(reviewer)
        return q.get('scope') === 'created_by_me' ? mr.author === ME.username : true
      })
      return HttpResponse.json(items.map((mr) => mrJson(mr, false)))
    }),
    http.get(`${API}/projects/:project/merge_requests/:iid`, ({ params }) => {
      const mr = findMr(params.project, params.iid)
      return mr ? HttpResponse.json(mrJson(mr, true)) : refused(404, '404 Not found')
    }),
    http.get(`${API}/projects/:project/merge_requests/:iid/approvals`, ({ params }) => {
      const mr = findMr(params.project, params.iid)
      if (!mr) return refused(404, '404 Not found')
      return HttpResponse.json({
        approved: mr.approvedBy.length > 0,
        approved_by: mr.approvedBy.map((username) => ({ user: { username } })),
      })
    }),
    http.get(`${API}/projects/:project/merge_requests/:iid/discussions`, ({ params }) => {
      const mr = findMr(params.project, params.iid)
      if (!mr) return refused(404, '404 Not found')
      return HttpResponse.json(
        Array.from({ length: mr.notes }, (_, i) => ({
          id: `d${i}`,
          notes: [{ id: i, resolvable: true, resolved: i >= mr.unresolved }],
        })),
      )
    }),
    http.post(`${API}/projects/:project/merge_requests/:iid/approve`, ({ params }) => {
      const mr = findMr(params.project, params.iid)
      if (!mr) return refused(404, '404 Not found')
      if (mr.author === ME.username) return refused(401, '401 Unauthorized')
      if (!mr.approvedBy.includes(ME.username)) mr.approvedBy.push(ME.username)
      mr.updated = 0
      return HttpResponse.json({ approved: true }, { status: 201 })
    }),
    http.put(`${API}/projects/:project/merge_requests/:iid/merge`, async ({ params, request }) => {
      const mr = findMr(params.project, params.iid)
      if (!mr) return refused(404, '404 Not found')
      const body = (await request.json()) as { sha?: string }
      if (body.sha && body.sha !== mrJson(mr, false).sha) {
        return refused(409, 'SHA does not match HEAD of source branch')
      }
      const pipeline = pipelines.find((p) => p.id === mr.pipeline)
      if (mr.approvedBy.length === 0 || (pipeline && status(pipeline) !== 'success')) {
        return refused(405, '405 Method Not Allowed')
      }
      mr.state = 'merged'
      mr.updated = 0
      return HttpResponse.json(mrJson(mr, true))
    }),
    http.get(`${API}/projects/:project/pipelines`, ({ params, request }) => {
      const username = new URL(request.url).searchParams.get('username')
      const list = pipelines
        .filter((p) => p.project === decode(params.project) && (!username || username === p.user))
        .map(pipelineJson)
        .sort((a, b) => b.id - a.id)
      return HttpResponse.json(list)
    }),
    http.get(`${API}/projects/:project/pipelines/:id`, ({ params }) => {
      const p = findPipeline(params.project, params.id)
      return p ? HttpResponse.json(pipelineJson(p)) : refused(404, '404 Not found')
    }),
    http.get(`${API}/projects/:project/pipelines/:id/jobs`, ({ params }) => {
      const p = findPipeline(params.project, params.id)
      return p
        ? HttpResponse.json(p.jobs.map((j, i) => jobJson(p, j, i)))
        : refused(404, '404 Not found')
    }),
    http.get(`${API}/projects/:project/jobs/:job/trace`, ({ params }) => {
      const p = pipelines.find(
        (x) =>
          x.project === decode(params.project) && x.jobs.some((j) => j.id === Number(params.job)),
      )
      const job = p?.jobs.find((j) => j.id === Number(params.job))
      return p && job ? HttpResponse.text(traceFor(p, job)) : refused(404, '404 Not found')
    }),
    http.post(`${API}/projects/:project/pipelines/:id/retry`, ({ params }) => {
      const p = findPipeline(params.project, params.id)
      if (!p) return refused(404, '404 Not found')
      if (!times(p).done) return refused(403, '403 Forbidden - Pipeline is still running')
      p.retriedAt = demoMin()
      p.cancelledAt = undefined
      p.takesMin = 2
      return HttpResponse.json(pipelineJson(p), { status: 201 })
    }),
    http.post(`${API}/projects/:project/pipelines/:id/cancel`, ({ params }) => {
      const p = findPipeline(params.project, params.id)
      if (!p) return refused(404, '404 Not found')
      if (times(p).done) return refused(403, '403 Forbidden - Pipeline is not running')
      p.cancelledAt = demoMin()
      return HttpResponse.json(pipelineJson(p))
    }),
  ]
}
