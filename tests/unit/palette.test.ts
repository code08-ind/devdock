import { describe, expect, it, vi } from 'vitest'
import { VIEWS } from '../../src/shared/channels'
import {
  buildCommands,
  filterCommands,
  queryCommands,
  rememberRecent,
  withRecentFirst,
  RECENT_LIMIT,
  type CommandContext,
} from '../../src/renderer/features/palette/commands'

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  goto: vi.fn(),
  theme: 'system',
  themeLabel: (t) => t,
  demoMode: true,
  paused: false,
  update: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  openLogs: vi.fn(),
  testNotification: vi.fn(),
  quit: vi.fn(),
  repos: [],
  requestAction: vi.fn(),
  openRepo: vi.fn(),
  openLabels: { editor: 'Open in VS Code', terminal: 'Open terminal', files: 'Reveal in Finder' },
  watch: vi.fn(),
  utility: vi.fn(),
  quickLinks: [],
  openLink: vi.fn(),
  devServers: [],
  baselines: [],
  branchBuilds: [],
  watchDeploy: vi.fn(),
  ticketMoves: [],
  ciActions: [],
  moveTicket: vi.fn(),
  configured: { prs: true, jenkins: true, jira: true },
  prActions: [],
  buildWatches: [],
  finishedBuilds: false,
  unwatchBuild: vi.fn(),
  clearFinishedBuilds: vi.fn(),
  devServer: vi.fn(),
  issues: [],
  startWork: vi.fn(),
  watches: [],
  unwatch: vi.fn(),
  openTerminal: vi.fn(),
  agent: null,
  aiPrs: [],
  aiName: 'Claude',
  ...over,
})

describe('palette commands', () => {
  it('has a Go to entry for every nav item, in rail order', () => {
    const go = buildCommands(ctx(), VIEWS).filter((c) => c.group === 'Go to')
    expect(go.map((c) => c.id)).toEqual(VIEWS.map((v) => `go:${v}`))
  })

  it('offers every theme except the current one', () => {
    const themes = buildCommands(ctx({ theme: 'dark' }), VIEWS).filter(
      (c) => c.group === 'Appearance',
    )
    expect(themes.map((c) => c.id)).not.toContain('theme:dark')
    expect(themes).toHaveLength(5)
  })

  it('switches Pause/Resume and demo-mode wording with state', () => {
    const titles = (c: CommandContext) => buildCommands(c, VIEWS).map((x) => x.title)
    expect(titles(ctx())).toContain('Pause notifications for 1 hour')
    expect(titles(ctx({ paused: true }))).toContain('Resume notifications')
    expect(titles(ctx({ demoMode: false }))).toContain('Turn on demo mode')
  })

  it('runs the matching action', () => {
    const c = ctx()
    const cmds = buildCommands(c, VIEWS)
    cmds.find((x) => x.id === 'go:builds')!.run()
    expect(c.goto).toHaveBeenCalledWith('builds')
    cmds.find((x) => x.id === 'app:demo')!.run()
    expect(c.update).toHaveBeenCalledWith({ general: { demoMode: false } })
  })
})

describe('repo commands', () => {
  const repos = [{ id: 'r1', name: 'web-app' }]
  it('lists every action and open target per repo', () => {
    const cmds = buildCommands(ctx({ repos }), VIEWS).filter((c) => c.group === 'Repos')
    expect(cmds.map((c) => c.title)).toEqual([
      'Fetch all — web-app',
      'Sync base — web-app',
      'Update my branch — web-app',
      'New branch — web-app',
      'Push branch — web-app',
      'Sync fork — web-app',
      'Start dev server — web-app',
      'Open in VS Code — web-app',
      'Open terminal — web-app',
      'Reveal in Finder — web-app',
    ])
  })
  it('actions open the dialog (never run git directly); opens go straight through', () => {
    const c = ctx({ repos })
    const cmds = buildCommands(c, VIEWS)
    cmds.find((x) => x.id === 'repo:r1:push')!.run()
    expect(c.requestAction).toHaveBeenCalledWith('r1', { action: 'pushBranch' })
    cmds.find((x) => x.id === 'repo:r1:editor')!.run()
    expect(c.openRepo).toHaveBeenCalledWith('r1', 'editor')
  })
  it('is searchable by repo name', () => {
    const cmds = buildCommands(ctx({ repos }), VIEWS)
    expect(filterCommands(cmds, 'sync base web').map((c) => c.id)).toEqual(['repo:r1:sync'])
  })
})

describe('filterCommands', () => {
  const cmds = buildCommands(ctx(), VIEWS)
  const ids = (q: string) => filterCommands(cmds, q).map((c) => c.id)

  it('returns everything for an empty query', () => {
    expect(ids('  ')).toHaveLength(cmds.length)
  })
  it('ranks title prefix matches first', () => {
    expect(ids('quit')[0]).toBe('app:quit')
  })
  it('matches keywords', () => {
    expect(ids('jenkins')).toEqual(['go:builds', 'build:pipeline'])
    expect(ids('jira')).toEqual(['go:tickets'])
  })
  it('requires every term to match', () => {
    expect(ids('go pull')).toEqual(['go:prs'])
    expect(ids('go nonsense')).toEqual([])
  })
  it('supports subsequence matches', () => {
    expect(ids('gtset')).toContain('go:settings')
  })
  it('is case-insensitive', () => {
    expect(ids('LOGS')).toEqual(['app:logs'])
  })
})

describe('watch <PR link> (SPEC 6.1 argument command)', () => {
  const DC = 'https://bitbucket.example.com/projects/WEB/repos/web-app/pull-requests/42/overview'
  it('`watch <link>` and a bare pasted link both offer to watch that PR', () => {
    for (const query of [`watch ${DC}`, `  WATCH   ${DC} `, DC]) {
      const c = ctx()
      const [cmd] = queryCommands(query, c)
      expect(cmd).toMatchObject({ title: 'Watch pull request web-app #42', group: 'Pull requests' })
      void cmd!.run()
      expect(c.watch).toHaveBeenCalledWith(DC)
    }
    expect(queryCommands(`watch ${DC}`, ctx())).toHaveLength(1)
  })

  it('`pipeline <link>` watches its Jenkins build; a bare link offers that second', () => {
    for (const query of [`pipeline ${DC}`, DC]) {
      const c = ctx()
      const offered = queryCommands(query, c)
      const cmd = offered.at(-1)!
      expect(offered).toHaveLength(query === DC ? 2 : 1)
      expect(cmd).toMatchObject({ title: 'Watch the pipeline of web-app #42', group: 'Builds' })
      void cmd.run()
      expect(c.watch).toHaveBeenCalledWith(DC, true)
    }
    const c = ctx()
    const [hint] = queryCommands('pipeline nope', c)
    expect(hint).toMatchObject({ id: 'build:pipeline-invalid' })
    void hint!.run()
    expect(c.goto).toHaveBeenCalledWith('builds')
  })

  it('offers nothing for searches that are not links; `watch <not a link>` says so', () => {
    for (const query of ['', 'watch', 'https://github.com/a/b/issues/1', 'watch x y', 'theme']) {
      expect(queryCommands(query, ctx())).toEqual([])
    }
    const c = ctx()
    const [hint, ...rest] = queryCommands('watch https://github.com/a/b/issues/1', c)
    expect(rest).toEqual([])
    expect(hint).toMatchObject({ id: 'pr:watch-invalid', title: /Not a pull request link/ })
    void hint!.run()
    expect(c.goto).toHaveBeenCalledWith('prs')
    expect(c.watch).not.toHaveBeenCalled()
  })

  it('P7: GitHub / GitLab PR links and Actions run / pipeline links', () => {
    const c = ctx()
    expect(queryCommands('https://github.com/a/web/pull/3', c).map((x) => x.title)).toEqual([
      'Watch pull request web #3',
      'Watch the pipeline of web #3',
    ])
    expect(
      queryCommands('watch https://gitlab.com/g/sub/app/-/merge_requests/9', c)[0]!.title,
    ).toBe('Watch pull request app !9')
    const [run, ...more] = queryCommands('watch https://github.com/a/web/actions/runs/77', c)
    expect(more).toEqual([])
    expect(run).toMatchObject({ id: 'build:watch-run-link', title: 'Watch web run #77' })
    void run!.run()
    expect(c.watch).toHaveBeenCalledWith('https://github.com/a/web/actions/runs/77')
    expect(queryCommands('gitlab.com/g/app/-/pipelines/5', c)[0]!.title).toBe(
      'Watch app pipeline #5',
    )
  })

  it('"watch" alone still finds the Watch a pull request entry (it opens Pull requests)', () => {
    const c = ctx()
    const [first] = filterCommands(buildCommands(c, VIEWS), 'watch')
    expect(first).toMatchObject({ id: 'pr:watch' })
    void first!.run()
    expect(c.goto).toHaveBeenCalledWith('prs')
    // With a link typed, the static entry no longer matches: only the argument command shows.
    expect(filterCommands(buildCommands(c, VIEWS), `watch ${DC}`)).toEqual([])
  })
})

describe('Utilities in the palette (SPEC 6.1 / 6.6)', () => {
  it('`kill 5173` opens the stop dialog for that port (it never stops anything itself)', () => {
    const c = ctx()
    const [cmd, ...rest] = queryCommands('kill 5173', c)
    expect(rest).toEqual([])
    expect(cmd).toMatchObject({ title: 'Stop the process on port 5173…', group: 'Utilities' })
    void cmd!.run()
    expect(c.utility).toHaveBeenCalledWith({ tab: 'ports', stopPort: 5173 })
    expect(queryCommands('kill 70000', c)).toEqual([])
    expect(queryCommands('kill', c)).toEqual([])
  })

  it('each quick link is a command, found by name, group or host', () => {
    const c = ctx({
      quickLinks: [
        {
          id: 'a',
          name: 'Orders dashboard',
          url: 'https://eu-west-1.console.aws.amazon.com/cw',
          group: 'AWS',
        },
      ],
    })
    for (const q of ['orders', 'aws', 'eu-west']) {
      expect(
        filterCommands(buildCommands(c, VIEWS), q).map((x) => x.id),
        q,
      ).toContain('link:a')
    }
    const link = buildCommands(c, VIEWS).find((x) => x.id === 'link:a')!
    expect(link).toMatchObject({ title: 'Open Orders dashboard', group: 'Quick links' })
    void link.run()
    expect(c.openLink).toHaveBeenCalledWith('https://eu-west-1.console.aws.amazon.com/cw')
  })

  it('every utility has an entry that opens its tab', () => {
    const c = ctx()
    const utils = buildCommands(c, VIEWS).filter((x) => x.group === 'Utilities')
    expect(utils.map((x) => x.id)).toEqual([
      'util:ports',
      'util:caches',
      'util:env',
      'util:links',
      'util:standup',
      'util:lessons',
    ])
    void filterCommands(utils, 'standup')[0]!.run()
    expect(c.utility).toHaveBeenCalledWith({ tab: 'standup' })
    void filterCommands(utils, 'review comments')[0]!.run()
    expect(c.utility).toHaveBeenCalledWith({ tab: 'lessons' })
  })
})

describe('palette completeness (P6.01)', () => {
  const repo = { id: 'r1', name: 'web-app' }

  it('P7-C: the installed agent CLI per repo, started in a terminal tab there', () => {
    const find = (c: CommandContext) =>
      buildCommands(c, VIEWS).find((x) => x.id === 'repo:r1:agent')
    expect(find(ctx({ repos: [repo] }))).toBeUndefined()
    const openTerminal = vi.fn()
    const c = find(ctx({ repos: [repo], openTerminal, agent: { id: 'codex', name: 'Codex' } }))!
    expect(c.title).toBe('Start Codex — web-app')
    void c.run()
    expect(openTerminal).toHaveBeenCalledWith('r1', { id: 'codex' })
  })

  it('dev server per repo: Start; Stop asks first, and only where a dialog can show', () => {
    const find = (c: CommandContext) =>
      buildCommands(c, VIEWS).find((x) => x.id === 'repo:r1:devserver')
    expect(find(ctx({ repos: [repo] }))!.title).toBe('Start dev server — web-app')
    const running = [{ repoId: 'r1', running: true }]
    // The palette window has no confirm: no Stop there.
    expect(find(ctx({ repos: [repo], devServers: running }))).toBeUndefined()
    const confirm = vi.fn()
    const c = ctx({ repos: [repo], devServers: running, confirm })
    const stop = find(c)!
    expect(stop.title).toBe('Stop dev server — web-app…')
    void stop.run()
    expect(c.devServer).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Stop the dev server for web-app?',
        confirmLabel: 'Stop dev server',
      }),
    )
    void (confirm.mock.calls[0]![0] as { run: () => void }).run()
    expect(c.devServer).toHaveBeenCalledWith('r1', false)
  })

  it('baseline server: only for repos with the script; Stop asks first', () => {
    const find = (c: CommandContext) =>
      buildCommands(c, VIEWS).find((x) => x.id === 'repo:r1:baseline')
    expect(find(ctx({ repos: [repo] }))).toBeUndefined()
    const c = ctx({ repos: [repo], baselines: [{ repoId: 'r1', running: false }] })
    const start = find(c)!
    expect(start.title).toBe('Start baseline server — web-app')
    void start.run()
    expect(c.devServer).toHaveBeenCalledWith('r1', true, 'baseline')
    const running = [{ repoId: 'r1', running: true }]
    expect(find(ctx({ repos: [repo], baselines: running }))).toBeUndefined()
    const confirm = vi.fn()
    const stop = find(ctx({ repos: [repo], baselines: running, confirm }))!
    expect(stop).toMatchObject({ title: 'Stop baseline server — web-app…', inMain: true })
    void stop.run()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Stop baseline server' }),
    )
  })

  it('trigger a build (where its dialog can show) and watch a deploy, per branch job', () => {
    const job = 'web-app/feature%2FDD-1'
    const branchBuilds = [
      {
        job,
        label: 'web-app › feature/DD-1',
        branch: 'feature/DD-1',
        triggers: true,
        deploys: true,
      },
      // Same branch in another project: one deploy command for the branch.
      {
        job: 'api/feature%2FDD-1',
        label: 'api › feature/DD-1',
        branch: 'feature/DD-1',
        triggers: false,
        deploys: true,
      },
      {
        job: 'web-app/PR-412',
        label: 'web-app › PR-412',
        branch: 'PR-412',
        triggers: true,
        deploys: false,
      },
    ]
    const ids = (c: CommandContext) =>
      buildCommands(c, VIEWS)
        .filter((x) => x.id.startsWith('build:trigger') || x.id.startsWith('build:deploy'))
        .map((x) => x.id)
    // No trigger dialog: deploy watches only.
    expect(ids(ctx({ branchBuilds }))).toEqual(['build:deploy:feature/DD-1'])
    const trigger = vi.fn()
    const c = ctx({ branchBuilds, trigger })
    expect(ids(c)).toEqual([
      `build:trigger:${job}`,
      'build:trigger:web-app/PR-412',
      'build:deploy:feature/DD-1',
    ])
    const all = buildCommands(c, VIEWS)
    const t = all.find((x) => x.id === `build:trigger:${job}`)!
    expect(t).toMatchObject({ title: 'Trigger a build of web-app › feature/DD-1…', inMain: true })
    void t.run()
    expect(trigger).toHaveBeenCalledWith(job)
    const d = all.find((x) => x.id === 'build:deploy:feature/DD-1')!
    expect(d.title).toBe('Watch the deploy of feature/DD-1')
    void d.run()
    expect(c.watchDeploy).toHaveBeenCalledWith('feature/DD-1')
  })

  it('CI actions (T11): one command per allowed action, through its dialog, where one can show', () => {
    const ciActions = [
      { key: 'gh-1', action: 'retry' as const, title: 'Re-run failed jobs: storefront CI #345' },
      {
        key: 'gl-2',
        action: 'cancel' as const,
        title: 'Cancel pipeline: infra-tools Pipeline #77',
      },
    ]
    const ids = (c: CommandContext) =>
      buildCommands(c, VIEWS)
        .filter((x) => x.id.startsWith('ci:'))
        .map((x) => x.id)
    expect(ids(ctx({ ciActions }))).toEqual([])
    const ciAction = vi.fn()
    const c = ctx({ ciActions, ciAction })
    expect(ids(c)).toEqual(['ci:retry:gh-1', 'ci:cancel:gl-2'])
    const retry = buildCommands(c, VIEWS).find((x) => x.id === 'ci:retry:gh-1')!
    expect(retry).toMatchObject({
      title: 'Re-run failed jobs: storefront CI #345…',
      group: 'Builds',
      inMain: true,
    })
    void retry.run()
    expect(ciAction).toHaveBeenCalledWith('gh-1', 'retry')
  })

  it('move a ticket (T5): asks first, only where a dialog can show', () => {
    const ticketMoves = [
      {
        prKey: 'k2',
        key: 'DD-101',
        status: 'In Review',
        confirm: {
          title: 'Move DD-101 to In Review?',
          body: 'b',
          confirmLabel: 'Move to In Review',
        },
      },
    ]
    const find = (c: CommandContext) =>
      buildCommands(c, VIEWS).find((x) => x.id === 'ticket:move:k2')
    expect(find(ctx({ ticketMoves }))).toBeUndefined()
    const confirm = vi.fn()
    const c = ctx({ ticketMoves, confirm })
    const move = find(c)!
    expect(move).toMatchObject({
      title: 'Move DD-101 to In Review…',
      group: 'Tickets',
      inMain: true,
    })
    void move.run()
    expect(c.moveTicket).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Move DD-101 to In Review?',
        confirmLabel: 'Move to In Review',
      }),
    )
    void (confirm.mock.calls[0]![0] as { run: () => void }).run()
    expect(c.moveTicket).toHaveBeenCalledWith('k2')
  })

  it('commands with a dialog are marked to hand over from the palette window', () => {
    const all = buildCommands(
      ctx({
        repos: [repo],
        devServers: [{ repoId: 'r1', running: true }],
        confirm: vi.fn(),
        prActions: [{ key: 'k1', label: 'web-app #412', action: 'merge' }],
        prAction: vi.fn(),
        aiPrs: [{ key: 'k1', label: 'web-app #412' }],
        ai: vi.fn(),
      }),
      VIEWS,
    )
    expect(all.filter((c) => c.inMain).map((c) => c.id)).toEqual([
      'repo:r1:devserver',
      'ai:standup',
      'ai:pr-summary:k1',
      'pr:merge:k1',
    ])
  })

  it('AI actions: only where the dialog can show (and AI is available), per open PR', () => {
    const aiPrs = [{ key: 'k1', label: 'web-app #412' }]
    expect(buildCommands(ctx({ aiPrs }), VIEWS).some((x) => x.id.startsWith('ai:'))).toBe(false)
    const ai = vi.fn()
    const all = buildCommands(ctx({ aiPrs, ai }), VIEWS)
    const standup = all.find((x) => x.id === 'ai:standup')!
    expect(standup.title).toBe('Polish the standup with Claude…')
    void standup.run()
    expect(ai).toHaveBeenCalledWith({ feature: 'standup' })
    const note = all.find((x) => x.id === 'ai:pr-summary:k1')!
    expect(note.title).toBe('Summarise web-app #412 with Claude…')
    void note.run()
    expect(ai).toHaveBeenCalledWith({ feature: 'pr-summary', key: 'k1' })
    expect(filterCommands(all, 'claude standup').map((c) => c.id)).toContain('ai:standup')
  })

  it('PR actions (when turned on and a dialog can show) and build watches', () => {
    const base = {
      prActions: [{ key: 'k1', label: 'web-app #412', action: 'approve' as const }],
      buildWatches: [{ key: 'b1', label: 'web-app › develop #230' }],
      finishedBuilds: true,
    }
    expect(buildCommands(ctx(base), VIEWS).some((x) => x.id.startsWith('pr:approve'))).toBe(false)
    const prAction = vi.fn()
    const c = ctx({ ...base, prAction })
    const all = buildCommands(c, VIEWS)
    const approve = all.find((x) => x.id === 'pr:approve:k1')!
    expect(approve.title).toBe('Approve web-app #412…')
    void approve.run()
    expect(prAction).toHaveBeenCalledWith('k1', 'approve')
    void all.find((x) => x.id === 'build:unwatch:b1')!.run()
    expect(c.unwatchBuild).toHaveBeenCalledWith('b1')
    void all.find((x) => x.id === 'build:clear-finished')!.run()
    expect(c.clearFinishedBuilds).toHaveBeenCalled()
  })

  it('says why a command is off: no repo for Start work, a service not set up', () => {
    const c = ctx({
      issues: [{ key: 'DD-101', summary: 'Checkout total' }],
      configured: { prs: false, jenkins: true, jira: true },
    })
    const all = buildCommands(c, VIEWS)
    expect(all.find((x) => x.id === 'ticket:start:DD-101')!.disabled).toBe(
      'Add a repo first: Start work makes the branch there',
    )
    expect(queryCommands('branch DD-101', c)[0]!.disabled).toMatch(/^Add a repo first/)
    const noJira = ctx({
      repos: [repo],
      configured: { prs: true, jenkins: true, jira: false },
    })
    expect(queryCommands('branch DD-101', noJira)[0]!.disabled).toBe(
      'Set up Jira in Settings first',
    )
    expect(all.find((x) => x.id === 'pr:watch')!.disabled).toBe(
      'Turn on Bitbucket, GitHub or GitLab in Settings first',
    )
    expect(all.find((x) => x.id === 'build:pipeline')!.disabled).toBeUndefined()
  })

  it('Start work on each open issue; Stop watching each watched PR', () => {
    const c = ctx({
      repos: [repo],
      issues: [{ key: 'DD-101', summary: 'Checkout total' }],
      watches: [{ key: 'w1', label: 'web-app #412' }],
    })
    const all = buildCommands(c, VIEWS)
    void filterCommands(all, 'dd-101')[0]!.run()
    expect(c.startWork).toHaveBeenCalledWith('DD-101')
    void filterCommands(all, 'stop watching 412')[0]!.run()
    expect(c.unwatch).toHaveBeenCalledWith('w1')
  })

  it('`branch <KEY>` starts work (preview first); a non-key says so and opens Tickets', () => {
    const c = ctx({ repos: [repo] })
    const [cmd, ...rest] = queryCommands('branch dd-101', c)
    expect(rest).toEqual([])
    expect(cmd!.title).toBe('Start work on DD-101…')
    void cmd!.run()
    expect(c.startWork).toHaveBeenCalledWith('DD-101')
    const [bad] = queryCommands('branch hello', c)
    expect(bad!.title).toMatch(/isn't a Jira key/)
    void bad!.run()
    expect(c.goto).toHaveBeenCalledWith('tickets')
  })

  it('`open <link name>`: matching quick links, names starting with it first', () => {
    const c = ctx({
      quickLinks: [
        { id: 'a', name: 'AWS orders', url: 'https://aws.example.com/a', group: '' },
        { id: 'b', name: 'Orders dashboard', url: 'https://d.example.com/b', group: '' },
        { id: 'c', name: 'Figma', url: 'https://figma.com/c', group: '' },
      ],
    })
    expect(queryCommands('open orders', c).map((x) => x.title)).toEqual([
      'Open Orders dashboard',
      'Open AWS orders',
    ])
    void queryCommands('open fig', c)[0]!.run()
    expect(c.openLink).toHaveBeenCalledWith('https://figma.com/c')
    expect(queryCommands('open nothing-like-it', c)).toEqual([])
  })

  it('recent commands first, most recent on top; forgotten ones drop out; capped', () => {
    const all = buildCommands(ctx(), VIEWS)
    let recent: string[] = []
    recent = rememberRecent(recent, 'go:builds')
    recent = rememberRecent(recent, 'app:quit')
    recent = rememberRecent(recent, 'go:builds')
    recent = rememberRecent(recent, 'repo:gone:fetch')
    const ordered = withRecentFirst(all, recent)
    expect(ordered.slice(0, 2).map((c) => c.id)).toEqual(['go:builds', 'app:quit'])
    expect(ordered).toHaveLength(all.length)
    for (let i = 0; i < 20; i++) recent = rememberRecent(recent, `x${i}`)
    expect(recent).toHaveLength(RECENT_LIMIT)
  })

  it("ranks commands that can run above ones that can't", () => {
    const c = ctx({
      issues: [{ key: 'DD-106', summary: 'Export orders as CSV' }],
      quickLinks: [{ id: 'a', name: 'Orders dashboard', url: 'https://x.example.com', group: '' }],
    })
    const found = filterCommands(buildCommands(c, VIEWS), 'orders')
    expect(found.map((x) => x.id)).toEqual(['link:a', 'ticket:start:DD-106'])
  })
})
