import { http, HttpResponse, type RequestHandler } from 'msw'
import type { JenkinsDemo } from '../services/jenkins/service'
import { DEMO_ORIGIN } from './origin'

/**
 * Demo Jenkins: multibranch jobs `web-app` and `design-system` (branch and PR jobs matching the
 * demo Bitbucket PRs and their build-status links), and a folder `apps` with `deploy-dev` and
 * the protected `deploy-prod` (freestyle: no stages). Two builds are running when the demo
 * starts: design-system PR-88 passes after 2 minutes (as its Bitbucket status does), web-app
 * chore/bump-tooling fails after 90 s. Times are relative to the start.
 */
export const DEMO_JENKINS: JenkinsDemo = {
  config: { baseUrl: `${DEMO_ORIGIN}/jenkins`, username: 'dev', token: 'demo' },
  jobs: ['web-app', 'design-system'],
}

const BASE = DEMO_JENKINS.config.baseUrl
const BASE_PATH = new URL(BASE).pathname
const MIN = 60_000

type Result = 'SUCCESS' | 'FAILURE'
type Kind = 'folder' | 'multibranch' | 'pipeline' | 'freestyle'

interface DemoBuild {
  number: number
  result: Result
  /** Started this many minutes before the demo started. */
  agoMin: number
  /** Running at start: finishes this many seconds after the demo starts. */
  runSec?: number
  /** Index of the stage that fails (FAILURE only). */
  failsAt?: number
  cause: string
  params?: Record<string, string>
}

const STAGES: [name: string, seconds: number][] = [
  ['Checkout', 5],
  ['Install', 40],
  ['Lint', 20],
  ['Unit tests', 60],
  ['Build', 45],
]
const DEPLOY_STAGES: [string, number][] = [
  ['Deploy', 50],
  ['Smoke test', 20],
]
const UNIT_TESTS = 3
const BUILD = 4

const JOBS: { path: string; kind: Kind; builds?: DemoBuild[] }[] = [
  { path: 'web-app', kind: 'multibranch' },
  {
    path: 'web-app/develop',
    kind: 'pipeline',
    builds: [{ number: 230, result: 'SUCCESS', agoMin: 180, cause: 'Branch indexing' }],
  },
  {
    path: 'web-app/bugfix%2FDD-101-date-picker-focus',
    kind: 'pipeline',
    builds: [
      { number: 2, result: 'FAILURE', agoMin: 140, failsAt: UNIT_TESTS, cause: 'Push event' },
      { number: 3, result: 'SUCCESS', agoMin: 70, cause: 'Push event' },
    ],
  },
  {
    path: 'web-app/feature%2FDD-102-checkout-summary-card',
    kind: 'pipeline',
    builds: [
      { number: 5, result: 'FAILURE', agoMin: 130, failsAt: UNIT_TESTS, cause: 'Push event' },
    ],
  },
  {
    path: 'web-app/chore%2Fbump-tooling',
    kind: 'pipeline',
    builds: [
      { number: 1, result: 'SUCCESS', agoMin: 1900, cause: 'Branch indexing' },
      {
        number: 2,
        result: 'FAILURE',
        agoMin: 1,
        runSec: 90,
        failsAt: BUILD,
        cause: 'Push event',
      },
    ],
  },
  {
    path: 'web-app/PR-412',
    kind: 'pipeline',
    builds: [{ number: 12, result: 'SUCCESS', agoMin: 65, cause: 'Pull request #412 updated' }],
  },
  {
    path: 'web-app/PR-415',
    kind: 'pipeline',
    builds: [
      {
        number: 12,
        result: 'FAILURE',
        agoMin: 125,
        failsAt: UNIT_TESTS,
        cause: 'Pull request #415 updated',
      },
    ],
  },
  {
    path: 'web-app/PR-410',
    kind: 'pipeline',
    builds: [{ number: 12, result: 'SUCCESS', agoMin: 190, cause: 'Pull request #410 opened' }],
  },
  { path: 'design-system', kind: 'multibranch' },
  {
    path: 'design-system/main',
    kind: 'pipeline',
    builds: [{ number: 88, result: 'SUCCESS', agoMin: 300, cause: 'Branch indexing' }],
  },
  {
    path: 'design-system/feature%2Fbutton-loading',
    kind: 'pipeline',
    builds: [{ number: 4, result: 'SUCCESS', agoMin: 15, cause: 'Push event' }],
  },
  {
    path: 'design-system/PR-88',
    kind: 'pipeline',
    builds: [
      {
        number: 12,
        result: 'SUCCESS',
        agoMin: 1,
        runSec: 120,
        cause: 'Pull request #88 updated',
      },
    ],
  },
  {
    path: 'design-system/PR-91',
    kind: 'pipeline',
    builds: [
      {
        number: 12,
        result: 'FAILURE',
        agoMin: 240,
        failsAt: BUILD,
        cause: 'Pull request #91 opened',
      },
    ],
  },
  // Not under a configured job: found through the deploy watcher setting (P4-B).
  { path: 'apps', kind: 'folder' },
  {
    path: 'apps/deploy-dev',
    kind: 'freestyle',
    builds: [
      {
        number: 57,
        result: 'SUCCESS',
        agoMin: 45,
        cause: 'Started by timer',
        params: { BRANCH: 'develop' },
      },
    ],
  },
  {
    path: 'apps/deploy-prod',
    kind: 'freestyle',
    builds: [
      {
        number: 19,
        result: 'SUCCESS',
        agoMin: 2900,
        cause: 'Started by user Release Manager',
        params: { BRANCH: 'main' },
      },
    ],
  },
]

const CLASS: Record<Kind, string> = {
  folder: 'com.cloudbees.hudson.plugins.folder.Folder',
  multibranch: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
  pipeline: 'org.jenkinsci.plugins.workflow.job.WorkflowJob',
  freestyle: 'hudson.model.FreeStyleProject',
}

interface Line {
  /** Seconds after the build started. */
  at: number
  text: string
}

/** What a build looks like `elapsedSec` after it started. */
function timeline(job: (typeof JOBS)[number], build: DemoBuild, elapsedSec: number) {
  const stages = job.kind === 'freestyle' ? DEPLOY_STAGES : STAGES
  const planned = stages.reduce((sum, [, s]) => sum + s, 0)
  // A running build is stretched to end at its finish time.
  const total = build.runSec !== undefined ? build.agoMin * 60 + build.runSec : planned
  const scale = total / planned
  const lastStage = build.failsAt ?? stages.length - 1
  const end = stages.slice(0, lastStage + 1).reduce((sum, [, s]) => sum + s * scale, 0)
  const building = elapsedSec < end
  const branch = decodeURIComponent(job.path.split('/').pop()!)
  const lines: Line[] = [
    { at: 0, text: `Started by ${build.cause}` },
    { at: 0, text: '[Pipeline] Start of Pipeline' },
    {
      at: 1,
      text: `Running on agent-linux-2 in /var/lib/jenkins/workspace/${job.path.replace(/[/%]/g, '_')}`,
    },
  ]
  const described: {
    name: string
    status: string
    startTimeMillis: number
    durationMillis: number
  }[] = []
  let at = 0
  stages.forEach(([name, seconds], i) => {
    const length = seconds * scale
    const fails = i === build.failsAt
    const status =
      i > lastStage
        ? building
          ? null
          : 'NOT_EXECUTED'
        : elapsedSec < at
          ? null
          : elapsedSec < at + length
            ? 'IN_PROGRESS'
            : fails
              ? 'FAILED'
              : 'SUCCESS'
    if (status) {
      described.push({
        name,
        status,
        startTimeMillis: status === 'NOT_EXECUTED' ? 0 : at * 1000,
        durationMillis: status === 'NOT_EXECUTED' ? 0 : Math.min(elapsedSec - at, length) * 1000,
      })
    }
    if (i > lastStage) return
    lines.push({ at, text: '[Pipeline] stage' }, { at, text: `[Pipeline] { (${name})` })
    lines.push(
      ...stageLines(name, branch, fails).map((text, k) => ({
        at: at + (k + 1) * (length / 5),
        text,
      })),
    )
    lines.push({ at: at + length, text: '[Pipeline] }' })
    at += length
  })
  const result = build.result
  lines.push(
    { at: end, text: '[Pipeline] End of Pipeline' },
    { at: end, text: `Finished: ${result}` },
  )
  return { building, result, end, described, lines: lines.filter((l) => l.at <= elapsedSec) }
}

function stageLines(stage: string, branch: string, fails: boolean): string[] {
  switch (stage) {
    case 'Checkout':
      return [`+ git checkout -f origin/${branch}`, `HEAD is now at 3f2a1b4 ${branch}`]
    case 'Install':
      return ['+ npm ci', 'added 1243 packages, and audited 1244 packages in 38s']
    case 'Lint':
      return ['+ npm run lint', '\u001b[32m✔\u001b[0m No problems found']
    case 'Unit tests':
      return fails
        ? [
            '+ npm test',
            '\u001b[31m FAIL \u001b[0m src/components/DatePicker.test.tsx > keeps focus on month change',
            'AssertionError: expected <button> to be the active element',
            ' Test Files  1 failed | 31 passed (32)',
            'script returned exit code 1',
          ]
        : ['+ npm test', ' Test Files  32 passed (32)', '      Tests  561 passed (561)']
    case 'Build':
      return fails
        ? [
            '+ npm run build',
            "src/vite.config.ts(4,10): error TS2305: Module '\"vitest/config\"' has no exported member 'defineProject'.",
            'script returned exit code 2',
          ]
        : ['+ npm run build', '\u001b[32m✓\u001b[0m built in 41.2s']
    case 'Deploy':
      return ['+ ./deploy.sh dev', 'Uploading build to s3://demo-dev-bucket … done']
    default:
      return ['+ curl -fsS https://dev.example.com/health', '{"status":"ok"}']
  }
}

const authed = (request: Request) => /^Basic .+/.test(request.headers.get('authorization') ?? '')

/**
 * Fresh state per call (demoHandlers() builds one set per app or test), so the running builds
 * start over each time.
 */
export function jenkinsHandlers(): RequestHandler[] {
  const startedAt = Date.now()
  const jobs = new Map(JOBS.map((j) => [j.path, j]))
  const children = (path: string) =>
    JOBS.filter(
      (j) => j.path.startsWith(`${path}/`) && !j.path.slice(path.length + 1).includes('/'),
    )
  const roots = () => JOBS.filter((j) => !j.path.includes('/'))

  const buildJson = (job: (typeof JOBS)[number], build: DemoBuild) => {
    const started = startedAt - build.agoMin * MIN
    const elapsed = (Date.now() - started) / 1000
    const t = timeline(job, build, elapsed)
    return {
      _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
      number: build.number,
      building: t.building,
      result: t.building ? null : t.result,
      timestamp: started,
      duration: t.building ? 0 : Math.round(t.end * 1000),
      estimatedDuration: 170_000,
      actions: [
        {
          _class: 'hudson.model.CauseAction',
          causes: [{ shortDescription: `Started by ${build.cause}` }],
        },
        ...(build.params
          ? [
              {
                _class: 'hudson.model.ParametersAction',
                parameters: Object.entries(build.params).map(([name, value]) => ({
                  _class: 'hudson.model.StringParameterValue',
                  name,
                  value,
                })),
              },
            ]
          : []),
      ],
    }
  }
  const lastOf = (job: (typeof JOBS)[number]) => job.builds?.at(-1)
  const jobJson = (job: (typeof JOBS)[number]): Record<string, unknown> => {
    const last = lastOf(job)
    return {
      _class: CLASS[job.kind],
      name: job.path.split('/').pop(),
      ...(job.builds ? { lastBuild: last ? buildJson(job, last) : null } : {}),
      ...(job.builds ? {} : { jobs: children(job.path).map(jobJson) }),
    }
  }
  const notFound = () => new HttpResponse('<html>Not Found</html>', { status: 404 })

  return [
    http.get(`${BASE}/*`, ({ request }) => {
      if (!authed(request)) return new HttpResponse(null, { status: 401 })
      const url = new URL(request.url)
      const parts = url.pathname.slice(BASE_PATH.length + 1).split('/')
      const rest = parts.join('/')
      if (rest === 'me/api/json') {
        return HttpResponse.json(
          { id: 'dev', fullName: 'Demo Developer' },
          { headers: { 'X-Jenkins': '2.479.1' } },
        )
      }
      if (rest === 'crumbIssuer/api/json') {
        return HttpResponse.json({ crumb: 'demo-crumb', crumbRequestField: 'Jenkins-Crumb' })
      }
      if (rest === 'api/json') return HttpResponse.json({ jobs: roots().map(jobJson) })

      const names: string[] = []
      let i = 0
      while (parts[i] === 'job' && parts[i + 1]) {
        names.push(decodeURIComponent(parts[i + 1]!))
        i += 2
      }
      const job = jobs.get(names.join('/'))
      if (!job) return notFound()
      const tail = parts.slice(i).filter(Boolean)
      if (tail.length === 2 && tail[0] === 'api' && tail[1] === 'json') {
        return HttpResponse.json(jobJson(job))
      }
      const build = job.builds?.find((b) => String(b.number) === tail[0])
      if (!build) return notFound()
      const page = tail.slice(1).join('/')
      const started = startedAt - build.agoMin * MIN
      const t = timeline(job, build, (Date.now() - started) / 1000)
      if (page === 'api/json') return HttpResponse.json(buildJson(job, build))
      if (page === 'wfapi/describe') {
        if (job.kind === 'freestyle') return notFound()
        return HttpResponse.json({
          id: String(build.number),
          name: `#${build.number}`,
          status: t.building ? 'IN_PROGRESS' : build.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
          stages: t.described.map((s, k) => ({
            id: String(k + 6),
            ...s,
            startTimeMillis: s.startTimeMillis ? started + s.startTimeMillis : 0,
          })),
        })
      }
      if (page === 'logText/progressiveText') {
        const log = Buffer.from(t.lines.map((l) => `${l.text}\n`).join(''), 'utf8')
        const start = Number(url.searchParams.get('start') ?? 0) || 0
        return new HttpResponse(start < log.length ? log.subarray(start) : '', {
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            'X-Text-Size': String(log.length),
            ...(t.building ? { 'X-More-Data': 'true' } : {}),
          },
        })
      }
      return notFound()
    }),
  ]
}
