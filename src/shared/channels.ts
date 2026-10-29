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
  /** P6.04: versions and proxy; the redacted report; saving it where the user picks. */
  'diagnostics:info',
  'diagnostics:export',
  'diagnostics:save',
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
  'panel:close',
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
  /** Palette window → main window: show PRs and watch this link there (result as a toast). */
  'watch:request',
  'jenkins:testConnection',
  /** SPEC 6.4 "My branches": last build of each branch I have locally or in open PRs. */
  'jenkins:branches',
  'jenkins:build',
  /** Console from a byte offset (progressive text). */
  'jenkins:console',
  /** "Build with parameters": the job's parameter definitions. */
  'jenkins:parameters',
  /** Queue a build. Rejected unless `features.jobTriggers`, allow-listed and not protected. */
  'jenkins:trigger',
  'buildwatch:list',
  /** Watch a build, a job's next build, or the deploy job for a branch. */
  'buildwatch:add',
  /** Watch PR pipeline: from a PR link to the Jenkins build that runs it. */
  'buildwatch:addPr',
  'buildwatch:remove',
  'buildwatch:clearFinished',
  'startwork:plan',
  'startwork:run',
  /** SPEC 6.6 Ports: listening TCP ports with PID, process and command. */
  'ports:list',
  /** Stops a process; the handler re-checks it still listens on that port. */
  'ports:stop',
  /** Clean caches: what would be removed, with sizes. */
  'caches:plan',
  'caches:clean',
  /** SPEC 6.6 env profiles: key names, profiles, backups of a repo's `.env.local`. */
  'envprofiles:state',
  'envprofiles:save',
  'envprofiles:switch',
  /** Puts back the newest backup (undoes the last switch). */
  'envprofiles:restore',
  'envprofiles:delete',
  /** One value, on request (values are masked otherwise). */
  'envprofiles:reveal',
  /** Key names only: added / removed / changed / same. */
  'envprofiles:diff',
  'envprofiles:clearAll',
  /** SPEC 6.6 standup draft from commits, PRs and Jira. */
  'standup:draft',
  /** P6-F agent lessons: review comments to pick from, the repo's lessons file, add to it. */
  'lessons:comments',
  'lessons:state',
  'lessons:add',
  /** Palette window → main window: show Utilities on a tab (`kill 5173` → that port). */
  'utilities:request',
  /** Palette window → main window: Start work on a ticket (`branch NM-1234`). */
  'tickets:request',
  /** P7-A in-app terminal: real PTYs in main, owned by the window that made them. */
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  /** Palette window / panel → main window: open a DevDock terminal (in a repo or home). */
  'terminal:request',
] as const

/** Events pushed from main to renderer. */
export const EVENT_CHANNELS = [
  'settings:changed',
  'notifications:changed',
  'nav:goto',
  'palette:shown',
  /** The menu-bar panel was shown again: back to its first tab, scrolled to the top. */
  'panel:shown',
  'repos:output',
  /** A repo's HEAD changed (checkout, commit, merge…): refresh its status. */
  'repos:changed',
  'repos:actionRequested',
  'devserver:changed',
  'devserver:output',
  /** The watch list or a watched PR's snapshot changed. */
  'watch:changed',
  'watch:requested',
  /** The build watch list or a watched build changed. */
  'buildwatch:changed',
  'utilities:requested',
  'tickets:requested',
  /** PTY output, batched (~16 ms), only to the window that owns the session. */
  'terminal:output',
  'terminal:exit',
  'terminal:requested',
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type EventChannel = (typeof EVENT_CHANNELS)[number]

/** Nav rail order (⌘1…); Home first, the view DevDock opens on. */
export const VIEWS = [
  'home',
  'today',
  'repos',
  'prs',
  'builds',
  'tickets',
  'utilities',
  'terminal',
  'settings',
] as const
export type View = (typeof VIEWS)[number]
