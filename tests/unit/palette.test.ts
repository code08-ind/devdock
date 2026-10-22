import { describe, expect, it, vi } from 'vitest'
import { VIEWS } from '../../src/shared/channels'
import {
  buildCommands,
  filterCommands,
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
    expect(ids('jenkins')).toEqual(['go:builds'])
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
