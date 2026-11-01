/**
 * What each AI feature sends (P7-C-B). Pure: the same input always gives the same text, so the
 * preview the user confirms is exactly what goes out. Only data DevDock already shows on screen
 * is included; never tokens, paths outside the repo, or environment values.
 */
import type { AiFeature } from '@shared/ai'
import {
  MAX_PR_DESCRIPTION,
  type PrChanges,
  type PrFileChange,
  type PullRequest,
} from '@shared/bitbucket'
import type { StandupDraft } from '@shared/standup'

export const SYSTEM: Record<AiFeature, string> = {
  'pr-summary':
    'You summarise a pull request for its author to paste into a team chat. Use only the facts ' +
    'given. Say what the change does (from its description and changed files, else its title ' +
    'and branches), where it stands (reviews, build, conflicts, open threads) and the one next ' +
    'step that unblocks it. Four to six plain sentences, no headings, no greeting, no emoji.',
  lesson:
    "You turn a code reviewer's comment into one reusable lesson for a coding agent's lessons " +
    'file. Write a single imperative line under 25 words that states the general rule behind the ' +
    'comment, not the specific fix. No quotes, no bullet, no preamble.',
  standup:
    'You tidy a developer’s daily standup notes. Keep every fact and ticket key, drop ' +
    'duplicates, and write short plain-English bullets under the headings Yesterday, Today and ' +
    'Blockers (write "None" when there are none). Do not invent work. Markdown, nothing else.',
}

const SIGN: Record<PrFileChange['status'], string> = {
  added: 'added',
  modified: 'modified',
  removed: 'removed',
  renamed: 'renamed',
}

/** T7: the description and changed files, or why they're missing. */
function changesLines(changes: PrChanges | null): string[] {
  if (!changes) return ['Description and changed files: could not be read.']
  const description = changes.description
    ? `${changes.description}${changes.descriptionCut ? `\n[… cut at ${MAX_PR_DESCRIPTION} characters]` : ''}`
    : '(none)'
  const known = changes.files.filter((f) => f.added !== null && f.removed !== null)
  const sum = (k: 'added' | 'removed') => known.reduce((n, f) => n + (f[k] ?? 0), 0)
  const totals =
    known.length === changes.files.length && known.length > 0
      ? ` (+${sum('added')} −${sum('removed')} lines)`
      : ''
  const total = changes.filesTotal ?? changes.files.length
  const files = changes.files.map(
    (f) =>
      `- ${SIGN[f.status]} ${f.path}${f.added !== null && f.removed !== null ? ` (+${f.added} −${f.removed})` : ''}`,
  )
  const more = total - changes.files.length
  return [
    'Description:',
    description,
    `Changed files: ${total}${totals}`,
    ...files,
    ...(more > 0 ? [`(and ${more} more files)`] : []),
  ]
}

export function prPrompt(pr: PullRequest, changes: PrChanges | null = null): string {
  const reviewers = pr.reviewers.length
    ? pr.reviewers.map((r) => `${r.name} (${r.status.replace(/_/g, ' ')})`).join(', ')
    : 'none yet'
  const failing = pr.build.statuses.filter((s) => s.state === 'failed').map((s) => s.name)
  return [
    `Pull request: ${pr.title}`,
    `Branches: ${pr.sourceBranch} → ${pr.targetBranch}`,
    `State: ${pr.state}`,
    `Reviewers: ${reviewers}`,
    `Approvals: ${pr.approvals}; needs work: ${pr.needsWork}`,
    `Comments: ${pr.comments}; unresolved threads: ${pr.unresolvedComments ?? 'unknown'}`,
    `Merge conflicts: ${pr.conflicts === null ? 'unknown' : pr.conflicts ? 'yes' : 'no'}`,
    `Build: ${pr.build.state}${failing.length ? ` (failing: ${failing.join(', ')})` : ''}`,
    `Opened: ${pr.createdAt}; last updated: ${pr.updatedAt}`,
    ...changesLines(changes),
  ].join('\n')
}

export function lessonPrompt(comment: string, where?: string): string {
  return [where ? `Left on: ${where}` : null, 'Reviewer comment:', comment.trim()]
    .filter(Boolean)
    .join('\n')
}

export function standupPrompt(draft: Omit<StandupDraft, 'notes'>): string {
  const list = (items: string[]) =>
    items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)'
  return [
    `Yesterday (${draft.yesterdayDate}):`,
    list(draft.yesterday),
    '',
    'Today:',
    list(draft.today),
    '',
    'Blockers:',
    list(draft.blockers),
  ].join('\n')
}
