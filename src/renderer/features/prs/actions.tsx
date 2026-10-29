import type { ReactNode } from 'react'
import { Check, GitMerge, MessageSquareWarning } from 'lucide-react'
import {
  PROVIDER_ACTIONS,
  providerOf,
  type PrAction,
  type PrList,
  type PullRequest,
} from '@shared/bitbucket'
import { PR_NOUN, PROVIDER_NAMES } from '@shared/providers'

/** "Bitbucket", "GitHub", "GitLab": where the action is sent. */
const site = (pr: PullRequest) => PROVIDER_NAMES[providerOf(pr.ref)]
const noun = (pr: PullRequest) => PR_NOUN[providerOf(pr.ref)]

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
    explain: (pr) => `DevDock adds your approval to this ${noun(pr)} on ${site(pr)}.`,
  },
  needs_work: {
    button: 'Needs work…',
    verb: 'Mark needs work on',
    icon: <MessageSquareWarning size={16} aria-hidden="true" />,
    title: 'Mark needs work on',
    confirm: () => 'Mark needs work',
    done: 'Marked needs work on',
    explain: (pr) =>
      `DevDock marks this ${noun(pr)} as needing work (request changes) on ${site(pr)}, as you.`,
  },
  merge: {
    button: 'Merge…',
    verb: 'Merge',
    icon: <GitMerge size={16} aria-hidden="true" />,
    title: 'Merge',
    confirm: (pr) => `Merge into ${pr.targetBranch}`,
    done: 'Merged',
    explain: (pr) =>
      `DevDock merges ${pr.sourceBranch} into ${pr.targetBranch} on ${site(pr)} with the repository's default (or first allowed) merge method. This can't be undone from DevDock.`,
  },
}

/** Once PR actions are on: merge your own PRs, review everyone else's (Watched mixes both). */
export const MINE: readonly PrAction[] = ['merge']
export const OTHERS: readonly PrAction[] = ['approve', 'needs_work']
export const LIST_ACTIONS: Record<PrList, readonly PrAction[]> = {
  mine: MINE,
  reviewing: OTHERS,
  merged: [],
}

/** Only what the PR's provider offers through its API (GitLab has no request changes). */
export const offered = (pr: PullRequest, wanted: readonly PrAction[]) =>
  wanted.filter((a) => PROVIDER_ACTIONS[providerOf(pr.ref)].includes(a))
