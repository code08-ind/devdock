import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, Hammer } from 'lucide-react'
import type { View } from '@shared/channels'
import {
  jobLabel,
  sameJob,
  triggerRefusal,
  type BranchBuild,
  type BuildRef,
  type BuildWatch,
} from '@shared/jenkins'
import { parsePrLink } from '@shared/prlink'
import type { Settings } from '@shared/settings'
import { bridge, isNotConfigured, keys, queryClient, unwrap, useSettings } from '../../lib/devdock'
import {
  byLiveFirst,
  jenkinsKeys,
  useAddBuildWatch,
  useBranches,
  useBuildWatches,
  useClearFinished,
  useRemoveBuildWatch,
  useWatchPipeline,
} from '../../lib/jenkins'
import { useAction } from '../../lib/useAction'
import { Button, IconButton } from '../../ui/Button'
import { RefreshButton } from '../../ui/RefreshButton'
import { EmptyState, ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl } from '../../ui/Field'
import { BuildDialog } from './BuildDialog'
import { BuildPill, BuildTimes, WatchHead, watchLabel, watchNote } from './BuildBits'
import { TriggerDialog } from './TriggerDialog'

type Tab = 'mine' | 'watched'

/** Watches that are live, or finished within this long, make Builds open on Watched. */
const RECENT_MS = 15 * 60_000
const isRecent = (w: BuildWatch) =>
  !w.done || (w.checkedAt !== null && Date.now() - w.checkedAt < RECENT_MS)

/** SPEC 6.4: My branches, Watched builds, Watch PR pipeline, triggers and the console tail. */
export function BuildsPage({ onView }: { onView: (v: View) => void }) {
  const settings = useSettings().data
  // Opened to see a watch (a notification, palette `pipeline <link>`): show Watched first.
  const [tab, setTab] = useState<Tab>(() =>
    (queryClient.getQueryData<BuildWatch[]>(keys.buildWatches) ?? []).some(isRecent)
      ? 'watched'
      : 'mine',
  )
  const [open, setOpen] = useState<BuildRef | null>(null)
  const [triggering, setTriggering] = useState<BranchBuild | null>(null)
  const watches = useBuildWatches().data ?? []
  if (!settings) return null

  return (
    <div className="prs">
      <PipelineField onWatched={() => setTab('watched')} />
      <div className="row-between list-head">
        <SegmentedControl
          label="List"
          options={[
            { value: 'mine' as Tab, label: 'My branches' },
            { value: 'watched' as Tab, label: `Watched (${watches.length})` },
          ]}
          value={tab}
          onValue={setTab}
        />
        {tab === 'mine' ? (
          <RefreshButton queryKey={jenkinsKeys.branches} label="Refresh from Jenkins" />
        ) : null}
      </div>
      {tab === 'mine' ? (
        <MyBranches
          settings={settings}
          watches={watches}
          onView={onView}
          onOpen={setOpen}
          onTrigger={setTriggering}
        />
      ) : (
        <WatchedBuilds items={watches} onOpen={setOpen} />
      )}
      {open ? <BuildDialog build={open} onClose={() => setOpen(null)} /> : null}
      {triggering ? <TriggerDialog row={triggering} onClose={() => setTriggering(null)} /> : null}
    </div>
  )
}

function MyBranches({
  settings,
  watches,
  onView,
  onOpen,
  onTrigger,
}: {
  settings: Settings
  watches: BuildWatch[]
  onView: (v: View) => void
  onOpen: (ref: BuildRef) => void
  onTrigger: (row: BranchBuild) => void
}) {
  const query = useBranches()
  const rows = query.data?.builds ?? []
  const skipped = query.data?.skipped ?? []
  const live = watches.filter((w) => !w.done)

  return (
    <section className="prs-list">
      {query.isFetching && !query.isPending ? (
        <p className="muted" role="status">
          Refreshing…
        </p>
      ) : null}
      {skipped.map((s) => (
        <p key={s.job} className="pr-watch-error">
          Couldn't read <span className="mono">{s.job}</span>: {s.message}
        </p>
      ))}
      {isNotConfigured(query.error) ? (
        <EmptyState
          icon={<Hammer size={18} aria-hidden="true" />}
          title={query.error.message}
          action={<Button onClick={() => onView('settings')}>Open Settings</Button>}
        />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : query.isPending ? (
        <p className="muted" role="status">
          Loading builds from Jenkins…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Hammer size={18} aria-hidden="true" />}
          title="None of your branches have Jenkins builds yet. DevDock shows the branches you have locally and the source branches of your open pull requests."
        />
      ) : (
        <ul className="pr-list" aria-label="My branches">
          {rows.map((row) => (
            <BranchRow
              key={row.job}
              row={row}
              watch={live.find((w) => w.kind !== 'deploy' && sameJob(w.job, row.job))}
              deploys={settings.general.demoMode || settings.jenkins.deployJob !== ''}
              triggers={triggerRefusal(row.job, settings) === null}
              onOpen={onOpen}
              onTrigger={onTrigger}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function BranchRow({
  row,
  watch,
  deploys,
  triggers,
  onOpen,
  onTrigger,
}: {
  row: BranchBuild
  /** The live watch on this job, if any. */
  watch: BuildWatch | undefined
  /** A deploy job is set: offer to watch this branch's deploy. */
  deploys: boolean
  /** Triggers are on, the job is allow-listed and not protected. */
  triggers: boolean
  onOpen: (ref: BuildRef) => void
  onTrigger: (row: BranchBuild) => void
}) {
  const { run, pending } = useAction()
  const add = useAddBuildWatch()
  const remove = useRemoveBuildWatch()
  const label = jobLabel(row.job)
  const last = row.lastBuild

  const toggleWatch = () =>
    watch
      ? void run(remove.mutateAsync(watch.key), `Stopped watching ${label}`)
      : void run(
          add.mutateAsync(
            last?.state === 'running'
              ? { kind: 'build', job: row.job, number: last.number }
              : { kind: 'job', job: row.job },
          ),
          last?.state === 'running'
            ? `Watching ${label} #${last.number}`
            : `Watching ${label}: you'll be notified when its next build finishes`,
        )

  return (
    <li className="pr-row">
      <div className="pr-row-head">
        <span className="mono pr-ref">{jobLabel(row.project)}</span>
        <BuildPill build={last} />
        {last ? <span className="muted">#{last.number}</span> : null}
        {watch ? <StatusPill tone="info">Watched</StatusPill> : null}
        <span className="row-actions">
          <IconButton
            label={watch ? `Stop watching ${label}` : `Watch ${label}`}
            icon={
              watch ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />
            }
            disabled={pending}
            onClick={toggleWatch}
          />
          <IconButton
            label={`Open ${label} in Jenkins`}
            icon={<ExternalLink size={16} aria-hidden="true" />}
            onClick={() => void run(unwrap(bridge.app.openExternal({ url: last?.url ?? row.url })))}
          />
        </span>
      </div>
      <h3 className="pr-title mono">{row.branch}</h3>
      <p className="pr-meta">
        {row.kind === 'pr' ? <span>Pull request #{row.prId}</span> : null}
        {last ? <BuildTimes build={last} /> : null}
      </p>
      <div className="button-row">
        {last ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Details and console of ${label} #${last.number}`}
            onClick={() => onOpen({ job: row.job, number: last.number })}
          >
            Details and console
          </Button>
        ) : null}
        {deploys && row.kind === 'branch' ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Watch the deploy of ${row.branch}`}
            onClick={() =>
              void run(
                add.mutateAsync({ kind: 'deploy', branch: row.branch }),
                `Watching the deploy of ${row.branch}`,
              )
            }
          >
            Watch deploy
          </Button>
        ) : null}
        {triggers ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Trigger a build of ${label}`}
            onClick={() => onTrigger(row)}
          >
            Trigger build
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function WatchedBuilds({
  items,
  onOpen,
}: {
  items: BuildWatch[]
  onOpen: (ref: BuildRef) => void
}) {
  const clear = useClearFinished()
  const remove = useRemoveBuildWatch()
  const { run, pending } = useAction()
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Eye size={18} aria-hidden="true" />}
        title="No builds watched. Paste a pull request link above, or watch a branch from My branches, to be notified when its build finishes."
      />
    )
  }
  return (
    <section className="prs-list">
      {items.some((w) => w.done) ? (
        <div className="row-between">
          <span />
          <Button
            size="sm"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() => void run(clear.mutateAsync(), 'Cleared finished builds')}
          >
            Clear finished
          </Button>
        </div>
      ) : null}
      <ul className="pr-list" aria-label="Watched builds">
        {byLiveFirst(items).map((w) => {
          const label = watchLabel(w)
          return (
            <li key={w.key} className="pr-row">
              <div className="pr-row-head">
                <WatchHead watch={w} />
                <span className="row-actions">
                  <IconButton
                    label={`Stop watching ${label}`}
                    icon={<EyeOff size={16} aria-hidden="true" />}
                    disabled={pending}
                    onClick={() => void run(remove.mutateAsync(w.key), `Stopped watching ${label}`)}
                  />
                  {w.build ? (
                    <IconButton
                      label={`Open ${label} in Jenkins`}
                      icon={<ExternalLink size={16} aria-hidden="true" />}
                      onClick={() =>
                        void run(unwrap(bridge.app.openExternal({ url: w.build!.url })))
                      }
                    />
                  ) : null}
                </span>
              </div>
              {w.label ? <p className="pr-meta mono">{w.job}</p> : null}
              {/* Stored state, not news: no live region (it would re-announce on every change). */}
              <p className={w.error ? 'pr-watch-error' : 'muted pr-watch-note'}>{watchNote(w)}</p>
              {w.build ? (
                <div className="button-row">
                  <BuildTimes build={w.build} />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Details and console of ${label} #${w.build.number}`}
                    onClick={() => onOpen({ job: w.job, number: w.build!.number })}
                  >
                    Details and console
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** SPEC 6.4 "Watch PR pipeline": paste a PR link and walk away. */
function PipelineField({ onWatched }: { onWatched: () => void }) {
  const [draft, setDraft] = useState('')
  const watch = useWatchPipeline()
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
        watch.mutate(trimmed, {
          onSuccess: (item) => {
            toast(`Watching ${watchLabel(item)}`)
            setDraft('')
            onWatched()
          },
        })
      }}
    >
      <Field
        label="Watch a pull request's pipeline"
        hint="Paste its Bitbucket link. DevDock finds the Jenkins build that runs it and notifies you when it finishes."
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
                watch.reset()
              }}
            />
            <Button type="submit" disabled={!parsed || watch.isPending}>
              {watch.isPending ? 'Finding…' : 'Watch pipeline'}
            </Button>
          </div>
        )}
      </Field>
      {/* No matching job, another site, no access: main's message with Details. */}
      {watch.error ? <ErrorNotice error={watch.error} /> : null}
    </form>
  )
}
