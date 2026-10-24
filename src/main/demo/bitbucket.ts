import { http, HttpResponse, type RequestHandler } from 'msw'
import type { BitbucketConfig } from '../services/bitbucket/client'
import { DEMO_ORIGIN } from './origin'

/**
 * Demo Bitbucket (Data Center flavour, so the demo shows the other adapter from Jira's Cloud):
 * my open PRs in mixed states, two to review, two merged this week. Times are relative to now.
 */
export const DEMO_BITBUCKET: { config: BitbucketConfig } = {
  config: {
    flavor: 'datacenter',
    baseUrl: `${DEMO_ORIGIN}/bitbucket`,
    username: '',
    token: 'demo',
  },
}

const BASE = DEMO_BITBUCKET.config.baseUrl
const API = `${BASE}/rest/api/1.0`
const ME = {
  name: 'dev',
  slug: 'dev',
  displayName: 'Demo Developer',
  emailAddress: 'dev@example.com',
}
const HOUR = 3_600_000

type Review = 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED'
type Build = 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS'

interface DemoPr {
  id: number
  repo: string
  title: string
  from: string
  to: string
  state: 'OPEN' | 'MERGED'
  mine: boolean
  /** Hours ago. */
  created: number
  updated: number
  reviewers: [string, Review][]
  comments: number
  /** Open comment threads (shown for a single PR). */
  unresolved: number
  merge: 'CLEAN' | 'CONFLICTED'
  builds: [string, Build][]
}

const PRS: DemoPr[] = [
  {
    id: 412,
    repo: 'web-app',
    title: 'DD-101: Fix date picker losing focus on month change',
    from: 'bugfix/DD-101-date-picker-focus',
    to: 'develop',
    state: 'OPEN',
    mine: true,
    created: 26,
    updated: 1,
    reviewers: [
      ['Priya Reviewer', 'APPROVED'],
      ['Sam Lead', 'APPROVED'],
    ],
    comments: 4,
    unresolved: 0,
    merge: 'CLEAN',
    builds: [['web-app » PR-412', 'SUCCESSFUL']],
  },
  {
    id: 415,
    repo: 'web-app',
    title: 'DD-102: Checkout summary card (Figma v3)',
    from: 'feature/DD-102-checkout-summary-card',
    to: 'develop',
    state: 'OPEN',
    mine: true,
    created: 20,
    updated: 2,
    reviewers: [
      ['Priya Reviewer', 'NEEDS_WORK'],
      ['Sam Lead', 'UNAPPROVED'],
    ],
    comments: 7,
    unresolved: 3,
    merge: 'CLEAN',
    builds: [
      ['web-app » PR-415', 'FAILED'],
      ['visual-tests', 'SUCCESSFUL'],
    ],
  },
  {
    id: 88,
    repo: 'design-system',
    title: 'Button: add loading state and aria-busy',
    from: 'feature/button-loading',
    to: 'main',
    state: 'OPEN',
    mine: true,
    created: 5,
    updated: 0.2,
    reviewers: [['Alex Designer', 'UNAPPROVED']],
    comments: 1,
    unresolved: 1,
    merge: 'CONFLICTED',
    builds: [['design-system » PR-88', 'INPROGRESS']],
  },
  {
    id: 419,
    repo: 'web-app',
    title: 'Chore: bump vite and vitest',
    from: 'chore/bump-tooling',
    to: 'develop',
    state: 'OPEN',
    mine: true,
    created: 50,
    updated: 30,
    reviewers: [],
    comments: 0,
    unresolved: 0,
    merge: 'CLEAN',
    builds: [],
  },
  {
    id: 410,
    repo: 'web-app',
    title: 'DD-099: Search results skeleton loader',
    from: 'feature/DD-099-search-skeleton',
    to: 'develop',
    state: 'OPEN',
    mine: false,
    created: 30,
    updated: 3,
    reviewers: [
      ['Demo Developer', 'UNAPPROVED'],
      ['Sam Lead', 'APPROVED'],
    ],
    comments: 2,
    unresolved: 1,
    merge: 'CLEAN',
    builds: [['web-app » PR-410', 'SUCCESSFUL']],
  },
  {
    id: 91,
    repo: 'design-system',
    title: 'Tokens: high-contrast focus ring',
    from: 'feature/hc-focus-ring',
    to: 'main',
    state: 'OPEN',
    mine: false,
    created: 8,
    updated: 4,
    reviewers: [['Demo Developer', 'UNAPPROVED']],
    comments: 0,
    unresolved: 0,
    merge: 'CLEAN',
    builds: [['design-system » PR-91', 'FAILED']],
  },
  {
    id: 401,
    repo: 'web-app',
    title: 'DD-095: Remember last used repo filter',
    from: 'feature/DD-095-repo-filter',
    to: 'develop',
    state: 'MERGED',
    mine: true,
    created: 80,
    updated: 40,
    reviewers: [['Sam Lead', 'APPROVED']],
    comments: 3,
    unresolved: 0,
    merge: 'CLEAN',
    builds: [['web-app » PR-401', 'SUCCESSFUL']],
  },
  {
    id: 395,
    repo: 'web-app',
    title: 'DD-090: Fix toast stacking on Windows',
    from: 'bugfix/DD-090-toast-stack',
    to: 'develop',
    state: 'MERGED',
    mine: true,
    created: 150,
    updated: 120,
    reviewers: [['Priya Reviewer', 'APPROVED']],
    comments: 5,
    unresolved: 0,
    merge: 'CLEAN',
    builds: [['web-app » PR-395', 'SUCCESSFUL']],
  },
]

const commitOf = (pr: DemoPr) => `${pr.id.toString(16).padStart(4, '0')}${'d3m0'.repeat(9)}`

function repoJson(slug: string) {
  return { slug, name: slug, project: { key: 'DEMO', name: 'Demo' } }
}

function prJson(pr: DemoPr, now: number) {
  const user = (displayName: string) => ({
    name: displayName.toLowerCase().replace(/\s+/g, '.'),
    displayName,
  })
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: { user: pr.mine ? ME : user('Priya Reviewer'), role: 'AUTHOR' },
    fromRef: { displayId: pr.from, latestCommit: commitOf(pr), repository: repoJson(pr.repo) },
    toRef: { displayId: pr.to, repository: repoJson(pr.repo) },
    reviewers: pr.reviewers.map(([name, status]) => ({
      user: name === ME.displayName ? ME : user(name),
      role: 'REVIEWER',
      status,
      approved: status === 'APPROVED',
    })),
    participants: [],
    properties: { commentCount: pr.comments, mergeResult: { outcome: pr.merge, current: true } },
    createdDate: now - pr.created * HOUR,
    updatedDate: now - pr.updated * HOUR,
    ...(pr.state === 'MERGED' ? { closedDate: now - pr.updated * HOUR } : {}),
    links: {
      self: [{ href: `${BASE}/projects/DEMO/repos/${pr.repo}/pull-requests/${pr.id}/overview` }],
    },
  }
}

const page = (values: unknown[]) =>
  HttpResponse.json({ values, size: values.length, isLastPage: true, start: 0, limit: 50 })

const authed = (request: Request) => /^Bearer .+/.test(request.headers.get('authorization') ?? '')

export const bitbucketHandlers: RequestHandler[] = [
  http.get(`${API}/application-properties`, ({ request }) =>
    HttpResponse.json(
      { version: '8.19.1', buildNumber: '8019001', displayName: 'Bitbucket' },
      { headers: authed(request) ? { 'X-AUSERNAME': ME.name } : {} },
    ),
  ),
  http.get(`${API}/users/:slug`, ({ params }) =>
    params.slug === ME.slug ? HttpResponse.json(ME) : new HttpResponse(null, { status: 404 }),
  ),
  http.get(`${API}/dashboard/pull-requests`, ({ request }) => {
    const q = new URL(request.url).searchParams
    const reviewing = q.get('role') === 'REVIEWER'
    const state = q.get('state') ?? 'OPEN'
    const now = Date.now()
    return page(
      PRS.filter(
        (pr) =>
          pr.state === state &&
          (reviewing ? pr.reviewers.some(([name]) => name === ME.displayName) : pr.mine),
      )
        .sort((a, b) => a.updated - b.updated)
        .map((pr) => prJson(pr, now)),
    )
  }),
  http.get(`${API}/projects/DEMO/repos/:repo/pull-requests/:id/activities`, ({ params }) => {
    const pr = find(params)
    if (!pr) return new HttpResponse(null, { status: 404 })
    const threads = Array.from({ length: Math.min(pr.comments, 10) }, (_, i) => ({
      id: pr.id * 100 + i,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: { id: pr.id * 100 + i, text: 'Demo comment', threadResolved: i >= pr.unresolved },
    }))
    return page(threads)
  }),
  http.get(`${API}/projects/DEMO/repos/:repo/pull-requests/:id`, ({ params }) => {
    const pr = find(params)
    return pr ? HttpResponse.json(prJson(pr, Date.now())) : new HttpResponse(null, { status: 404 })
  }),
  http.get(`${BASE}/rest/build-status/1.0/commits/:commit`, ({ params }) => {
    const pr = PRS.find((p) => commitOf(p) === params.commit)
    const now = Date.now()
    return page(
      (pr?.builds ?? []).map(([name, state], i) => ({
        key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name,
        state,
        url: `${DEMO_ORIGIN}/jenkins/job/${pr!.repo}/job/PR-${pr!.id}/${12 + i}/`,
        dateAdded: now - pr!.updated * HOUR,
      })),
    )
  }),
]

function find(params: Record<string, unknown>): DemoPr | undefined {
  return PRS.find((p) => p.repo === params.repo && String(p.id) === params.id)
}
