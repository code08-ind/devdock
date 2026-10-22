/** One handler per IPC channel in @shared/ipc `contract`. Electron-free: adapters are injected. */
import type { View } from '@shared/channels'
import type { ErrorCode, Res } from '@shared/ipc'
import type { ActionRequest, OpenTarget, RepoOutputEvent } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { DEMO_ORIGIN } from './demo/handlers'
import { IpcError, type HandlerMap } from './ipc/registry'
import { checkExternalUrl } from './security'
import type { GitActions } from './services/git/actions'
import { GitError, type GitErrorKind } from './services/git/errors'
import type { GitRunner } from './services/git/exec'
import { repoStatus } from './services/git/repo'
import type { HttpClient } from './services/http'
import type { NotificationService } from './services/notifications'
import { RepoNotFoundError, type RepoService } from './services/repos'
import { SecretsUnavailableError, type SecretStore } from './services/secrets'
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
      const verdict = checkExternalUrl(url, deps.settings.get().links.allowedHosts)
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
    'repos:requestAction': ({ id, request }) =>
      withGit(() => {
        deps.repos.get(id)
        deps.requestRepoAction({ id, request })
      }),
  }
}
