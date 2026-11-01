import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpenCheck,
  CalendarCheck,
  Command as CommandIcon,
  Eraser,
  FileKey,
  FolderGit2,
  GitPullRequest,
  Hammer,
  Link2,
  MessageSquareText,
  Network,
  Settings as SettingsIcon,
  SquareTerminal,
  Ticket,
} from 'lucide-react'
import { VIEWS, type View } from '@shared/channels'
import type { UtilityRequest } from '@shared/utilities'
import logo from '../../assets/logo.png'
import { bridge, unwrap } from '../../lib/devdock'
import { modLabel } from '../../lib/keyboard'
import { Kbd } from '../../ui/Text'

interface Tool {
  id: string
  label: string
  /** One line: what it is for. */
  hint: string
  icon: ReactNode
  /** Views: ⌘n; the palette: ⌘K. */
  shortcut?: string
  open: () => void
}

const toolIcon = (Icon: typeof Ticket) => <Icon size={30} strokeWidth={1.75} aria-hidden="true" />

/**
 * Home: what DevDock opens on (user request, P6-A) — the logo and what DevDock is, then every
 * tool as a card in groups, each with what it is for and its shortcut.
 */
export function HomePage({
  onView,
  onUtility,
  onPalette,
}: {
  onView: (v: View) => void
  onUtility: (request: UtilityRequest) => void
  onPalette: () => void
}) {
  const version = useQuery({
    queryKey: ['app-info'],
    queryFn: () => unwrap(bridge.app.info()),
  }).data?.version

  const viewTool = (v: View, label: string, hint: string, Icon: typeof Ticket): Tool => ({
    id: v,
    label,
    hint,
    icon: toolIcon(Icon),
    shortcut: modLabel(String(VIEWS.indexOf(v) + 1)),
    open: () => onView(v),
  })
  const utilityTool = (
    tab: UtilityRequest['tab'],
    label: string,
    hint: string,
    Icon: typeof Ticket,
  ): Tool => ({
    id: `util-${tab}`,
    label,
    hint,
    icon: toolIcon(Icon),
    open: () => onUtility({ tab }),
  })

  const groups: { id: string; title: string; tools: Tool[] }[] = [
    {
      id: 'day',
      title: 'Your day',
      tools: [
        viewTool(
          'today',
          'Today',
          'Your pull requests, watched builds and tickets in progress at a glance',
          CalendarCheck,
        ),
        viewTool(
          'repos',
          'Repos',
          'Sync the base branch, update your branch and push, with every git command shown first',
          FolderGit2,
        ),
        viewTool(
          'prs',
          'Pull requests',
          'Yours, those waiting for your review, recently merged, and watched ones',
          GitPullRequest,
        ),
        viewTool(
          'builds',
          'Builds',
          'Jenkins builds, GitHub Actions runs and GitLab pipelines: stages, jobs and the live log',
          Hammer,
        ),
        viewTool(
          'tickets',
          'Tickets',
          'Your Jira issues and Start work: branch, brief and agent message in one go',
          Ticket,
        ),
        viewTool(
          'terminal',
          'Terminal',
          'Your own shell in tabs, in a repo or your home folder, in DevDock colours',
          SquareTerminal,
        ),
      ],
    },
    {
      id: 'utilities',
      title: 'Utilities',
      tools: [
        utilityTool('ports', 'Ports', 'See what is listening on which port and stop it', Network),
        utilityTool(
          'caches',
          'Clean caches',
          'Free space taken by dist, coverage and Vite caches',
          Eraser,
        ),
        utilityTool(
          'env',
          'Env profiles',
          'Keep named copies of .env.local and switch between them safely',
          FileKey,
        ),
        utilityTool(
          'links',
          'Quick links',
          'Your consoles, dashboards and boards, one click or ⌘K away',
          Link2,
        ),
        utilityTool(
          'standup',
          'Standup',
          'A draft of yesterday, today and blockers from your own activity',
          MessageSquareText,
        ),
        utilityTool(
          'lessons',
          'Agent lessons',
          'Turn review comments into lessons your agent reads before it starts',
          BookOpenCheck,
        ),
      ],
    },
    {
      id: 'devdock',
      title: 'DevDock',
      tools: [
        {
          id: 'palette',
          label: 'Command palette',
          hint: 'Search every action, or paste a pull request link',
          icon: toolIcon(CommandIcon),
          shortcut: modLabel('K'),
          open: onPalette,
        },
        viewTool(
          'settings',
          'Settings',
          'Connect services, pick a theme, set notifications and shortcuts',
          SettingsIcon,
        ),
      ],
    },
  ]

  return (
    <div className="home">
      <header className="home-hero">
        <img className="home-logo" src={logo} alt="" width={88} height={88} />
        {/* The view's heading (focused on navigation, like other views' titles). */}
        <h1 className="home-title" tabIndex={-1}>
          Welcome to DevDock
          {version ? <span className="home-version">v{version}</span> : null}
        </h1>
        <p className="home-lede">
          Your daily development chores in one place: repos, pull requests, builds, tickets and the
          small tools in between. Pick a tool below, or press <Kbd>{modLabel('K')}</Kbd> to search
          every action.
        </p>
      </header>
      {groups.map((g) => (
        <section key={g.id} className="home-group" aria-labelledby={`home-${g.id}`}>
          <h2 id={`home-${g.id}`} className="home-group-title">
            {g.title}
          </h2>
          <ul className="home-tiles">
            {g.tools.map((t) => (
              <li key={t.id}>
                <button type="button" className="home-tile" onClick={t.open}>
                  <span className="home-tile-icon">{t.icon}</span>
                  <span className="home-tile-text">
                    <span className="home-tile-label">{t.label}</span>
                    <span className="home-tile-hint">{t.hint}</span>
                  </span>
                  {t.shortcut ? <Kbd>{t.shortcut}</Kbd> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
