import { z } from 'zod'
import {
  DevServerStateSchema,
  ServerRefSchema,
  type DevServerOutputEvent,
  type DevServerState,
} from './devserver'
import type { EventChannel, InvokeChannel } from './channels'
import { VIEWS } from './channels'
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

export const SECRET_KEYS = ['bitbucket.token', 'jenkins.token', 'jira.token'] as const
export const SecretKeySchema = z.enum(SECRET_KEYS)
export type SecretKey = z.infer<typeof SecretKeySchema>

export const NotificationRecordSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  url: z.string().optional(),
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
  'devserver:start': { req: ServerRefSchema, res: DevServerStateSchema },
  'devserver:stop': { req: ServerRefSchema, res: none },
  /** Output so far, for a log panel opened after the server started. */
  'devserver:log': { req: ServerRefSchema, res: z.string() },
  'repos:requestAction': {
    req: z.object({ id: z.string(), request: ActionRequestSchema }),
    res: none,
  },
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
  'repos:output': RepoOutputEvent
  'repos:changed': { id: string }
  'repos:actionRequested': { id: string; request: ActionRequest }
  'devserver:changed': DevServerState[]
  'devserver:output': DevServerOutputEvent
}
export type EventPayload<E extends EventChannel> = EventPayloads[E]
