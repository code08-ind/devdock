import { http, HttpResponse, type RequestHandler } from 'msw'
import type { JiraConfig } from '../services/jira/client'
import { DEMO_ORIGIN } from './origin'

/**
 * Demo Jira (Cloud flavour): 8 obviously fake issues — bugs, stories (one vague), a task with
 * no acceptance criteria, one whose criteria live in a custom field.
 */
export const DEMO_JIRA: { config: JiraConfig; boardId: number } = {
  config: {
    flavor: 'cloud',
    baseUrl: `${DEMO_ORIGIN}/jira`,
    email: 'dev@example.com',
    token: 'demo',
  },
  boardId: 7,
}

const BASE = DEMO_JIRA.config.baseUrl
const SPRINT_FIELD = 'customfield_10020'
const AC_FIELD = 'customfield_10050'
const SPRINT = { id: 42, name: 'Demo Sprint 7', state: 'active', boardId: DEMO_JIRA.boardId }

// ---- tiny ADF builders -------------------------------------------------------------------------
type Node = Record<string, unknown>
const t = (text: string, ...marks: string[]): Node => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
})
const a = (text: string, href: string): Node => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
})
const p = (...content: Node[]): Node => ({ type: 'paragraph', content })
const h = (level: number, text: string): Node => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
})
const li = (...content: Node[]): Node => ({ type: 'listItem', content: [p(...content)] })
const ul = (...items: Node[]): Node => ({ type: 'bulletList', content: items })
const ol = (...items: Node[]): Node => ({
  type: 'orderedList',
  attrs: { order: 1 },
  content: items,
})
const code = (language: string, text: string): Node => ({
  type: 'codeBlock',
  attrs: { language },
  content: [t(text)],
})
const mention = (name: string): Node => ({
  type: 'mention',
  attrs: { id: 'demo', text: `@${name}` },
})
const doc = (...content: Node[]): Node => ({ type: 'doc', version: 1, content })
const cell = (kind: 'tableHeader' | 'tableCell', text: string): Node => ({
  type: kind,
  content: [p(t(text))],
})
const table = (head: string[], ...rows: string[][]): Node => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((x) => cell('tableHeader', x)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((x) => cell('tableCell', x)) })),
  ],
})

const people = {
  me: { accountId: 'demo-0001', displayName: 'Demo Developer', emailAddress: 'dev@example.com' },
  pm: { accountId: 'demo-0002', displayName: 'Pat Example (PM)' },
  qa: { accountId: 'demo-0003', displayName: 'Quinn Example (QA)' },
}
const STATUS = {
  todo: { name: 'To Do', statusCategory: { key: 'new' } },
  progress: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  review: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
  done: { name: 'Done', statusCategory: { key: 'done' } },
}
const comment = (author: Node, created: string, ...content: Node[]) => ({
  author,
  created,
  body: doc(...content),
})

interface DemoIssue {
  key: string
  type: 'Bug' | 'Story' | 'Task'
  priority: string
  status: keyof typeof STATUS
  summary: string
  inSprint: boolean
  fixVersion?: string
  updated: string
  description: Node
  acceptanceField?: Node
  comments?: ReturnType<typeof comment>[]
}

const ISSUES: DemoIssue[] = [
  {
    key: 'DD-101',
    type: 'Bug',
    priority: 'High',
    status: 'progress',
    summary: 'Checkout total rounds wrong for 3-decimal currencies',
    inSprint: true,
    fixVersion: '2.4.0',
    updated: '2026-10-22T16:40:00.000+0000',
    description: doc(
      p(
        t('Orders in '),
        t('KWD', 'code'),
        t(' and '),
        t('BHD', 'code'),
        t(' show a total off by 0.001.'),
      ),
      h(3, 'Steps to reproduce'),
      ol(
        li(t('Switch the demo store to Kuwaiti dinar')),
        li(t('Add two items at 1.005')),
        li(t('Open checkout')),
      ),
      h(3, 'Expected'),
      p(t('Total is '), t('2.010', 'strong'), t(', not 2.009.')),
      code('ts', 'const total = items.reduce((s, i) => s + i.price, 0) // float sum'),
      h(3, 'Acceptance criteria'),
      ul(
        li(t('Totals use minor units for every currency')),
        li(t('A unit test covers 0-, 2- and 3-decimal currencies')),
      ),
    ),
    comments: [
      comment(
        people.qa,
        '2026-10-21T09:12:00.000+0000',
        p(t('Reproduced on staging. Also affects refunds.')),
      ),
      comment(
        people.me,
        '2026-10-22T16:40:00.000+0000',
        p(t('Looking at it — '), mention('Quinn Example (QA)'), t(' thanks.')),
      ),
    ],
  },
  {
    key: 'DD-102',
    type: 'Story',
    priority: 'Medium',
    status: 'todo',
    summary: 'Saved payment methods on the profile page',
    inSprint: true,
    fixVersion: '2.5.0',
    updated: '2026-10-21T11:05:00.000+0000',
    description: doc(
      p(
        t(
          'As a returning customer I want to see and remove my saved cards, so I stay in control of them.',
        ),
      ),
      p(
        t('Design: '),
        a(
          'Profile – payment methods',
          'https://www.figma.com/design/DEMOfile123/Profile?node-id=12-34',
        ),
      ),
      p(
        t('Background: '),
        a(
          'Payments RFC',
          'https://example-team.atlassian.net/wiki/spaces/DEMO/pages/1234/Payments+RFC',
        ),
      ),
      h(2, 'Acceptance criteria'),
      ul(
        li(t('Cards list shows brand, last 4 digits and expiry')),
        li(t('Remove asks for confirmation and updates the list')),
        li(t('Empty state links to "Add a card"')),
      ),
      h(2, 'Card brands'),
      table(['Brand', 'Icon'], ['Visa', 'visa.svg'], ['Mastercard', 'mc.svg']),
    ),
  },
  {
    key: 'DD-103',
    type: 'Story',
    priority: 'Medium',
    status: 'todo',
    summary: 'Make the dashboard feel faster',
    inSprint: true,
    updated: '2026-10-20T15:30:00.000+0000',
    description: doc(p(t('Users say the dashboard is slow. Can we make it snappier?'))),
    comments: [
      comment(
        people.pm,
        '2026-10-20T15:30:00.000+0000',
        p(t('Not sure which widgets are slow yet.')),
      ),
    ],
  },
  {
    key: 'DD-104',
    type: 'Task',
    priority: 'Low',
    status: 'todo',
    summary: 'Upgrade the date library to the next major version',
    inSprint: false,
    updated: '2026-10-19T08:00:00.000+0000',
    description: doc(
      p(t('The current version is out of support. Upgrade and fix any breaking changes.')),
    ),
  },
  {
    key: 'DD-105',
    type: 'Bug',
    priority: 'Medium',
    status: 'todo',
    summary: 'Login button is unreadable in high-contrast mode',
    inSprint: true,
    updated: '2026-10-18T13:20:00.000+0000',
    description: doc(
      p(
        t('Text and background are both near-white with '),
        t('forced-colors: active', 'code'),
        t('.'),
      ),
      code('css', '.login-button { color: #fafafa; background: #ffffff; }'),
    ),
  },
  {
    key: 'DD-106',
    type: 'Story',
    priority: 'High',
    status: 'review',
    summary: 'Export orders as CSV',
    inSprint: false,
    fixVersion: '2.4.0',
    updated: '2026-10-17T10:45:00.000+0000',
    description: doc(p(t('Ops need a CSV of orders for a date range.'))),
    acceptanceField: doc(
      ul(
        li(t('Date range picker, max 92 days')),
        li(t('CSV columns match the orders table')),
        li(t('Large exports stream, no timeout')),
      ),
    ),
  },
  {
    key: 'DD-107',
    type: 'Task',
    priority: 'Medium',
    status: 'done',
    summary: 'Add retries to the webhook sender',
    inSprint: false,
    updated: '2026-10-15T09:00:00.000+0000',
    description: doc(p(t('Retry 5xx responses 3 times with backoff.'))),
  },
  {
    key: 'DD-108',
    type: 'Bug',
    priority: 'Low',
    status: 'progress',
    summary: 'Toast flickers when switching to dark mode',
    inSprint: false,
    updated: '2026-10-14T17:10:00.000+0000',
    description: doc(p(t('Seen in the demo build only. '), t('Low impact', 'em'), t('.'))),
  },
]

function raw(i: DemoIssue) {
  return {
    id: String(10000 + Number(i.key.split('-')[1])),
    key: i.key,
    fields: {
      summary: i.summary,
      issuetype: { name: i.type },
      priority: { name: i.priority },
      status: STATUS[i.status],
      fixVersions: i.fixVersion ? [{ name: i.fixVersion }] : [],
      assignee: people.me,
      updated: i.updated,
      [SPRINT_FIELD]: i.inSprint ? [SPRINT] : null,
      [AC_FIELD]: i.acceptanceField ?? null,
      description: i.description,
    },
  }
}

/** Issues the demo user moved (to In Review, to Done) on the previous working day. */
const CHANGED_BY_ME = ['DD-106', 'DD-107']

export const jiraHandlers: RequestHandler[] = [
  http.get(`${BASE}/rest/api/3/myself`, () => HttpResponse.json(people.me)),
  http.get(`${BASE}/rest/api/3/field`, () =>
    HttpResponse.json([
      { id: 'summary', name: 'Summary', custom: false },
      {
        id: SPRINT_FIELD,
        name: 'Sprint',
        custom: true,
        schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
      },
      { id: AC_FIELD, name: 'Acceptance Criteria', custom: true, schema: { custom: 'textarea' } },
    ]),
  ),
  http.get(`${BASE}/rest/api/3/search/jql`, ({ request }) => {
    const jql = new URL(request.url).searchParams.get('jql') ?? ''
    const issues = ISSUES.filter((i) =>
      /sprint in/i.test(jql)
        ? i.inSprint
        : /status CHANGED BY currentUser\(\)/i.test(jql)
          ? // Standup: what the demo user moved on the previous working day.
            CHANGED_BY_ME.includes(i.key)
          : /statusCategory\s*=\s*"In Progress"/i.test(jql)
            ? i.status === 'progress' || i.status === 'review'
            : /statusCategory\s*!=\s*Done/i.test(jql)
              ? i.status !== 'done'
              : true,
    )
    return HttpResponse.json({ issues: issues.map(raw), isLast: true })
  }),
  http.get(`${BASE}/rest/agile/1.0/board/:id/sprint`, ({ params }) =>
    Number(params.id) === DEMO_JIRA.boardId
      ? HttpResponse.json({ isLast: true, values: [SPRINT] })
      : HttpResponse.json({ errorMessages: ['Board not found'] }, { status: 404 }),
  ),
  // Workflow: To Do → In Progress ("Start progress"); other statuses offer no such move.
  http.get(`${BASE}/rest/api/3/issue/:key/transitions`, ({ params }) => {
    const issue = ISSUES.find((i) => i.key === params.key)
    if (!issue)
      return HttpResponse.json({ errorMessages: ['Issue does not exist'] }, { status: 404 })
    const transitions =
      issue.status === 'todo'
        ? [{ id: '21', name: 'Start progress', to: STATUS.progress }]
        : [{ id: '31', name: 'Done', to: STATUS.done }]
    return HttpResponse.json({ transitions })
  }),
  http.post(
    `${BASE}/rest/api/3/issue/:key/transitions`,
    () => new HttpResponse(null, { status: 204 }),
  ),
  // Newest first, like `orderBy=-created`.
  http.get(`${BASE}/rest/api/3/issue/:key/comment`, ({ params }) => {
    const issue = ISSUES.find((i) => i.key === params.key)
    if (!issue)
      return HttpResponse.json({ errorMessages: ['Issue does not exist'] }, { status: 404 })
    const comments = [...(issue.comments ?? [])].reverse().slice(0, 10)
    return HttpResponse.json({ startAt: 0, maxResults: 10, total: comments.length, comments })
  }),
  http.get(`${BASE}/rest/api/3/issue/:key`, ({ params }) => {
    const issue = ISSUES.find((i) => i.key === params.key)
    return issue
      ? HttpResponse.json(raw(issue))
      : HttpResponse.json(
          { errorMessages: ['Issue does not exist or you do not have permission to see it.'] },
          { status: 404 },
        )
  }),
]
