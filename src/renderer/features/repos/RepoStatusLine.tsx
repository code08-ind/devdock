import { ArrowDown, ArrowUp, GitBranch, Clock, Package, TriangleAlert } from 'lucide-react'
import type { RepoStatus } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { relativeTime } from '../../lib/repos'
import { ErrorDetails, StatusPill } from '../../ui/Feedback'

const ICON = { size: 14, 'aria-hidden': true } as const

/** One-line status (SPEC 6.2 "Status per repo"). Every item is icon + text, never colour alone. */
export function RepoStatusLine({ repo, status }: { repo: RepoConfig; status: RepoStatus }) {
  const base = repo.baseBranch
  const up = status.vsUpstream
  const vsBase = status.vsBase
  return (
    <ul className="repo-status" aria-label={`${repo.name} status`}>
      <li className="mono">
        <GitBranch {...ICON} />
        {status.branch ?? 'detached HEAD'}
      </li>
      {status.operation ? (
        <li>
          <StatusPill tone="danger">
            {status.operation === 'merge' ? 'Merge' : 'Rebase'} in progress
            {status.conflicted.length ? ` · ${status.conflicted.length} conflicted` : ''}
          </StatusPill>
        </li>
      ) : null}
      <li className="tabular">
        {up ? (
          <span title={`vs origin/${status.branch}`}>
            <ArrowUp {...ICON} />
            {up.ahead} <ArrowDown {...ICON} />
            {up.behind} <span className="muted">origin</span>
          </span>
        ) : (
          <span className="muted">not pushed</span>
        )}
      </li>
      {status.branch !== base ? (
        <li className="tabular">
          {!status.lastFetch || !vsBase ? (
            // Compared with the local copy of origin/<base>: meaningless before a fetch.
            <span className="muted">fetch to compare with {base}</span>
          ) : vsBase.behind > 0 ? (
            <StatusPill tone="warning">
              {vsBase.behind} behind, {vsBase.ahead} ahead of origin/{base}
            </StatusPill>
          ) : (
            <span className="muted">
              up to date with origin/{base}
              {vsBase.ahead > 0 ? `, ${vsBase.ahead} ahead` : ''}
            </span>
          )}
        </li>
      ) : null}
      <li className="tabular">
        {status.dirty > 0 ? (
          <StatusPill tone="warning">
            {status.dirty} changed {status.dirty === 1 ? 'file' : 'files'}
          </StatusPill>
        ) : (
          <span className="muted">clean</span>
        )}
      </li>
      {status.stashes > 0 ? (
        <li className="tabular">
          <Package {...ICON} />
          {status.stashes} {status.stashes === 1 ? 'stash' : 'stashes'}
        </li>
      ) : null}
      <li className="muted">
        <Clock {...ICON} />
        {status.lastFetch ? `fetched ${relativeTime(status.lastFetch)}` : 'never fetched'}
      </li>
    </ul>
  )
}

export function RepoStatusError({ error }: { error: Error }) {
  return (
    <div>
      <p className="repo-status-error">
        <TriangleAlert {...ICON} />
        {error.message}
      </p>
      <ErrorDetails error={error} />
    </div>
  )
}
