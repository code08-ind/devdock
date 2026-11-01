import type { AgentCliId, AgentLaunch } from '@shared/agents'
import type { PrAction } from '@shared/bitbucket'
import type { View } from '@shared/channels'
import { ISSUE_KEY } from '@shared/jira'
import { refLabel } from '@shared/bitbucket'
import { parseRunLink, ciRunLabel } from '@shared/ci'
import { parseAnyPrLink } from '@shared/prlink'
import type { ServerKind } from '@shared/devserver'
import type { ActionRequest, OpenTarget } from '@shared/repos'
import { THEMES, type SettingsPatch, type Theme } from '@shared/settings'
import type { QuickLink } from '@shared/links'
import type { UtilityRequest } from '@shared/utilities'

const linkHost = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** One palette entry. Argument commands (`watch <link>`) come from `queryCommands`. */
export interface Command {
  id: string
  title: string
  group:
    | 'Go to'
    | 'Repos'
    | 'Pull requests'
    | 'Builds'
    | 'Tickets'
    | 'Utilities'
    | 'Terminal'
    | 'Quick links'
    | 'Appearance'
    | 'Notifications'
    | 'App'
  keywords?: string[]
  shortcut?: string
  /** Why it can't run now (shown in the list; picking it does nothing). */
  disabled?: string
  /**
   * It opens a dialog or reports its result in a window (stop dev server, PR actions, AI,
   * trigger build, watch deploy). The palette window can't show either: it hands these to the
   * main window by id, which runs its own copy (`commands:request`).
   */
  inMain?: true
  run: () => unknown
}

export const VIEW_LABELS: Record<View, string> = {
  home: 'Home',
  today: 'Today',
  repos: 'Repos',
  prs: 'Pull requests',
  builds: 'Builds',
  tickets: 'Tickets',
  utilities: 'Utilities',
  terminal: 'Terminal',
  settings: 'Settings',
}

const VIEW_KEYWORDS: Partial<Record<View, string[]>> = {
  home: ['start', 'launcher', 'features'],
  prs: ['bitbucket', 'github', 'gitlab', 'merge request', 'review'],
  builds: ['jenkins', 'pipeline', 'ci', 'actions', 'github', 'gitlab'],
  tickets: ['jira', 'issues'],
  repos: ['git', 'branches'],
  utilities: ['ports', 'env', 'links', 'standup', 'lessons'],
  terminal: ['shell', 'zsh', 'console', 'command line', 'pty'],
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
  /**
   * Watches a PR link (the main window shows PRs and reports the result there), or with
   * `pipeline` the Jenkins build that runs it (shown in Builds). A GitHub Actions run or GitLab
   * pipeline link is watched as a run (Builds).
   */
  watch: (link: string, pipeline?: boolean) => unknown
  /** Opens a Utilities tab (`stopPort`: the stop dialog for that port's process). */
  utility: (request: UtilityRequest) => unknown
  /** SPEC 6.6 quick links: each is a palette command. */
  quickLinks: readonly QuickLink[]
  openLink: (url: string) => unknown
  /** Each repo's dev server: running (or starting) or not, and whether it has a command. */
  devServers: readonly { repoId: string; running: boolean }[]
  /** Repos with a baseline server (`scripts/baseline.mjs`, or one running), SPEC 6.2. */
  baselines: readonly { repoId: string; running: boolean }[]
  /** Services set up (or demo mode): commands that need one say so when it isn't. */
  configured: { prs: boolean; jenkins: boolean; jira: boolean }
  /**
   * Asks before doing something that stops a process (SPEC 7). Windows that can't show a
   * dialog leave it out, and the commands that need it aren't offered there.
   */
  confirm?: (request: ConfirmRequest) => unknown
  /** PR actions the user turned on, per open PR (approve / needs work / merge). */
  prActions: readonly { key: string; label: string; action: PrAction }[]
  /** Opens the PR action's confirmation dialog; left out where it can't be shown. */
  prAction?: (key: string, action: PrAction) => unknown
  /** Watched builds, to stop watching; whether any have finished (to clear them). */
  buildWatches: readonly { key: string; label: string }[]
  finishedBuilds: boolean
  unwatchBuild: (key: string) => unknown
  clearFinishedBuilds: () => unknown
  /** Starts or stops a repo's dev server (or, with `kind`, its baseline server). */
  devServer: (repoId: string, start: boolean, kind?: ServerKind) => unknown
  /**
   * My branches' Jenkins jobs (when Jenkins is set up): `triggers` when the job may be
   * triggered (allowed, not protected), `deploys` when a deploy job is set for branches.
   */
  branchBuilds: readonly {
    job: string
    label: string
    branch: string
    triggers: boolean
    deploys: boolean
  }[]
  /**
   * CI actions on my recent and watched GitHub Actions runs / GitLab pipelines (Settings →
   * Actions → CI actions on), each with its title ("Re-run failed jobs: storefront CI #345").
   */
  ciActions: readonly { key: string; action: 'retry' | 'cancel'; title: string }[]
  /** Opens the CI action's confirmation dialog; left out where it can't be shown. */
  ciAction?: (key: string, action: 'retry' | 'cancel') => unknown
  /** Opens the trigger dialog (parameters, confirmation); left out where it can't be shown. */
  trigger?: (job: string) => unknown
  /** Watches the deploy job's next build for a branch (SPEC 6.4). */
  watchDeploy: (branch: string) => unknown
  /** My open Jira issues (when loaded): Start work on each. */
  issues: readonly { key: string; summary: string }[]
  /** Opens Start work for an issue key (preview first, then the user starts it). */
  startWork: (key: string) => unknown
  /**
   * T5 offers to move a ticket (a PR of mine opened for it), with their confirmation text;
   * moving needs `confirm` (SPEC 7: Jira transitions).
   */
  ticketMoves: readonly {
    prKey: string
    key: string
    status: string
    confirm: { title: string; body: string; confirmLabel: string }
  }[]
  moveTicket: (prKey: string) => unknown
  /** Watched pull requests, to stop watching. */
  watches: readonly { key: string; label: string }[]
  unwatch: (key: string) => unknown
  /** A new tab in DevDock's own terminal (P7-A), in a repo or the home folder; or an agent CLI there. */
  openTerminal: (repoId: string | null, agent?: AgentLaunch) => unknown
  /** The agent CLI to offer per repo (P7-C: Settings → Workflow → Agent, if installed). */
  agent: { id: AgentCliId; name: string } | null
  /** Open PRs (mine and the ones I review) that a status note can be drafted for (P7-C-B). */
  aiPrs: readonly { key: string; label: string }[]
  /**
   * Opens the AI dialog (preview, then Send) for the standup or a PR's status note. Left out
   * where the dialog can't show, or when there is no key for the active AI provider and demo
   * mode is off.
   */
  ai?: (request: { feature: 'standup' } | { feature: 'pr-summary'; key: string }) => unknown
  /** The active AI provider's assistant ("Claude", "GPT", "Gemini"), for the titles. */
  aiName: string
}

/**
 * The palette's name for DevDock's own terminal ("Open terminal" is the OS terminal app). It
 * lives here, not next to `OPEN_LABELS` in lib/repos, so this registry stays free of React and
 * the bridge (its unit tests run in Node).
 */
export const DEVDOCK_TERMINAL_LABEL = 'Open in DevDock terminal'

/** "New terminal" (home folder): in the full list and for a bare `terminal`. */
function newTerminalCommand(ctx: Pick<CommandContext, 'openTerminal'>): Command {
  return {
    id: 'terminal:new',
    title: 'New terminal',
    group: 'Terminal',
    keywords: ['shell', 'zsh', 'console', 'tab', 'home'],
    run: () => ctx.openTerminal(null),
  }
}

const UTILITY_COMMANDS: { tab: UtilityRequest['tab']; title: string; keywords: string[] }[] = [
  {
    tab: 'ports',
    title: 'Show listening ports',
    keywords: ['port', 'kill', 'lsof', 'netstat', 'process'],
  },
  { tab: 'caches', title: 'Clean caches…', keywords: ['dist', 'coverage', 'vite', 'node_modules'] },
  { tab: 'env', title: 'Switch env profile…', keywords: ['env', '.env.local', 'dotenv'] },
  { tab: 'links', title: 'Manage quick links', keywords: ['links', 'bookmarks', 'aws'] },
  { tab: 'standup', title: 'Write standup draft', keywords: ['standup', 'yesterday', 'daily'] },
  {
    tab: 'lessons',
    title: 'Pick agent lessons from review comments',
    keywords: ['lessons', 'agent', 'review', 'comments', 'learn'],
  },
]

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
    ...serverCommands(ctx, r, 'dev'),
    ...serverCommands(ctx, r, 'baseline'),
    ...(['editor', 'terminal', 'files'] as const).map<Command>((target) => ({
      id: `repo:${r.id}:${target}`,
      title: `${ctx.openLabels[target]} — ${r.name}`,
      group: 'Repos',
      keywords: ['open', 'code', 'shell', 'folder', 'finder', 'explorer'],
      run: () => ctx.openRepo(r.id, target),
    })),
    {
      id: `repo:${r.id}:devdock-terminal`,
      title: `${DEVDOCK_TERMINAL_LABEL} — ${r.name}`,
      group: 'Terminal',
      keywords: ['terminal', 'shell', 'zsh', 'console', 'tab'],
      run: () => ctx.openTerminal(r.id),
    },
    ...(ctx.agent ? [agentCommand(ctx.agent, r, ctx)] : []),
  ])
}

/** P7-C-B: the AI actions with your own key (SPEC 7: every action from the palette). */
function aiCommands(ctx: Pick<CommandContext, 'ai' | 'aiPrs' | 'aiName'>): Command[] {
  const ai = ctx.ai
  if (!ai) return []
  return [
    {
      id: 'ai:standup',
      title: `Polish the standup with ${ctx.aiName}…`,
      group: 'Utilities',
      inMain: true,
      keywords: ['ai', 'claude', 'gpt', 'openai', 'gemini', 'standup', 'polish', 'daily'],
      run: () => ai({ feature: 'standup' }),
    },
    ...ctx.aiPrs.map<Command>((p) => ({
      id: `ai:pr-summary:${p.key}`,
      title: `Draft a status note for ${p.label} with ${ctx.aiName}…`,
      group: 'Pull requests',
      keywords: ['ai', 'claude', 'gpt', 'openai', 'gemini', 'status', 'note', 'summary', 'pr'],
      inMain: true,
      run: () => ai({ feature: 'pr-summary', key: p.key }),
    })),
  ]
}

/** P7-C: the agent CLI in a terminal tab in the repo (no first message: Start work gives that). */
function agentCommand(
  agent: { id: AgentCliId; name: string },
  r: { id: string; name: string },
  ctx: Pick<CommandContext, 'openTerminal'>,
): Command {
  return {
    id: `repo:${r.id}:agent`,
    title: `Start ${agent.name} — ${r.name}`,
    group: 'Terminal',
    keywords: ['agent', 'ai', 'claude', 'codex', 'gemini', 'copilot'],
    run: () => ctx.openTerminal(r.id, { id: agent.id }),
  }
}

/** A confirmation a command asks for before it runs. */
export interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  run: () => unknown
}

const PR_ACTION_VERB: Record<PrAction, string> = {
  approve: 'Approve',
  needs_work: 'Mark needs work on',
  merge: 'Merge',
}

/** Start work makes a branch in a registered repo. */
const noRepoReason = (ctx: Pick<CommandContext, 'repos'>) =>
  ctx.repos.length ? undefined : 'Add a repo first: Start work makes the branch there'

const SERVER_NAMES: Record<ServerKind, string> = { dev: 'dev server', baseline: 'baseline server' }

/** Start or stop a repo's dev or baseline server (SPEC 7: every action from the palette). */
function serverCommands(
  ctx: CommandContext,
  r: { id: string; name: string },
  kind: ServerKind,
): Command[] {
  const list = kind === 'dev' ? ctx.devServers : ctx.baselines
  const state = list.find((d) => d.repoId === r.id)
  // Baseline commands only for repos that have the script (or one running).
  if (kind === 'baseline' && !state) return []
  const id = kind === 'dev' ? `repo:${r.id}:devserver` : `repo:${r.id}:baseline`
  const name = SERVER_NAMES[kind]
  const keywords = kind === 'dev' ? ['dev', 'server', 'npm'] : ['baseline', 'server', 'node']
  const call = (start: boolean) =>
    kind === 'dev' ? ctx.devServer(r.id, start) : ctx.devServer(r.id, start, kind)
  const confirm = ctx.confirm
  if (state?.running) {
    return confirm
      ? [
          {
            id,
            title: `Stop ${name} — ${r.name}…`,
            group: 'Repos',
            keywords: [...keywords, 'kill'],
            inMain: true,
            run: () =>
              confirm({
                title: `Stop the ${name} for ${r.name}?`,
                body: `DevDock stops the ${name} and the processes it started.`,
                confirmLabel: `Stop ${name}`,
                run: () => call(false),
              }),
          },
        ]
      : []
  }
  return [
    {
      id,
      title: `Start ${name} — ${r.name}`,
      group: 'Repos',
      keywords: [...keywords, 'run', ...(kind === 'dev' ? ['vite'] : [])],
      run: () => call(true),
    },
  ]
}

/**
 * SPEC 6.4 from the palette: trigger a build (its dialog), watch a branch's deploy; SPEC 6.3a
 * CI actions on GitHub / GitLab runs (their confirmation dialog).
 */
function branchBuildCommands(ctx: CommandContext): Command[] {
  const trigger = ctx.trigger
  const triggers = trigger
    ? ctx.branchBuilds
        .filter((b) => b.triggers)
        .map<Command>((b) => ({
          id: `build:trigger:${b.job}`,
          title: `Trigger a build of ${b.label}…`,
          group: 'Builds',
          keywords: ['jenkins', 'build', 'run', 'parameters', 'queue'],
          inMain: true,
          run: () => trigger(b.job),
        }))
    : []
  // The deploy watch is by branch: one command per branch, whichever job it came from.
  const branches = [...new Set(ctx.branchBuilds.filter((b) => b.deploys).map((b) => b.branch))]
  const deploys = branches.map<Command>((branch) => ({
    id: `build:deploy:${branch}`,
    title: `Watch the deploy of ${branch}`,
    group: 'Builds',
    keywords: ['jenkins', 'deploy', 'watch', 'release'],
    inMain: true,
    run: () => ctx.watchDeploy(branch),
  }))
  const ciAction = ctx.ciAction
  const ci = ciAction
    ? ctx.ciActions.map<Command>((c) => ({
        id: `ci:${c.action}:${c.key}`,
        title: `${c.title}…`,
        group: 'Builds',
        keywords: ['github', 'gitlab', 'actions', 'pipeline', 'ci', c.action, 'rerun'],
        inMain: true,
        run: () => ciAction(c.key, c.action),
      }))
    : []
  return [...triggers, ...deploys, ...ci]
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
      keywords: ['watch', 'bitbucket', 'github', 'gitlab', 'link', 'pr', 'paste'],
      disabled: ctx.configured.prs
        ? undefined
        : 'Turn on Bitbucket, GitHub or GitLab in Settings first',
      run: () => ctx.goto('prs'),
    },
    {
      id: 'build:pipeline',
      title: "Watch a pull request's pipeline…",
      group: 'Builds',
      keywords: ['jenkins', 'build', 'watch', 'pipeline', 'pr', 'paste'],
      disabled: ctx.configured.jenkins ? undefined : 'Set up Jenkins in Settings first',
      run: () => ctx.goto('builds'),
    },
    ...ctx.watches.map<Command>((w) => ({
      id: `pr:unwatch:${w.key}`,
      title: `Stop watching ${w.label}`,
      group: 'Pull requests',
      keywords: ['unwatch', 'watch', 'bitbucket', 'github', 'gitlab'],
      run: () => ctx.unwatch(w.key),
    })),
    ...aiCommands(ctx),
    ...(ctx.prAction
      ? ctx.prActions.map<Command>((p) => ({
          id: `pr:${p.action}:${p.key}`,
          title: `${PR_ACTION_VERB[p.action]} ${p.label}…`,
          group: 'Pull requests',
          keywords: ['bitbucket', 'github', 'gitlab', 'review', p.action.replace('_', ' ')],
          inMain: true,
          run: () => ctx.prAction?.(p.key, p.action),
        }))
      : []),
    ...branchBuildCommands(ctx),
    ...ctx.buildWatches.map<Command>((w) => ({
      id: `build:unwatch:${w.key}`,
      title: `Stop watching ${w.label}`,
      group: 'Builds',
      keywords: ['jenkins', 'build', 'run', 'pipeline', 'unwatch'],
      run: () => ctx.unwatchBuild(w.key),
    })),
    ...(ctx.finishedBuilds
      ? [
          {
            id: 'build:clear-finished',
            title: 'Clear finished build watches',
            group: 'Builds' as const,
            keywords: ['jenkins', 'watch', 'done'],
            run: ctx.clearFinishedBuilds,
          },
        ]
      : []),
    ...UTILITY_COMMANDS.map<Command>((u) => ({
      id: `util:${u.tab}`,
      title: u.title,
      group: 'Utilities',
      keywords: u.keywords,
      run: () => ctx.utility({ tab: u.tab }),
    })),
    newTerminalCommand(ctx),
    ...ctx.quickLinks.map<Command>((l) => ({
      id: `link:${l.id}`,
      title: `Open ${l.name}`,
      group: 'Quick links',
      // Matched lower-case (see score).
      keywords: [l.group, linkHost(l.url)].filter(Boolean).map((k) => k.toLowerCase()),
      run: () => ctx.openLink(l.url),
    })),
    ...ctx.issues.map<Command>((i) => ({
      id: `ticket:start:${i.key}`,
      title: `Start work on ${i.key}: ${i.summary}`,
      group: 'Tickets',
      keywords: ['jira', 'branch', 'ticket', 'issue', i.key.toLowerCase()],
      disabled: noRepoReason(ctx),
      run: () => ctx.startWork(i.key),
    })),
    ...(ctx.confirm
      ? ctx.ticketMoves.map<Command>((m) => ({
          id: `ticket:move:${m.prKey}`,
          title: `Move ${m.key} to ${m.status}…`,
          group: 'Tickets',
          keywords: ['jira', 'transition', 'review', 'status', m.key.toLowerCase()],
          inMain: true,
          run: () => ctx.confirm?.({ ...m.confirm, run: () => ctx.moveTicket(m.prKey) }),
        }))
      : []),
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
      id: 'app:diagnostics',
      title: 'Show diagnostics',
      group: 'App',
      keywords: ['versions', 'proxy', 'test connections', 'export', 'support', 'debug'],
      run: () => ctx.goto('settings'),
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
 * `watch <link>`, `pipeline <link>`, or a pull request link pasted on its own (both offered).
 * Checked with the same parser as main.
 */
export function queryCommands(
  query: string,
  ctx: Pick<
    CommandContext,
    | 'watch'
    | 'goto'
    | 'utility'
    | 'startWork'
    | 'quickLinks'
    | 'openLink'
    | 'repos'
    | 'configured'
    | 'openTerminal'
  >,
): Command[] {
  const text = query.trim()
  // `terminal <repo>`: DevDock's terminal in each repo whose name matches (best first);
  // `terminal` alone: a new one in the home folder.
  const term = /^terminal(?:\s+(.+))?$/i.exec(text)
  if (term) {
    const name = term[1]?.trim().toLowerCase()
    if (!name) {
      return [newTerminalCommand(ctx)]
    }
    const matches = ctx.repos
      .filter((r) => r.name.toLowerCase().includes(name))
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(name)) -
          Number(a.name.toLowerCase().startsWith(name)),
      )
    return matches.length
      ? matches.map<Command>((r) => ({
          // The registry's id, so it shows up in recents.
          id: `repo:${r.id}:devdock-terminal`,
          title: `${DEVDOCK_TERMINAL_LABEL} — ${r.name}`,
          group: 'Terminal',
          run: () => ctx.openTerminal(r.id),
        }))
      : [
          {
            id: 'terminal:no-repo',
            title: `No repo called "${term[1]!.trim()}": open a terminal in the home folder`,
            group: 'Terminal',
            run: () => ctx.openTerminal(null),
          },
        ]
  }
  // `branch NM-1234` (SPEC 6.1): Start work on that ticket — the preview, never straight away.
  const branch = /^branch\s+(\S+)$/i.exec(text)
  if (branch) {
    const key = branch[1]!.toUpperCase()
    return ISSUE_KEY.test(key)
      ? [
          {
            id: 'ticket:branch',
            title: `Start work on ${key}…`,
            group: 'Tickets',
            disabled: ctx.configured.jira ? noRepoReason(ctx) : 'Set up Jira in Settings first',
            run: () => ctx.startWork(key),
          },
        ]
      : [
          {
            id: 'ticket:branch-invalid',
            title: `${branch[1]} isn't a Jira key (like NM-1234): open Tickets`,
            group: 'Tickets',
            run: () => ctx.goto('tickets'),
          },
        ]
  }
  // `open <link name>`: the quick links whose name matches, best first.
  const open = /^open\s+(.+)$/i.exec(text)
  if (open) {
    const name = open[1]!.trim().toLowerCase()
    return ctx.quickLinks
      .filter((l) => l.name.toLowerCase().includes(name))
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(name)) -
          Number(a.name.toLowerCase().startsWith(name)),
      )
      .map<Command>((l) => ({
        // The registry's id, so a link opened this way shows up in recents.
        id: `link:${l.id}`,
        title: `Open ${l.name}`,
        group: 'Quick links',
        run: () => ctx.openLink(l.url),
      }))
  }
  // `kill 5173` (SPEC 6.1): opens the stop dialog for that port's process — never stops it here.
  const kill = /^kill\s+(\d{1,5})$/i.exec(text)
  if (kill) {
    const port = Number(kill[1])
    return port >= 1 && port <= 65535
      ? [
          {
            id: 'util:kill-port',
            title: `Stop the process on port ${port}…`,
            group: 'Utilities',
            run: () => ctx.utility({ tab: 'ports', stopPort: port }),
          },
        ]
      : []
  }
  const typed = /^(watch|pipeline)\s+(\S+)$/i.exec(text)
  const verb = typed?.[1]?.toLowerCase()
  const argument = typed?.[2]
  const link = argument ?? text
  const runLink = link && verb !== 'pipeline' ? parseRunLink(link) : null
  if (runLink) {
    const name = ciRunLabel({
      ref: runLink.ref,
      name: runLink.ref.provider === 'github' ? 'run' : 'pipeline',
      number: runLink.ref.id,
    })
    return [
      {
        id: 'build:watch-run-link',
        title: `Watch ${name}`,
        group: 'Builds',
        run: () => ctx.watch(link),
      },
    ]
  }
  const parsed = link ? parseAnyPrLink(link) : null
  if (!parsed) {
    // `watch <something>` that isn't a link: say so (a bare non-link is just a search).
    return argument
      ? [
          verb === 'pipeline'
            ? {
                id: 'build:pipeline-invalid',
                title: 'Not a pull request link: open Builds to paste one',
                group: 'Builds',
                run: () => ctx.goto('builds'),
              }
            : {
                id: 'pr:watch-invalid',
                title: `Not a pull request link: open Pull requests to paste one`,
                group: 'Pull requests',
                run: () => ctx.goto('prs'),
              },
        ]
      : []
  }
  const name = refLabel(parsed.ref)
  const pr: Command = {
    id: 'pr:watch-link',
    title: `Watch pull request ${name}`,
    group: 'Pull requests',
    run: () => ctx.watch(link),
  }
  const pipeline: Command = {
    id: 'build:pipeline-link',
    title: `Watch the pipeline of ${name}`,
    group: 'Builds',
    run: () => ctx.watch(link, true),
  }
  if (verb === 'pipeline') return [pipeline]
  if (verb === 'watch') return [pr]
  return [pr, pipeline]
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

/** Ranked matches (runnable first); every whitespace-separated term must match. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...commands]
  return (
    commands
      .map((c, i) => ({ c, i, s: terms.reduce((sum, t) => sum + (score(c, t) || -Infinity), 0) }))
      .filter((r) => r.s > 0)
      // A command that can run beats one that can't, then the better match, then registry order.
      .sort((a, b) => Number(!!a.c.disabled) - Number(!!b.c.disabled) || b.s - a.s || a.i - b.i)
      .map((r) => r.c)
  )
}

/**
 * Recent commands first (P6.01), most recent at the top; the rest keep their order. Only ids
 * still in the registry count (a removed repo's commands drop out).
 */
export function withRecentFirst(
  commands: readonly Command[],
  recent: readonly string[],
): Command[] {
  const byId = new Map(commands.map((c) => [c.id, c]))
  const first = recent.map((id) => byId.get(id)).filter((c): c is Command => c !== undefined)
  const seen = new Set(first.map((c) => c.id))
  return [...first, ...commands.filter((c) => !seen.has(c.id))]
}

/** How many recent commands are remembered. */
export const RECENT_LIMIT = 8

/** `recent` with `id` moved to the front, capped. */
export function rememberRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT)
}
