import { useState, type ReactNode } from 'react'
import type { TicketMove } from '@shared/ticketmoves'
import { isLive } from '@shared/bitbucket'
import type { View } from '@shared/channels'
import type { BuildWatch } from '@shared/jenkins'
import type { RepoConfig } from '@shared/settings'
import { usePrList, useWatchedKeys, useWatches } from '../../lib/bitbucket'
import { isNotConfigured } from '../../lib/devdock'
import { useBuildWatches, byLiveFirst } from '../../lib/jenkins'
import { useJiraList } from '../../lib/jira'
import { useRepoStatus, useRepos } from '../../lib/repos'
import {
  ticketMoveConfirm,
  useAcceptTicketMove,
  useDismissTicketMove,
  useTicketMoves,
} from '../../lib/ticketmoves'
import { useAction } from '../../lib/useAction'
import { ConfirmDialog } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { WatchHead, watchNote } from '../builds/BuildBits'
import { WatchedRunRow } from '../builds/CiRuns'
import { useCiWatches } from '../../lib/providers'
import { PrRow } from '../prs/PrRow'
import { RepoStatusError, RepoStatusLine } from '../repos/RepoStatusLine'
import { StatusOf } from '../tickets/IssueBits'

/** Today (SPEC 6.1): my PRs, watched PRs, my in-progress tickets, repo status. */
export function TodayPage({ onView }: { onView: (v: View) => void }) {
  return (
    <div className="today">
      <TicketMoves />
      <MyPrs onView={onView} />
      <Watched onView={onView} />
      <WatchedBuilds onView={onView} />
      <InProgress onView={onView} />
      <Repos onView={onView} />
    </div>
  )
}

/**
 * T5: a PR of mine opened for a Jira key; move the ticket? Shown only while there are offers.
 * Moving asks first (SPEC 7: Jira transitions).
 */
function TicketMoves() {
  const offers = useTicketMoves().data ?? []
  const accept = useAcceptTicketMove()
  const dismiss = useDismissTicketMove()
  const { run } = useAction()
  const toast = useToast()
  const [confirming, setConfirming] = useState<TicketMove | null>(null)
  if (offers.length === 0) return null
  return (
    <section className="today-section" aria-labelledby="today-moves">
      <h2 id="today-moves">Move tickets?</h2>
      <ul className="today-rows" aria-label="Tickets to move">
        {offers.map((o) => (
          <li key={o.prKey} className="today-row">
            <span className="mono issue-key">{o.key}</span>
            <span className="today-row-text">
              {o.prLabel} opened: move {o.key} to {o.status}?
            </span>
            <span className="row-actions">
              <Button
                size="sm"
                aria-label={`Move ${o.key} to ${o.status}…`}
                onClick={() => setConfirming(o)}
              >
                Move to {o.status}…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Dismiss: leave ${o.key} as it is`}
                onClick={() => void run(dismiss.mutateAsync(o.prKey))}
              >
                Dismiss
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {confirming ? (
        <ConfirmDialog
          open
          {...ticketMoveConfirm(confirming)}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const o = confirming
            setConfirming(null)
            void run(accept.mutateAsync(o.prKey)).then((r) => {
              if (r.ok) toast(r.value.message, r.value.result === 'done' ? undefined : 'warning')
            })
          }}
        />
      ) : null}
    </section>
  )
}

function TodaySection({
  id,
  title,
  open,
  children,
}: {
  id: string
  title: string
  /** The view this section summarises, with its button label. */
  open: { label: string; onClick: () => void }
  children: ReactNode
}) {
  return (
    <section className="today-section" aria-labelledby={id}>
      <div className="row-between">
        <h2 id={id}>{title}</h2>
        <Button size="sm" variant="ghost" onClick={open.onClick}>
          {open.label}
        </Button>
      </div>
      {children}
    </section>
  )
}

/** A service that isn't set up yet: one line and the way to fix it, not an error. */
export function SetUp({ error, onView }: { error: unknown; onView: (v: View) => void }) {
  if (!isNotConfigured(error)) {
    return <ErrorNotice error={error} />
  }
  return (
    <div className="today-setup">
      <p className="muted">{error.message}</p>
      <Button size="sm" onClick={() => onView('settings')}>
        Open Settings
      </Button>
    </div>
  )
}

function MyPrs({ onView }: { onView: (v: View) => void }) {
  const mine = usePrList('mine')
  const watched = useWatchedKeys()
  return (
    <TodaySection
      id="today-prs"
      title="My pull requests"
      open={{ label: 'Open Pull requests', onClick: () => onView('prs') }}
    >
      {mine.error ? (
        <SetUp error={mine.error} onView={onView} />
      ) : mine.isPending || !mine.data ? (
        <p className="muted" role="status">
          Loading pull requests…
        </p>
      ) : mine.data.length === 0 ? (
        <p className="muted">You have no open pull requests.</p>
      ) : (
        <ul className="pr-list" aria-label="My pull requests">
          {mine.data.map((pr) => (
            <PrRow key={pr.key} pr={pr} watchKey={watched.has(pr.key) ? pr.key : undefined} />
          ))}
        </ul>
      )}
    </TodaySection>
  )
}

/** Watched PRs still open (closed ones stay in PRs → Watched). Hidden while there are none. */
function Watched({ onView }: { onView: (v: View) => void }) {
  const live = (useWatches().data ?? []).filter(isLive)
  if (live.length === 0) return null
  return (
    <TodaySection
      id="today-watched"
      title="Watched"
      open={{ label: 'Open Watched', onClick: () => onView('prs') }}
    >
      <ul className="pr-list" aria-label="Watched pull requests">
        {live.map((w) => (
          <PrRow key={w.key} pr={w.pr} watchKey={w.key} showAuthor>
            {w.error ? <p className="pr-watch-error">{w.error}</p> : null}
          </PrRow>
        ))}
      </ul>
    </TodaySection>
  )
}

/** SPEC 6.1 Today "watched builds": running ones first. Hidden while there are none. */
function WatchedBuilds({ onView }: { onView: (v: View) => void }) {
  const items = byLiveFirst(useBuildWatches().data ?? [])
  // P7: watched GitHub Actions runs / GitLab pipelines sit with the Jenkins builds.
  const runs = [...(useCiWatches().data ?? [])].sort((a, b) => Number(a.done) - Number(b.done))
  if (items.length === 0 && runs.length === 0) return null
  return (
    <TodaySection
      id="today-builds"
      title="Watched builds"
      open={{ label: 'Open Builds', onClick: () => onView('builds') }}
    >
      <ul className="pr-list" aria-label="Watched builds">
        {items.map((w) => (
          <WatchedBuildRow key={w.key} watch={w} />
        ))}
        {runs.map((w) => (
          <WatchedRunRow key={w.key} watch={w} />
        ))}
      </ul>
    </TodaySection>
  )
}

/** A watched build: its head (job, number, state) and the last check; `actions` on the right. */
export function WatchedBuildRow({ watch: w, actions }: { watch: BuildWatch; actions?: ReactNode }) {
  return (
    <li className="pr-row">
      <div className="pr-row-head">
        <WatchHead watch={w} />
        {actions ? <span className="row-actions">{actions}</span> : null}
      </div>
      <p className={w.error ? 'pr-watch-error' : 'muted pr-watch-note'}>{watchNote(w)}</p>
    </li>
  )
}

function InProgress({ onView }: { onView: (v: View) => void }) {
  const mine = useJiraList({ list: 'mine' })
  const started = (mine.data ?? []).filter((i) => i.statusCategory === 'indeterminate')
  return (
    <TodaySection
      id="today-tickets"
      title="In progress"
      open={{ label: 'Open Tickets', onClick: () => onView('tickets') }}
    >
      {mine.error ? (
        <SetUp error={mine.error} onView={onView} />
      ) : mine.isPending || !mine.data ? (
        <p className="muted" role="status">
          Loading tickets…
        </p>
      ) : started.length === 0 ? (
        <p className="muted">Nothing in progress. Start work from Tickets.</p>
      ) : (
        <ul className="today-rows" aria-label="Tickets in progress">
          {started.map((issue) => (
            <li key={issue.key} className="today-row">
              <span className="mono issue-key">{issue.key}</span>
              <span className="today-row-text">{issue.summary}</span>
              <StatusOf issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </TodaySection>
  )
}

function RepoRow({ repo }: { repo: RepoConfig }) {
  const status = useRepoStatus(repo.id)
  return (
    <li className="today-repo">
      <span className="today-repo-name">{repo.name}</span>
      {status.data ? <RepoStatusLine repo={repo} status={status.data} /> : null}
      {status.error ? <RepoStatusError error={status.error} /> : null}
    </li>
  )
}

function Repos({ onView }: { onView: (v: View) => void }) {
  const repos = useRepos()
  return (
    <TodaySection
      id="today-repos"
      title="Repos"
      open={{
        label: repos.length ? 'Open Repos' : 'Add a repo',
        onClick: () => onView('repos'),
      }}
    >
      {repos.length === 0 ? (
        <p className="muted">
          No repos added yet. Add a local git repo to see its branch and sync status.
        </p>
      ) : (
        <ul className="today-repos">
          {repos.map((r) => (
            <RepoRow key={r.id} repo={r} />
          ))}
        </ul>
      )}
    </TodaySection>
  )
}
