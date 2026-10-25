import { z } from 'zod'

/**
 * Jenkins model (SPEC 6.4). A job is named by its **path**: the raw Jenkins item names from
 * the root down, joined with `/` (`apps/web-app/feature%2FDD-1`). Jenkins forbids `/` in item
 * names (multibranch encodes it as `%2F`), so the path is unambiguous; each name is
 * URL-encoded again when it goes into `/job/…`.
 */

/** One raw item name: no `/` `\` `?` `#`, no control characters, not `.` or `..`. */
// eslint-disable-next-line no-control-regex -- control characters are what it rejects.
const SEGMENT = /^(?!\.{1,2}$)[^/\\?#\u0000-\u001f\u007f]{1,200}$/

export const isJobPath = (path: string): boolean => {
  const segments = path.split('/')
  return segments.length <= 10 && segments.every((s) => SEGMENT.test(s))
}

export const JobPathSchema = z
  .string()
  .trim()
  .max(1000)
  .refine(isJobPath, 'Use the job path, e.g. apps/web-app')
export type JobPath = string

/** `{base}/job/a/job/b` for path `a/b`. */
export function jobUrl(baseUrl: string, path: JobPath): string {
  const segments = path.split('/').map((s) => encodeURIComponent(s))
  return `${baseUrl.replace(/\/+$/, '')}/job/${segments.join('/job/')}`
}

/** The name Jenkins shows for an item: a multibranch child's name decoded (`feature/DD-1`). */
export function displayName(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** `web-app › feature/DD-1` for `web-app/feature%2FDD-1`: how a job is named to people. */
export const jobLabel = (path: JobPath) => path.split('/').map(displayName).join(' › ')

const hostKey = (url: URL) =>
  `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'http:' ? '80' : '443')}`

/**
 * Job path (and build number) from a classic Jenkins link on the configured site:
 * `{base}/job/a/job/b/12/`, with any page after it (`console`, `display/redirect`, …). The
 * scheme is ignored (Jenkins' root URL may say http behind an https proxy). Null for other
 * hosts, other context paths and links that aren't job links.
 */
export function jobFromUrl(
  baseUrl: string,
  link: string,
): { job: JobPath; build: number | null } | null {
  let base: URL
  let url: URL
  try {
    base = new URL(baseUrl)
    url = new URL(link)
  } catch {
    return null
  }
  if (hostKey(base) !== hostKey(url)) return null
  const prefix = base.pathname.replace(/\/+$/, '').toLowerCase()
  if (!url.pathname.toLowerCase().startsWith(`${prefix}/job/`)) return null
  const parts = url.pathname.slice(prefix.length + 1).split('/')
  const names: string[] = []
  let build: number | null = null
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] !== 'job' || !parts[i + 1]) {
      // After the last job name: an optional build number, then any page.
      build = /^\d+$/.test(parts[i] ?? '') ? Number(parts[i]) : null
      break
    }
    names.push(displayName(parts[i + 1]!))
  }
  const job = names.join('/')
  return names.length && isJobPath(job) ? { job, build } : null
}

/**
 * A job as typed in Settings: its path (`apps/web-app`, slashes around it ignored) or a job
 * link on the configured site. Null when it is neither.
 */
export function jobPathFrom(input: string, baseUrl: string): JobPath | null {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) return baseUrl ? (jobFromUrl(baseUrl, text)?.job ?? null) : null
  const path = text.replace(/^\/+|\/+$/g, '')
  return isJobPath(path) ? path : null
}

/** SPEC 6.4 default: jobs whose name or path contains one of these can never be triggered. */
export const DEFAULT_PROTECTED_JOBS = ['prod', 'production', 'uat', 'release'] as const

/**
 * SPEC 6.4 protected jobs: true when any pattern occurs anywhere in the job's path, ignoring
 * case and Unicode width (`apps/Deploy-PROD`, `release%2F1.2`). A pattern is a substring;
 * `|` separates alternatives (the SPEC writes the default as `prod|production|uat|release`)
 * and `*` matches anything, so either spelling protects rather than silently matching
 * nothing. Names are also checked percent-decoded, so an encoded spelling can't hide one.
 * The renderer hides the trigger button with this; the IPC handler refuses with it too.
 */
export function isProtectedJob(path: string, patterns: readonly string[]): boolean {
  const spellings = new Set<string>()
  let current = path
  for (let i = 0; i < 3; i++) {
    spellings.add(current.normalize('NFKC').toLowerCase())
    const next = displayName(current)
    if (next === current) break
    current = next
  }
  const needles = patterns
    .flatMap((p) => p.split('|'))
    .map((p) => p.trim().normalize('NFKC').toLowerCase())
    .filter((p) => p.replaceAll('*', '') !== '')
  return needles.some((needle) => {
    const glob = new RegExp(needle.split('*').map(escapeRegExp).join('.*'))
    return [...spellings].some((s) => glob.test(s))
  })
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const BUILD_RESULTS = [
  'success',
  'failed',
  'unstable',
  'aborted',
  'not_built',
  'running',
] as const
export type BuildResult = (typeof BUILD_RESULTS)[number]

export const JenkinsBuildSchema = z.object({
  job: z.string(),
  number: z.number().int(),
  /** Browser link, on the configured site. */
  url: z.string(),
  state: z.enum(BUILD_RESULTS),
  /** Epoch ms. */
  startedAt: z.number().nullable(),
  /** Null while running. */
  durationMs: z.number().nullable(),
  /** Jenkins' estimate from earlier builds; null when it has none. */
  estimatedMs: z.number().nullable(),
})
export type JenkinsBuild = z.infer<typeof JenkinsBuildSchema>

export const STAGE_STATES = [
  'success',
  'failed',
  'unstable',
  'aborted',
  'running',
  'paused',
  'queued',
  'skipped',
  'unknown',
] as const
export type StageState = (typeof STAGE_STATES)[number]

export const StageSchema = z.object({
  name: z.string(),
  state: z.enum(STAGE_STATES),
  startedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
})
export type Stage = z.infer<typeof StageSchema>

export const BuildDetailSchema = z.object({
  build: JenkinsBuildSchema,
  /** From the Pipeline REST API (`wfapi`); null = "stages unavailable". */
  stages: z.array(StageSchema).nullable(),
  /** Build parameters (password values are never read). */
  parameters: z.array(z.object({ name: z.string(), value: z.string() })),
  /** "Started by user …", "Branch indexing", … */
  causes: z.array(z.string()),
})
export type BuildDetail = z.infer<typeof BuildDetailSchema>

export const BRANCH_KINDS = ['branch', 'pr'] as const

/** SPEC 6.4 "My branches": one branch (or PR) job of a configured multibranch job. */
export const BranchBuildSchema = z.object({
  /** The multibranch job it belongs to. */
  project: z.string(),
  /** The branch job's path. */
  job: z.string(),
  /** Branch name (`feature/DD-1`) or `PR-412`. */
  branch: z.string(),
  kind: z.enum(BRANCH_KINDS),
  /** PR jobs only. */
  prId: z.number().int().nullable(),
  url: z.string(),
  lastBuild: JenkinsBuildSchema.nullable(),
})
export type BranchBuild = z.infer<typeof BranchBuildSchema>

export const BranchesResultSchema = z.object({
  builds: z.array(BranchBuildSchema),
  /** Configured jobs that couldn't be read (wrong path, no access), with why. */
  skipped: z.array(z.object({ job: z.string(), message: z.string() })),
})
export type BranchesResult = z.infer<typeof BranchesResultSchema>

export const ConsoleChunkSchema = z.object({
  text: z.string(),
  /** Pass back as `start` for the next chunk (bytes, as Jenkins counts). */
  nextStart: z.number().int().nonnegative(),
  /** Jenkins says more is coming (the build is still running). */
  more: z.boolean(),
  /** The log is shorter than `start`: it was replaced, so clear the view and read from 0. */
  reset: z.boolean(),
  /** Only the end of a very long chunk was kept. */
  truncated: z.boolean(),
})
export type ConsoleChunk = z.infer<typeof ConsoleChunkSchema>

export const BuildRefSchema = z.object({
  job: JobPathSchema,
  number: z.number().int().positive().max(1e9),
})
export type BuildRef = z.infer<typeof BuildRefSchema>

export const JenkinsConnectionSchema = z.object({
  status: z.number().int(),
  user: z.object({ id: z.string(), fullName: z.string() }),
  /** From the `X-Jenkins` header; null when hidden. */
  version: z.string().nullable(),
})
export type JenkinsConnection = z.infer<typeof JenkinsConnectionSchema>

/** A job's build parameters (for "Build with parameters"); secrets have no default shown. */
export const ParameterDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'text', 'boolean', 'choice', 'password', 'other']),
  /** As text; '' for password parameters. */
  defaultValue: z.string(),
  choices: z.array(z.string()),
  description: z.string(),
})
export type ParameterDefinition = z.infer<typeof ParameterDefinitionSchema>

/** A parameter name Jenkins accepts (also keeps it a plain form field). */
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/

/** SPEC 6.4 trigger; off unless `features.jobTriggers`, the job allow-listed and not protected. */
export const TriggerRequestSchema = z.object({
  job: JobPathSchema,
  parameters: z
    .record(z.string().regex(PARAMETER_NAME, 'Not a parameter name'), z.string().max(4000))
    .refine((p) => Object.keys(p).length <= 50, 'At most 50 parameters'),
  /** The renderer's confirmation (job, branch, parameters) was accepted (SPEC 7). */
  confirmed: z.literal(true),
})
export type TriggerRequest = z.infer<typeof TriggerRequestSchema>

/**
 * Job paths compare ignoring case (Jenkins item names are case-insensitive on lookup), so the
 * allow-list and watch keys agree with whatever spelling the user typed.
 */
export const sameJob = (a: JobPath, b: JobPath) => a.toLowerCase() === b.toLowerCase()

/**
 * Whether a job may be triggered (SPEC 6.4): triggers on, the job allow-listed, and never a
 * protected job. The renderer shows the button with this; the IPC handler checks the same.
 */
export function triggerRefusal(
  job: JobPath,
  settings: {
    features: { jobTriggers: boolean; allowedJobs: readonly string[] }
    jenkins: { protectedPatterns: readonly string[] }
  },
): 'protected' | 'off' | 'not-allowed' | null {
  if (isProtectedJob(job, settings.jenkins.protectedPatterns)) return 'protected'
  if (!settings.features.jobTriggers) return 'off'
  if (!settings.features.allowedJobs.some((allowed) => sameJob(allowed, job))) return 'not-allowed'
  return null
}

/** SPEC 6.4 watches: one build, a job's next build, or the deploy job's next build for a branch. */
export const BUILD_WATCH_KINDS = ['build', 'job', 'deploy'] as const
export type BuildWatchKind = (typeof BUILD_WATCH_KINDS)[number]

/** Most build watches at once (polling stays bounded, as for PR watches). */
export const MAX_BUILD_WATCHES = 50

export const BuildWatchSchema = z.object({
  key: z.string(),
  kind: z.enum(BUILD_WATCH_KINDS),
  /** Checked again on load: it goes into request URLs. */
  job: JobPathSchema,
  /** Jenkins site (lower case); polled only while Settings point at it. */
  site: z.string(),
  /** The build being followed; null while waiting for one to start. */
  number: z.number().int().nullable(),
  /** While waiting: only builds numbered above this count. */
  after: z.number().int().nullable(),
  /** Deploy watches: the branch whose deploy is followed. */
  branch: z.string().nullable(),
  /** What the user asked to watch, e.g. "web-app #412 pipeline"; null = the job path. */
  label: z.string().nullable(),
  /** Watch PR pipeline: the PR's key, so the tray lists that PR once. */
  pr: z.string().nullable(),
  addedAt: z.number(),
  checkedAt: z.number().nullable(),
  /** Last snapshot of the followed build. */
  build: JenkinsBuildSchema.nullable(),
  /** Finished (and notified): no longer polled. */
  done: z.boolean(),
  error: z.string().nullable(),
})
export type BuildWatch = z.infer<typeof BuildWatchSchema>

export const BuildWatchRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('build'), job: JobPathSchema, number: z.number().int().positive() }),
  z.object({
    kind: z.literal('job'),
    job: JobPathSchema,
    /** Only a build that starts after now (just triggered), not one already running. */
    next: z.boolean().optional(),
  }),
  /** Follows Settings → Jenkins → deploy job for this branch (SPEC 6.4 deploy watcher). */
  z.object({ kind: z.literal('deploy'), branch: z.string().trim().min(1).max(255) }),
])
export type BuildWatchRequest = z.infer<typeof BuildWatchRequestSchema>
