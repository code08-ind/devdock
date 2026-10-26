import { useState } from 'react'
import { Eye, GitPullRequest } from 'lucide-react'
import {
  PR_LISTS,
  isLive,
  providerOf,
  type PrAction,
  type PrList,
  type PullRequest,
  type WatchItem,
} from '@shared/bitbucket'
import type { View } from '@shared/channels'
import { parseAnyPrLink } from '@shared/prlink'
import { PROVIDER_NAMES, providerList, type Provider } from '@shared/providers'
import { enabledProviders } from '@shared/settings'
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
import { Button } from '../../ui/Button'
import { RefreshButton } from '../../ui/RefreshButton'
import { EmptyState, ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl, Select } from '../../ui/Field'
import { ProviderFailures, ago, prLabel } from './PrBits'
import { LIST_ACTIONS, MINE, OTHERS, offered } from './actions'
import { PrRow } from './PrRow'

type Tab = PrList | 'watched'

/** SPEC 6.3: My PRs, Reviewing, Recently merged, and the Watched list with its paste field. */
export function PrsPage({ onView }: { onView: (v: View) => void }) {
  const settings = useSettings().data
  const [tab, setTab] = useState<Tab>('mine')
  const [only, setOnly] = useState<Provider | 'all'>('all')
  const watches = useWatches().data ?? []
  const watched = useWatchedKeys()
  const mine = useMyPrKeys()
  if (!settings) return null
  const providers = enabledProviders(settings)
  const allowed = (pr: PullRequest) => {
    if (!settings.features.prActions || pr.state !== 'open') return []
    if (tab !== 'watched') return offered(pr, LIST_ACTIONS[tab])
    return offered(pr, mine.has(pr.key) ? MINE : OTHERS)
  }
  const shown = only !== 'all' && providers.includes(only) ? only : 'all'

  return (
    <div className="prs">
      <WatchField providers={providers} onWatched={() => setTab('watched')} />
      <div className="row-between list-head">
        <SegmentedControl
          label="List"
          options={[
            ...PR_LISTS.map((l) => ({ value: l as Tab, label: LIST_LABELS[l] })),
            { value: 'watched' as Tab, label: `Watched (${watches.length})` },
          ]}
          value={tab}
          onValue={setTab}
        />
        <span className="row-actions">
          {providers.length > 1 ? (
            // P7.04: one list across providers; narrow it to one when there are several.
            <Select
              aria-label="Provider"
              options={[
                { value: 'all' as const, label: 'All providers' },
                ...providers.map((p) => ({ value: p, label: PROVIDER_NAMES[p] })),
              ]}
              value={shown}
              onValue={setOnly}
            />
          ) : null}
          {tab === 'watched' ? null : (
            // Beside the list switcher (as in Tickets), not on a row of its own.
            <RefreshButton
              queryKey={prKeys.list(tab)}
              label={`Refresh from ${providerList(providers)}`}
            />
          )}
        </span>
      </div>
      {tab === 'watched' ? (
        <WatchedList
          items={watches.filter((w) => shown === 'all' || providerOf(w.ref) === shown)}
          actionsFor={allowed}
        />
      ) : (
        <PrListView
          key={tab}
          list={tab}
          only={shown}
          watched={watched}
          actionsFor={allowed}
          onView={onView}
        />
      )}
    </div>
  )
}

function PrListView({
  list,
  only,
  watched,
  actionsFor,
  onView,
}: {
  list: PrList
  only: Provider | 'all'
  watched: ReadonlySet<string>
  actionsFor: (pr: PullRequest) => readonly PrAction[]
  onView: (v: View) => void
}) {
  const query = usePrList(list)
  const prs = (query.data ?? []).filter((pr) => only === 'all' || providerOf(pr.ref) === only)
  const label = LIST_LABELS[list]

  return (
    <section className="prs-list">
      {query.isFetching && !query.isPending ? (
        <p className="muted" role="status">
          Refreshing…
        </p>
      ) : null}
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
          Loading pull requests…
        </p>
      ) : (
        <>
          <ProviderFailures failures={query.failures} />
          {prs.length === 0 ? (
            <EmptyState
              icon={<GitPullRequest size={18} aria-hidden="true" />}
              title={EMPTY[list]}
            />
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
        </>
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
function WatchField({
  providers,
  onWatched,
}: {
  providers: readonly Provider[]
  onWatched: () => void
}) {
  const from = providerList(providers.length ? providers : ['bitbucket'])
  const [draft, setDraft] = useState('')
  const add = useAddWatch()
  const toast = useToast()
  const trimmed = draft.trim()
  const parsed = trimmed ? parseAnyPrLink(trimmed) : null
  const typed = trimmed && !parsed ? `That isn't a pull request link from ${from}.` : null

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
        hint={`Paste its link from ${from}. DevDock notifies you when its build, reviews or comments change.`}
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
