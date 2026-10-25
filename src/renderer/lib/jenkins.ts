import { useMutation, useQuery } from '@tanstack/react-query'
import type { BuildRef, BuildWatch, BuildWatchRequest, TriggerRequest } from '@shared/jenkins'
import { bridge, keys, queryClient, unwrap, useSettings } from './devdock'

/** Jenkins data (SPEC 6.4). Everything comes from the main process; the token never gets here. */

export const jenkinsKeys = {
  all: ['jenkins'] as const,
  branches: ['jenkins', 'branches'] as const,
  build: (ref: BuildRef) => ['jenkins', 'build', ref.job, ref.number] as const,
  parameters: (job: string) => ['jenkins', 'parameters', job] as const,
}

/** My branches: at the foreground interval while focused, and on focus (like the PR lists). */
export function useBranches() {
  const intervalMs = (useSettings().data?.polling.foregroundSec ?? 60) * 1000
  return useQuery({
    queryKey: jenkinsKeys.branches,
    queryFn: () => unwrap(bridge.jenkins.branches()),
    staleTime: intervalMs,
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
  })
}

/** A build with stages; every 5 s while it runs, so the stages move with the console. */
export function useBuild(ref: BuildRef) {
  return useQuery({
    queryKey: jenkinsKeys.build(ref),
    queryFn: () => unwrap(bridge.jenkins.build(ref)),
    refetchInterval: (q) => (q.state.data?.build.state === 'running' ? 5_000 : false),
  })
}

export function useParameters(job: string) {
  return useQuery({
    queryKey: jenkinsKeys.parameters(job),
    queryFn: () => unwrap(bridge.jenkins.parameters({ job })),
  })
}

/** The build watch list; main's `buildwatch:changed` keeps it current (see useMainEvents). */
export function useBuildWatches() {
  return useQuery({
    queryKey: keys.buildWatches,
    queryFn: () => unwrap(bridge.buildwatch.list()),
  })
}

const refreshWatches = () => void queryClient.invalidateQueries({ queryKey: keys.buildWatches })

export function useAddBuildWatch() {
  return useMutation({
    mutationFn: (request: BuildWatchRequest) => unwrap(bridge.buildwatch.add(request)),
    onSuccess: refreshWatches,
  })
}

/** Watch PR pipeline (SPEC 6.4): a PR link → the Jenkins build that runs it. */
export function useWatchPipeline() {
  return useMutation({
    mutationFn: (link: string) => unwrap(bridge.buildwatch.addPr({ link })),
    onSuccess: refreshWatches,
  })
}

export function useRemoveBuildWatch() {
  return useMutation({
    mutationFn: (key: string) => unwrap(bridge.buildwatch.remove({ key })),
    onSuccess: refreshWatches,
  })
}

export function useClearFinished() {
  return useMutation({
    mutationFn: () => unwrap(bridge.buildwatch.clearFinished()),
    onSuccess: refreshWatches,
  })
}

/**
 * Queues a build. Only that: watching it is a separate call (the dialog's), so a failed watch
 * can never make a retry queue a second build.
 */
export function useTrigger() {
  return useMutation({
    mutationFn: (request: TriggerRequest) => unwrap(bridge.jenkins.trigger(request)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: jenkinsKeys.branches }),
  })
}

/** Live watches first, then finished ones; each group newest first (main's order). */
export const byLiveFirst = (items: BuildWatch[]) =>
  [...items].sort((a, b) => Number(a.done) - Number(b.done))
