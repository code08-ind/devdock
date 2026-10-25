import type { ReactNode } from 'react'
import {
  CalendarCheck,
  House,
  FolderGit2,
  GitPullRequest,
  Hammer,
  Settings as SettingsIcon,
  SquareTerminal,
  Ticket,
  Wrench,
} from 'lucide-react'
import type { View } from '@shared/channels'

export const VIEW_ICONS: Record<View, ReactNode> = {
  home: <House size={18} aria-hidden="true" />,
  today: <CalendarCheck size={18} aria-hidden="true" />,
  repos: <FolderGit2 size={18} aria-hidden="true" />,
  prs: <GitPullRequest size={18} aria-hidden="true" />,
  builds: <Hammer size={18} aria-hidden="true" />,
  tickets: <Ticket size={18} aria-hidden="true" />,
  utilities: <Wrench size={18} aria-hidden="true" />,
  terminal: <SquareTerminal size={18} aria-hidden="true" />,
  settings: <SettingsIcon size={18} aria-hidden="true" />,
}

/** Empty-state line per view until each module lands (Phases 1–5). */
export const EMPTY_COPY: Record<Exclude<View, 'settings'>, string> = {
  home: 'Every DevDock feature, one click away.',
  today: 'Your pull requests, watched builds, tickets and repo status will show up here.',
  repos: 'No repos added yet. Add a local git repo to see its branch and sync status.',
  prs: 'No pull requests yet. Connect Bitbucket to see the ones you opened or review.',
  builds: 'No builds watched yet. Connect Jenkins to follow jobs and pipelines.',
  tickets: 'No tickets yet. Connect Jira to see the issues assigned to you.',
  utilities: 'Port scanner, env profiles, quick links and the standup helper will live here.',
  terminal: 'No terminals open.',
}
