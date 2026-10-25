import { useState } from 'react'
import type { PrAction, PullRequest } from '@shared/bitbucket'
import { ConfirmDialog } from '../../ui/Dialog'
import { PrActionDialog } from '../prs/PrActionDialog'
import type { ConfirmRequest } from './commands'

/**
 * The dialogs palette commands ask for (SPEC 7: confirm before stopping a process or acting on
 * a PR), for windows that can show them: the main window and the menu-bar panel.
 */
export function useCommandDialogs() {
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null)
  const [acting, setActing] = useState<{ pr: PullRequest; action: PrAction } | null>(null)
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
    </>
  )
  return {
    confirm: setConfirming,
    prAction: (pr: PullRequest, action: PrAction) => setActing({ pr, action }),
    dialogs,
  }
}
