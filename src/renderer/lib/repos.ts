import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActionName, ActionRequest, OpenTarget, RepoOutputEvent } from '@shared/repos'
import { bridge, keys, unwrap, useSettings } from './devdock'
import { isMac } from './keyboard'
import { useAction } from './useAction'

/** Status refresh (SPEC 6.2): on window focus, every 2 minutes, and on `repos:changed` (HEAD). */
export const STATUS_INTERVAL_MS = 120_000

export function useRepos() {
  return useSettings().data?.repos ?? []
}

export function useRepoStatus(id: string) {
  return useQuery({
    queryKey: keys.repoStatus(id),
    queryFn: () => unwrap(bridge.repos.status({ id })),
    refetchInterval: STATUS_INTERVAL_MS,
    refetchOnWindowFocus: true,
    // Status is cheap and changes outside DevDock: always refetch on focus.
    staleTime: 0,
  })
}

export const ACTION_LABELS: Record<ActionName, string> = {
  fetchAll: 'Fetch all',
  syncBase: 'Sync base',
  updateBranch: 'Update my branch',
  abort: 'Abort',
  syncFork: 'Sync fork',
  pushBase: 'Push base to origin',
  newBranch: 'New branch',
  pushBranch: 'Push branch',
}

export const OPEN_LABELS: Record<OpenTarget, string> = {
  editor: 'Open in VS Code',
  terminal: 'Open terminal',
  files: isMac ? 'Reveal in Finder' : 'Reveal in Explorer',
}

/** Opens a repo in the editor, a terminal or the file manager; failures become a toast. */
export function useOpenRepo() {
  const { run } = useAction()
  return (id: string, target: OpenTarget) => run(unwrap(bridge.repos.open({ id, target })))
}

/**
 * A new tab in DevDock's own terminal (P7-A) in this repo. Goes through main, which shows the
 * main window's Terminal view, so it works the same from the panel and the palette window.
 */
export function useOpenDevdockTerminal() {
  const { run } = useAction()
  return (repoId: string | null) => run(unwrap(bridge.terminal.request({ repoId })))
}

// ---- Streamed output, per run --------------------------------------------------------------

const output = new Map<string, string>()
const listeners = new Set<() => void>()
const OUTPUT_LIMIT = 200_000

bridge.on('repos:output', ({ runId, chunk }: RepoOutputEvent) => {
  const text = (output.get(runId) ?? '') + chunk
  output.set(runId, text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text)
  for (const l of listeners) l()
})

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Live output of the given runs, concatenated (an action and its follow-up share one log). */
export function useRunOutput(runIds: readonly string[]): string {
  return useSyncExternalStore(subscribe, () => runIds.map((id) => output.get(id) ?? '').join(''))
}

/** Frees the output of runs nobody will show again (their dialog closed). */
export function forgetRuns(runIds: readonly string[]): void {
  for (const id of runIds) output.delete(id)
}

/** Starts an action; output arrives on `repos:output` tagged with the returned run id. */
export function startRun(id: string, request: ActionRequest) {
  const runId = crypto.randomUUID()
  return { runId, result: unwrap(bridge.repos.run({ id, runId, request })) }
}

/** "3 minutes ago" for the last fetch. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
