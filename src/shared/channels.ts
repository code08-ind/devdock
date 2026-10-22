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
] as const

/** Events pushed from main to renderer. */
export const EVENT_CHANNELS = [
  'settings:changed',
  'notifications:changed',
  'nav:goto',
  'palette:toggle',
  'palette:shown',
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
