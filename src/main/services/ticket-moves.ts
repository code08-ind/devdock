import { z } from 'zod'
import { refLabel, type PullRequest } from '@shared/bitbucket'
import { issueKeyIn } from '@shared/jira'
import type { Settings } from '@shared/settings'
import {
  MAX_TICKET_MOVES,
  TicketMoveSchema,
  type TicketMove,
  type TicketMoveResult,
} from '@shared/ticketmoves'
import { loadItems, saveItems } from './json-file'
import type { NotifyInput } from './notifications'
import { ServiceError } from './service-error'

/** PR keys remembered as seen (oldest dropped): enough for anyone's open PRs. */
const MAX_SEEN = 500

const StateSchema = z.object({
  /** Seen PRs were recorded while the option was on: new ones are offers from now on. */
  seeded: z.boolean(),
  seen: z.array(z.string()),
  offers: z.array(TicketMoveSchema),
})
type State = z.infer<typeof StateSchema>

export interface TicketMoveDeps {
  file: string
  settings: () => Pick<Settings, 'workflow'>
  /** Jira is set up (or demo mode): offers need somewhere to move the ticket. */
  jiraReady: () => boolean
  /** My pull requests, every provider turned on. */
  myPrs: () => Promise<PullRequest[]>
  jira: { transitionToStatus: (key: string, status: string) => Promise<'done' | 'unavailable'> }
  notify: (n: NotifyInput) => void
  onChange: (offers: TicketMove[]) => void
  now?: () => number
}

/**
 * T5 "move the ticket when a PR opens" (Settings → Workflow, off by default). Polled with the
 * PR lists: a PR of mine that wasn't open before, with a Jira key in its branch (or title),
 * becomes an offer — a notification and a card on Today. Jira changes only when the user
 * confirms an offer (SPEC 7). The first poll after the option is turned on only records the PRs
 * already open, so turning it on doesn't offer to move every ticket at once.
 */
export class TicketMoves {
  private state: State

  constructor(private readonly deps: TicketMoveDeps) {
    this.state = loadItems(deps.file, StateSchema, 'ticket move offers')[0] ?? {
      seeded: false,
      seen: [],
      offers: [],
    }
  }

  list(): TicketMove[] {
    return this.state.offers
  }

  async poll(): Promise<void> {
    const { moveTicketOnPr, prOpenedStatus } = this.deps.settings().workflow
    if (!moveTicketOnPr || !this.deps.jiraReady()) {
      // Off: forget what was seen, so turning it on again starts from the PRs open then.
      if (this.state.seeded || this.state.offers.length) {
        this.save({ seeded: false, seen: [], offers: [] })
      }
      return
    }
    const open = (await this.deps.myPrs()).filter((pr) => pr.state === 'open')
    const seen = new Set(this.state.seen)
    const fresh = this.state.seeded ? open.filter((pr) => !seen.has(pr.key)) : []
    const offers: TicketMove[] = []
    for (const pr of fresh) {
      const key = issueKeyIn(pr.sourceBranch) ?? issueKeyIn(pr.title)
      if (!key || this.state.offers.some((o) => o.prKey === pr.key)) continue
      offers.push({
        prKey: pr.key,
        prLabel: refLabel(pr.ref),
        prTitle: pr.title,
        key,
        status: prOpenedStatus,
        at: this.now(),
      })
    }
    const seenNext = [...open.map((pr) => pr.key).filter((k) => !seen.has(k)), ...this.state.seen]
    const changed = !this.state.seeded || offers.length > 0 || seenNext.length !== seen.size
    if (!changed) return
    this.save({
      seeded: true,
      seen: seenNext.slice(0, MAX_SEEN),
      offers: [...offers, ...this.state.offers].slice(0, MAX_TICKET_MOVES),
    })
    for (const o of offers) {
      this.deps.notify({
        type: 'pr-opened',
        title: `${o.prLabel} opened for ${o.key}`,
        body: `Move ${o.key} to ${o.status}? DevDock asks you first, on Today.`,
        view: 'today',
      })
    }
  }

  /** e2e only: every open PR counts as new on the next poll (demo PRs never change). */
  forgetSeen(): void {
    this.save({ ...this.state, seeded: true, seen: [] })
  }

  dismiss(prKey: string): void {
    const offers = this.state.offers.filter((o) => o.prKey !== prKey)
    if (offers.length !== this.state.offers.length) this.save({ ...this.state, offers })
  }

  /** The user confirmed this offer: asks Jira, then drops the offer either way it answers. */
  async accept(prKey: string): Promise<TicketMoveResult> {
    const offer = this.state.offers.find((o) => o.prKey === prKey)
    if (!offer) {
      throw new ServiceError('not_found', 'That suggestion is gone. Nothing was changed in Jira.')
    }
    const result = await this.deps.jira.transitionToStatus(offer.key, offer.status)
    this.dismiss(prKey)
    return result === 'done'
      ? { result, message: `Moved ${offer.key} to ${offer.status}` }
      : {
          result,
          message: `${offer.key} has no "${offer.status}" transition from its current status; it was left as is.`,
        }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private save(state: State): void {
    this.state = state
    saveItems(this.deps.file, [state])
    this.deps.onChange(state.offers)
  }
}
