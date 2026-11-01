import { useQuery } from '@tanstack/react-query'
import { bridge, unwrap } from './devdock'

/** T9: whether a newer DevDock release is published; main's `updates:changed` keeps it fresh. */
export const updateKeys = { status: ['updates', 'status'] as const }

export function useUpdateStatus() {
  return useQuery({ queryKey: updateKeys.status, queryFn: () => unwrap(bridge.updates.status()) })
}
