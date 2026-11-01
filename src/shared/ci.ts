import { z } from 'zod'
import { CI_PROVIDERS, type CiProvider } from './providers'

/**
 * P7.05 / P7.06: GitHub Actions workflow runs and GitLab pipelines in one model. Jenkins keeps
 * its own (`jenkins.ts`); the tray dot, Today and the Builds view show both.
 */

/** `owner/repo` (GitHub) or `group/sub/project` (GitLab); each part a slug. */
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){1,20}$/

/** Each segment starts with a letter or digit, so `.` and `..` can't appear. */
export const ProjectPathSchema = z.string().max(2100).regex(PROJECT, 'Not a project path')

export const CiRunRefSchema = z
  .object({
    provider: z.enum(CI_PROVIDERS),
    project: ProjectPathSchema,
    /** GitHub run id / GitLab pipeline id. */
    id: z
      .number()
      .int()
      .positive()
      .max(2 ** 53),
  })
  .refine((r) => r.provider === 'gitlab' || r.project.split('/').length === 2, {
    message: 'A GitHub repository is owner/repo',
    path: ['project'],
  })
export type CiRunRef = z.infer<typeof CiRunRefSchema>

/** Stable key for a run, e.g. `github:acme/web-app@123`. */
export const ciRunKey = (ref: CiRunRef) => `${ref.provider}:${ref.project}@${ref.id}`.toLowerCase()

export const CI_STATES = [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
  'skipped',
  /** Waits for someone (GitLab manual job, GitHub environment approval). */
  'manual',
] as const
export type CiState = (typeof CI_STATES)[number]

export const isFinished = (s: CiState) =>
  s === 'success' || s === 'failed' || s === 'cancelled' || s === 'skipped'

/** Doing work now (a log grows). Not `manual`: that waits for someone, but isn't finished. */
export const isWorking = (s: CiState) => s === 'running' || s === 'queued'

export const CiRunSchema = z.object({
  key: z.string(),
  ref: CiRunRefSchema,
  /** Workflow name (GitHub) / "Pipeline" (GitLab). */
  name: z.string(),
  /** Run number in its workflow (GitHub) / pipeline iid (GitLab); null when unknown. */
  number: z.number().int().nullable(),
  /** What started it: `push`, `pull_request`, `merge_request_event`, `schedule`… */
  event: z.string(),
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  /** Head commit's first line, when the API gives it. */
  title: z.string().nullable(),
  actor: z.string().nullable(),
  state: z.enum(CI_STATES),
  /** Browser link. */
  url: z.string(),
  /** Epoch ms. */
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  /** Null while it runs. */
  durationMs: z.number().nullable(),
  /** Attempt (GitHub re-runs bump it); 1 otherwise. */
  attempt: z.number().int().positive(),
})
export type CiRun = z.infer<typeof CiRunSchema>

export const CiStepSchema = z.object({
  name: z.string(),
  state: z.enum(CI_STATES),
  number: z.number().int(),
})

export const CiJobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** GitLab stage; null on GitHub. */
  stage: z.string().nullable(),
  state: z.enum(CI_STATES),
  url: z.string().nullable(),
  startedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** GitHub steps; GitLab jobs have none. */
  steps: z.array(CiStepSchema),
})
export type CiJob = z.infer<typeof CiJobSchema>

export const CiRunDetailSchema = z.object({ run: CiRunSchema, jobs: z.array(CiJobSchema) })
export type CiRunDetail = z.infer<typeof CiRunDetailSchema>

/** The end of a job's log (logs can be many MB; the tail is what tells why it failed). */
export const CiLogSchema = z.object({
  text: z.string(),
  /** Earlier output was left out. */
  truncated: z.boolean(),
})
export type CiLog = z.infer<typeof CiLogSchema>
export const LOG_TAIL_BYTES = 64 * 1024

export const CiRunsResultSchema = z.object({
  runs: z.array(CiRunSchema),
  /** Registered repos on this provider that were read. */
  projects: z.array(z.string()),
  /** Why something is missing ("acme/api: not found"), shown under the list. */
  notes: z.array(z.string()),
})
export type CiRunsResult = z.infer<typeof CiRunsResultSchema>

/** GitHub: re-run failed jobs; GitLab: retry failed jobs. Both: cancel a running one. */
export const CI_ACTIONS = ['retry', 'cancel'] as const
export type CiAction = (typeof CI_ACTIONS)[number]

export const CI_ACTION_COPY: Record<CiProvider, Record<CiAction, string>> = {
  github: { retry: 'Re-run failed jobs', cancel: 'Cancel run' },
  gitlab: { retry: 'Retry failed jobs', cancel: 'Cancel pipeline' },
}

/** When an action makes sense for a run in this state. */
export const ciActionAllowed = (action: CiAction, state: CiState) =>
  action === 'retry' ? state === 'failed' || state === 'cancelled' : !isFinished(state)

export const CiActionRequestSchema = z.object({
  ref: CiRunRefSchema,
  action: z.enum(CI_ACTIONS),
  /** The renderer's confirmation dialog was accepted (SPEC 7). */
  confirmed: z.literal(true),
})
export type CiActionRequest = z.infer<typeof CiActionRequestSchema>

export const MAX_CI_WATCHES = 50

/** A watched run, persisted with its last snapshot (no repeat notification after a restart). */
export const CiWatchSchema = z.object({
  key: z.string(),
  ref: CiRunRefSchema,
  /** Site the run belongs to (lower case); polled only while Settings point at it. */
  site: z.string(),
  addedAt: z.number(),
  checkedAt: z.number().nullable(),
  run: CiRunSchema,
  /** Finished and notified: no longer polled (stays listed for the tray until removed). */
  done: z.boolean(),
  error: z.string().nullable(),
})
export type CiWatch = z.infer<typeof CiWatchSchema>

export const ciRunLabel = (run: Pick<CiRun, 'ref' | 'name' | 'number'>) => {
  const repo = run.ref.project.split('/').at(-1) ?? run.ref.project
  return `${repo} ${run.name}${run.number === null ? '' : ` #${run.number}`}`
}

/**
 * A run link: GitHub `…/<owner>/<repo>/actions/runs/<id>[/job/<id>|/attempts/<n>]`, GitLab
 * `…/<group…>/<project>/-/pipelines/<id>`. Like PR links, main checks the site afterwards.
 */
export function parseRunLink(input: string): { origin: string; ref: CiRunRef } | null {
  let text = input.trim().replace(/^<(.*)>$/, '$1')
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const segs = url.pathname.split('/').filter(Boolean)
  const make = (provider: CiProvider, project: string, id: string | undefined) => {
    if (!id || !/^\d+$/.test(id)) return null
    const ref = CiRunRefSchema.safeParse({ provider, project, id: Number(id) })
    return ref.success ? { origin: url.origin, ref: ref.data } : null
  }
  const dash = segs.indexOf('-')
  if (dash >= 2 && segs[dash + 1] === 'pipelines') {
    return make('gitlab', segs.slice(0, dash).join('/'), segs[dash + 2])
  }
  if (segs[2] === 'actions' && segs[3] === 'runs') {
    return make('github', `${segs[0]}/${segs[1]}`, segs[4])
  }
  return null
}
