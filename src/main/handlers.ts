/** One handler per IPC channel in @shared/ipc `contract`. Electron-free: adapters are injected. */
import { stat } from 'node:fs/promises'
import type { IpcMainInvokeEvent } from 'electron'
import type { ServiceName } from '@shared/diagnostics'
import type { DiagnosticsService } from './services/diagnostics'
import { LessonsError, type LessonsService } from './services/lessons'
import type { View } from '@shared/channels'
import type { ErrorCode, Req, Res } from '@shared/ipc'
import type { ActionRequest, OpenTarget, RepoOutputEvent } from '@shared/repos'
import type { RepoConfig, Settings } from '@shared/settings'
import { DEMO_ORIGIN } from './demo/handlers'
import { IpcError, type HandlerMap } from './ipc/registry'
import { checkExternalUrl, linkHosts } from './security'
import type { GitActions } from './services/git/actions'
import { GitError, type GitErrorKind } from './services/git/errors'
import type { GitRunner } from './services/git/exec'
import { repoStatus } from './services/git/repo'
import type { HttpClient } from './services/http'
import { PrActionError } from './services/bitbucket/client'
import type { BitbucketService } from './services/bitbucket/service'
import type { PrWatcher } from './services/bitbucket/watcher'
import { WatchError } from './services/watch'
import { triggerRefusal } from '@shared/jenkins'
import type { JenkinsService } from './services/jenkins/service'
import type { BuildWatcher } from './services/jenkins/watcher'
import type { CiWatcher } from './services/ci/watcher'
import { CiActionError } from './services/providers/common'
import type { PrHub } from './services/providers/hub'
import type { HostService } from './services/providers/service'
import type { RemoteHost } from '@shared/hosting'
import type { CiProvider } from '@shared/providers'
import type { JiraService } from './services/jira/service'
import { StartWorkError, type StartWorkService } from './services/startwork'
import type { NotificationService } from './services/notifications'
import { DevServerError, type DevServerManager } from './services/process/devserver'
import { ProcessError, type ProcessErrorKind, type PortService } from './services/process/ports'
import { CacheError, clean, planClean } from './services/caches'
import { EnvProfileError, type EnvProfiles } from './services/envprofiles'
import type { StandupDraft } from '@shared/standup'
import { RepoNotFoundError, type RepoService } from './services/repos'
import { SecretsUnavailableError, type SecretStore } from './services/secrets'
import { ServiceError, type ServiceErrorKind } from './services/service-error'
import type { SettingsStore } from './services/settings'
import type { ShortcutService } from './services/shortcut'
import { TerminalError, type TerminalManager } from './services/terminal/manager'
import { AgentNotFoundError, agentSpawn, agentStatus, type AgentInfo } from './services/agents'
import { tabTitle } from '@shared/agents'
import type { AiService } from './services/ai/service'
import { lessonPrompt, prPrompt, standupPrompt } from './services/ai/prompts'
import type { TerminalRequest } from '@shared/terminal'

/** Everything the handlers touch, injected so they can be tested without Electron. */
export interface HandlerDeps {
  settings: SettingsStore
  secrets: SecretStore
  notifications: NotificationService
  shortcut: ShortcutService
  http: HttpClient
  logsDir: string
  versions: () => Omit<Res<'app:info'>, 'shortcut'>
  openExternal: (url: string) => Promise<void>
  /** Electron's shell.openPath: resolves to an error message, or '' on success. */
  openPath: (path: string) => Promise<string>
  showView: (view: View) => void
  openPalette: () => void
  closePalette: () => void
  closePanel: () => void
  quit: () => void
  diagnostics: DiagnosticsService
  /** Asks where to save (native dialog) and writes the text there; null when cancelled. */
  saveText: (defaultName: string, text: string) => Promise<string | null>
  repos: RepoService
  git: GitRunner
  actions: GitActions
  /** Native folder picker; resolves to null when cancelled. */
  pickFolder: () => Promise<string | null>
  /** Opens a repo in the editor, a terminal or the file manager. */
  openRepo: (repo: RepoConfig, target: OpenTarget) => Promise<void>
  /** Streams git output to the renderer's activity log. */
  emitOutput: (event: RepoOutputEvent) => void
  devServers: DevServerManager
  jira: JiraService
  bitbucket: BitbucketService
  /** P7.04: PRs from Bitbucket, GitHub or GitLab, routed by the ref's provider. */
  prs: PrHub
  /** P7.05 / P7.06: GitHub and GitLab (PRs through `prs`; Test connection and CI here). */
  hosts: Record<CiProvider, HostService>
  ciWatcher: CiWatcher
  /** Hosts in the registered repos' remotes and the provider each one means. */
  detectProviders: () => Promise<RemoteHost[]>
  prWatcher: PrWatcher
  jenkins: JenkinsService
  ports: PortService
  envProfiles: EnvProfiles
  /** SPEC 6.6 standup draft for today. */
  standupDraft: () => Promise<StandupDraft>
  lessons: LessonsService
  buildWatcher: BuildWatcher
  startWork: StartWorkService
  /** Shows PRs in the main window and hands it a link to watch (from the palette window). */
  requestWatch: (link: string, pipeline: boolean) => void
  /** Shows Utilities in the main window on a tab (from the palette window). */
  requestUtility: (request: Req<'utilities:request'>) => void
  /** Shows the main window with Start work open for that issue. */
  requestTicket: (key: string) => void
  /** Shows the main window and runs a palette command there that needs its dialog (by id). */
  requestCommand: (id: string) => void
  /** Brings up the main window's action dialog (from the palette window). */
  requestRepoAction: (event: { id: string; request: ActionRequest }) => void
  /** P7-A: the in-app terminal's PTYs. */
  terminal: TerminalManager
  /** Where a terminal starts when it isn't opened for a repo. */
  home: string
  /** Shows the main window's Terminal view with a new tab (from the palette window / panel). */
  requestTerminal: (request: TerminalRequest) => void
  /** P7-C: the agent CLIs on PATH (looked up on each call: a few file checks). */
  agents: () => AgentInfo[] | Promise<AgentInfo[]>
  platform: NodeJS.Platform
  /** P7-C-B: Claude with the user's own key. */
  ai: AiService
}

const GIT_CODES: Record<GitErrorKind, ErrorCode> = {
  'git-missing': 'GIT_MISSING',
  'not-a-repo': 'NOT_A_REPO',
  'dirty-tree': 'DIRTY_TREE',
  conflict: 'CONFLICT',
  'non-fast-forward': 'NON_FAST_FORWARD',
  auth: 'AUTH_FAILED',
  timeout: 'TIMEOUT',
  // The destructive-command guard and protected-branch push both land here.
  unsafe: 'NOT_ALLOWED',
  precondition: 'PRECONDITION_FAILED',
  failed: 'GIT_FAILED',
}

/** Runs a repo handler, turning git and lookup failures into typed IPC errors. */
async function withGit<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof GitError) throw new IpcError(GIT_CODES[err.kind], err.message, err.details)
    if (err instanceof RepoNotFoundError) throw new IpcError('NOT_FOUND', err.message)
    if (err instanceof DevServerError) throw new IpcError('PRECONDITION_FAILED', err.message)
    throw err
  }
}

const TRIGGER_REFUSALS: Record<
  NonNullable<ReturnType<typeof triggerRefusal>>,
  (job: string, s: Settings) => string
> = {
  protected: (job, s) =>
    `${job} matches a protected pattern (${s.jenkins.protectedPatterns.join(', ')}), so DevDock never triggers it. Run it from Jenkins if your role permits.`,
  off: () =>
    'Job triggers are turned off. Turn them on in Settings → Jenkins (only if your role permits).',
  'not-allowed': (job) =>
    `${job} isn't on the list of jobs DevDock may trigger. Add it in Settings → Jenkins.`,
}

const PROCESS_CODES: Record<ProcessErrorKind, ErrorCode> = {
  'missing-tool': 'INTERNAL',
  failed: 'INTERNAL',
  refused: 'NOT_ALLOWED',
  permission: 'NOT_ALLOWED',
  changed: 'PRECONDITION_FAILED',
  gone: 'NOT_FOUND',
  'not-stopped': 'NOT_STOPPED',
}

/** Port scanning and stopping: typed failures with what the OS said in Details. */
async function withProcess<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ProcessError)
      throw new IpcError(PROCESS_CODES[err.kind], err.message, err.details)
    throw err
  }
}

/** Clean caches: an unknown repo, or a file the OS wouldn't remove (held open, locked). */
function withCaches<T>(fn: () => Promise<T>): Promise<T> {
  return withGit(async () => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof CacheError)
        throw new IpcError('PRECONDITION_FAILED', err.message, err.details)
      throw err
    }
  })
}

const ENV_CODES: Record<EnvProfileError['kind'], ErrorCode> = {
  'not-found': 'NOT_FOUND',
  exists: 'PRECONDITION_FAILED',
  'no-file': 'PRECONDITION_FAILED',
  'no-backup': 'PRECONDITION_FAILED',
  symlink: 'PRECONDITION_FAILED',
}

const LESSON_CODES: Record<LessonsError['kind'], ErrorCode> = {
  outside: 'NOT_ALLOWED',
  symlink: 'PRECONDITION_FAILED',
  io: 'PRECONDITION_FAILED',
}

/** Agent lessons: an unknown repo, a path out of the repo, or a file that can't be written. */
function withLessons<T>(fn: () => Promise<T>): Promise<T> {
  return withGit(async () => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof LessonsError) throw new IpcError(LESSON_CODES[err.kind], err.message)
      throw err
    }
  })
}

/** Env profiles: an unknown repo, a missing profile/file, or no OS encryption. */
function withEnv<T>(fn: () => T): Promise<T> {
  return withService(() =>
    withGit(async () => {
      try {
        return fn()
      } catch (err) {
        if (err instanceof EnvProfileError) throw new IpcError(ENV_CODES[err.kind], err.message)
        throw err
      }
    }),
  )
}

const SERVICE_CODES: Record<ServiceErrorKind, ErrorCode> = {
  not_configured: 'NOT_CONFIGURED',
  auth: 'SERVICE_AUTH',
  forbidden: 'SERVICE_FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  rate_limited: 'RATE_LIMITED',
  server: 'SERVICE_FAILED',
  bad_response: 'SERVICE_FAILED',
  timeout: 'TIMEOUT',
  proxy: 'PROXY',
  certificate: 'CERTIFICATE',
  network: 'NETWORK',
}

/** Runs an HTTP-service handler, turning adapter failures into typed IPC errors with hints. */
async function withService<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ServiceError) {
      throw new IpcError(SERVICE_CODES[err.kind], err.message, err.details)
    }
    // Reading the token needs the OS keychain.
    if (err instanceof SecretsUnavailableError)
      throw new IpcError('SECRETS_UNAVAILABLE', err.message)
    throw err
  }
}

/** Watch requests: a bad link is a bad payload; another site or a full list is a precondition. */
function withWatch<T>(fn: () => Promise<T> | T): Promise<T> {
  return withService(async () => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof WatchError) {
        throw new IpcError(
          err.kind === 'invalid' ? 'INVALID_PAYLOAD' : 'PRECONDITION_FAILED',
          err.message,
        )
      }
      throw err
    }
  })
}

const TERMINAL_CODES: Record<TerminalError['kind'], ErrorCode> = {
  'not-found': 'NOT_FOUND',
  limit: 'PRECONDITION_FAILED',
  shell: 'PRECONDITION_FAILED',
  failed: 'INTERNAL',
}

/** The window asking: terminals belong to the webContents that made them. */
function terminalOwner(event: IpcMainInvokeEvent | null): number {
  if (!event) throw new IpcError('FORBIDDEN', 'Terminals can only be used from a DevDock window.')
  return event.sender.id
}

/**
 * Terminal calls: typed failures (unknown or someone else's session → NOT_FOUND). Wraps `withGit`
 * because `terminal:create` looks the repo up (`RepoNotFoundError` → NOT_FOUND).
 */
async function withTerminal<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await withGit(fn)
  } catch (err) {
    if (err instanceof TerminalError) {
      throw new IpcError(TERMINAL_CODES[err.kind], err.message, err.details)
    }
    if (err instanceof AgentNotFoundError) throw new IpcError('NOT_FOUND', err.message)
    throw err
  }
}

/** Start work touches Jira, git and the file system: map each kind of failure. */
function withStartWork<T>(fn: () => Promise<T>): Promise<T> {
  return withService(() =>
    withGit(async () => {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof StartWorkError) {
          throw new IpcError(
            err.kind === 'changed' ? 'PRECONDITION_FAILED' : 'INTERNAL',
            err.message,
          )
        }
        throw err
      }
    }),
  )
}

function withSecrets<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof SecretsUnavailableError) {
      throw new IpcError('SECRETS_UNAVAILABLE', err.message)
    }
    throw err
  }
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  /** A Test connection, its outcome kept for the diagnostics report. */
  const recorded = async <T>(service: ServiceName, test: () => Promise<T>): Promise<T> => {
    try {
      const result = await withService(test)
      deps.diagnostics.recordTest(service, true, null)
      return result
    } catch (err) {
      deps.diagnostics.recordTest(service, false, err instanceof IpcError ? err.code : 'INTERNAL')
      throw err
    }
  }
  return {
    'app:info': () => ({ ...deps.versions(), shortcut: deps.shortcut.status() }),
    'app:openExternal': async ({ url }) => {
      const hosts = linkHosts(deps.settings.get(), deps.http.demo)
      const verdict = checkExternalUrl(url, hosts)
      if (!verdict.ok) throw new IpcError('NOT_ALLOWED', verdict.reason)
      await deps.openExternal(verdict.url)
    },
    'diagnostics:info': () => deps.diagnostics.info(),
    'diagnostics:export': () => deps.diagnostics.report(),
    'diagnostics:save': async () => {
      const text = await deps.diagnostics.report()
      try {
        return { path: await deps.saveText(deps.diagnostics.fileName(), text) }
      } catch (err) {
        throw new IpcError(
          'INTERNAL',
          "Couldn't save the report. Pick another folder, or copy it from the dialog.",
          err instanceof Error ? err.message : String(err),
        )
      }
    },
    'app:openLogsFolder': async () => {
      const error = await deps.openPath(deps.logsDir)
      if (error) throw new IpcError('INTERNAL', 'Could not open the logs folder.', error)
    },
    'app:showView': ({ view }) => deps.showView(view),
    'app:quit': () => deps.quit(),

    'settings:get': () => deps.settings.get(),
    'settings:update': (patch) => deps.settings.update(patch),
    'settings:export': () => deps.settings.export(),
    'settings:import': ({ json }) => {
      try {
        return deps.settings.import(json)
      } catch (err) {
        throw new IpcError('INVALID_PAYLOAD', err instanceof Error ? err.message : String(err))
      }
    },
    'settings:reset': () => deps.settings.reset(),

    'secrets:status': () => deps.secrets.status(),
    'secrets:list': () => withSecrets(() => deps.secrets.keys()),
    'secrets:set': ({ key, value }) => withSecrets(() => deps.secrets.set(key, value)),
    'secrets:delete': ({ key }) => withSecrets(() => deps.secrets.delete(key)),
    'secrets:clearAll': () => deps.secrets.clear(),

    'notifications:history': () => deps.notifications.list(),
    'notifications:clear': () => deps.notifications.clear(),
    'notifications:test': ({ type }) =>
      deps.notifications.notify({
        type,
        title: 'Test notification',
        body: `This is how a "${type}" notification looks.`,
      }),
    'notifications:pause': ({ minutes }) => deps.notifications.pause(minutes),
    'notifications:resume': () => deps.notifications.resume(),
    'notifications:state': () => ({ pausedUntil: deps.notifications.getPausedUntil() }),

    'shortcut:set': ({ accelerator }) => {
      const result = deps.shortcut.set(accelerator)
      if (result.ok && deps.settings.get().general.paletteShortcut !== accelerator) {
        deps.settings.update({ general: { paletteShortcut: accelerator } })
      }
      return result
    },
    'palette:open': () => deps.openPalette(),
    'palette:close': () => deps.closePalette(),
    'panel:close': () => deps.closePanel(),

    'demo:ping': async () => {
      const res = await deps.http.fetch(new Request(`${DEMO_ORIGIN}/ping`))
      return { status: res.status, body: await res.text(), demo: deps.http.demo }
    },

    'repos:list': () => deps.repos.list(),
    'repos:pickFolder': () => deps.pickFolder(),
    'repos:add': ({ path }) => withGit(() => deps.repos.add(path)),
    'repos:remove': ({ id }) => withGit(() => deps.repos.remove(id)),
    'repos:update': ({ id, patch }) => withGit(() => deps.repos.update(id, patch)),
    'repos:status': ({ id }) => withGit(() => repoStatus(deps.git, deps.repos.get(id))),
    'repos:plan': ({ id, request }) =>
      withGit(() => deps.actions.plan(deps.repos.get(id), request)),
    'repos:run': ({ id, runId, request }) =>
      withGit(() =>
        deps.actions.run(deps.repos.get(id), request, (chunk, stream) =>
          deps.emitOutput({ runId, chunk, stream }),
        ),
      ),
    'repos:open': ({ id, target }) => withGit(() => deps.openRepo(deps.repos.get(id), target)),
    'devserver:list': () => deps.devServers.list(),
    'devserver:start': ({ id, kind }) =>
      withGit(() => deps.devServers.start(deps.repos.get(id), kind)),
    'devserver:stop': ({ id, kind }) =>
      withGit(() => deps.devServers.stop(deps.repos.get(id).id, kind)),
    'devserver:log': ({ id, kind }) => deps.devServers.log(id, kind),
    'jira:testConnection': () => recorded('Jira', () => deps.jira.testConnection()),
    'jira:list': (request) => withService(() => deps.jira.list(request)),
    'jira:issue': ({ key }) => withService(() => deps.jira.issue(key)),
    'bitbucket:detect': ({ baseUrl }) => withService(() => deps.bitbucket.detect(baseUrl)),
    'bitbucket:testConnection': () => recorded('Bitbucket', () => deps.bitbucket.testConnection()),
    'bitbucket:list': ({ list }) => withService(() => deps.bitbucket.list(list)),
    'bitbucket:pr': (ref) => withService(() => deps.bitbucket.pr(ref)),
    'bitbucket:action': (request) =>
      withService(async () => {
        // SPEC 6.3: off by default. Checked here, whatever the renderer showed or sent.
        if (!deps.settings.get().features.prActions) {
          throw new IpcError(
            'NOT_ALLOWED',
            'PR actions are turned off. Turn them on in Settings → Actions (only if your role permits).',
          )
        }
        try {
          const result = await deps.bitbucket.act(request)
          deps.prWatcher.acknowledge(result)
          return result.pr
        } catch (err) {
          if (err instanceof PrActionError) throw new IpcError('PRECONDITION_FAILED', err.message)
          throw err
        }
      }),
    'prs:list': ({ provider, list }) => withService(() => deps.prs.list(provider, list)),
    'prs:pr': (ref) => withService(() => deps.prs.pr(ref)),
    'prs:action': (request) =>
      withService(async () => {
        // SPEC 6.3: one switch for every provider, checked here whatever the renderer sent.
        if (!deps.settings.get().features.prActions) {
          throw new IpcError(
            'NOT_ALLOWED',
            'PR actions are turned off. Turn them on in Settings → Actions (only if your role permits).',
          )
        }
        try {
          const result = await deps.prs.act(request)
          deps.prWatcher.acknowledge(result)
          return result.pr
        } catch (err) {
          if (err instanceof PrActionError) throw new IpcError('PRECONDITION_FAILED', err.message)
          throw err
        }
      }),
    'providers:detect': () => withGit(() => deps.detectProviders()),
    'github:testConnection': () => recorded('GitHub', () => deps.hosts.github.testConnection()),
    'gitlab:testConnection': () => recorded('GitLab', () => deps.hosts.gitlab.testConnection()),
    'ci:runs': ({ provider }) => withService(() => deps.hosts[provider].runs()),
    'ci:run': (ref) => withService(() => deps.hosts[ref.provider].run(ref)),
    'ci:log': ({ ref, jobId }) => withService(() => deps.hosts[ref.provider].log(ref, jobId)),
    'ci:action': (request) =>
      withService(async () => {
        // Owner decision (P7): off by default and confirmed each time, like PR actions.
        if (!deps.settings.get().features.ciActions) {
          throw new IpcError(
            'NOT_ALLOWED',
            'CI actions are turned off. Turn them on in Settings → Actions (only if your role permits).',
          )
        }
        try {
          const run = await deps.hosts[request.ref.provider].ciAct(request)
          deps.ciWatcher.restarted(run)
          return run
        } catch (err) {
          if (err instanceof CiActionError) throw new IpcError('PRECONDITION_FAILED', err.message)
          throw err
        }
      }),
    'ciwatch:list': () => deps.ciWatcher.list(),
    'ciwatch:add': (request) => withWatch(() => deps.ciWatcher.add(request)),
    'ciwatch:remove': ({ key }) => deps.ciWatcher.remove(key),
    'ciwatch:clearFinished': () => deps.ciWatcher.clearFinished(),
    'watch:list': () => deps.prWatcher.list(),
    'watch:add': ({ link }) => withWatch(() => deps.prWatcher.add(link)),
    'watch:remove': ({ key }) => deps.prWatcher.remove(key),
    'watch:request': ({ link, pipeline }) => deps.requestWatch(link, pipeline ?? false),
    'jenkins:testConnection': () => recorded('Jenkins', () => deps.jenkins.testConnection()),
    'jenkins:branches': () => withService(() => deps.jenkins.branches()),
    'jenkins:build': (ref) => withService(() => deps.jenkins.build(ref)),
    'jenkins:console': ({ start, ...ref }) => withService(() => deps.jenkins.console(ref, start)),
    'jenkins:parameters': ({ job }) => withService(() => deps.jenkins.parameters(job)),
    'jenkins:trigger': ({ job, parameters }) =>
      withService(async () => {
        // SPEC 6.4: checked here, whatever the renderer showed or sent. Protected wins over
        // the allow-list: those jobs can never be triggered from DevDock.
        const settings = deps.settings.get()
        const refusal = triggerRefusal(job, settings)
        if (refusal) throw new IpcError('NOT_ALLOWED', TRIGGER_REFUSALS[refusal](job, settings))
        return { queueUrl: await deps.jenkins.trigger(job, parameters) }
      }),
    'buildwatch:list': () => deps.buildWatcher.list(),
    'buildwatch:add': (request) => withWatch(() => deps.buildWatcher.add(request)),
    'buildwatch:addPr': ({ link }) => withWatch(() => deps.buildWatcher.addPr(link)),
    'buildwatch:remove': ({ key }) => deps.buildWatcher.remove(key),
    'buildwatch:clearFinished': () => deps.buildWatcher.clearFinished(),
    'ports:list': () => withProcess(() => deps.ports.list()),
    'ports:stop': (request) => withProcess(() => deps.ports.stop(request)),
    'caches:plan': ({ id }) => withCaches(() => planClean(deps.repos.get(id).path)),
    'caches:clean': ({ id, includeNodeModules }) =>
      withCaches(() => clean(deps.repos.get(id).path, includeNodeModules)),
    'envprofiles:state': ({ id }) => withEnv(() => deps.envProfiles.state(deps.repos.get(id))),
    'envprofiles:save': ({ id, name, replace }) =>
      withEnv(() => deps.envProfiles.save(deps.repos.get(id), name, replace)),
    'envprofiles:switch': ({ id, name }) =>
      withEnv(() => deps.envProfiles.switchTo(deps.repos.get(id), name)),
    'envprofiles:restore': ({ id }) =>
      withEnv(() => deps.envProfiles.restoreBackup(deps.repos.get(id))),
    'envprofiles:delete': ({ id, name }) =>
      withEnv(() => deps.envProfiles.remove(deps.repos.get(id), name)),
    'envprofiles:reveal': ({ id, profile, key }) =>
      withEnv(() => deps.envProfiles.reveal(deps.repos.get(id), profile, key)),
    'envprofiles:diff': ({ id, a, b }) =>
      withEnv(() => deps.envProfiles.diff(deps.repos.get(id), a, b)),
    'envprofiles:clearAll': () => withEnv(() => deps.envProfiles.clearAll()),
    'standup:draft': () => deps.standupDraft(),
    'lessons:comments': () => withService(() => deps.bitbucket.reviewComments()),
    'lessons:state': ({ repoId }) => withLessons(() => deps.lessons.state(repoId)),
    'lessons:add': ({ repoId, lessons }) => withLessons(() => deps.lessons.add(repoId, lessons)),
    'utilities:request': (request) => deps.requestUtility(request),
    'tickets:request': ({ key }) => deps.requestTicket(key),
    'commands:request': ({ id }) => deps.requestCommand(id),
    'startwork:plan': (request) => withStartWork(() => deps.startWork.plan(request)),
    'startwork:run': (request) =>
      withStartWork(() =>
        deps.startWork.run(request, (chunk, stream) =>
          deps.emitOutput({ runId: request.runId, chunk, stream }),
        ),
      ),
    'repos:requestAction': ({ id, request }) =>
      withGit(() => {
        deps.repos.get(id)
        deps.requestRepoAction({ id, request })
      }),
    // P7-A. The renderer never sends a path: a terminal starts in a registered repo (looked
    // up here) or in the home folder.
    'terminal:create': ({ repoId, cols, rows, agent }, event) =>
      withTerminal(async () => {
        const owner = terminalOwner(event)
        // Taken before the folder check: a window that reloads meanwhile gets no shell.
        const epoch = deps.terminal.epoch(owner)
        const repo = repoId ? deps.repos.get(repoId) : null
        const cwd = repo ? repo.path : deps.home
        const isDir = await stat(cwd).then(
          (s) => s.isDirectory(),
          () => false,
        )
        if (!isDir) {
          throw new IpcError(
            'NOT_FOUND',
            repo
              ? `The folder for ${repo.name} is missing. Check it in Repos.`
              : 'Your home folder could not be opened.',
          )
        }
        // P7-C: the agent CLI is the PTY's process, started with an argument array.
        const program = agent ? agentSpawn(agent, await deps.agents(), deps.platform) : undefined
        return deps.terminal.create({
          owner,
          cwd,
          title: tabTitle(repo ? repo.name : 'Home', agent?.id),
          repoId: repo ? repo.id : null,
          cols,
          rows,
          epoch,
          program,
        })
      }),
    'terminal:write': ({ id, data }, event) =>
      withTerminal(() => deps.terminal.write(terminalOwner(event), id, data)),
    'terminal:resize': ({ id, cols, rows }, event) =>
      withTerminal(() => deps.terminal.resize(terminalOwner(event), id, cols, rows)),
    'terminal:kill': ({ id }, event) =>
      withTerminal(() => deps.terminal.kill(terminalOwner(event), id)),
    'terminal:request': (request) =>
      withGit(() => {
        if (request.repoId) deps.repos.get(request.repoId)
        deps.requestTerminal(request)
      }),
    'agents:detect': async () => agentStatus(await deps.agents()),
    // P7-C-B: main builds the text (loading the PR itself; a comment and the edited standup come
    // from the screen), holds it, and sends it on `ai:run` once the user has seen it.
    'ai:prepare': (req) =>
      withService(async () => {
        if (req.feature === 'pr-summary') {
          return deps.ai.prepare('pr-summary', prPrompt(await deps.prs.pr(req.ref)))
        }
        if (req.feature === 'standup') return deps.ai.prepare('standup', standupPrompt(req.draft))
        return deps.ai.prepare('lesson', lessonPrompt(req.comment, req.where))
      }),
    'ai:run': ({ id }) => withService(() => deps.ai.run(id)),
    'ai:testConnection': () => recorded('Anthropic', () => deps.ai.testConnection()),
  }
}
