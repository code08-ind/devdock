import { z } from 'zod'

/** Normalised Jira model (SPEC 6.5): Cloud (REST v3) and Data Center (REST v2) map onto it. */

export const JIRA_FLAVORS = ['cloud', 'datacenter'] as const
export type JiraFlavor = (typeof JIRA_FLAVORS)[number]

export const DEFAULT_JQL =
  'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'

/** PROJ-123. Checked before a key is put into a URL path. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/
export const IssueKeySchema = z.string().regex(ISSUE_KEY, 'Not a Jira issue key')

/** A status or transition name meaning "In Progress" (case and spacing ignored). */
export const isInProgress = (name: string) => /^in\s+progress$/i.test(name.trim())

/** Jira's status categories: To Do / In Progress / Done. */
export const STATUS_CATEGORIES = ['new', 'indeterminate', 'done', 'unknown'] as const

export const JiraIssueSchema = z.object({
  key: z.string(),
  /** Browser link to the issue. */
  url: z.string(),
  /** Issue type name as Jira shows it ("Bug", "Story", "Task", …). */
  type: z.string(),
  priority: z.string().nullable(),
  status: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
  summary: z.string(),
  /** Name of the open (else latest) sprint. */
  sprint: z.string().nullable(),
  fixVersions: z.array(z.string()),
  assignee: z.string().nullable(),
  updated: z.string(),
})
export type JiraIssue = z.infer<typeof JiraIssueSchema>

export const JiraCommentSchema = z.object({
  author: z.string(),
  created: z.string(),
  /** Markdown. */
  body: z.string(),
})
export type JiraComment = z.infer<typeof JiraCommentSchema>

export const LINK_KINDS = ['figma', 'confluence'] as const
export const JiraLinkSchema = z.object({ kind: z.enum(LINK_KINDS), url: z.string() })
export type JiraLink = z.infer<typeof JiraLinkSchema>

export const JiraIssueDetailSchema = JiraIssueSchema.extend({
  /** Description converted to Markdown (ADF on Cloud, wiki markup on Data Center). */
  description: z.string(),
  /** From an "Acceptance Criteria" field, else that section of the description; null if none. */
  acceptanceCriteria: z.string().nullable(),
  /** Figma / Confluence URLs found in the description. */
  links: z.array(JiraLinkSchema),
  /** Last 10, oldest first. */
  comments: z.array(JiraCommentSchema),
})
export type JiraIssueDetail = z.infer<typeof JiraIssueDetailSchema>

export const JiraUserSchema = z.object({
  displayName: z.string(),
  /** Email (Cloud, when visible) or user name (Data Center). */
  account: z.string().nullable(),
})
export type JiraUser = z.infer<typeof JiraUserSchema>

export const JiraConnectionSchema = z.object({
  flavor: z.enum(JIRA_FLAVORS),
  status: z.number().int(),
  user: JiraUserSchema,
})
export type JiraConnection = z.infer<typeof JiraConnectionSchema>

export const SavedQuerySchema = z.object({
  name: z.string().trim().min(1).max(60),
  jql: z.string().trim().min(1).max(2000),
})
export type SavedQuery = z.infer<typeof SavedQuerySchema>

/** Which list to load: My open issues, Current sprint, or a saved query by name. */
export const JiraListRequestSchema = z.discriminatedUnion('list', [
  z.object({ list: z.literal('mine') }),
  z.object({ list: z.literal('sprint') }),
  z.object({ list: z.literal('saved'), name: z.string().min(1).max(60) }),
])
export type JiraListRequest = z.infer<typeof JiraListRequestSchema>
