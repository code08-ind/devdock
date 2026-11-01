import { z } from 'zod'
import { TicketMoveResultSchema, TicketMoveSchema, type TicketMove } from './ticketmoves'
import { UpdateStatusSchema, type UpdateStatus } from './updates'
import { AgentStatusSchema } from './agents'
import { AiConnectionSchema, AiPrepareSchema, AiPreviewSchema, AiResultSchema } from './ai'
import {
  DevServerStateSchema,
  ServerRefSchema,
  type DevServerOutputEvent,
  type DevServerState,
} from './devserver'
import type { EventChannel, InvokeChannel } from './channels'
import {
  StartWorkPlanSchema,
  StartWorkRequestSchema,
  StartWorkResultSchema,
  StartWorkRunSchema,
} from './startwork'
import {
  BitbucketConnectionSchema,
  BitbucketDetectionSchema,
  PR_LISTS,
  PrActionRequestSchema,
  PrRefSchema,
  PullRequestSchema,
  WatchItemSchema,
  type WatchItem,
} from './bitbucket'
import {
  CiActionRequestSchema,
  CiLogSchema,
  CiRunDetailSchema,
  CiRunRefSchema,
  CiRunSchema,
  CiRunsResultSchema,
  CiWatchSchema,
  type CiWatch,
} from './ci'
import { HostConnectionSchema, RemoteHostSchema } from './hosting'
import { CI_PROVIDERS, PROVIDERS } from './providers'
import {
  BranchesResultSchema,
  BuildDetailSchema,
  BuildRefSchema,
  BuildWatchRequestSchema,
  BuildWatchSchema,
  ConsoleChunkSchema,
  JenkinsConnectionSchema,
  JobPathSchema,
  ParameterDefinitionSchema,
  TriggerRequestSchema,
  type BuildWatch,
} from './jenkins'
import {
  IssueKeySchema,
  JiraConnectionSchema,
  JiraIssueDetailSchema,
  JiraIssueSchema,
  JiraListRequestSchema,
} from './jira'
import { VIEWS } from './channels'
import { EnvDiffRowSchema, EnvSourceSchema, EnvStateSchema, ProfileNameSchema } from './envprofiles'
import {
  LessonsAddResultSchema,
  LessonsAddSchema,
  LessonsRequestSchema,
  LessonsStateSchema,
  ReviewCommentSchema,
} from './lessons'
import { DiagnosticsSchema } from './diagnostics'
import { StandupDraftSchema } from './standup'
import {
  TerminalCreateSchema,
  TerminalBusySchema,
  TerminalRefSchema,
  TerminalRequestSchema,
  type TerminalRequest,
  TerminalResizeSchema,
  TerminalSessionSchema,
  TerminalWriteSchema,
  type TerminalExitEvent,
  type TerminalOutputEvent,
} from './terminal'
import {
  CachePlanSchema,
  CleanRequestSchema,
  CleanResultSchema,
  ListeningPortSchema,
  StopRequestSchema,
  StopResultSchema,
  UtilityRequestSchema,
} from './utilities'
import {
  ActionOutcomeSchema,
  ActionRequestSchema,
  OPEN_TARGETS,
  PlannedCommandSchema,
  RepoPatchSchema,
  RepoStatusSchema,
  type ActionRequest,
  type RepoOutputEvent,
} from './repos'
import {
  NOTIFICATION_TYPES,
  RepoConfigSchema,
  SettingsPatchSchema,
  SettingsSchema,
} from './settings'

const none = z.undefined()
const repoId = z.string().min(1).max(100)

export const SECRET_KEYS = [
  'bitbucket.token',
  'jenkins.token',
  'jira.token',
  'github.token',
  'gitlab.token',
  /** P7-C-B: the user's own Anthropic API key (Settings → AI). */
  'anthropic.key',
  /** T6: the user's own OpenAI and Google (Gemini) API keys (Settings → AI). */
  'openai.key',
  'google.key',
] as const
export const SecretKeySchema = z.enum(SECRET_KEYS)
export type SecretKey = z.infer<typeof SecretKeySchema>

export const NotificationRecordSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  url: z.string().optional(),
  view: z.enum(VIEWS).optional(),
  at: z.number(),
  shown: z.boolean(),
  suppressedReason: z.enum(['type-off', 'quiet-hours', 'paused']).optional(),
})
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>

export const ShortcutResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), accelerator: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string(), accelerator: z.string() }),
])
export type ShortcutResult = z.infer<typeof ShortcutResultSchema>

/** Request/response contract for every invoke channel. */
export const contract = {
  'app:info': {
    req: none,
    res: z.object({
      version: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
      platform: z.string(),
      arch: z.string(),
      shortcut: ShortcutResultSchema,
    }),
  },
  'app:openExternal': { req: z.object({ url: z.string().max(4096) }), res: none },
  'app:openLogsFolder': { req: none, res: none },
  'app:showView': { req: z.object({ view: z.enum(VIEWS) }), res: none },
  'app:quit': { req: none, res: none },
  'diagnostics:info': { req: none, res: DiagnosticsSchema },
  /** The redacted report (shown to copy). */
  'diagnostics:export': { req: none, res: z.string() },
  /** Writes the report where the user picks; null when they cancel. */
  'diagnostics:save': { req: none, res: z.object({ path: z.string().nullable() }) },

  'settings:get': { req: none, res: SettingsSchema },
  'settings:update': { req: SettingsPatchSchema, res: SettingsSchema },
  'settings:export': { req: none, res: z.string() },
  'settings:import': { req: z.object({ json: z.string().max(1_000_000) }), res: SettingsSchema },
  'settings:reset': { req: none, res: SettingsSchema },

  'secrets:status': {
    req: none,
    res: z.object({ available: z.boolean(), backend: z.string(), reason: z.string().optional() }),
  },
  'secrets:list': { req: none, res: z.array(SecretKeySchema) },
  'secrets:set': {
    req: z.object({ key: SecretKeySchema, value: z.string().min(1).max(8192) }),
    res: none,
  },
  'secrets:delete': { req: z.object({ key: SecretKeySchema }), res: none },
  'secrets:clearAll': { req: none, res: none },

  'notifications:history': { req: none, res: z.array(NotificationRecordSchema) },
  'notifications:clear': { req: none, res: none },
  'notifications:test': {
    req: z.object({ type: z.enum(NOTIFICATION_TYPES) }),
    res: NotificationRecordSchema,
  },
  'notifications:pause': {
    req: z.object({ minutes: z.number().int().min(1).max(1440) }),
    res: none,
  },
  'notifications:resume': { req: none, res: none },
  'notifications:state': { req: none, res: z.object({ pausedUntil: z.number().nullable() }) },

  'shortcut:set': {
    req: z.object({ accelerator: z.string().min(1).max(100) }),
    res: ShortcutResultSchema,
  },
  'palette:open': { req: none, res: none },
  'palette:close': { req: none, res: none },
  'panel:close': { req: none, res: none },

  'demo:ping': {
    req: none,
    res: z.object({ status: z.number(), body: z.string(), demo: z.boolean() }),
  },

  'repos:list': { req: none, res: z.array(RepoConfigSchema) },
  /** Native folder picker; null when cancelled. */
  'repos:pickFolder': { req: none, res: z.string().nullable() },
  'repos:add': { req: z.object({ path: z.string().min(1).max(4096) }), res: RepoConfigSchema },
  'repos:remove': { req: z.object({ id: z.string() }), res: none },
  'repos:update': {
    req: z.object({ id: z.string(), patch: RepoPatchSchema }),
    res: RepoConfigSchema,
  },
  'repos:status': { req: z.object({ id: z.string() }), res: RepoStatusSchema },
  'repos:plan': {
    req: z.object({ id: z.string(), request: ActionRequestSchema }),
    res: z.array(PlannedCommandSchema),
  },
  'repos:run': {
    req: z.object({
      id: z.string(),
      /** Chosen by the renderer; tags the streamed `repos:output` events. */
      runId: z.string().min(1).max(100),
      request: ActionRequestSchema,
    }),
    res: ActionOutcomeSchema,
  },
  'repos:open': { req: z.object({ id: z.string(), target: z.enum(OPEN_TARGETS) }), res: none },
  'devserver:list': { req: none, res: z.array(DevServerStateSchema) },
  'devserver:start': {
    /** `ifStopped`: one already running is fine (Start work and a branch switch may both ask). */
    req: ServerRefSchema.extend({ ifStopped: z.boolean().optional() }),
    res: DevServerStateSchema,
  },
  'devserver:stop': { req: ServerRefSchema, res: none },
  /** Output so far, for a log panel opened after the server started. */
  'devserver:log': { req: ServerRefSchema, res: z.string() },
  'jira:testConnection': { req: none, res: JiraConnectionSchema },
  'jira:list': { req: JiraListRequestSchema, res: z.array(JiraIssueSchema) },
  'jira:issue': { req: z.object({ key: IssueKeySchema }), res: JiraIssueDetailSchema },
  /** Probes a base URL being typed in Settings (no credentials sent). */
  'bitbucket:detect': {
    req: z.object({ baseUrl: z.url({ protocol: /^https?$/ }).max(500) }),
    res: BitbucketDetectionSchema,
  },
  'bitbucket:testConnection': { req: none, res: BitbucketConnectionSchema },
  'watch:list': { req: none, res: z.array(WatchItemSchema) },
  'watch:add': { req: z.object({ link: z.string().min(1).max(2000) }), res: WatchItemSchema },
  'watch:remove': { req: z.object({ key: z.string().min(1).max(400) }), res: none },
  /** `pipeline`: watch the PR's Jenkins build (Builds view) instead of the PR itself. */
  'watch:request': {
    req: z.object({ link: z.string().min(1).max(2000), pipeline: z.boolean().optional() }),
    res: none,
  },
  'prs:list': {
    req: z.object({ provider: z.enum(PROVIDERS), list: z.enum(PR_LISTS) }),
    res: z.array(PullRequestSchema),
  },
  'prs:pr': { req: PrRefSchema, res: PullRequestSchema },
  /** Returns the PR after the action. */
  'prs:action': { req: PrActionRequestSchema, res: PullRequestSchema },
  'providers:detect': { req: none, res: z.array(RemoteHostSchema) },
  'github:testConnection': { req: none, res: HostConnectionSchema },
  'gitlab:testConnection': { req: none, res: HostConnectionSchema },
  'ci:runs': { req: z.object({ provider: z.enum(CI_PROVIDERS) }), res: CiRunsResultSchema },
  'ci:run': { req: CiRunRefSchema, res: CiRunDetailSchema },
  'ci:log': {
    req: z.object({
      ref: CiRunRefSchema,
      jobId: z
        .number()
        .int()
        .positive()
        .max(2 ** 53),
    }),
    res: CiLogSchema,
  },
  'ci:action': { req: CiActionRequestSchema, res: CiRunSchema },
  'ciwatch:list': { req: none, res: z.array(CiWatchSchema) },
  'ciwatch:add': {
    req: z.union([
      z.object({ ref: CiRunRefSchema }),
      z.object({ link: z.string().min(1).max(2000) }),
    ]),
    res: CiWatchSchema,
  },
  'ciwatch:remove': { req: z.object({ key: z.string().min(1).max(2400) }), res: none },
  'ciwatch:clearFinished': { req: none, res: none },
  'jenkins:testConnection': { req: none, res: JenkinsConnectionSchema },
  'jenkins:branches': { req: none, res: BranchesResultSchema },
  'jenkins:build': { req: BuildRefSchema, res: BuildDetailSchema },
  'jenkins:console': {
    req: BuildRefSchema.extend({
      start: z
        .number()
        .int()
        .nonnegative()
        .max(2 ** 40),
    }),
    res: ConsoleChunkSchema,
  },
  'jenkins:parameters': {
    req: z.object({ job: JobPathSchema }),
    res: z.array(ParameterDefinitionSchema),
  },
  /** Returns Jenkins' queue item link (null if it didn't say). */
  'jenkins:trigger': {
    req: TriggerRequestSchema,
    res: z.object({ queueUrl: z.string().nullable() }),
  },
  'buildwatch:list': { req: none, res: z.array(BuildWatchSchema) },
  'buildwatch:add': { req: BuildWatchRequestSchema, res: BuildWatchSchema },
  'buildwatch:addPr': {
    req: z.object({ link: z.string().min(1).max(2000) }),
    res: BuildWatchSchema,
  },
  'buildwatch:remove': { req: z.object({ key: z.string().min(1).max(1200) }), res: none },
  'buildwatch:clearFinished': { req: none, res: none },
  'ports:list': { req: none, res: z.array(ListeningPortSchema) },
  'ports:stop': { req: StopRequestSchema, res: StopResultSchema },
  'caches:plan': { req: z.object({ id: repoId }), res: CachePlanSchema },
  'caches:clean': { req: CleanRequestSchema, res: CleanResultSchema },
  'envprofiles:state': { req: z.object({ id: repoId }), res: EnvStateSchema },
  'envprofiles:save': {
    req: z.object({ id: repoId, name: ProfileNameSchema, replace: z.boolean() }),
    res: none,
  },
  'envprofiles:switch': {
    req: z.object({ id: repoId, name: ProfileNameSchema, confirmed: z.literal(true) }),
    res: none,
  },
  'envprofiles:restore': { req: z.object({ id: repoId, confirmed: z.literal(true) }), res: none },
  'envprofiles:delete': {
    req: z.object({ id: repoId, name: ProfileNameSchema, confirmed: z.literal(true) }),
    res: none,
  },
  'envprofiles:reveal': {
    req: z.object({ id: repoId, profile: EnvSourceSchema, key: z.string().min(1).max(200) }),
    res: z.string(),
  },
  'envprofiles:diff': {
    req: z.object({ id: repoId, a: EnvSourceSchema, b: EnvSourceSchema }),
    res: z.array(EnvDiffRowSchema),
  },
  /** Settings → Clear all data. */
  'envprofiles:clearAll': { req: z.object({ confirmed: z.literal(true) }), res: none },
  'standup:draft': { req: none, res: StandupDraftSchema },
  'lessons:comments': { req: none, res: z.array(ReviewCommentSchema) },
  'lessons:state': { req: LessonsRequestSchema, res: LessonsStateSchema },
  /** Writes only the lessons the user picked, inside the repo (local file, no remote). */
  'lessons:add': { req: LessonsAddSchema, res: LessonsAddResultSchema },
  'utilities:request': { req: UtilityRequestSchema, res: none },
  'tickets:request': { req: z.object({ key: IssueKeySchema }), res: none },
  'commands:request': { req: z.object({ id: z.string().min(1).max(1000) }), res: none },
  'ticketmove:list': { req: none, res: z.array(TicketMoveSchema) },
  'updates:status': { req: none, res: UpdateStatusSchema },
  'updates:check': { req: none, res: UpdateStatusSchema },
  /** Opens the newer release's page; main knows the URL (only this repo's releases). */
  'updates:open': { req: none, res: none },
  'ticketmove:dismiss': { req: z.object({ prKey: z.string().min(1).max(2400) }), res: none },
  'ticketmove:accept': {
    // A Jira transition: the renderer must say the user confirmed it (SPEC 7).
    req: z.object({ prKey: z.string().min(1).max(2400), confirmed: z.literal(true) }),
    res: TicketMoveResultSchema,
  },
  /** Read-only: branch name, commands, brief path + .gitignore check, agent and message. */
  'startwork:plan': { req: StartWorkRequestSchema, res: StartWorkPlanSchema },
  'startwork:run': { req: StartWorkRunSchema, res: StartWorkResultSchema },
  'repos:requestAction': {
    req: z.object({ id: z.string(), request: ActionRequestSchema }),
    res: none,
  },
  'terminal:create': { req: TerminalCreateSchema, res: TerminalSessionSchema },
  'terminal:write': { req: TerminalWriteSchema, res: none },
  'terminal:resize': { req: TerminalResizeSchema, res: none },
  /** Closing a tab: the shell and what it started are stopped. */
  'terminal:kill': { req: TerminalRefSchema, res: none },
  'terminal:busy': { req: TerminalRefSchema, res: TerminalBusySchema },
  /** Palette window / panel → main window: open a DevDock terminal tab there. */
  'terminal:request': { req: TerminalRequestSchema, res: none },
  'agents:detect': { req: none, res: z.array(AgentStatusSchema) },
  'ai:prepare': { req: AiPrepareSchema, res: AiPreviewSchema },
  'ai:run': { req: z.object({ id: z.string().uuid() }), res: AiResultSchema },
  'ai:testConnection': { req: none, res: AiConnectionSchema },
} satisfies Record<InvokeChannel, { req: z.ZodType; res: z.ZodType }>

export type Contract = typeof contract
export type Req<C extends InvokeChannel> = z.input<Contract[C]['req']>
export type Res<C extends InvokeChannel> = z.output<Contract[C]['res']>

export const ERROR_CODES = [
  'INVALID_PAYLOAD',
  'UNKNOWN_CHANNEL',
  'FORBIDDEN',
  'NOT_ALLOWED',
  'SECRETS_UNAVAILABLE',
  'NOT_FOUND',
  'INTERNAL',
  // Git failures (services/git/errors.ts kinds).
  'GIT_MISSING',
  'NOT_A_REPO',
  'DIRTY_TREE',
  'CONFLICT',
  'NON_FAST_FORWARD',
  'AUTH_FAILED',
  'TIMEOUT',
  'GIT_FAILED',
  'PRECONDITION_FAILED',
  // HTTP service failures (services/service-error.ts kinds).
  'NOT_CONFIGURED',
  'SERVICE_AUTH',
  'SERVICE_FORBIDDEN',
  'RATE_LIMITED',
  'PROXY',
  'CERTIFICATE',
  'NETWORK',
  'SERVICE_FAILED',
  // A process that didn't accept a polite stop (Ports: offer Force stop).
  'NOT_STOPPED',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export interface IpcErrorShape {
  code: ErrorCode
  message: string
  details?: string
}

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: IpcErrorShape }

export interface EventPayloads {
  'settings:changed': z.output<typeof SettingsSchema>
  'notifications:changed': null
  'nav:goto': (typeof VIEWS)[number]
  'palette:shown': null
  'panel:shown': null
  'repos:output': RepoOutputEvent
  'repos:changed': { id: string }
  'repos:actionRequested': { id: string; request: ActionRequest }
  'devserver:changed': DevServerState[]
  'devserver:output': DevServerOutputEvent
  'watch:changed': WatchItem[]
  'watch:requested': { link: string; pipeline?: boolean }
  'buildwatch:changed': BuildWatch[]
  'ciwatch:changed': CiWatch[]
  'utilities:requested': z.infer<typeof UtilityRequestSchema>
  'tickets:requested': { key: string }
  'commands:requested': { id: string }
  'ticketmove:changed': TicketMove[]
  'updates:changed': UpdateStatus
  'terminal:output': TerminalOutputEvent
  'terminal:exit': TerminalExitEvent
  'terminal:requested': TerminalRequest
}
export type EventPayload<E extends EventChannel> = EventPayloads[E]
