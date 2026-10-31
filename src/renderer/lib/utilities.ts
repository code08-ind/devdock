import { useMutation, useQuery } from '@tanstack/react-query'
import type { StopRequest } from '@shared/utilities'
import { bridge, queryClient, unwrap } from './devdock'

/** Utilities data (SPEC 6.6): ports, caches, env profiles, standup — all from the main process. */

export const utilityKeys = {
  ports: ['ports'] as const,
  caches: (id: string) => ['caches', id] as const,
  env: (id: string) => ['envprofiles', id] as const,
  standup: ['standup'] as const,
  lessons: (id: string) => ['lessons', id] as const,
  reviewComments: ['lessons', 'comments'] as const,
}

/** Listening ports: read on open and on Refresh (a scan runs lsof/netstat; not on a timer). */
export function usePorts() {
  return useQuery({
    queryKey: utilityKeys.ports,
    queryFn: () => unwrap(bridge.ports.list()),
    staleTime: 0,
  })
}

export function useStop() {
  return useMutation({
    mutationFn: (request: StopRequest) => unwrap(bridge.ports.stop(request)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: utilityKeys.ports }),
  })
}

export function useCachePlan(id: string | null) {
  return useQuery({
    queryKey: utilityKeys.caches(id ?? ''),
    queryFn: () => unwrap(bridge.caches.plan({ id: id! })),
    enabled: id !== null,
    staleTime: 0,
  })
}

export function useClean(id: string) {
  return useMutation({
    mutationFn: (opts: { includeNodeModules: boolean }) =>
      unwrap(
        bridge.caches.clean({
          id,
          includeNodeModules: opts.includeNodeModules,
          confirmed: true,
          ...(opts.includeNodeModules ? { nodeModulesConfirmed: true as const } : {}),
        }),
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: utilityKeys.caches(id) }),
  })
}

export function useEnvState(id: string | null) {
  return useQuery({
    queryKey: utilityKeys.env(id ?? ''),
    queryFn: () => unwrap(bridge.envprofiles.state({ id: id! })),
    enabled: id !== null,
    staleTime: 0,
  })
}

/** Any env-profile change: refresh that repo's state afterwards (success or not). */
export function useEnvAction<A>(id: string, fn: (args: A) => Promise<unknown>) {
  return useMutation({
    mutationFn: fn,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: utilityKeys.env(id) }),
  })
}

/** The collected standup draft (kept until "Collect again"); shared with the palette's AI command. */
export const standupQuery = {
  queryKey: utilityKeys.standup,
  queryFn: () => unwrap(bridge.standup.draft()),
  staleTime: Infinity,
} as const

export function useStandupDraft() {
  return useQuery(standupQuery)
}

/** The repo's agent lessons file (P6-F). */
export function useLessons(repoId: string) {
  return useQuery({
    queryKey: utilityKeys.lessons(repoId),
    queryFn: () => unwrap(bridge.lessons.state({ repoId })),
    staleTime: 0,
  })
}

/** Review comments on my recent PRs: read when asked for (several Bitbucket requests). */
export function useReviewComments(enabled: boolean) {
  return useQuery({
    queryKey: utilityKeys.reviewComments,
    queryFn: () => unwrap(bridge.lessons.comments()),
    enabled,
  })
}

export function useAddLessons(repoId: string) {
  return useMutation({
    mutationFn: (lessons: string[]) => unwrap(bridge.lessons.add({ repoId, lessons })),
    onSuccess: (state) => queryClient.setQueryData(utilityKeys.lessons(repoId), state),
  })
}
