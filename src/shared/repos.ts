import { z } from 'zod'
import { RepoFields, UPDATE_STRATEGIES } from './settings'

/** IPC shapes for repos and git actions (SPEC 6.2). Main-process logic lives in services/git. */

export const ActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fetchAll') }),
  z.object({ action: z.literal('syncBase') }),
  z.object({
    action: z.literal('updateBranch'),
    strategy: z.enum(UPDATE_STRATEGIES),
    stash: z.boolean(),
  }),
  z.object({ action: z.literal('abort') }),
  z.object({ action: z.literal('syncFork') }),
  // Sync fork step 3 pushes to origin: the request must carry an explicit confirmation.
  z.object({ action: z.literal('pushBase'), confirmed: z.literal(true) }),
  z.object({
    action: z.literal('newBranch'),
    kind: z.enum(['feature', 'bugfix']),
    key: z.string().trim().max(50).optional(),
    title: z.string().max(300),
  }),
  z.object({
    action: z.literal('pushBranch'),
    /** T5: run the repo's check command first; the push happens only if it passes. */
    check: z.boolean().optional(),
  }),
])
export type ActionRequest = z.infer<typeof ActionRequestSchema>
export type ActionName = ActionRequest['action']

export const ActionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('done'),
    summary: z.string(),
    branch: z.string().optional(),
    /** Sync fork: commits on the local base that origin doesn't have yet. */
    pushable: z.number().int().optional(),
  }),
  z.object({
    /** Git stopped on conflicts; nothing is resolved automatically. */
    status: z.literal('conflict'),
    operation: z.enum(['merge', 'rebase', 'stash']),
    files: z.array(z.string()),
    /** A DevDock stash is still waiting to be re-applied. */
    stashed: z.boolean(),
    summary: z.string(),
  }),
])
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>

/** One command in the "commands that will run" disclosure. */
export const PlannedCommandSchema = z.object({
  /** The program, when it isn't git (the check command before a push). */
  program: z.string().optional(),
  args: z.array(z.string()),
  note: z.string().optional(),
})
export type PlannedCommand = z.infer<typeof PlannedCommandSchema>

const AheadBehindSchema = z.object({ ahead: z.number().int(), behind: z.number().int() })

export const RepoStatusSchema = z.object({
  branch: z.string().nullable(),
  detached: z.boolean(),
  vsUpstream: AheadBehindSchema.nullable(),
  vsBase: AheadBehindSchema.nullable(),
  dirty: z.number().int(),
  conflicted: z.array(z.string()),
  stashes: z.number().int(),
  lastFetch: z.number().nullable(),
  operation: z.enum(['merge', 'rebase']).nullable(),
  hasUpstreamRemote: z.boolean(),
  /** `scripts/baseline.mjs` exists (SPEC 6.2 "Baseline server"). */
  hasBaseline: z.boolean(),
})
export type RepoStatus = z.infer<typeof RepoStatusSchema>

/** Built from the default-free fields: `.partial()` would otherwise fill in defaults. */
export const RepoPatchSchema = z.object({
  name: RepoFields.name.optional(),
  baseBranch: RepoFields.baseBranch.optional(),
  protectedPatterns: RepoFields.protectedPatterns.optional(),
  branchTemplates: RepoFields.branchTemplates.optional(),
  devCommand: RepoFields.devCommand.optional(),
  checkCommand: RepoFields.checkCommand.optional(),
})
export type RepoPatch = z.infer<typeof RepoPatchSchema>

export const OPEN_TARGETS = ['editor', 'terminal', 'files'] as const
export type OpenTarget = (typeof OPEN_TARGETS)[number]

/** Streamed git output for the activity log; `runId` is chosen by the renderer per action. */
export interface RepoOutputEvent {
  runId: string
  chunk: string
  stream: 'stdout' | 'stderr'
}
