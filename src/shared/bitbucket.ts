import { z } from 'zod'
import type { Provider } from './providers'

/**
 * Normalised pull-request model (SPEC 6.3): Bitbucket Cloud (REST 2.0) and Data Center (REST
 * 1.0) map onto it, and since P7.04 GitHub pull requests and GitLab merge requests too (the
 * ref's `provider`; absent means Bitbucket, so stored watches and Bitbucket code are unchanged).
 */

export const BITBUCKET_FLAVORS = ['cloud', 'datacenter'] as const
export type BitbucketFlavor = (typeof BITBUCKET_FLAVORS)[number]

/** Workspace / project key / repo slug. DC user repos use the personal project key `~user`. */
const SLUG = /^~?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** A SLUG, or a GitLab namespace with subgroups, `group/sub/team` (each part a slug). */
const OWNER =
  /^(?:~?[A-Za-z0-9][A-Za-z0-9._-]{0,99}|[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){1,19})$/

/** Providers other than Bitbucket, as stored on a ref. */
export const OTHER_PROVIDERS = ['github', 'gitlab'] as const

/**
 * One pull request: Bitbucket workspace or DC project (`~user` for personal repos), GitHub
 * owner, or GitLab namespace (`group/sub`); repo / project slug; id (GitLab: the MR's `iid`).
 * Checked like renderer input before any of it reaches a URL path.
 */
export const PrRefSchema = z
  .object({
    /** Absent: Bitbucket (every ref before P7.04). */
    provider: z.enum(OTHER_PROVIDERS).optional(),
    owner: z.string().max(2100).regex(OWNER, 'Not a workspace or project key'),
    repo: z.string().regex(SLUG, 'Not a repository slug'),
    id: z.number().int().positive().max(1e9),
  })
  .refine((r) => r.provider === 'gitlab' || !r.owner.includes('/'), {
    message: 'Only a GitLab namespace has subgroups',
    path: ['owner'],
  })
  .refine((r) => !r.provider || (!r.owner.startsWith('~') && !r.repo.startsWith('~')), {
    message: 'Not an owner name',
    path: ['owner'],
  })
export type PrRef = z.infer<typeof PrRefSchema>

/** The provider a ref belongs to. */
export const providerOf = (ref: { provider?: Provider }): Provider => ref.provider ?? 'bitbucket'

/** `web-app #412`, GitLab `web-app !12`. */
export const refLabel = (ref: PrRef) =>
  `${ref.repo} ${ref.provider === 'gitlab' ? '!' : '#'}${ref.id}`
/** A repository: Cloud workspace or DC project key, and repo slug. */
export type RepoRef = Omit<PrRef, 'id'>

/**
 * Stable key for a PR, e.g. `proj/web-app#42`. Lower case: slugs and project keys are
 * case-insensitive, and DC spells a personal project `~JDOE` where its links say `/users/jdoe`.
 */
export const prKey = (ref: PrRef) =>
  `${ref.provider ? `${ref.provider}:` : ''}${ref.owner}/${ref.repo}#${ref.id}`.toLowerCase()

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

/** T7: the description and changed files the AI summary reads, bounded so a big PR stays small. */
export const MAX_PR_DESCRIPTION = 4_000
export const MAX_PR_FILES = 100

export const PR_FILE_STATUSES = ['added', 'modified', 'removed', 'renamed'] as const

export const PrChangesSchema = z.object({
  /** The author's description, trimmed; cut at MAX_PR_DESCRIPTION characters. */
  description: z.string(),
  descriptionCut: z.boolean(),
  /** Up to MAX_PR_FILES changed files, as the API lists them. */
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(PR_FILE_STATUSES),
      /** Lines added / removed; null where the API doesn't say (Bitbucket Data Center). */
      added: z.number().int().nullable(),
      removed: z.number().int().nullable(),
    }),
  ),
  /** Changed files in all (more than `files` when the list was cut). */
  filesTotal: z.number().int(),
  /**
   * False when the API gave no total (a full list may go on) or only a floor (GitLab's "1000+"):
   * `filesTotal` is then "at least".
   */
  filesTotalExact: z.boolean(),
})
export type PrChanges = z.infer<typeof PrChangesSchema>
export type PrFileChange = PrChanges['files'][number]

/** A provider's file status in DevDock's words; anything else (copied, conflicted…) is modified. */
export const asFileStatus = (v: unknown): PrFileChange['status'] =>
  (PR_FILE_STATUSES as readonly unknown[]).includes(v) ? (v as PrFileChange['status']) : 'modified'

/**
 * Description and files cut to the bounds, with the cut recorded. `total`: the API's count, or
 * `{ atLeast }` for a floor (GitLab's "1000+"), or null when it gave none — then a list that
 * fills the cap may go on, so the total is "at least" the list's length.
 */
export function boundChanges(
  description: string,
  files: PrFileChange[],
  total: number | { atLeast: number } | null,
): PrChanges {
  const text = description.trim()
  const listed = files.slice(0, MAX_PR_FILES)
  const [filesTotal, filesTotalExact] =
    typeof total === 'number'
      ? [Math.max(total, listed.length), true]
      : total
        ? [Math.max(total.atLeast, listed.length), false]
        : [listed.length, files.length < MAX_PR_FILES]
  return {
    description: text.slice(0, MAX_PR_DESCRIPTION),
    descriptionCut: text.length > MAX_PR_DESCRIPTION,
    files: listed,
    filesTotal,
    filesTotalExact,
  }
}

/** Added / removed lines in a unified diff's body (`+`/`-` lines, not the `+++`/`---` headers). */
export function diffLineCounts(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    // File headers are `+++ b/path` / `--- a/path`; a changed line may start with `++`.
    if (line.startsWith('+') && !line.startsWith('+++ ')) added++
    else if (line.startsWith('-') && !line.startsWith('--- ')) removed++
  }
  return { added, removed }
}

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

/**
 * The actions each provider's API offers. GitLab's REST API has no "request changes" (only
 * approve / unapprove), so `needs_work` isn't offered there.
 */
export const PROVIDER_ACTIONS: Record<Provider, readonly PrAction[]> = {
  bitbucket: PR_ACTIONS,
  github: PR_ACTIONS,
  gitlab: ['approve', 'merge'],
}

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
