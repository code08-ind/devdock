import { useMutation, useQuery } from '@tanstack/react-query'
import type { CiActionRequest, CiRunRef } from '@shared/ci'
import type { CiProvider } from '@shared/providers'
import { bridge, keys, queryClient, unwrap, useSettings } from './devdock'

/**
 * GitHub Actions runs and GitLab pipelines (P7.05 / P7.06). Everything comes from the main
 * process; tokens never reach the renderer.
 */

export const ciKeys = {
  all: ['ci'] as const,
  runs: (provider: CiProvider) => ['ci', 'runs', provider] as const,
  run: (ref: CiRunRef) => ['ci', 'run', ref.provider, ref.project, ref.id] as const,
  log: (ref: CiRunRef, jobId: number) =>
    ['ci', 'log', ref.provider, ref.project, ref.id, jobId] as const,
}

/** My recent runs: at the foreground interval while focused, and on focus (like the PR lists). */
export function useCiRuns(provider: CiProvider) {
  const intervalMs = (useSettings().data?.polling.foregroundSec ?? 60) * 1000
  return useQuery({
    queryKey: ciKeys.runs(provider),
    queryFn: () => unwrap(bridge.ci.runs({ provider })),
    staleTime: intervalMs,
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
  })
}

const going = (state: string | undefined) =>
  state === 'running' || state === 'queued' || state === 'manual'

/** One run with its jobs; every 5 s while it is going. */
export function useCiRun(ref: CiRunRef) {
  return useQuery({
    queryKey: ciKeys.run(ref),
    queryFn: () => unwrap(bridge.ci.run(ref)),
    refetchInterval: (q) => (going(q.state.data?.run.state) ? 5_000 : false),
  })
}

/** The end of a job's log; again every 5 s while that job runs. */
export function useCiLog(ref: CiRunRef, jobId: number | null, running: boolean) {
  return useQuery({
    queryKey: ciKeys.log(ref, jobId ?? 0),
    queryFn: () => unwrap(bridge.ci.log({ ref, jobId: jobId! })),
    enabled: jobId !== null,
    refetchInterval: running ? 5_000 : false,
  })
}

/** The run watch list; main's `ciwatch:changed` keeps it current (see useMainEvents). */
export function useCiWatches() {
  return useQuery({ queryKey: keys.ciWatches, queryFn: () => unwrap(bridge.ciwatch.list()) })
}

const refreshWatches = () => void queryClient.invalidateQueries({ queryKey: keys.ciWatches })

/** Watch a run from its row, or its link (Builds field, palette `watch <run link>`). */
export function useAddCiWatch() {
  return useMutation({
    mutationFn: (input: { ref: CiRunRef } | { link: string }) => unwrap(bridge.ciwatch.add(input)),
    onSuccess: refreshWatches,
  })
}

export function useRemoveCiWatch() {
  return useMutation({
    mutationFn: (key: string) => unwrap(bridge.ciwatch.remove({ key })),
    onSuccess: refreshWatches,
  })
}

export function useClearFinishedRuns() {
  return useMutation({
    mutationFn: () => unwrap(bridge.ciwatch.clearFinished()),
    onSuccess: refreshWatches,
  })
}

/** Re-run / retry / cancel (behind Settings → Actions → CI actions and a confirmation). */
export function useCiAction() {
  return useMutation({
    mutationFn: (request: CiActionRequest) => unwrap(bridge.ci.action(request)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ciKeys.all })
      refreshWatches()
    },
  })
}
