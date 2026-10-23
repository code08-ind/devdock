/** One handler per IPC channel in @shared/ipc `contract`. Electron-free: adapters are injected. */
import type { View } from '@shared/channels'
import type { ErrorCode, Res } from '@shared/ipc'
import type { ActionRequest, OpenTarget, RepoOutputEvent } from '@shared/repos'
import type { RepoConfig, Settings } from '@shared/settings'
import { DEMO_ORIGIN } from './demo/handlers'
import { IpcError, type HandlerMap } from './ipc/registry'
import { checkExternalUrl } from './security'
import type { GitActions } from './services/git/actions'
import { GitError, type GitErrorKind } from './services/git/errors'
import type { GitRunner } from './services/git/exec'
import { repoStatus } from './services/git/repo'
import type { HttpClient } from './services/http'
import type { JiraService } from './services/jira/service'
import type { NotificationService } from './services/notifications'
import { DevServerError, type DevServerManager } from './services/process/devserver'
import { RepoNotFoundError, type RepoService } from './services/repos'
import { SecretsUnavailableError, type SecretStore } from './services/secrets'
import { ServiceError, type ServiceErrorKind } from './services/service-error'
import type { SettingsStore } from './services/settings'
import type { ShortcutService } from './services/shortcut'

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
  quit: () => void
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
  /** Brings up the main window's action dialog (from the palette window). */
  requestRepoAction: (event: { id: string; request: ActionRequest }) => void
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

const SERVICE_CODES: Record<ServiceErrorKind, ErrorCode> = {
  not_configured: 'NOT_CONFIGURED',
  auth: 'SERVICE_AUTH',
  forbidden: 'SERVICE_FORBIDDEN',
  not_found: 'NOT_FOUND',
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
  return {
    'app:info': () => ({ ...deps.versions(), shortcut: deps.shortcut.status() }),
    'app:openExternal': async ({ url }) => {
      // Local dev servers (P1 "Start dev server" URL) are always allowed besides the list.
      const settings = deps.settings.get()
      // SPEC 5: configured services' hosts + the user's list; local dev servers (P1) too.
      const hosts = [
        ...settings.links.allowedHosts,
        ...serviceHosts(settings),
        // Demo-mode links point at the demo fixtures' host.
        ...(deps.http.demo ? [new URL(DEMO_ORIGIN).hostname] : []),
        'localhost',
        '127.0.0.1',
        '[::1]',
      ]
      const verdict = checkExternalUrl(url, hosts)
      if (!verdict.ok) throw new IpcError('NOT_ALLOWED', verdict.reason)
      await deps.openExternal(verdict.url)
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
    'jira:testConnection': () => withService(() => deps.jira.testConnection()),
    'jira:list': (request) => withService(() => deps.jira.list(request)),
    'jira:issue': ({ key }) => withService(() => deps.jira.issue(key)),
    'repos:requestAction': ({ id, request }) =>
      withGit(() => {
        deps.repos.get(id)
        deps.requestRepoAction({ id, request })
      }),
  }
}

/** Hosts of the services configured in Settings (links to them may be opened). */
function serviceHosts(settings: Settings): string[] {
  return [settings.jira.baseUrl].flatMap((url) => {
    try {
      return url ? [new URL(url).hostname] : []
    } catch {
      return []
    }
  })
}
