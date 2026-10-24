import { useState } from 'react'
import type { PrAction, PullRequest } from '@shared/bitbucket'
import { usePrAction } from '../../lib/bitbucket'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input } from '../../ui/Field'
import { ACTION_COPY } from './actions'
import { prLabel } from './PrBits'

/**
 * SPEC 6.3: every PR action is confirmed in a dialog naming the PR and its target branch;
 * merge also needs the target branch typed. Bitbucket's own refusal is shown here, verbatim.
 */
export function PrActionDialog({
  pr,
  action,
  onClose,
}: {
  pr: PullRequest
  action: PrAction
  onClose: () => void
}) {
  const act = usePrAction()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const copy = ACTION_COPY[action]
  const merge = action === 'merge'
  const typedOk = typed.trim() === pr.targetBranch

  const submit = () =>
    act.mutate(
      { ref: pr.ref, action, confirmed: true, ...(merge ? { targetBranch: typed.trim() } : {}) },
      {
        onSuccess: () => {
          toast(`${copy.done} ${prLabel(pr)}`)
          onClose()
        },
      },
    )

  return (
    <Dialog
      open
      title={`${copy.title} ${prLabel(pr)}?`}
      onClose={onClose}
      dismissible={!act.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={act.isPending}>
            Cancel
          </Button>
          <Button
            variant={merge ? 'danger' : 'primary'}
            disabled={act.isPending || (merge && !typedOk)}
            onClick={submit}
          >
            {act.isPending ? 'Sending…' : copy.confirm(pr)}
          </Button>
        </>
      }
    >
      <p>
        <strong>{pr.title}</strong>
      </p>
      <p className="mono pr-branches">
        {pr.sourceBranch} → {pr.targetBranch}
      </p>
      <p>{copy.explain(pr)}</p>
      {merge ? (
        <Field label={`Type ${pr.targetBranch} to confirm`}>
          {({ id }) => (
            <Input
              id={id}
              className="mono"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedOk && !act.isPending) submit()
              }}
            />
          )}
        </Field>
      ) : null}
      {act.error ? <ErrorNotice error={act.error} /> : null}
    </Dialog>
  )
}
