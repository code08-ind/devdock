import { useState } from 'react'
import type { JiraIssue } from '@shared/jira'
import { useJiraIssue, useJiraList } from '../../lib/jira'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/Feedback'
import { StatusOf } from '../tickets/IssueBits'
import { StartWorkDialog } from '../tickets/StartWorkDialog'
import { SetUp } from '../today/TodayPage'
import { Loading, goto } from './bits'

/** My open tickets, in progress first; each starts work in one click (then the preview). */
export function TicketsTab() {
  const mine = useJiraList({ list: 'mine' })
  if (mine.error) return <SetUp error={mine.error} onView={goto} />
  if (mine.isPending) return <Loading what="tickets" />
  const issues = [...mine.data].sort((a, b) => Number(inProgress(b)) - Number(inProgress(a)))
  if (issues.length === 0) return <p className="muted">No open tickets assigned to you.</p>
  return <TicketList issues={issues} label="My open tickets" />
}

export const inProgress = (issue: JiraIssue) => issue.statusCategory === 'indeterminate'

export function TicketList({ issues, label }: { issues: readonly JiraIssue[]; label: string }) {
  const [starting, setStarting] = useState<string | null>(null)
  return (
    <>
      <ul className="panel-tickets" aria-label={label}>
        {issues.map((issue) => (
          <li key={issue.key} className="panel-ticket">
            <div className="row-between">
              <span className="mono issue-key">{issue.key}</span>
              <StatusOf issue={issue} />
            </div>
            <p className="panel-ticket-summary">{issue.summary}</p>
            <div className="button-row">
              <Button size="sm" variant="primary" onClick={() => setStarting(issue.key)}>
                Start work…
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {starting ? <StartWork issueKey={starting} onClose={() => setStarting(null)} /> : null}
    </>
  )
}

/** Start work needs the issue's details (description, Figma links) for the brief. */
function StartWork({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const issue = useJiraIssue(issueKey)
  if (issue.error) return <ErrorNotice error={issue.error} />
  if (!issue.data) return <Loading what={issueKey} />
  return <StartWorkDialog issue={issue.data} onClose={onClose} onView={goto} />
}
