import type { View } from '@shared/channels'
import { parsePrLink } from '@shared/prlink'
import type { ActionRequest, OpenTarget } from '@shared/repos'
import { THEMES, type SettingsPatch, type Theme } from '@shared/settings'

/** One palette entry. Argument commands (`watch <link>`) come from `queryCommands`. */
export interface Command {
  id: string
  title: string
  group: 'Go to' | 'Repos' | 'Pull requests' | 'Appearance' | 'Notifications' | 'App'
  keywords?: string[]
  shortcut?: string
  run: () => unknown
}

export const VIEW_LABELS: Record<View, string> = {
  today: 'Today',
  repos: 'Repos',
  prs: 'Pull requests',
  builds: 'Builds',
  tickets: 'Tickets',
  utilities: 'Utilities',
  settings: 'Settings',
}

const VIEW_KEYWORDS: Partial<Record<View, string[]>> = {
  prs: ['bitbucket', 'review'],
  builds: ['jenkins', 'pipeline', 'ci'],
  tickets: ['jira', 'issues'],
  repos: ['git', 'branches'],
  utilities: ['ports', 'env', 'links', 'standup'],
  settings: ['preferences', 'options'],
}

export interface CommandContext {
  goto: (view: View) => void
  /** Shortcut label for "Go to" entries, e.g. index 0 → "⌘1". */
  viewShortcut?: (index: number) => string
  theme: Theme
  themeLabel: (t: Theme) => string
  demoMode: boolean
  paused: boolean
  update: (patch: SettingsPatch) => unknown
  pause: () => unknown
  resume: () => unknown
  openLogs: () => unknown
  testNotification: () => unknown
  quit: () => unknown
  /** Registered repos, for per-repo commands. */
  repos: readonly { id: string; name: string }[]
  /** Opens the action dialog (commands disclosure, confirm, activity log) for a repo. */
  requestAction: (id: string, request: ActionRequest) => unknown
  openRepo: (id: string, target: OpenTarget) => unknown
  openLabels: Record<OpenTarget, string>
  /** Watches a PR link (the main window shows PRs and reports the result there). */
  watch: (link: string) => unknown
}

const REPO_ACTIONS: { key: string; label: string; request: ActionRequest; keywords: string[] }[] = [
  { key: 'fetch', label: 'Fetch all', request: { action: 'fetchAll' }, keywords: ['git', 'fetch'] },
  {
    key: 'sync',
    label: 'Sync base',
    request: { action: 'syncBase' },
    keywords: ['develop', 'main'],
  },
  {
    key: 'update',
    label: 'Update my branch',
    // The dialog swaps in the saved merge/rebase default.
    request: { action: 'updateBranch', strategy: 'merge', stash: false },
    keywords: ['merge', 'rebase', 'pull'],
  },
  {
    key: 'branch',
    label: 'New branch',
    request: { action: 'newBranch', kind: 'feature', title: '' },
    keywords: ['checkout', 'feature', 'bugfix'],
  },
  { key: 'push', label: 'Push branch', request: { action: 'pushBranch' }, keywords: ['publish'] },
  { key: 'fork', label: 'Sync fork', request: { action: 'syncFork' }, keywords: ['upstream'] },
]

/** Every repo action goes through the same dialog as the Repos screen (commands shown first). */
function repoCommands(ctx: CommandContext): Command[] {
  return ctx.repos.flatMap<Command>((r) => [
    ...REPO_ACTIONS.map<Command>((a) => ({
      id: `repo:${r.id}:${a.key}`,
      title: `${a.label} — ${r.name}`,
      group: 'Repos',
      keywords: ['git', ...a.keywords],
      run: () => ctx.requestAction(r.id, a.request),
    })),
    ...(['editor', 'terminal', 'files'] as const).map<Command>((target) => ({
      id: `repo:${r.id}:${target}`,
      title: `${ctx.openLabels[target]} — ${r.name}`,
      group: 'Repos',
      keywords: ['open', 'code', 'shell', 'folder', 'finder', 'explorer'],
      run: () => ctx.openRepo(r.id, target),
    })),
  ])
}

export function buildCommands(ctx: CommandContext, views: readonly View[]): Command[] {
  const go = views.map<Command>((view, i) => ({
    id: `go:${view}`,
    title: `Go to ${VIEW_LABELS[view]}`,
    group: 'Go to',
    keywords: VIEW_KEYWORDS[view],
    shortcut: ctx.viewShortcut?.(i),
    run: () => ctx.goto(view),
  }))
  const themes = THEMES.filter((t) => t !== ctx.theme).map<Command>((t) => ({
    id: `theme:${t}`,
    title: `Use ${ctx.themeLabel(t)} theme`,
    group: 'Appearance',
    keywords: ['theme', 'colour', 'color', 'dark', 'light'],
    run: () => ctx.update({ appearance: { theme: t } }),
  }))
  return [
    ...go,
    ...repoCommands(ctx),
    {
      id: 'pr:watch',
      title: 'Watch a pull request…',
      group: 'Pull requests',
      keywords: ['watch', 'bitbucket', 'link', 'pr', 'paste'],
      run: () => ctx.goto('prs'),
    },
    ...themes,
    ctx.paused
      ? {
          id: 'notif:resume',
          title: 'Resume notifications',
          group: 'Notifications',
          run: ctx.resume,
        }
      : {
          id: 'notif:pause',
          title: 'Pause notifications for 1 hour',
          group: 'Notifications',
          keywords: ['mute', 'quiet', 'focus'],
          run: ctx.pause,
        },
    {
      id: 'notif:test',
      title: 'Send a test notification',
      group: 'Notifications',
      run: ctx.testNotification,
    },
    {
      id: 'app:demo',
      title: ctx.demoMode ? 'Turn off demo mode' : 'Turn on demo mode',
      group: 'App',
      keywords: ['fake', 'fixtures', 'sample'],
      run: () => ctx.update({ general: { demoMode: !ctx.demoMode } }),
    },
    {
      id: 'app:logs',
      title: 'Open logs folder',
      group: 'App',
      keywords: ['debug', 'diagnostics'],
      run: ctx.openLogs,
    },
    { id: 'app:quit', title: 'Quit DevDock', group: 'App', keywords: ['exit'], run: ctx.quit },
  ]
}

/**
 * Commands made from what is typed (SPEC 6.1 "some take arguments, e.g. `watch <PR link>`"):
 * `watch <link>`, or a pull request link pasted on its own. Checked with the same parser as main.
 */
export function queryCommands(
  query: string,
  ctx: Pick<CommandContext, 'watch' | 'goto'>,
): Command[] {
  const text = query.trim()
  const argument = /^watch\s+(\S+)$/i.exec(text)?.[1]
  const link = argument ?? text
  const parsed = link ? parsePrLink(link) : null
  if (!parsed) {
    // `watch <something>` that isn't a link: say so (a bare non-link is just a search).
    return argument
      ? [
          {
            id: 'pr:watch-invalid',
            title: `Not a pull request link: open Pull requests to paste one`,
            group: 'Pull requests',
            run: () => ctx.goto('prs'),
          },
        ]
      : []
  }
  return [
    {
      id: 'pr:watch-link',
      title: `Watch pull request ${parsed.ref.repo} #${parsed.ref.id}`,
      group: 'Pull requests',
      run: () => ctx.watch(link),
    },
  ]
}

function score(c: Command, q: string): number {
  const title = c.title.toLowerCase()
  if (title.startsWith(q)) return 4
  const words = [...title.split(/\s+/), ...(c.keywords ?? [])]
  if (words.some((w) => w.startsWith(q))) return 3
  if (title.includes(q)) return 2
  // Subsequence match, e.g. "gtpr" → "Go to Pull requests".
  let i = 0
  for (const ch of title) if (ch === q[i]) i++
  return i === q.length ? 1 : 0
}

/** Ranked matches; every whitespace-separated term must match. Ties keep registry order. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...commands]
  return commands
    .map((c, i) => ({ c, i, s: terms.reduce((sum, t) => sum + (score(c, t) || -Infinity), 0) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.c)
}
