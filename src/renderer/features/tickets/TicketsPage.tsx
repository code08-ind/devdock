import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Ticket } from 'lucide-react'
import type { View } from '@shared/channels'
import { DevDockError, useSettings } from '../../lib/devdock'
import { jiraKeys, listChoices, useJiraList } from '../../lib/jira'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, ErrorNotice } from '../../ui/Feedback'
import { SegmentedControl } from '../../ui/Field'
import { StatusOf, TypeOf } from './IssueBits'
import { IssuePane } from './IssuePane'

/** SPEC 6.5 lists (My open issues, Current sprint, saved queries) with the issue detail pane. */
export function TicketsPage({ onView }: { onView: (v: View) => void }) {
  const settings = useSettings().data
  const qc = useQueryClient()
  const choices = settings ? listChoices(settings) : []
  const [choiceId, setChoiceId] = useState('mine')
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0] ?? null
  const list = useJiraList(choice?.request ?? null)
  const [selected, setSelected] = useState<string | null>(null)

  if (!settings || !choice) return null

  const notConfigured = list.error instanceof DevDockError && list.error.code === 'NOT_CONFIGURED'
  const issues = list.data ?? []
  const selectedKey = issues.some((i) => i.key === selected) ? selected : null

  return (
    <div className="tickets">
      <div className="tickets-list">
        <div className="row-between">
          {choices.length > 1 ? (
            <SegmentedControl
              label="List"
              options={choices.map((c) => ({ value: c.id, label: c.label }))}
              value={choice.id}
              onValue={(id) => {
                // A different list: don't bring back (and focus) an issue from the old one.
                setChoiceId(id)
                setSelected(null)
              }}
            />
          ) : (
            <h2 className="tickets-list-title">{choice.label}</h2>
          )}
          <IconButton
            label="Refresh from Jira"
            icon={<RefreshCw size={16} aria-hidden="true" />}
            disabled={list.isFetching}
            onClick={() => void qc.invalidateQueries({ queryKey: jiraKeys.all })}
          />
        </div>

        {notConfigured ? (
          <EmptyState
            icon={<Ticket size={18} aria-hidden="true" />}
            title={(list.error as Error).message}
            action={<Button onClick={() => onView('settings')}>Open Settings</Button>}
          />
        ) : list.error ? (
          <ErrorNotice error={list.error} />
        ) : list.isPending ? (
          <p className="muted" role="status">
            Loading issues from Jira…
          </p>
        ) : issues.length === 0 ? (
          <EmptyState
            icon={<Ticket size={18} aria-hidden="true" />}
            title={`No issues in ${choice.label}.`}
          />
        ) : (
          <ul className="issue-list" aria-label={choice.label}>
            {issues.map((issue) => (
              <li key={issue.key}>
                <button
                  type="button"
                  className="issue-row"
                  aria-current={issue.key === selectedKey ? 'true' : undefined}
                  onClick={() => setSelected(issue.key)}
                >
                  <span className="issue-row-top">
                    <span className="mono issue-key">{issue.key}</span>
                    <TypeOf type={issue.type} />
                    {issue.priority ? (
                      <span className="muted">{issue.priority} priority</span>
                    ) : null}
                    <StatusOf issue={issue} />
                  </span>
                  <span className="issue-summary">{issue.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedKey ? (
        <IssuePane issueKey={selectedKey} onClose={() => setSelected(null)} onView={onView} />
      ) : (
        <p className="tickets-hint muted">Select an issue to see its details and start work.</p>
      )}
    </div>
  )
}
