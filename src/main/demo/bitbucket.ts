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
  /** A running build passes this many minutes after the demo starts (the watcher sees it). */
  passesAfterMin?: number
  /** Bumped by each vote or merge, like DC's optimistic-locking `version`. */
  version?: number
}

/** What demo reviewers say (author, text, file); the lessons list picks from these (P6-F). */
const REVIEW_COMMENTS: [string, string, string | null][] = [
  [
    'Priya Reviewer',
    'Use the `formatMoney` helper here instead of toFixed: it rounds 3-decimal currencies correctly.',
    'src/checkout/Total.tsx',
  ],
  ['Sam Lead', 'Please add a test for the empty state before we merge.', null],
  [
    'Priya Reviewer',
    'Prefer `aria-busy` on the button itself over a separate live region.',
    'src/ui/Button.tsx',
  ],
  [
    'Alex Designer',
    'Spacing should come from the tokens (space-3), not a hard-coded 12px.',
    'src/ui/Card.css',
  ],
  ['Sam Lead', 'LGTM', null],
  ['Demo Developer', 'Fixed in the latest commit, thanks!', null],
  [
    'Priya Reviewer',
    'Name the test after the behaviour ("keeps focus when the month changes"), not the function.',
    'src/DatePicker.test.tsx',
  ],
]

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
    passesAfterMin: 2,
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
    version: pr.version ?? 0,
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

/**
 * Fresh demo state per call (demoHandlers() builds one set per app or test): votes and merges
 * change it, and the running build on design-system #88 passes a couple of minutes in.
 */
export function bitbucketHandlers(): RequestHandler[] {
  const prs: DemoPr[] = structuredClone(PRS)
  const startedAt = Date.now()
  const find = (params: Record<string, unknown>) =>
    prs.find((p) => p.repo === params.repo && String(p.id) === params.id)
  const builds = (pr: DemoPr): [string, Build][] =>
    pr.passesAfterMin !== undefined && Date.now() >= startedAt + pr.passesAfterMin * 60_000
      ? pr.builds.map(([name, state]) => [name, state === 'INPROGRESS' ? 'SUCCESSFUL' : state])
      : pr.builds
  const refused = (status: number, message: string) =>
    HttpResponse.json({ errors: [{ context: null, message }] }, { status })
  const prUrl = `${API}/projects/DEMO/repos/:repo/pull-requests/:id`

  return [
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
        prs
          .filter(
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
      const threads = Array.from({ length: Math.min(pr.comments, 10) }, (_, i) => {
        const [author, text, path] = REVIEW_COMMENTS[(pr.id + i) % REVIEW_COMMENTS.length]!
        return {
          id: pr.id * 100 + i,
          action: 'COMMENTED',
          commentAction: 'ADDED',
          commentAnchor: path ? { path } : undefined,
          comment: {
            id: pr.id * 100 + i,
            text,
            author: {
              // The demo user's own replies are "mine" (left out of the lessons list).
              name: author === ME.displayName ? ME.name : author.toLowerCase().replace(/\s+/g, '.'),
              displayName: author,
            },
            createdDate: Date.now() - (i + 1) * HOUR,
            threadResolved: i >= pr.unresolved,
          },
        }
      })
      return page(threads)
    }),
    http.get(`${API}/projects/DEMO/repos/:repo/pull-requests/:id`, ({ params }) => {
      const pr = find(params)
      return pr
        ? HttpResponse.json(prJson(pr, Date.now()))
        : new HttpResponse(null, { status: 404 })
    }),
    http.get(`${BASE}/rest/build-status/1.0/commits/:commit`, ({ params }) => {
      const pr = prs.find((p) => commitOf(p) === params.commit)
      const now = Date.now()
      return page(
        (pr ? builds(pr) : []).map(([name, state], i) => ({
          key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          state,
          url: `${DEMO_ORIGIN}/jenkins/job/${pr!.repo}/job/PR-${pr!.id}/${12 + i}/`,
          dateAdded: now - pr!.updated * HOUR,
        })),
      )
    }),
    // Approve / needs work: DC 7+ participants endpoint, as the signed-in user.
    http.put(`${prUrl}/participants/:slug`, async ({ params, request }) => {
      const pr = find(params)
      if (!pr) return new HttpResponse(null, { status: 404 })
      if (params.slug !== ME.slug) return refused(403, 'You can only update your own review.')
      if (pr.mine)
        return refused(409, 'You are the author of this pull request and cannot review it.')
      if (pr.state !== 'OPEN') return refused(409, 'This pull request is already closed.')
      const { status } = (await request.json()) as { status?: Review }
      if (status !== 'APPROVED' && status !== 'NEEDS_WORK' && status !== 'UNAPPROVED')
        return refused(400, 'A review status is required.')
      pr.reviewers = [
        ...pr.reviewers.filter(([name]) => name !== ME.displayName),
        [ME.displayName, status],
      ]
      pr.version = (pr.version ?? 0) + 1
      pr.updated = 0
      return HttpResponse.json({
        user: ME,
        role: 'REVIEWER',
        approved: status === 'APPROVED',
        status,
      })
    }),
    http.get(`${prUrl}/merge`, ({ params }) => {
      const pr = find(params)
      if (!pr) return new HttpResponse(null, { status: 404 })
      const vetoes = [
        pr.reviewers.some(([, r]) => r === 'NEEDS_WORK') && {
          summaryMessage: 'Needs work',
          detailedMessage: 'A reviewer has marked this pull request as needing work.',
        },
        !pr.reviewers.some(([, r]) => r === 'APPROVED') && {
          summaryMessage: 'Not enough approvals',
          detailedMessage: 'You need 1 more approval before this pull request can be merged.',
        },
        builds(pr).some(([, b]) => b !== 'SUCCESSFUL') && {
          summaryMessage: 'Builds not passing',
          detailedMessage: 'This pull request needs a successful build before it can be merged.',
        },
      ].filter(Boolean)
      const conflicted = pr.merge === 'CONFLICTED'
      return HttpResponse.json({
        canMerge: pr.state === 'OPEN' && !conflicted && vetoes.length === 0,
        conflicted,
        outcome: pr.merge,
        vetoes,
      })
    }),
    http.post(`${prUrl}/merge`, ({ params, request }) => {
      const pr = find(params)
      if (!pr) return new HttpResponse(null, { status: 404 })
      if (new URL(request.url).searchParams.get('version') !== String(pr.version ?? 0))
        return refused(409, 'The pull request has been updated since you last viewed it.')
      pr.state = 'MERGED'
      pr.updated = 0
      pr.version = (pr.version ?? 0) + 1
      return HttpResponse.json(prJson(pr, Date.now()))
    }),
  ]
}
