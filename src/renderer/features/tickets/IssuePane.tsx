import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Play, X } from 'lucide-react'
import type { View } from '@shared/channels'
import type { JiraIssueDetail } from '@shared/jira'
import { bridge, unwrap } from '../../lib/devdock'
import { useJiraIssue } from '../../lib/jira'
import { useAction } from '../../lib/useAction'
import { Button, IconButton } from '../../ui/Button'
import { ErrorNotice } from '../../ui/Feedback'
import { KeyValue } from '../../ui/Text'
import { StartWorkDialog } from './StartWorkDialog'
import { StatusOf, TypeOf } from './IssueBits'

const LINK_LABEL = { figma: 'Figma', confluence: 'Confluence' } as const

/** Issue detail (SPEC 6.5 issue card + BUILD-PROMPTS "detail drawer with links"). */
export function IssuePane({
  issueKey,
  onClose,
  onView,
}: {
  issueKey: string
  onClose: () => void
  onView: (v: View) => void
}) {
  const { data: issue, error, isPending } = useJiraIssue(issueKey)
  const { run } = useAction()
  const [starting, setStarting] = useState(false)
  const ref = useRef<HTMLElement>(null)
  // In a narrow window the pane sits below the list: bring it into view and move focus to it,
  // so keyboard and screen-reader users land on what they just opened.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }, [issueKey])
  const open = (url: string) => void run(unwrap(bridge.app.openExternal({ url })))

  return (
    <aside ref={ref} tabIndex={-1} className="issue-pane" aria-label={`${issueKey} details`}>
      <div className="issue-pane-head">
        <span className="mono issue-key">{issueKey}</span>
        <IconButton
          label="Close details"
          icon={<X size={16} aria-hidden="true" />}
          onClick={onClose}
        />
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {isPending ? (
        <p className="muted" role="status">
          Loading {issueKey}…
        </p>
      ) : null}
      {issue ? (
        <>
          <h2 className="issue-title">{issue.summary}</h2>
          <div className="button-row">
            <Button
              variant="primary"
              icon={<Play size={16} aria-hidden="true" />}
              onClick={() => setStarting(true)}
            >
              Start work…
            </Button>
            <Button
              variant="ghost"
              icon={<ExternalLink size={16} aria-hidden="true" />}
              onClick={() => open(issue.url)}
            >
              Open in Jira
            </Button>
          </div>
          <Facts issue={issue} />
          {issue.links.length ? (
            <section aria-labelledby="issue-links">
              <h3 id="issue-links">Links</h3>
              <ul className="issue-links">
                {issue.links.map((l) => (
                  <li key={l.url}>
                    <button type="button" className="link-button" onClick={() => open(l.url)}>
                      <ExternalLink size={14} aria-hidden="true" />
                      {LINK_LABEL[l.kind]}: {l.url}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <IssueText title="Description" text={issue.description} empty="No description." />
          <IssueText
            title="Acceptance criteria"
            text={issue.acceptanceCriteria ?? ''}
            empty="None in the ticket."
          />
          <section aria-labelledby="issue-comments">
            <h3 id="issue-comments">Comments</h3>
            {issue.comments.length === 0 ? <p className="muted">No comments.</p> : null}
            {issue.comments.map((c, i) => (
              <article key={i} className="issue-comment">
                <p className="muted">
                  {c.author}, {c.created.slice(0, 10)}
                </p>
                <div className="issue-text">{c.body}</div>
              </article>
            ))}
          </section>
          {starting ? (
            <StartWorkDialog issue={issue} onClose={() => setStarting(false)} onView={onView} />
          ) : null}
        </>
      ) : null}
    </aside>
  )
}

function Facts({ issue }: { issue: JiraIssueDetail }) {
  const items: [string, React.ReactNode][] = [
    ['Type', <TypeOf key="t" type={issue.type} />],
    ['Status', <StatusOf key="s" issue={issue} />],
  ]
  if (issue.priority) items.push(['Priority', issue.priority])
  if (issue.sprint) items.push(['Sprint', issue.sprint])
  if (issue.fixVersions.length) items.push(['Fix version', issue.fixVersions.join(', ')])
  if (issue.assignee) items.push(['Assignee', issue.assignee])
  return <KeyValue items={items} />
}

/** Ticket text is Markdown from Jira; shown as wrapped plain text (no HTML is rendered). */
function IssueText({ title, text, empty }: { title: string; text: string; empty: string }) {
  const id = `issue-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {text ? <div className="issue-text">{text}</div> : <p className="muted">{empty}</p>}
    </section>
  )
}
