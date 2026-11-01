import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, type Mock } from 'vitest'
import type { HandlerDeps } from '../../src/main/handlers'
import type { HandlerMap } from '../../src/main/ipc/registry'
import type { GitRunner } from '../../src/main/services/git/exec'
import type { RepoOutputEvent } from '../../src/shared/repos'
import type { TerminalExitEvent, TerminalOutputEvent } from '../../src/shared/terminal'
import { fakeSpawn, type FakePty } from './pty'

/** HandlerDeps with the Electron adapters exposed as mocks, so tests can stub and inspect them. */
export type TestDeps = HandlerDeps & {
  openExternal: Mock<(url: string) => Promise<void>>
  openPath: Mock<(path: string) => Promise<string>>
  pickFolder: Mock<() => Promise<string | null>>
  openRepo: Mock<HandlerDeps['openRepo']>
  emitOutput: Mock<(e: RepoOutputEvent) => void>
  writeClipboard: Mock<(text: string) => void>
  requestTerminal: Mock<HandlerDeps['requestTerminal']>
  requestCommand: Mock<HandlerDeps['requestCommand']>
  agents: Mock<HandlerDeps['agents']>
}

export interface HandlerSetup {
  deps: TestDeps
  handlers: HandlerMap
  output: RepoOutputEvent[]
  git: GitRunner
  /** Fake PTYs the terminal handlers started, and what they sent to which window. */
  ptys: FakePty[]
  terminalEvents: { owner: number; output?: TerminalOutputEvent; exit?: TerminalExitEvent }[]
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
  const { LessonsService } = await import('../../src/main/services/lessons')
  const { DiagnosticsService } = await import('../../src/main/services/diagnostics')
  const { PrWatcher } = await import('../../src/main/services/bitbucket/watcher')
  const { JenkinsService } = await import('../../src/main/services/jenkins/service')
  const { DEMO_JENKINS } = await import('../../src/main/demo/jenkins')
  const { BuildWatcher } = await import('../../src/main/services/jenkins/watcher')
  const { PortService, runCommand } = await import('../../src/main/services/process/ports')
  const { EnvProfiles } = await import('../../src/main/services/envprofiles')
  const { standupDraft } = await import('../../src/main/services/standup')
  const { demoCommits } = await import('../../src/main/demo/standup')
  const { HostService } = await import('../../src/main/services/providers/service')
  const { PrHub } = await import('../../src/main/services/providers/hub')
  const { CiWatcher } = await import('../../src/main/services/ci/watcher')
  const { GitHubClient } = await import('../../src/main/services/github/client')
  const { GitLabClient } = await import('../../src/main/services/gitlab/client')
  const { DEMO_GITHUB_CONFIG } = await import('../../src/main/demo/github')
  const { DEMO_GITLAB_CONFIG } = await import('../../src/main/demo/gitlab')
  const { detectHosts, configuredHosts } = await import('../../src/main/services/providers/detect')

  const dir = mkdtempSync(join(tmpdir(), 'devdock-handlers-'))
  const settings = new SettingsStore(join(dir, 'settings.json'))
  const cipher = {
    isEncryptionAvailable: () => opts.encryption ?? true,
    encryptString: (s: string) => Buffer.from(s).reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
  }
  const secrets = new SecretStore(join(dir, 'secrets.bin'), cipher, 'darwin')
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
  const lessons = new LessonsService({
    repo: (id) => repos.get(id),
    settings: () => settings.get(),
    git,
  })
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
  const bitbucket = new BitbucketService({
    http,
    settings: () => settings.get(),
    token: () => secrets.get('bitbucket.token'),
    repoRemotes: async () => [],
    demo: DEMO_BITBUCKET,
  })
  const jenkins = new JenkinsService({
    http,
    settings: () => settings.get(),
    token: () => secrets.get('jenkins.token'),
    myWork: async () => ({ branches: [], prs: [] }),
    demo: DEMO_JENKINS,
  })
  const { AiService } = await import('../../src/main/services/ai/service')
  const { TerminalManager } = await import('../../src/main/services/terminal/manager')
  const pty = fakeSpawn()
  const terminalEvents: HandlerSetup['terminalEvents'] = []
  const terminal = new TerminalManager({
    spawn: pty.spawn,
    settings: () => settings.get().terminal,
    onOutput: (owner, output) => terminalEvents.push({ owner, output }),
    onExit: (owner, exit) => terminalEvents.push({ owner, exit }),
    promptDir: join(dir, 'terminal'),
    batchMs: 1,
    killGraceMs: 50,
    signal: () => undefined,
  })
  const github = new HostService({
    provider: 'github',
    http,
    settings: () => settings.get(),
    token: () => secrets.get('github.token'),
    repoRemotes: async () => [],
    demo: DEMO_GITHUB_CONFIG,
    makeClient: (h, config, projects) => new GitHubClient(h, config, projects),
  })
  const gitlab = new HostService({
    provider: 'gitlab',
    http,
    settings: () => settings.get(),
    token: () => secrets.get('gitlab.token'),
    repoRemotes: async () => [],
    demo: DEMO_GITLAB_CONFIG,
    makeClient: (h, config, projects) => new GitLabClient(h, config, projects),
  })
  const hosts = { github, gitlab }
  const prs = new PrHub({ bitbucket, github, gitlab })
  const ciWatcher = new CiWatcher({
    file: join(dir, 'ci-watches.json'),
    ci: {
      runInfo: (ref) => hosts[ref.provider].runInfo(ref),
      site: (p) => hosts[p].site(),
    },
    notify: (n) => notifications.notify(n),
    onChange: vi.fn(),
  })
  const deps: TestDeps = {
    terminal,
    home: dir,
    requestTerminal: vi.fn(),
    agents: vi.fn(() => [
      { id: 'claude' as const, name: 'Claude Code', path: '/usr/local/bin/claude' },
      { id: 'codex' as const, name: 'Codex', path: null },
      { id: 'gemini' as const, name: 'Gemini CLI', path: null },
      { id: 'copilot' as const, name: 'GitHub Copilot CLI', path: null },
    ]),
    platform: 'darwin',
    ai: new AiService({
      http,
      key: () => secrets.get('anthropic.key'),
      model: () => settings.get().ai.model,
    }),
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
    closePanel: vi.fn(),
    diagnostics: new DiagnosticsService({
      versions: () => ({
        app: '0.0.0',
        electron: '0',
        chrome: '0',
        node: '0',
        platform: 'test',
        arch: 'x',
      }),
      run: async () => ({ stdout: 'git version 2.0.0\n', stderr: '', code: 0 }),
      resolveProxy: async () => 'DIRECT',
      settings: () => settings.get(),
      credentials: async () => [],
      logFile: join(dir, 'devdock.log'),
      home: dir,
      user: 'tester',
    }),
    saveText: vi.fn(async () => null),
    quit: vi.fn(),
    repos,
    git,
    actions,
    pickFolder: vi.fn(async () => null as string | null),
    openRepo,
    emitOutput: vi.fn((e: RepoOutputEvent) => void output.push(e)),
    requestRepoAction: vi.fn(),
    requestWatch: vi.fn(),
    requestUtility: vi.fn(),
    requestTicket: vi.fn(),
    requestCommand: vi.fn(),
    devServers: new DevServerManager({ onChange: vi.fn(), onOutput: vi.fn() }),
    jira,
    bitbucket,
    prs,
    hosts,
    ciWatcher,
    detectProviders: async () =>
      detectHosts(
        settings.get().repos.map((r) => ({ name: r.name, remotes: [] })),
        configuredHosts(settings.get()),
      ),
    prWatcher: new PrWatcher({
      file: join(dir, 'watches.json'),
      bitbucket: prs,
      notify: (n) => notifications.notify(n),
      onChange: vi.fn(),
    }),
    jenkins,
    envProfiles: new EnvProfiles({ dir: join(dir, 'env-profiles'), cipher }),
    lessons,
    standupDraft: () =>
      standupDraft(
        {
          holidays: () => settings.get().standup.holidays,
          commits: async (from) => demoCommits(from),
          prs: (list) => bitbucket.list(list),
          jira,
        },
        new Date(),
      ),
    ports: new PortService({
      platform: process.platform,
      run: runCommand,
      signal: (pid, sig) => process.kill(pid, sig),
      ownPids: () => [process.pid, process.ppid],
    }),
    buildWatcher: new BuildWatcher({
      file: join(dir, 'build-watches.json'),
      jenkins,
      bitbucket: prs,
      notify: (n) => notifications.notify(n),
      onChange: vi.fn(),
    }),
    writeClipboard,
    startWork: new StartWorkService({
      jira,
      actions,
      git,
      repo: (id) => repos.get(id),
      settings: () => settings.get(),
      lessonsExist: (id) => lessons.exists(id),
      briefsDir: join(dir, 'briefs'),
      writeClipboard,
      openEditor: (repo) => openRepo(repo, 'editor'),
    }),
  }
  return { deps, handlers: createHandlers(deps), output, git, ptys: pty.ptys, terminalEvents }
}
