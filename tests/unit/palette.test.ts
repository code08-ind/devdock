import { describe, expect, it, vi } from 'vitest'
import { VIEWS } from '../../src/shared/channels'
import {
  buildCommands,
  filterCommands,
  queryCommands,
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
    for (const query of ['', 'watch', 'https://github.com/a/b/pull/1', 'watch x y', 'theme']) {
      expect(queryCommands(query, ctx())).toEqual([])
    }
    const c = ctx()
    const [hint, ...rest] = queryCommands('watch https://github.com/a/b/pull/1', c)
    expect(rest).toEqual([])
    expect(hint).toMatchObject({ id: 'pr:watch-invalid', title: /Not a pull request link/ })
    void hint!.run()
    expect(c.goto).toHaveBeenCalledWith('prs')
    expect(c.watch).not.toHaveBeenCalled()
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
    ])
    void filterCommands(utils, 'standup')[0]!.run()
    expect(c.utility).toHaveBeenCalledWith({ tab: 'standup' })
  })
})
