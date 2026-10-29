import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PrActionRequest, PrList, PullRequest } from '@shared/bitbucket'
import type { Provider } from '@shared/providers'
import { enabledProviders } from '@shared/settings'
import { DevDockError, bridge, keys, queryClient, unwrap, useSettings } from './devdock'

/**
 * Pull requests from every provider turned on (SPEC 6.3, P7.04: Bitbucket, GitHub, GitLab).
 * Lists come from the main process; tokens never get here.
 */

export const prKeys = {
  all: ['prs'] as const,
  list: (list: PrList) => ['prs', 'list', list] as const,
  listOf: (list: PrList, provider: Provider) => ['prs', 'list', list, provider] as const,
}

export const LIST_LABELS: Record<PrList, string> = {
  mine: 'My PRs',
  reviewing: 'Reviewing',
  merged: 'Recently merged',
}

export interface PrListResult {
  /** Every provider's PRs that loaded, newest activity first. */
  data: PullRequest[] | undefined
  /** Set only when every provider failed (the first failure). */
  error: unknown
  /** Providers that failed while others loaded: shown under the list. */
  failures: { provider: Provider; error: unknown }[]
  isPending: boolean
  isFetching: boolean
}

const NONE_ON = new DevDockError(
  'NOT_CONFIGURED',
  'Pull requests are turned off for Bitbucket, GitHub and GitLab. Turn one on in Settings.',
)

/**
 * One list across the providers that are on, each its own query (one slow or failing provider
 * doesn't hold up the others). Refreshes at the foreground interval while the window has
 * focus and on focus; watched PRs are polled by the main process instead.
 */
export function usePrList(list: PrList, enabled = true): PrListResult {
  const settings = useSettings().data
  const intervalMs = (settings?.polling.foregroundSec ?? 60) * 1000
  const providers = settings ? enabledProviders(settings) : []
  return useQueries({
    queries: providers.map((provider) => ({
      queryKey: prKeys.listOf(list, provider),
      queryFn: () => unwrap(bridge.prs.list({ provider, list })),
      enabled,
      staleTime: intervalMs,
      refetchInterval: intervalMs,
      refetchOnWindowFocus: true,
    })),
    combine: (results) => {
      const failed = results.flatMap((r, i) =>
        r.error ? [{ provider: providers[i]!, error: r.error as unknown }] : [],
      )
      const loaded = results.filter((r) => r.data)
      const allFailed = results.length > 0 && failed.length === results.length
      if (settings && providers.length === 0) {
        return {
          data: undefined,
          error: NONE_ON,
          failures: [],
          isPending: false,
          isFetching: false,
        }
      }
      return {
        data:
          !settings || (results.some((r) => r.isPending && !r.error) && loaded.length === 0)
            ? undefined
            : loaded
                .flatMap((r) => r.data!)
                .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        error: allFailed ? failed[0]!.error : null,
        failures: allFailed ? [] : failed,
        isPending: !settings || results.some((r) => r.isPending && !r.error),
        isFetching: results.some((r) => r.isFetching),
      }
    },
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
    mutationFn: (request: PrActionRequest) => unwrap(bridge.prs.action(request)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prKeys.all })
      void qc.invalidateQueries({ queryKey: keys.watches })
    },
  })
}
