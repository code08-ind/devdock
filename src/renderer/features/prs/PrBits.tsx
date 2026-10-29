import { refLabel, type BuildState, type PullRequest } from '@shared/bitbucket'
import { PROVIDER_NAMES, type Provider } from '@shared/providers'
import { ErrorNotice, StatusPill, type Tone } from '../../ui/Feedback'

/** Small pieces of a PR row (SPEC 6.3 PR card), shared by the PRs view and Today. */

const BUILD: Record<BuildState, [Tone, string]> = {
  success: ['success', 'Build passed'],
  failed: ['danger', 'Build failed'],
  running: ['info', 'Building'],
  stopped: ['warning', 'Build stopped'],
  none: ['neutral', 'No builds'],
}

export function BuildPill({ pr }: { pr: PullRequest }) {
  const [tone, text] = BUILD[pr.build.state]
  const failed = pr.build.statuses.filter((s) => s.state === 'failed').map((s) => s.name)
  return (
    <span className="pill-wrap" title={failed.length ? `Failed: ${failed.join(', ')}` : undefined}>
      <StatusPill tone={tone}>{text}</StatusPill>
    </span>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Approvals / needs work, open threads, conflicts: only what says something. Lists don't know
 * which comments are resolved (DECISIONS P3-A), so there the total shows, in a neutral tone.
 */
export function ReviewState({ pr }: { pr: PullRequest }) {
  const open = pr.unresolvedComments
  const threads: [Tone, string] | null =
    open === null
      ? pr.comments > 0
        ? ['neutral', `${plural(pr.comments, 'comment')} in all`]
        : null
      : open > 0
        ? ['info', plural(open, 'open thread')]
        : null
  return (
    <>
      {pr.needsWork > 0 ? (
        <StatusPill tone="warning">Needs work ({pr.needsWork})</StatusPill>
      ) : null}
      {pr.approvals > 0 ? (
        <StatusPill tone="success">{plural(pr.approvals, 'approval')}</StatusPill>
      ) : pr.needsWork === 0 && pr.state === 'open' ? (
        <StatusPill tone="neutral">No reviews yet</StatusPill>
      ) : null}
      {threads ? <StatusPill tone={threads[0]}>{threads[1]}</StatusPill> : null}
      {pr.conflicts ? <StatusPill tone="danger">Conflicts</StatusPill> : null}
    </>
  )
}

export function StatePill({ pr }: { pr: PullRequest }) {
  if (pr.state === 'merged') return <StatusPill tone="success">Merged</StatusPill>
  if (pr.state === 'declined') return <StatusPill tone="neutral">Declined</StatusPill>
  return null
}

/** "3 h ago" — minutes under an hour, hours under two days, then days. ISO text or epoch ms. */
export function ago(when: string | number, now = Date.now()): string {
  const ms = now - (typeof when === 'number' ? when : Date.parse(when))
  if (!Number.isFinite(ms)) return ''
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** "Opened 26 h ago" / "Merged 2 d ago". */
export function AgeOf({ pr }: { pr: PullRequest }) {
  const closed = pr.closedAt && pr.state !== 'open'
  const label = closed ? (pr.state === 'merged' ? 'Merged' : 'Declined') : 'Opened'
  const when = ago(closed ? pr.closedAt! : pr.createdAt)
  return when ? (
    <span className="muted">
      {label} {when}
    </span>
  ) : null
}

/** `web-app #412`, GitLab `checkout !12`: how notifications and dialogs name a PR too. */
export const prLabel = (pr: PullRequest) => refLabel(pr.ref)

/** Providers that failed while others loaded (P7.04): the rest of the list still shows. */
export function ProviderFailures({
  failures,
}: {
  failures: readonly { provider: Provider; error: unknown }[]
}) {
  return failures.map(({ provider, error }) => (
    <div key={provider} className="provider-failure">
      <p className="muted">{PROVIDER_NAMES[provider]}:</p>
      <ErrorNotice error={error} />
    </div>
  ))
}
