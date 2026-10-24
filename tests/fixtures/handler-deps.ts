import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, type Mock } from 'vitest'
import type { HandlerDeps } from '../../src/main/handlers'
import type { HandlerMap } from '../../src/main/ipc/registry'
import type { GitRunner } from '../../src/main/services/git/exec'
import type { RepoOutputEvent } from '../../src/shared/repos'

/** HandlerDeps with the Electron adapters exposed as mocks, so tests can stub and inspect them. */
export type TestDeps = HandlerDeps & {
  openExternal: Mock<(url: string) => Promise<void>>
  openPath: Mock<(path: string) => Promise<string>>
  pickFolder: Mock<() => Promise<string | null>>
  openRepo: Mock<HandlerDeps['openRepo']>
  emitOutput: Mock<(e: RepoOutputEvent) => void>
  writeClipboard: Mock<(text: string) => void>
}

export interface HandlerSetup {
  deps: TestDeps
  handlers: HandlerMap
  output: RepoOutputEvent[]
  git: GitRunner
}

/**
 * Real services in a temp folder + fakes for Electron-only adapters. Import after
 * `vi.mock('electron', …)` in the test file (it loads main-process modules dynamically).
 */
export async function handlerSetup(
  opts: { encryption?: boolean; registerOk?: boolean } = {},
): Promise<HandlerSetup> {
  const { createHandlers } = await import('../../src/main/handlers')
  const { SettingsStore } = await import('../../src/main/services/settings')
  const { SecretStore } = await import('../../src/main/services/secrets')
  const { NotificationService } = await import('../../src/main/services/notifications')
  const { ShortcutService } = await import('../../src/main/services/shortcut')
  const { DemoHttpClient } = await import('../../src/main/services/http')
  const { demoHandlers } = await import('../../src/main/demo/handlers')
  const { GitRunner } = await import('../../src/main/services/git/exec')
  const { GitActions } = await import('../../src/main/services/git/actions')
  const { RepoService } = await import('../../src/main/services/repos')
  const { DevServerManager } = await import('../../src/main/services/process/devserver')
  const { JiraService } = await import('../../src/main/services/jira/service')
  const { DEMO_JIRA } = await import('../../src/main/demo/jira')
  const { BitbucketService } = await import('../../src/main/services/bitbucket/service')
  const { DEMO_BITBUCKET } = await import('../../src/main/demo/bitbucket')
  const { StartWorkService } = await import('../../src/main/services/startwork')

  const dir = mkdtempSync(join(tmpdir(), 'devdock-handlers-'))
  const settings = new SettingsStore(join(dir, 'settings.json'))
  const secrets = new SecretStore(
    join(dir, 'secrets.bin'),
    {
      isEncryptionAvailable: () => opts.encryption ?? true,
      encryptString: (s) => Buffer.from(s).reverse(),
      decryptString: (b) => Buffer.from(b).reverse().toString(),
    },
    'darwin',
  )
  const notifications = new NotificationService({
    file: join(dir, 'notifications.json'),
    getPrefs: () => settings.get().notifications,
    native: { show: vi.fn() },
    onClick: vi.fn(),
  })
  const shortcut = new ShortcutService(
    { register: () => opts.registerOk ?? true, unregister: vi.fn(), isRegistered: () => false },
    vi.fn(),
    'darwin',
  )
  const git = new GitRunner()
  const output: RepoOutputEvent[] = []
  const repos = new RepoService(settings, git)
  const actions = new GitActions(git)
  const openRepo = vi.fn<HandlerDeps['openRepo']>(async () => undefined)
  const writeClipboard = vi.fn<(text: string) => void>()
  const http = new DemoHttpClient(demoHandlers())
  const jira = new JiraService({
    http,
    settings: () => settings.get(),
    token: () => secrets.get('jira.token'),
    demo: DEMO_JIRA,
  })
  const deps: TestDeps = {
    settings,
    secrets,
    notifications,
    shortcut,
    http,
    logsDir: join(dir, 'logs'),
    versions: () => ({
      version: '0.0.0',
      electron: '1',
      chrome: '1',
      node: '1',
      platform: 'darwin',
      arch: 'arm64',
    }),
    openExternal: vi.fn(async (_url: string) => undefined),
    openPath: vi.fn(async (_path: string) => ''),
    showView: vi.fn(),
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    quit: vi.fn(),
    repos,
    git,
    actions,
    pickFolder: vi.fn(async () => null as string | null),
    openRepo,
    emitOutput: vi.fn((e: RepoOutputEvent) => void output.push(e)),
    requestRepoAction: vi.fn(),
    devServers: new DevServerManager({ onChange: vi.fn(), onOutput: vi.fn() }),
    jira,
    bitbucket: new BitbucketService({
      http,
      settings: () => settings.get(),
      token: () => secrets.get('bitbucket.token'),
      repoRemotes: async () => [],
      demo: DEMO_BITBUCKET,
    }),
    writeClipboard,
    startWork: new StartWorkService({
      jira,
      actions,
      git,
      repo: (id) => repos.get(id),
      settings: () => settings.get(),
      briefsDir: join(dir, 'briefs'),
      writeClipboard,
      openEditor: (repo) => openRepo(repo, 'editor'),
    }),
  }
  return { deps, handlers: createHandlers(deps), output, git }
}
