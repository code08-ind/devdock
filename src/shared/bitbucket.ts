import { z } from 'zod'

/** Normalised Bitbucket model (SPEC 6.3): Cloud (REST 2.0) and Data Center (REST 1.0) map onto it. */

export const BITBUCKET_FLAVORS = ['cloud', 'datacenter'] as const
export type BitbucketFlavor = (typeof BITBUCKET_FLAVORS)[number]

/** Workspace / project key / repo slug. DC user repos use the personal project key `~user`. */
const SLUG = /^~?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** One pull request: Cloud workspace or DC project (`~user` for personal repos), repo, id. */
export const PrRefSchema = z.object({
  owner: z.string().regex(SLUG, 'Not a workspace or project key'),
  repo: z.string().regex(SLUG, 'Not a repository slug'),
  id: z.number().int().positive().max(1e9),
})
export type PrRef = z.infer<typeof PrRefSchema>
/** A repository: Cloud workspace or DC project key, and repo slug. */
export type RepoRef = Omit<PrRef, 'id'>

/**
 * Stable key for a PR, e.g. `proj/web-app#42`. Lower case: slugs and project keys are
 * case-insensitive, and DC spells a personal project `~JDOE` where its links say `/users/jdoe`.
 */
export const prKey = (ref: PrRef) => `${ref.owner}/${ref.repo}#${ref.id}`.toLowerCase()

export const PR_STATES = ['open', 'merged', 'declined'] as const
export const REVIEW_STATUSES = ['approved', 'needs_work', 'unapproved'] as const
export const BUILD_STATES = ['success', 'failed', 'running', 'stopped', 'none'] as const
export type BuildState = (typeof BUILD_STATES)[number]

export const BuildStatusSchema = z.object({
  key: z.string(),
  name: z.string(),
  state: z.enum(BUILD_STATES),
  url: z.string().nullable(),
})
export type BuildStatus = z.infer<typeof BuildStatusSchema>

export const BuildSummarySchema = z.object({
  /** failed > running > stopped > success; `none` when nothing reported. */
  state: z.enum(BUILD_STATES),
  statuses: z.array(BuildStatusSchema),
})
export type BuildSummary = z.infer<typeof BuildSummarySchema>

export const ReviewerSchema = z.object({
  name: z.string(),
  status: z.enum(REVIEW_STATUSES),
})

export const PullRequestSchema = z.object({
  /** `prKey(ref)`. */
  key: z.string(),
  ref: PrRefSchema,
  title: z.string(),
  /** Browser link. */
  url: z.string(),
  author: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  state: z.enum(PR_STATES),
  reviewers: z.array(ReviewerSchema),
  approvals: z.number().int(),
  needsWork: z.number().int(),
  /** All comments, as the list APIs report them. */
  comments: z.number().int(),
  /** Unresolved comment threads; null where the list API doesn't say (filled for a single PR). */
  unresolvedComments: z.number().int().nullable(),
  /** Null when the API doesn't expose it (Cloud). */
  conflicts: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Merge/decline time; null while open. */
  closedAt: z.string().nullable(),
  /** Head commit of the source branch (build statuses hang off it). */
  sourceCommit: z.string().nullable(),
  build: BuildSummarySchema,
})
export type PullRequest = z.infer<typeof PullRequestSchema>

export const BitbucketUserSchema = z.object({
  displayName: z.string(),
  /** Nickname / account id (Cloud) or user name (Data Center). */
  account: z.string().nullable(),
})
export type BitbucketUser = z.infer<typeof BitbucketUserSchema>

export const BitbucketConnectionSchema = z.object({
  flavor: z.enum(BITBUCKET_FLAVORS),
  status: z.number().int(),
  user: BitbucketUserSchema,
})
export type BitbucketConnection = z.infer<typeof BitbucketConnectionSchema>

export const BitbucketDetectionSchema = z.object({
  flavor: z.enum(BITBUCKET_FLAVORS),
  /** Data Center version from application-properties; null for Cloud. */
  version: z.string().nullable(),
})
export type BitbucketDetection = z.infer<typeof BitbucketDetectionSchema>

/** SPEC 6.3 lists: My open PRs, Reviewing (read-only), Recently merged (7 days). */
export const PR_LISTS = ['mine', 'reviewing', 'merged'] as const
export type PrList = (typeof PR_LISTS)[number]
export const MERGED_WINDOW_DAYS = 7

/** Most severe first: one failure fails the PR; anything still running keeps it running. */
export function summariseBuilds(statuses: BuildStatus[]): BuildSummary {
  const order: BuildState[] = ['failed', 'running', 'stopped', 'success']
  const state = order.find((s) => statuses.some((b) => b.state === s)) ?? 'none'
  return { state, statuses }
}

/** SPEC 6.3 PR actions; off unless `features.prActions`, each confirmed in the renderer. */
export const PR_ACTIONS = ['approve', 'needs_work', 'merge'] as const
export type PrAction = (typeof PR_ACTIONS)[number]

export const PrActionRequestSchema = z
  .object({
    ref: PrRefSchema,
    action: z.enum(PR_ACTIONS),
    /** The renderer's confirmation dialog was accepted (SPEC 7: no remote change without one). */
    confirmed: z.literal(true),
    /** Merge only: the target branch as the user typed it; must equal the PR's current target. */
    targetBranch: z.string().max(255).optional(),
  })
  .refine((r) => r.action !== 'merge' || !!r.targetBranch, {
    message: 'Type the target branch name to merge',
    path: ['targetBranch'],
  })
export type PrActionRequest = z.infer<typeof PrActionRequestSchema>

/** Most PRs watched at once (SPEC 7 measures 10; this keeps polling bounded). */
export const MAX_WATCHES = 50

/** One watched PR, persisted with the last state seen so a restart doesn't notify again. */
export const WatchItemSchema = z.object({
  key: z.string(),
  ref: PrRefSchema,
  /** Site the link belongs to (lower case); polled only while Settings point at it. */
  site: z.string(),
  addedAt: z.number(),
  checkedAt: z.number().nullable(),
  /** Last snapshot; changes against it produce the notifications. */
  pr: PullRequestSchema,
  /** Why the last check failed (shown on the item); null when it worked. */
  error: z.string().nullable(),
})
export type WatchItem = z.infer<typeof WatchItemSchema>

/** Watches are polled until the PR is merged or declined. */
export const isLive = (w: WatchItem) => w.pr.state === 'open'
