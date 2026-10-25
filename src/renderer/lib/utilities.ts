import { useMutation, useQuery } from '@tanstack/react-query'
import type { StopRequest } from '@shared/utilities'
import { bridge, queryClient, unwrap } from './devdock'

/** Utilities data (SPEC 6.6): ports, caches, env profiles, standup — all from the main process. */

export const utilityKeys = {
  ports: ['ports'] as const,
  caches: (id: string) => ['caches', id] as const,
  env: (id: string) => ['envprofiles', id] as const,
  standup: ['standup'] as const,
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

export function useStandupDraft() {
  return useQuery({
    queryKey: utilityKeys.standup,
    queryFn: () => unwrap(bridge.standup.draft()),
    staleTime: Infinity,
  })
}
