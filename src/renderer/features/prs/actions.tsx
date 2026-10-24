import type { ReactNode } from 'react'
import { Check, GitMerge, MessageSquareWarning } from 'lucide-react'
import type { PrAction, PullRequest } from '@shared/bitbucket'

/** Everything the UI says about a PR action: its button, dialog and result toast. */
export interface ActionCopy {
  /** Button text (opens the dialog, hence the ellipsis) and its accessible verb. */
  button: string
  verb: string
  icon: ReactNode
  /** Dialog title before the PR label, e.g. "Approve" → "Approve web-app #410?". */
  title: string
  confirm: (pr: PullRequest) => string
  /** Toast before the PR label, e.g. "Approved web-app #410". */
  done: string
  /** Exactly what will happen (UI-THEMES: confirmations state what happens). */
  explain: (pr: PullRequest) => string
}

export const ACTION_COPY: Record<PrAction, ActionCopy> = {
  approve: {
    button: 'Approve…',
    verb: 'Approve',
    icon: <Check size={16} aria-hidden="true" />,
    title: 'Approve',
    confirm: () => 'Approve',
    done: 'Approved',
    explain: () => 'DevDock adds your approval to this pull request on Bitbucket.',
  },
  needs_work: {
    button: 'Needs work…',
    verb: 'Mark needs work on',
    icon: <MessageSquareWarning size={16} aria-hidden="true" />,
    title: 'Mark needs work on',
    confirm: () => 'Mark needs work',
    done: 'Marked needs work on',
    explain: () =>
      'DevDock marks this pull request as needing work (request changes) on Bitbucket, as you.',
  },
  merge: {
    button: 'Merge…',
    verb: 'Merge',
    icon: <GitMerge size={16} aria-hidden="true" />,
    title: 'Merge',
    confirm: (pr) => `Merge into ${pr.targetBranch}`,
    done: 'Merged',
    explain: (pr) =>
      `DevDock merges ${pr.sourceBranch} into ${pr.targetBranch} on Bitbucket with the repository's default merge strategy. This can't be undone from DevDock.`,
  },
}
