import { z } from 'zod'

/** Dev server / baseline server state (SPEC 6.2 "Start dev server", "Baseline server"). */
export const SERVER_KINDS = ['dev', 'baseline'] as const
export type ServerKind = (typeof SERVER_KINDS)[number]

/** Offered as the repo's "Baseline server" when present (relative to the repo, `/`-separated). */
export const BASELINE_SCRIPT = 'scripts/baseline.mjs'

/** Request naming one server of one repo. */
export const ServerRefSchema = z.object({ id: z.string(), kind: z.enum(SERVER_KINDS) })

export const DevServerStateSchema = z.object({
  repoId: z.string(),
  kind: z.enum(SERVER_KINDS),
  command: z.string(),
  /** starting → running (URL seen) → stopping → stopped; or exited/failed on its own. */
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'exited', 'failed']),
  pid: z.number().int().nullable(),
  url: z.string().nullable(),
  port: z.number().int().nullable(),
  startedAt: z.number(),
  exitCode: z.number().int().nullable(),
  error: z.string().nullable(),
})
export type DevServerState = z.infer<typeof DevServerStateSchema>
export type DevServerStatus = DevServerState['status']

/** Started and not yet asked to stop: Stop is offered, a second Start is refused. */
export const isActive = (status: DevServerStatus) => status === 'starting' || status === 'running'

export interface DevServerOutputEvent {
  repoId: string
  kind: ServerKind
  chunk: string
}
