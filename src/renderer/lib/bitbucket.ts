import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PrActionRequest, PrList } from '@shared/bitbucket'
import { bridge, keys, queryClient, unwrap, useSettings } from './devdock'

/** Bitbucket data (SPEC 6.3). Lists come from the main process; tokens never get here. */

export const prKeys = {
  all: ['bitbucket'] as const,
  list: (list: PrList) => ['bitbucket', 'list', list] as const,
}

export const LIST_LABELS: Record<PrList, string> = {
  mine: 'My PRs',
  reviewing: 'Reviewing',
  merged: 'Recently merged',
}

/**
 * Lists refresh at the foreground interval while the window has focus (React Query pauses
 * the timer otherwise) and on focus. Watched PRs are polled by the main process instead.
 */
export function usePrList(list: PrList, enabled = true) {
  const intervalMs = (useSettings().data?.polling.foregroundSec ?? 60) * 1000
  return useQuery({
    queryKey: prKeys.list(list),
    queryFn: () => unwrap(bridge.bitbucket.list({ list })),
    enabled,
    staleTime: intervalMs,
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
  })
}

/** The watch list; main's `watch:changed` keeps it current (see useMainEvents). */
export function useWatches() {
  return useQuery({ queryKey: keys.watches, queryFn: () => unwrap(bridge.watch.list()) })
}

/** Keys of the watched PRs, for marking rows in the other lists. */
export function useWatchedKeys(): ReadonlySet<string> {
  return new Set((useWatches().data ?? []).map((w) => w.key))
}

/** Keys of my open PRs (Watched offers merge on these, reviews on the rest). */
export function useMyPrKeys(): ReadonlySet<string> {
  return new Set((usePrList('mine').data ?? []).map((pr) => pr.key))
}

export function useAddWatch() {
  return useMutation({
    mutationFn: (link: string) => unwrap(bridge.watch.add({ link })),
    // The event carries the list too; this covers a window that missed it.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.watches }),
  })
}

export function useRemoveWatch() {
  return useMutation({
    mutationFn: (key: string) => unwrap(bridge.watch.remove({ key })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.watches }),
  })
}

/** Approve / needs work / merge. The lists and watches catch up afterwards. */
export function usePrAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (request: PrActionRequest) => unwrap(bridge.bitbucket.action(request)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prKeys.all })
      void qc.invalidateQueries({ queryKey: keys.watches })
    },
  })
}
