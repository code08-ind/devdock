import { z } from 'zod'
import { IssueKeySchema } from './jira'
import { PlannedCommandSchema } from './repos'

/** "Start work" from a Jira issue (SPEC 6.5). */

/** The agent the ready message names (SPEC 6.5 step 4). */
export const AGENTS = ['bug-fixer', 'spec-writer', 'feature-builder'] as const
export type Agent = (typeof AGENTS)[number]

export const StartWorkRequestSchema = z.object({ key: IssueKeySchema, repoId: z.string().min(1) })
export type StartWorkRequest = z.infer<typeof StartWorkRequestSchema>

export const StartWorkPlanSchema = z.object({
  key: z.string(),
  summary: z.string(),
  agent: z.enum(AGENTS),
  /** Why that agent ("Bug", "no acceptance criteria", …). */
  reason: z.string(),
  branch: z.string(),
  /** Git commands that will run (fetch + create the branch). */
  commands: z.array(PlannedCommandSchema),
  /** Where TICKET.md goes: repo-relative (`docs/ai/specs/KEY/TICKET.md`) or an absolute path. */
  briefPath: z.string(),
  briefLocation: z.enum(['repo', 'appData']),
  /**
   * Brief inside the repo and not covered by .gitignore, so it would show up for commit
   * (SPEC 6.5 step 3). Null when the brief goes to DevDock's data folder.
   */
  briefWouldBeCommitted: z.boolean().nullable(),
  /** The clipboard text (SPEC 6.5 step 5). */
  message: z.string(),
  /**
   * Settings → "Transition on Start work" (off by default). When on, the dialog asks the user to
   * confirm the transition (SPEC 7: no remote-changing action without confirmation).
   */
  transitionEnabled: z.boolean(),
})
export type StartWorkPlan = z.infer<typeof StartWorkPlanSchema>

export const StartWorkRunSchema = StartWorkRequestSchema.extend({
  /** Renderer-chosen id for streaming git output to the activity log (repos:output). */
  runId: z.string().min(1).max(100),
  /** Open the repo in VS Code afterwards (SPEC 6.5 last step). */
  openEditor: z.boolean(),
  /** The agent the preview showed; the run refuses if the ticket now classifies differently. */
  agent: z.enum(AGENTS),
  /** The user confirmed moving the issue to In Progress. Ignored unless the setting is on. */
  confirmTransition: z.boolean(),
})
export type StartWorkRun = z.infer<typeof StartWorkRunSchema>

/** off: setting off · declined: setting on, user unticked it · already: status was In Progress. */
export const TRANSITION_RESULTS = [
  'off',
  'declined',
  'done',
  'already',
  'unavailable',
  'failed',
] as const

export const StartWorkResultSchema = z.object({
  branch: z.string(),
  /** Absolute path of the written TICKET.md. */
  briefFile: z.string(),
  agent: z.enum(AGENTS),
  message: z.string(),
  transition: z.object({ result: z.enum(TRANSITION_RESULTS), detail: z.string().optional() }),
  /** Steps after the branch that didn't work (e.g. editor not found); the branch and brief exist. */
  warnings: z.array(z.string()),
})
export type StartWorkResult = z.infer<typeof StartWorkResultSchema>
