import { useMutation, useQuery } from '@tanstack/react-query'
import type { TicketMove } from '@shared/ticketmoves'
import { bridge, keys, queryClient, unwrap } from './devdock'

/** T5 offers to move a ticket when a PR of mine opened; main's `ticketmove:changed` updates it. */
export function useTicketMoves() {
  return useQuery({ queryKey: keys.ticketMoves, queryFn: () => unwrap(bridge.ticketmove.list()) })
}

export function useAcceptTicketMove() {
  return useMutation({
    // Only after the confirmation dialog (SPEC 7: Jira transitions).
    mutationFn: (prKey: string) => unwrap(bridge.ticketmove.accept({ prKey, confirmed: true })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jira'] }),
  })
}

export function useDismissTicketMove() {
  return useMutation({
    mutationFn: (prKey: string) => unwrap(bridge.ticketmove.dismiss({ prKey })),
  })
}

/** The confirmation every way of accepting an offer shows (Today, the palette). */
export const ticketMoveConfirm = (o: TicketMove) => ({
  title: `Move ${o.key} to ${o.status}?`,
  body: `${o.prLabel} ("${o.prTitle}") opened for ${o.key}. DevDock asks Jira to move ${o.key} to ${o.status}, if its workflow allows that from the current status. This changes the issue in Jira.`,
  confirmLabel: `Move to ${o.status}`,
})
