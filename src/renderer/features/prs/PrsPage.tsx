import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, GitPullRequest, RefreshCw } from 'lucide-react'
import {
  PR_LISTS,
  isLive,
  type PrAction,
  type PrList,
  type PullRequest,
  type WatchItem,
} from '@shared/bitbucket'
import type { View } from '@shared/channels'
import { parsePrLink } from '@shared/prlink'
import {
  LIST_LABELS,
  prKeys,
  useAddWatch,
  useMyPrKeys,
  usePrList,
  useWatchedKeys,
  useWatches,
} from '../../lib/bitbucket'
import { isNotConfigured, useSettings } from '../../lib/devdock'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl } from '../../ui/Field'
import { ago, prLabel } from './PrBits'
import { PrRow } from './PrRow'

type Tab = PrList | 'watched'

/** Once PR actions are on: merge your own PRs, review everyone else's (Watched mixes both). */
const MINE: readonly PrAction[] = ['merge']
const OTHERS: readonly PrAction[] = ['approve', 'needs_work']
const LIST_ACTIONS: Record<PrList, readonly PrAction[]> = {
  mine: MINE,
  reviewing: OTHERS,
  merged: [],
}

/** SPEC 6.3: My PRs, Reviewing, Recently merged, and the Watched list with its paste field. */
export function PrsPage({ onView }: { onView: (v: View) => void }) {
  const settings = useSettings().data
  const [tab, setTab] = useState<Tab>('mine')
  const watches = useWatches().data ?? []
  const watched = useWatchedKeys()
  const mine = useMyPrKeys()
  if (!settings) return null
  const allowed = (pr: PullRequest) => {
    if (!settings.features.prActions || pr.state !== 'open') return []
    if (tab !== 'watched') return LIST_ACTIONS[tab]
    return mine.has(pr.key) ? MINE : OTHERS
  }

  return (
    <div className="prs">
      <WatchField onWatched={() => setTab('watched')} />
      <SegmentedControl
        label="List"
        options={[
          ...PR_LISTS.map((l) => ({ value: l as Tab, label: LIST_LABELS[l] })),
          { value: 'watched' as Tab, label: `Watched (${watches.length})` },
        ]}
        value={tab}
        onValue={setTab}
      />
      {tab === 'watched' ? (
        <WatchedList items={watches} actionsFor={allowed} />
      ) : (
        <PrListView key={tab} list={tab} watched={watched} actionsFor={allowed} onView={onView} />
      )}
    </div>
  )
}

function PrListView({
  list,
  watched,
  actionsFor,
  onView,
}: {
  list: PrList
  watched: ReadonlySet<string>
  actionsFor: (pr: PullRequest) => readonly PrAction[]
  onView: (v: View) => void
}) {
  const qc = useQueryClient()
  const query = usePrList(list)
  const prs = query.data ?? []
  const label = LIST_LABELS[list]

  return (
    <section className="prs-list">
      <div className="row-between">
        <p className="muted" role="status">
          {query.isFetching && !query.isPending ? 'Refreshing…' : ''}
        </p>
        <IconButton
          label="Refresh from Bitbucket"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          disabled={query.isFetching}
          onClick={() => void qc.invalidateQueries({ queryKey: prKeys.list(list) })}
        />
      </div>
      {isNotConfigured(query.error) ? (
        <EmptyState
          icon={<GitPullRequest size={18} aria-hidden="true" />}
          title={query.error.message}
          action={<Button onClick={() => onView('settings')}>Open Settings</Button>}
        />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : query.isPending ? (
        <p className="muted" role="status">
          Loading pull requests from Bitbucket…
        </p>
      ) : prs.length === 0 ? (
        <EmptyState icon={<GitPullRequest size={18} aria-hidden="true" />} title={EMPTY[list]} />
      ) : (
        <ul className="pr-list" aria-label={label}>
          {prs.map((pr) => (
            <PrRow
              key={pr.key}
              pr={pr}
              watchKey={watched.has(pr.key) ? pr.key : undefined}
              actions={actionsFor(pr)}
              showAuthor={list === 'reviewing'}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

const EMPTY: Record<PrList, string> = {
  mine: 'You have no open pull requests.',
  reviewing: 'No pull requests are waiting for your review.',
  merged: 'Nothing of yours was merged in the last 7 days.',
}

function WatchedList({
  items,
  actionsFor,
}: {
  items: WatchItem[]
  actionsFor: (pr: PullRequest) => readonly PrAction[]
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Eye size={18} aria-hidden="true" />}
        title="Nothing watched yet. Paste a pull request link above to get notified when its build, reviews or comments change."
      />
    )
  }
  return (
    <ul className="pr-list" aria-label="Watched pull requests">
      {items.map((w) => (
        <PrRow key={w.key} pr={w.pr} watchKey={w.key} actions={actionsFor(w.pr)} showAuthor>
          {w.error ? (
            // Stored state, not news: no live region (it would re-announce on every refetch).
            <p className="pr-watch-error">{w.error}</p>
          ) : (
            <p className="muted pr-watch-note">
              {isLive(w)
                ? `Watching. Checked ${w.checkedAt ? ago(w.checkedAt) : 'not yet'}.`
                : 'Closed: no longer checked.'}
            </p>
          )}
        </PrRow>
      ))}
    </ul>
  )
}

/** SPEC 6.3 "a Watch field": paste a link, watch it. Checked as you type (same parser as main). */
function WatchField({ onWatched }: { onWatched: () => void }) {
  const [draft, setDraft] = useState('')
  const add = useAddWatch()
  const toast = useToast()
  const trimmed = draft.trim()
  const parsed = trimmed ? parsePrLink(trimmed) : null
  const typed = trimmed && !parsed ? "That isn't a Bitbucket pull request link." : null

  return (
    <form
      className="watch-field"
      onSubmit={(e) => {
        e.preventDefault()
        if (!parsed) return
        add.mutate(trimmed, {
          onSuccess: (item) => {
            toast(`Watching ${prLabel(item.pr)}`)
            setDraft('')
            onWatched()
          },
        })
      }}
    >
      <Field
        label="Watch a pull request"
        hint="Paste its link from Bitbucket. DevDock notifies you when its build, reviews or comments change."
        error={typed}
      >
        {({ id, describedBy }) => (
          <div className="inline-form">
            <Input
              id={id}
              aria-describedby={describedBy}
              value={draft}
              placeholder="https://bitbucket.org/workspace/repo/pull-requests/42"
              spellCheck={false}
              onChange={(e) => {
                setDraft(e.target.value)
                add.reset()
              }}
            />
            <Button type="submit" disabled={!parsed || add.isPending}>
              {add.isPending ? 'Adding…' : 'Watch'}
            </Button>
          </div>
        )}
      </Field>
      {/* Main's refusal (other site, 404, no access) with its hint and Details. */}
      {add.error ? <ErrorNotice error={add.error} /> : null}
    </form>
  )
}
