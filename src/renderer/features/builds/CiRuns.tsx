import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, ExternalLink, Workflow } from 'lucide-react'
import type { View } from '@shared/channels'
import {
  CI_ACTION_COPY,
  CI_ACTIONS,
  ciActionAllowed,
  ciRunLabel,
  type CiAction,
  type CiJob,
  type CiRun,
  type CiRunRef,
  type CiState,
  type CiWatch,
} from '@shared/ci'
import { PROVIDER_NAMES, type CiProvider } from '@shared/providers'
import { bridge, isNotConfigured, unwrap, useSettings } from '../../lib/devdock'
import {
  useAddCiWatch,
  useCiAction,
  useCiLog,
  useCiRun,
  useCiRuns,
  useClearFinishedRuns,
  useRemoveCiWatch,
} from '../../lib/providers'
import { useAction } from '../../lib/useAction'
import { Button, IconButton } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { EmptyState, ErrorNotice, StatusPill, useToast, type Tone } from '../../ui/Feedback'
import { Field, Select } from '../../ui/Field'
import { ago } from '../prs/PrBits'
import { duration } from './BuildBits'

/** P7.05 / P7.06: GitHub Actions runs and GitLab pipelines in the Builds view. */

const STATE: Record<CiState, [Tone, string]> = {
  success: ['success', 'Passed'],
  failed: ['danger', 'Failed'],
  cancelled: ['neutral', 'Cancelled'],
  skipped: ['neutral', 'Skipped'],
  running: ['info', 'Running'],
  queued: ['neutral', 'Queued'],
  manual: ['warning', 'Waiting for someone'],
}

export function CiStatePill({ state }: { state: CiState }) {
  const [tone, text] = STATE[state]
  return <StatusPill tone={tone}>{text}</StatusPill>
}

/** What each provider calls one run. */
export const RUN_NOUN: Record<CiProvider, string> = { github: 'run', gitlab: 'pipeline' }
export const CI_TAB_LABEL: Record<CiProvider, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab pipelines',
}

/** "Started 5 min ago, took 2 min 50 s". */
function RunTimes({ run }: { run: CiRun }) {
  const started = run.startedAt ? `Started ${ago(run.startedAt)}` : null
  const length = run.durationMs !== null ? `took ${duration(run.durationMs)}` : null
  const text = [started, length].filter(Boolean).join(', ')
  return text ? <span className="muted">{text}</span> : null
}

/** A CI action someone picked: confirmed in `CiActionDialog` before anything is sent. */
export interface CiActing {
  run: CiRun
  action: CiAction
}

/** The actions the switch allows for this run now (none while CI actions are off). */
function useRunActions(run: CiRun): CiAction[] {
  const on = useSettings().data?.features.ciActions ?? false
  return on ? CI_ACTIONS.filter((a) => ciActionAllowed(a, run.state)) : []
}

function RunActions({ run, onAct }: { run: CiRun; onAct: (a: CiActing) => void }) {
  const actions = useRunActions(run)
  const label = ciRunLabel(run)
  return actions.map((action) => (
    <Button
      key={action}
      size="sm"
      variant={action === 'cancel' ? 'ghost' : 'secondary'}
      aria-label={`${CI_ACTION_COPY[run.ref.provider][action]}: ${label}`}
      onClick={() => onAct({ run, action })}
    >
      {CI_ACTION_COPY[run.ref.provider][action]}…
    </Button>
  ))
}

/** My recent runs on the registered repos hosted on this provider. */
export function CiRunsList({
  provider,
  watches,
  onView,
  onOpen,
  onAct,
}: {
  provider: CiProvider
  watches: CiWatch[]
  onView: (v: View) => void
  onOpen: (ref: CiRunRef) => void
  onAct: (a: CiActing) => void
}) {
  const query = useCiRuns(provider)
  const runs = query.data?.runs ?? []
  const name = PROVIDER_NAMES[provider]

  return (
    <section className="prs-list">
      {query.isFetching && !query.isPending ? (
        <p className="muted" role="status">
          Refreshing…
        </p>
      ) : null}
      {(query.data?.notes ?? []).map((n) => (
        <p key={n} className="pr-watch-error">
          {n}
        </p>
      ))}
      {isNotConfigured(query.error) ? (
        <EmptyState
          icon={<Workflow size={18} aria-hidden="true" />}
          title={query.error.message}
          action={<Button onClick={() => onView('settings')}>Open Settings</Button>}
        />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : query.isPending ? (
        <p className="muted" role="status">
          Loading {CI_TAB_LABEL[provider]}…
        </p>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Workflow size={18} aria-hidden="true" />}
          title={
            query.data?.projects.length
              ? `No ${RUN_NOUN[provider]}s of yours yet on ${query.data.projects.join(', ')}.`
              : `None of your repos is on ${name}. Add a repo whose remote is there in Repos.`
          }
        />
      ) : (
        <ul className="pr-list" aria-label={CI_TAB_LABEL[provider]}>
          {runs.map((run) => (
            <CiRunRow
              key={run.key}
              run={run}
              watch={watches.find((w) => w.key === run.key)}
              onOpen={onOpen}
              onAct={onAct}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CiRunRow({
  run,
  watch,
  onOpen,
  onAct,
}: {
  run: CiRun
  watch: CiWatch | undefined
  onOpen: (ref: CiRunRef) => void
  onAct: (a: CiActing) => void
}) {
  const { run: act, pending } = useAction()
  const add = useAddCiWatch()
  const remove = useRemoveCiWatch()
  const label = ciRunLabel(run)
  const site = PROVIDER_NAMES[run.ref.provider]

  return (
    <li className="pr-row">
      <div className="pr-row-head">
        <span className="mono pr-ref">{label}</span>
        <CiStatePill state={run.state} />
        {run.attempt > 1 ? <span className="muted">attempt {run.attempt}</span> : null}
        {watch ? <StatusPill tone="info">Watched</StatusPill> : null}
        <span className="row-actions">
          <IconButton
            label={watch ? `Stop watching ${label}` : `Watch ${label}`}
            icon={
              watch ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />
            }
            disabled={pending}
            onClick={() =>
              void (watch
                ? act(remove.mutateAsync(watch.key), `Stopped watching ${label}`)
                : act(add.mutateAsync({ ref: run.ref }), `Watching ${label}`))
            }
          />
          <IconButton
            label={`Open ${label} in ${site}`}
            icon={<ExternalLink size={16} aria-hidden="true" />}
            onClick={() => void act(unwrap(bridge.app.openExternal({ url: run.url })))}
          />
        </span>
      </div>
      {/* GitLab's pipeline list has no commit title; the label already names it. */}
      {run.title ? <h3 className="pr-title">{run.title}</h3> : null}
      <p className="pr-meta">
        {run.branch ? <span className="mono pr-branches">{run.branch}</span> : null}
        <span className="muted">{run.event.replaceAll('_', ' ')}</span>
        <RunTimes run={run} />
      </p>
      <div className="button-row">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Jobs and log of ${label}`}
          onClick={() => onOpen(run.ref)}
        >
          Jobs and log
        </Button>
        <RunActions run={run} onAct={onAct} />
      </div>
    </li>
  )
}

/** Watched runs (under Builds → Watched, after the Jenkins ones). */
export function CiWatchedList({
  items,
  onOpen,
  onAct,
}: {
  items: CiWatch[]
  onOpen: (ref: CiRunRef) => void
  onAct: (a: CiActing) => void
}) {
  const clear = useClearFinishedRuns()
  const remove = useRemoveCiWatch()
  const { run, pending } = useAction()
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done))
  return (
    <section className="prs-list">
      {items.some((w) => w.done) ? (
        <div className="row-between">
          <span />
          <Button
            size="sm"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() => void run(clear.mutateAsync(), 'Cleared finished runs')}
          >
            Clear finished runs
          </Button>
        </div>
      ) : null}
      <ul className="pr-list" aria-label="Watched runs">
        {sorted.map((w) => {
          const label = ciRunLabel(w.run)
          return (
            <li key={w.key} className="pr-row">
              <div className="pr-row-head">
                <span className="mono pr-ref">{label}</span>
                <CiStatePill state={w.run.state} />
                <span className="muted">{PROVIDER_NAMES[w.ref.provider]}</span>
                <span className="row-actions">
                  <IconButton
                    label={`Stop watching ${label}`}
                    icon={<EyeOff size={16} aria-hidden="true" />}
                    disabled={pending}
                    onClick={() => void run(remove.mutateAsync(w.key), `Stopped watching ${label}`)}
                  />
                  <IconButton
                    label={`Open ${label} in ${PROVIDER_NAMES[w.ref.provider]}`}
                    icon={<ExternalLink size={16} aria-hidden="true" />}
                    onClick={() => void run(unwrap(bridge.app.openExternal({ url: w.run.url })))}
                  />
                </span>
              </div>
              {w.run.branch ? <p className="pr-meta mono">{w.run.branch}</p> : null}
              {/* Stored state, not news: no live region (it would re-announce on every change). */}
              <p className={w.error ? 'pr-watch-error' : 'muted pr-watch-note'}>
                {w.error ??
                  (w.done
                    ? 'Finished: no longer checked.'
                    : `Watching: you'll be notified when it finishes.${w.checkedAt ? ` Checked ${ago(w.checkedAt)}.` : ''}`)}
              </p>
              <div className="button-row">
                <RunTimes run={w.run} />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Jobs and log of ${label}`}
                  onClick={() => onOpen(w.ref)}
                >
                  Jobs and log
                </Button>
                <RunActions run={w.run} onAct={onAct} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const going = (s: CiState) => s === 'running' || s === 'queued'

/** The job whose log opens first: the first failed one, else the running one, else the last. */
function firstJob(jobs: CiJob[]): number | null {
  return (
    jobs.find((j) => j.state === 'failed')?.id ??
    jobs.find((j) => going(j.state))?.id ??
    jobs.at(-1)?.id ??
    null
  )
}

/** One run: state, jobs (GitHub steps, GitLab stages), the end of a job's log, actions. */
export function RunDialog({
  runRef,
  onClose,
  onAct,
}: {
  runRef: CiRunRef
  onClose: () => void
  onAct: (a: CiActing) => void
}) {
  const query = useCiRun(runRef)
  const { run } = useAction()
  const detail = query.data
  const [picked, setPicked] = useState<number | null>(null)
  const jobId = picked ?? (detail ? firstJob(detail.jobs) : null)
  const job = detail?.jobs.find((j) => j.id === jobId)
  const site = PROVIDER_NAMES[runRef.provider]
  const ciActionsOn = useSettings().data?.features.ciActions ?? false

  return (
    <Dialog
      open
      wide
      title={detail ? ciRunLabel(detail.run) : `${runRef.project} ${RUN_NOUN[runRef.provider]}`}
      onClose={onClose}
      actions={
        <>
          {detail ? (
            <>
              <RunActions
                run={detail.run}
                onAct={(a) => {
                  onClose()
                  onAct(a)
                }}
              />
              <Button
                icon={<ExternalLink size={16} aria-hidden="true" />}
                onClick={() => void run(unwrap(bridge.app.openExternal({ url: detail.run.url })))}
              >
                Open in {site}
              </Button>
            </>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {query.error ? <ErrorNotice error={query.error} /> : null}
      {detail ? (
        <>
          <p className="build-head">
            <CiStatePill state={detail.run.state} />
            <RunTimes run={detail.run} />
          </p>
          <p className="pr-meta">
            {detail.run.branch ? (
              <span className="mono pr-branches">{detail.run.branch}</span>
            ) : null}
            {detail.run.title ? <span>{detail.run.title}</span> : null}
          </p>
          {!ciActionsOn && ciActionAllowed('retry', detail.run.state) ? (
            <p className="muted">
              {CI_ACTION_COPY[runRef.provider].retry} is off: turn on CI actions in Settings if your
              role permits.
            </p>
          ) : null}
          {detail.jobs.length === 0 ? (
            <p className="muted">No jobs yet.</p>
          ) : (
            <ol className="stage-list" aria-label="Jobs">
              {detail.jobs.map((j) => (
                <li key={j.id} className="stage">
                  <span className="stage-name">
                    {j.stage ? <span className="muted">{j.stage} · </span> : null}
                    {j.name}
                  </span>
                  <CiStatePill state={j.state} />
                  {j.durationMs !== null ? (
                    <span className="muted">{duration(j.durationMs)}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {job && job.steps.length ? (
            <details className="ci-steps">
              <summary>Steps of {job.name}</summary>
              <ol className="stage-list" aria-label={`Steps of ${job.name}`}>
                {job.steps.map((s) => (
                  <li key={s.number} className="stage">
                    <span className="stage-name">{s.name}</span>
                    <CiStatePill state={s.state} />
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {detail.jobs.length ? (
            <Field label="Log of job">
              {({ id }) => (
                <Select
                  id={id}
                  options={detail.jobs.map((j) => ({
                    value: j.id,
                    label: j.stage ? `${j.stage} / ${j.name}` : j.name,
                  }))}
                  value={jobId ?? detail.jobs[0]!.id}
                  onValue={setPicked}
                />
              )}
            </Field>
          ) : null}
          {jobId !== null ? (
            <JobLog runRef={runRef} jobId={jobId} running={job ? going(job.state) : false} />
          ) : null}
        </>
      ) : query.isPending ? (
        <p className="muted" role="status">
          Loading the {RUN_NOUN[runRef.provider]} from {site}…
        </p>
      ) : null}
    </Dialog>
  )
}

function JobLog({ runRef, jobId, running }: { runRef: CiRunRef; jobId: number; running: boolean }) {
  const log = useCiLog(runRef, jobId, running)
  const pre = useRef<HTMLPreElement>(null)
  const toast = useToast()
  useEffect(() => {
    // The end of a log is what says why it failed: start there.
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [log.data?.text])
  const text = log.data?.text ?? ''
  return (
    <div className="console stack">
      <div className="console-bar">
        <span className="muted" role="status">
          {log.isPending
            ? 'Loading the log…'
            : running
              ? 'Following the job…'
              : log.data?.truncated
                ? 'Showing the end of a long log.'
                : 'Job log.'}
        </span>
        <Button
          size="sm"
          disabled={!text}
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast('Log copied'),
              () => toast('Could not copy the log'),
            )
          }
        >
          Copy
        </Button>
      </div>
      <pre
        ref={pre}
        className="activity-log console-log mono"
        role="log"
        aria-live="off"
        aria-label="Job log"
        // A scrollable region must be reachable by keyboard (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        {text || (log.isPending ? '' : 'No output.')}
      </pre>
      {log.error ? <ErrorNotice error={log.error} /> : null}
    </div>
  )
}

/**
 * Re-run / retry / cancel, confirmed every time (owner decision P7): names the run and says
 * exactly what will happen; the server's refusal is shown here.
 */
export function CiActionDialog({ acting, onClose }: { acting: CiActing; onClose: () => void }) {
  const act = useCiAction()
  const toast = useToast()
  const { run, action } = acting
  const copy = CI_ACTION_COPY[run.ref.provider][action]
  const label = ciRunLabel(run)
  const site = PROVIDER_NAMES[run.ref.provider]
  const explain =
    action === 'retry'
      ? `DevDock asks ${site} to run the failed jobs of ${label} again, as you. Jobs that passed keep their results.`
      : `DevDock asks ${site} to stop ${label}, as you. Jobs still running are cancelled.`

  return (
    <Dialog
      open
      title={`${copy}: ${label}?`}
      onClose={onClose}
      dismissible={!act.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={act.isPending}>
            Cancel
          </Button>
          <Button
            variant={action === 'cancel' ? 'danger' : 'primary'}
            disabled={act.isPending}
            onClick={() =>
              act.mutate(
                { ref: run.ref, action, confirmed: true },
                {
                  onSuccess: () => {
                    toast(action === 'retry' ? `Started again: ${label}` : `Cancelled ${label}`)
                    onClose()
                  },
                },
              )
            }
          >
            {act.isPending ? 'Sending…' : copy}
          </Button>
        </>
      }
    >
      <p>
        <strong>{run.title ?? run.name}</strong>
      </p>
      {run.branch ? <p className="mono pr-branches">{run.branch}</p> : null}
      <p>{explain}</p>
      {act.error ? <ErrorNotice error={act.error} /> : null}
    </Dialog>
  )
}

/** A watched run, short (Today, the menu-bar panel); `actions` on the right. */
export function WatchedRunRow({ watch: w, actions }: { watch: CiWatch; actions?: ReactNode }) {
  return (
    <li className="pr-row">
      <div className="pr-row-head">
        <span className="mono pr-ref">{ciRunLabel(w.run)}</span>
        <CiStatePill state={w.run.state} />
        {actions ? <span className="row-actions">{actions}</span> : null}
      </div>
      <p className={w.error ? 'pr-watch-error' : 'muted pr-watch-note'}>
        {w.error ??
          (w.done
            ? 'Finished: no longer checked.'
            : "Watching: you'll be notified when it finishes.")}
      </p>
    </li>
  )
}
