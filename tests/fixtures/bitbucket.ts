/**
 * Recorded-style Bitbucket payloads (trimmed to the fields DevDock reads). The scripted
 * HttpClient and response helpers are shared with the Jira fixtures.
 */

export { ScriptedHttp, json, type Route } from './jira'

export const CLOUD_API = 'https://api.bitbucket.org/2.0'
export const DC_BASE = 'https://bitbucket.example.com'
export const ME_UUID = '{3f2a1b4c-0d9e-4f8a-9b7c-6e5d4c3b2a10}'

export const cloud = {
  user: {
    type: 'user',
    uuid: ME_UUID,
    display_name: 'Ada Example',
    nickname: 'ada',
    account_id: '5b10ac8d82e05b22cc7d4ef5',
    links: { html: { href: 'https://bitbucket.org/%7B3f2a1b4c%7D/' } },
  },
  /** One PR as listed with `fields=+values.participants`. */
  pr: (id: number, overrides: Record<string, unknown> = {}) => ({
    type: 'pullrequest',
    id,
    title: `Add checkout summary card #${id}`,
    state: 'OPEN',
    author: { type: 'user', display_name: 'Ada Example', uuid: ME_UUID },
    source: {
      branch: { name: `feature/NM-${id}-summary-card` },
      commit: { type: 'commit', hash: `a1b2c3d4e5f${id}` },
      repository: { full_name: 'acme/web-app', type: 'repository' },
    },
    destination: {
      branch: { name: 'develop' },
      commit: { hash: '9f8e7d6c5b4a' },
      repository: { full_name: 'acme/web-app', type: 'repository' },
    },
    participants: [
      {
        type: 'participant',
        user: { display_name: 'Priya Reviewer', uuid: '{p}' },
        role: 'REVIEWER',
        approved: true,
        state: 'approved',
      },
      {
        type: 'participant',
        user: { display_name: 'Sam Lead', uuid: '{s}' },
        role: 'REVIEWER',
        approved: false,
        state: 'changes_requested',
      },
      {
        type: 'participant',
        user: { display_name: 'Drive-by Commenter', uuid: '{d}' },
        role: 'PARTICIPANT',
        approved: false,
        state: null,
      },
    ],
    comment_count: 5,
    task_count: 1,
    created_on: '2026-10-20T09:15:00.000000+00:00',
    updated_on: '2026-10-23T16:40:12.345678+00:00',
    links: {
      html: { href: `https://bitbucket.org/acme/web-app/pull-requests/${id}` },
      self: { href: `${CLOUD_API}/repositories/acme/web-app/pullrequests/${id}` },
    },
    ...overrides,
  }),
  comments: [
    { id: 1, deleted: false, content: { raw: 'nit' } }, // open thread
    { id: 2, deleted: false, content: { raw: 'fixed' }, parent: { id: 1 } }, // reply
    {
      id: 3,
      deleted: false,
      content: { raw: 'done' },
      resolution: { type: 'comment_resolution', created_on: '2026-10-22T10:00:00Z' },
    },
    { id: 4, deleted: true, content: { raw: '' } },
    { id: 5, deleted: false, content: { raw: 'why?' }, inline: { path: 'src/App.tsx', to: 3 } },
  ],
  statuses: [
    {
      type: 'build',
      key: 'JENKINS-WEB',
      name: 'web-app » PR-42',
      state: 'SUCCESSFUL',
      url: 'https://jenkins.example.com/job/web-app/job/PR-42/3/',
    },
    {
      type: 'build',
      key: 'LINT',
      name: 'lint',
      state: 'INPROGRESS',
      url: 'https://jenkins.example.com/job/lint/9/',
    },
  ],
}

const ms = (iso: string) => Date.parse(iso)

export const dc = {
  applicationProperties: { version: '8.19.1', buildNumber: '8019001', displayName: 'Bitbucket' },
  user: { name: 'ada', slug: 'ada', displayName: 'Ada Example', emailAddress: 'ada@example.com' },
  pr: (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    version: 3,
    title: `Fix date picker focus #${id}`,
    state: 'OPEN',
    open: true,
    closed: false,
    createdDate: ms('2026-10-21T08:00:00Z'),
    updatedDate: ms('2026-10-23T12:30:00Z'),
    fromRef: {
      id: `refs/heads/bugfix/OPS-${id}-focus`,
      displayId: `bugfix/OPS-${id}-focus`,
      latestCommit: `0123456789abcdef0123456789abcdef0123${id}`,
      repository: { slug: 'web-app', project: { key: 'PROJ' } },
    },
    toRef: {
      id: 'refs/heads/develop',
      displayId: 'develop',
      latestCommit: 'fedcba9876543210fedcba9876543210fedcba98',
      repository: { slug: 'web-app', name: 'web-app', project: { key: 'PROJ', name: 'Project' } },
    },
    author: { user: { name: 'ada', displayName: 'Ada Example' }, role: 'AUTHOR', approved: false },
    reviewers: [
      {
        user: { name: 'priya', displayName: 'Priya Reviewer' },
        role: 'REVIEWER',
        approved: true,
        status: 'APPROVED',
      },
      {
        user: { name: 'sam', displayName: 'Sam Lead' },
        role: 'REVIEWER',
        approved: false,
        status: 'UNAPPROVED',
      },
    ],
    participants: [
      {
        user: { name: 'lee', displayName: 'Lee QA' },
        role: 'PARTICIPANT',
        approved: false,
        status: 'NEEDS_WORK',
      },
      {
        user: { name: 'kim', displayName: 'Kim Watcher' },
        role: 'PARTICIPANT',
        approved: false,
        status: 'UNAPPROVED',
      },
    ],
    properties: {
      mergeResult: { outcome: 'CONFLICTED', current: true },
      resolvedTaskCount: 0,
      commentCount: 6,
      openTaskCount: 1,
    },
    links: {
      self: [{ href: `${DC_BASE}/projects/PROJ/repos/web-app/pull-requests/${id}` }],
    },
    ...overrides,
  }),
  activities: [
    {
      id: 1,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: { id: 11, text: 'a', threadResolved: false },
    },
    {
      id: 2,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: { id: 12, text: 'b', threadResolved: true },
    },
    {
      id: 3,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: { id: 13, text: 'c', threadResolved: false },
    },
    { id: 4, action: 'COMMENTED', commentAction: 'EDITED', comment: { id: 11, text: 'a2' } },
    { id: 5, action: 'APPROVED', user: { name: 'priya' } },
    { id: 6, action: 'OPENED' },
  ],
  builds: [
    {
      state: 'FAILED',
      key: 'WEB-PR',
      name: 'web-app » PR-7',
      url: 'https://jenkins.example.com/job/web-app/job/PR-7/5/',
      dateAdded: ms('2026-10-23T12:35:00Z'),
    },
    {
      state: 'SUCCESSFUL',
      key: 'SONAR',
      name: 'Sonar',
      url: 'https://sonar.example.com/x',
      dateAdded: ms('2026-10-23T12:36:00Z'),
    },
  ],
}

/** DC paged envelope. */
export const dcPage = (values: unknown[], nextPageStart?: number) => ({
  size: values.length,
  limit: 25,
  start: 0,
  isLastPage: nextPageStart === undefined,
  values,
  ...(nextPageStart === undefined ? {} : { nextPageStart }),
})
