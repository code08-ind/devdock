import { z } from 'zod'
import { IssueKeySchema } from './jira'

/**
 * T5 "move the ticket when a PR opens": an offer DevDock made when a PR of mine appeared for
 * a Jira key. Nothing is moved until the user confirms it (SPEC 7: Jira transitions).
 */
export const TicketMoveSchema = z.object({
  /** The PR's `prKey`. */
  prKey: z.string(),
  /** "web-app #412". */
  prLabel: z.string(),
  prTitle: z.string(),
  key: IssueKeySchema,
  /** Settings → Workflow status at the time of the offer, e.g. "In Review". */
  status: z.string(),
  at: z.number(),
})
export type TicketMove = z.infer<typeof TicketMoveSchema>

export const TicketMoveResultSchema = z.object({
  result: z.enum(['done', 'unavailable']),
  message: z.string(),
})
export type TicketMoveResult = z.infer<typeof TicketMoveResultSchema>

/** Offers kept at most (oldest dropped). */
export const MAX_TICKET_MOVES = 20
