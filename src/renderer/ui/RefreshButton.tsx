import { useIsFetching, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { IconButton } from './Button'

/** Fetches a list again now; disabled while it is already fetching. */
export function RefreshButton({ queryKey, label }: { queryKey: QueryKey; label: string }) {
  const qc = useQueryClient()
  const fetching = useIsFetching({ queryKey }) > 0
  return (
    <IconButton
      label={label}
      icon={<RefreshCw size={16} aria-hidden="true" />}
      disabled={fetching}
      onClick={() => void qc.invalidateQueries({ queryKey })}
    />
  )
}
