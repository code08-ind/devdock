import type { View } from '@shared/channels'
import { THEMES, type SettingsPatch, type Theme } from '@shared/settings'

/** One palette entry. Later phases add argument commands (`watch <link>`, `kill <port>`). */
export interface Command {
  id: string
  title: string
  group: 'Go to' | 'Appearance' | 'Notifications' | 'App'
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
