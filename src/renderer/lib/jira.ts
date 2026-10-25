import { useQuery } from '@tanstack/react-query'
import type { JiraListRequest } from '@shared/jira'
import type { Settings } from '@shared/settings'
import { bridge, unwrap } from './devdock'

/** Jira data (SPEC 6.5). Lists and issues come from the main process; tokens never get here. */

export const jiraKeys = {
  all: ['jira'] as const,
  list: (req: JiraListRequest) => ['jira', 'list', req] as const,
  issue: (key: string) => ['jira', 'issue', key] as const,
  /** The location is in the key only to re-plan when it changes (main reads it from Settings). */
  /** `lessons`: this run's lessons lines, which change the message. */
  startWorkPlan: (
    key: string,
    repoId: string,
    location: BriefLocation,
    lessons: { read: boolean; add: boolean },
  ) => ['startwork', 'plan', key, repoId, location, lessons] as const,
}

type BriefLocation = Settings['features']['briefLocation']

/** Labels for the brief-location choice (Settings → Jira and the Start work dialog). */
export const BRIEF_LOCATION_OPTIONS: readonly { value: BriefLocation; label: string }[] = [
  { value: 'repo', label: 'In the repo (docs/ai/specs)' },
  { value: 'appData', label: "DevDock's data folder" },
]

/** Lists change in Jira, not in DevDock: refetch on focus and when older than a minute. */
const FRESH_MS = 60_000

export function useJiraList(req: JiraListRequest | null) {
  return useQuery({
    queryKey: req ? jiraKeys.list(req) : ['jira', 'list', 'none'],
    queryFn: () => unwrap(bridge.jira.list(req!)),
    enabled: req !== null,
    staleTime: FRESH_MS,
    refetchOnWindowFocus: true,
  })
}

export function useJiraIssue(key: string | null) {
  return useQuery({
    queryKey: key ? jiraKeys.issue(key) : ['jira', 'issue', 'none'],
    queryFn: () => unwrap(bridge.jira.issue({ key: key! })),
    enabled: key !== null,
    staleTime: FRESH_MS,
    refetchOnWindowFocus: true,
  })
}

/** A list the Tickets view can show, with its label and request. */
export interface ListChoice {
  id: string
  label: string
  request: JiraListRequest
}

/** My open issues, Current sprint (when a board is set, or in demo mode), then saved queries. */
export function listChoices(settings: Settings): ListChoice[] {
  const choices: ListChoice[] = [{ id: 'mine', label: 'My open issues', request: { list: 'mine' } }]
  if (settings.general.demoMode || settings.jira.boardId !== null) {
    choices.push({ id: 'sprint', label: 'Current sprint', request: { list: 'sprint' } })
  }
  for (const q of settings.jira.savedQueries) {
    choices.push({ id: `saved:${q.name}`, label: q.name, request: { list: 'saved', name: q.name } })
  }
  return choices
}
