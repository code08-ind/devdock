/**
 * The allow-list of IPC channels. Kept free of runtime dependencies so the sandboxed preload
 * can import it. Request/response schemas live in ./ipc.ts; the main process registers one
 * handler per channel and rejects anything else.
 */
export const INVOKE_CHANNELS = [
  'app:info',
  'app:openExternal',
  'app:openLogsFolder',
  'app:showView',
  'app:quit',
  'settings:get',
  'settings:update',
  'settings:export',
  'settings:import',
  'settings:reset',
  'secrets:status',
  'secrets:list',
  'secrets:set',
  'secrets:delete',
  'secrets:clearAll',
  'notifications:history',
  'notifications:clear',
  'notifications:test',
  'notifications:pause',
  'notifications:resume',
  'notifications:state',
  'shortcut:set',
  'palette:open',
  'palette:close',
  'demo:ping',
  'repos:list',
  'repos:pickFolder',
  'repos:add',
  'repos:remove',
  'repos:update',
  'repos:status',
  'repos:plan',
  'repos:run',
  'repos:open',
  /** Palette → main window: show Repos and open the action dialog for this repo. */
  'repos:requestAction',
  'devserver:list',
  'devserver:start',
  'devserver:stop',
  'devserver:log',
  'jira:testConnection',
  'jira:list',
  'jira:issue',
  'bitbucket:detect',
  'bitbucket:testConnection',
  'bitbucket:list',
  'bitbucket:pr',
  /** Approve / needs work / merge. Rejected unless `features.prActions` is on. */
  'bitbucket:action',
  'watch:list',
  /** Watch the PR behind a pasted link (palette `watch <link>` or the Watch field). */
  'watch:add',
  'watch:remove',
  'startwork:plan',
  'startwork:run',
] as const

/** Events pushed from main to renderer. */
export const EVENT_CHANNELS = [
  'settings:changed',
  'notifications:changed',
  'nav:goto',
  'palette:shown',
  'repos:output',
  /** A repo's HEAD changed (checkout, commit, merge…): refresh its status. */
  'repos:changed',
  'repos:actionRequested',
  'devserver:changed',
  'devserver:output',
  /** The watch list or a watched PR's snapshot changed. */
  'watch:changed',
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export const VIEWS = [
  'today',
  'repos',
  'prs',
  'builds',
  'tickets',
  'utilities',
  'settings',
] as const
export type View = (typeof VIEWS)[number]
