import { Bug, BookOpen, SquareCheck, Ticket } from 'lucide-react'
import type { JiraIssue } from '@shared/jira'
import { StatusPill, type Tone } from '../../ui/Feedback'

const STATUS_TONE: Record<JiraIssue['statusCategory'], Tone> = {
  new: 'neutral',
  indeterminate: 'info',
  done: 'success',
  unknown: 'neutral',
}

export function StatusOf({ issue }: { issue: JiraIssue }) {
  return <StatusPill tone={STATUS_TONE[issue.statusCategory]}>{issue.status}</StatusPill>
}

const TYPE_ICONS: [RegExp, typeof Ticket][] = [
  [/bug|defect/i, Bug],
  [/story/i, BookOpen],
  [/task/i, SquareCheck],
]

/** Issue type with an icon; the name is always shown (never icon alone). */
export function TypeOf({ type }: { type: string }) {
  const Icon = TYPE_ICONS.find(([re]) => re.test(type))?.[1] ?? Ticket
  return (
    <span className="issue-type">
      <Icon size={14} aria-hidden="true" />
      {type}
    </span>
  )
}
