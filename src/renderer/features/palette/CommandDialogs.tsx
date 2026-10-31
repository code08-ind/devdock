import { useState } from 'react'
import type { AiPrepare } from '@shared/ai'
import type { PrAction, PullRequest } from '@shared/bitbucket'
import { queryClient } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { standupQuery } from '../../lib/utilities'
import { ConfirmDialog } from '../../ui/Dialog'
import { AiDialog } from '../ai/AiDialog'
import { PrActionDialog } from '../prs/PrActionDialog'
import type { ConfirmRequest } from './commands'

/** What a palette AI command asks for (P7-C-B); the dialog then prepares it in main. */
export type AiCommandRequest = { feature: 'standup' } | { feature: 'pr-summary'; pr: PullRequest }

/**
 * The dialogs palette commands ask for (SPEC 7: confirm before stopping a process or acting on
 * a PR; the AI preview before anything is sent), for windows that can show them: the main
 * window and the menu-bar panel.
 */
export function useCommandDialogs() {
  const { run } = useAction()
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null)
  const [acting, setActing] = useState<{ pr: PullRequest; action: PrAction } | null>(null)
  const [asking, setAsking] = useState<AiPrepare | null>(null)
  const ai = async (request: AiCommandRequest) => {
    if (request.feature === 'pr-summary') {
      setAsking({ feature: 'pr-summary', ref: request.pr.ref })
      return
    }
    // The collected draft as Utilities → Standup shows it (edits made there stay there).
    const r = await run(queryClient.fetchQuery(standupQuery))
    if (!r.ok) return
    const { yesterdayDate, yesterday, today, blockers } = r.value
    setAsking({ feature: 'standup', draft: { yesterdayDate, yesterday, today, blockers } })
  }
  const dialogs = (
    <>
      {confirming ? (
        <ConfirmDialog
          open
          danger
          title={confirming.title}
          body={confirming.body}
          confirmLabel={confirming.confirmLabel}
          onConfirm={() => {
            void confirming.run()
            setConfirming(null)
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {acting ? (
        <PrActionDialog pr={acting.pr} action={acting.action} onClose={() => setActing(null)} />
      ) : null}
      {asking ? <AiDialog request={asking} onClose={() => setAsking(null)} /> : null}
    </>
  )
  return {
    confirm: setConfirming,
    prAction: (pr: PullRequest, action: PrAction) => setActing({ pr, action }),
    ai,
    dialogs,
  }
}
