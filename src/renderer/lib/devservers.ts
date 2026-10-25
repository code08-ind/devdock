import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DevServerOutputEvent, DevServerState, ServerKind } from '@shared/devserver'
import { bridge, queryClient, unwrap } from './devdock'

const LIST_KEY = ['devserver', 'list'] as const

/** Every dev and baseline server DevDock knows about, kept live by `devserver:changed`. */
export function useDevServers(): DevServerState[] {
  const { data } = useQuery({ queryKey: LIST_KEY, queryFn: () => unwrap(bridge.devserver.list()) })
  return data ?? []
}

export function useDevServer(repoId: string, kind: ServerKind): DevServerState | undefined {
  return useDevServers().find((s) => s.repoId === repoId && s.kind === kind)
}

// ---- Logs: seeded from the main process, then streamed ----------------------------------------

const logs = new Map<string, string>()
/** startedAt of the run each log belongs to. */
const runs = new Map<string, number>()
const listeners = new Set<() => void>()
const LIMIT = 200_000
const key = (repoId: string, kind: ServerKind) => `${repoId}:${kind}`
const notify = () => listeners.forEach((l) => l())

bridge.on('devserver:changed', (states: DevServerState[]) => {
  // A restart is a new run: drop the previous run's log (its output arrives after this event).
  for (const s of states) {
    const k = key(s.repoId, s.kind)
    if (runs.has(k) && runs.get(k) !== s.startedAt && logs.delete(k)) notify()
    runs.set(k, s.startedAt)
  }
  queryClient.setQueryData(LIST_KEY, states)
})

bridge.on('devserver:output', ({ repoId, kind, chunk }: DevServerOutputEvent) => {
  const k = key(repoId, kind)
  logs.set(k, ((logs.get(k) ?? '') + chunk).slice(-LIMIT))
  notify()
})

/** The server's log; fetches what was printed before this window started listening. */
export function useDevServerLog(repoId: string, kind: ServerKind, enabled: boolean): string {
  useEffect(() => {
    if (!enabled) return
    void unwrap(bridge.devserver.log({ id: repoId, kind })).then((full) => {
      // The main process keeps the authoritative copy (it saw output before we subscribed).
      logs.set(key(repoId, kind), full)
      notify()
    })
  }, [repoId, kind, enabled])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => logs.get(key(repoId, kind)) ?? '',
  )
}
