import type { View } from '@shared/channels'
import { useJiraIssue } from '../../lib/jira'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice, Loading } from '../../ui/Feedback'
import { StartWorkDialog } from './StartWorkDialog'

/**
 * Start work by issue key (Tickets, the panel, the palette's `branch <KEY>`): the issue's
 * details are fetched first (description, Figma links go into the brief), then the dialog.
 * Until then — or if the issue can't be read — a dialog says so and can be closed.
 */
export function StartWorkFor({
  issueKey,
  onClose,
  onView,
}: {
  issueKey: string
  onClose: () => void
  onView: (v: View) => void
}) {
  const issue = useJiraIssue(issueKey)
  if (issue.data) return <StartWorkDialog issue={issue.data} onClose={onClose} onView={onView} />
  return (
    <Dialog
      open
      title={`Start work on ${issueKey}`}
      onClose={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {issue.error ? <ErrorNotice error={issue.error} /> : <Loading what={issueKey} />}
    </Dialog>
  )
}
