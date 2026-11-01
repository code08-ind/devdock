import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Code, TriangleAlert } from 'lucide-react'
import type { ActionOutcome, ActionRequest, PlannedCommand } from '@shared/repos'
import type { RepoConfig, UpdateStrategy } from '@shared/settings'
import { bridge, DevDockError, isSetUp, keys, unwrap, useSettings } from '../../lib/devdock'
import { watchBranchBuilds } from '../../lib/jenkins'
import { ACTION_LABELS, forgetRuns, startRun, useOpenRepo, useRunOutput } from '../../lib/repos'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Checkbox, Field, Input, SegmentedControl } from '../../ui/Field'
import { ActivityLog, CommandList } from '../../ui/Run'

type Stage =
  | { kind: 'form' }
  | { kind: 'plan' }
  | { kind: 'running' }
  | { kind: 'done'; outcome: Extract<ActionOutcome, { status: 'done' }> }
  | { kind: 'conflict'; outcome: Extract<ActionOutcome, { status: 'conflict' }> }
  | { kind: 'dirty' }
  | { kind: 'error'; error: unknown }

type Phase =
  | { kind: 'form' }
  | { kind: 'planning' }
  | { kind: 'ready'; commands: PlannedCommand[] }
  | { kind: 'running' }
  | { kind: 'done'; outcome: Extract<ActionOutcome, { status: 'done' }> }
  | { kind: 'conflict'; outcome: Extract<ActionOutcome, { status: 'conflict' }> }
  | { kind: 'dirty' }
  | { kind: 'error'; error: unknown }

const WHAT_IT_DOES: Partial<Record<ActionRequest['action'], (base: string) => string>> = {
  fetchAll: () =>
    'Downloads new commits and branches from every remote. Your files are not changed.',
  syncBase: (b) =>
    `Fast-forwards your local ${b} to origin/${b}. Refuses if that isn't a fast-forward.`,
  updateBranch: (b) =>
    `Brings the latest origin/${b} into your current branch. Stops on conflicts; nothing is resolved for you.`,
  abort: () => 'Stops the merge or rebase and returns the branch to where it was before.',
  syncFork: (b) =>
    `Fast-forwards your local ${b} from upstream/${b}. Pushing to origin is a separate step.`,
  pushBase: (b) =>
    `Pushes ${b} to origin. Never forced: origin rejects it if the histories diverged.`,
  newBranch: (b) => `Creates a branch from a freshly fetched origin/${b} and switches to it.`,
  pushBranch: () => 'Pushes your current branch to origin and sets it as the upstream.',
}

/**
 * Runs one repo action (SPEC 6.2): shows the commands first, streams git output into an
 * activity log, then a result. Handles the follow-ups in place: Stash & continue on a dirty
 * tree, the conflict view with Abort, and the confirmed push after Sync fork.
 */
export function ActionDialog({
  repo,
  initial,
  onClose,
}: {
  repo: RepoConfig
  initial: ActionRequest
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const openRepo = useOpenRepo()
  const settings = useSettings().data
  const savedStrategy = settings?.git.updateStrategy ?? 'merge'
  const workflow = settings?.workflow
  // T5: the push follow-ups start ticked as set in Settings → Workflow; changed here per push.
  const [request, setRequest] = useState<ActionRequest>(() =>
    initial.action === 'updateBranch'
      ? { ...initial, strategy: savedStrategy }
      : initial.action === 'pushBranch' && workflow?.checkBeforePush && repo.checkCommand
        ? { ...initial, check: true }
        : initial,
  )
  const jenkinsOn = settings ? isSetUp(settings, 'jenkins') : false
  const [watchAfter, setWatchAfter] = useState(() => Boolean(workflow?.watchBuildAfterPush))
  /** What the dialog is doing; while planning, the plan query supplies the details. */
  const [stage, setStage] = useState<Stage>(
    initial.action === 'newBranch' ? { kind: 'form' } : { kind: 'plan' },
  )
  const [runIds, setRunIds] = useState<string[]>([])
  const output = useRunOutput(runIds)
  // Free this dialog's streamed output once it closes.
  const runIdsRef = useRef(runIds)
  useEffect(() => {
    runIdsRef.current = runIds
  }, [runIds])
  useEffect(() => () => forgetRuns(runIdsRef.current), [])
  const base = repo.baseBranch

  const planQuery = useQuery({
    queryKey: ['repos', 'plan', repo.id, request],
    queryFn: () => unwrap(bridge.repos.plan({ id: repo.id, request })),
    enabled: stage.kind === 'plan',
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const phase: Phase =
    stage.kind !== 'plan'
      ? stage
      : planQuery.data
        ? { kind: 'ready', commands: planQuery.data }
        : planQuery.error
          ? planQuery.error instanceof DevDockError && planQuery.error.code === 'DIRTY_TREE'
            ? { kind: 'dirty' }
            : { kind: 'error', error: planQuery.error }
          : { kind: 'planning' }

  const plan = (req: ActionRequest) => {
    setRequest(req)
    setStage({ kind: 'plan' })
  }

  const run = async () => {
    setStage({ kind: 'running' })
    const { runId, result } = startRun(repo.id, request)
    setRunIds((ids) => [...ids, runId])
    try {
      const outcome = await result
      if (outcome.status === 'conflict') {
        setStage({ kind: 'conflict', outcome })
        toast(outcome.summary, 'warning')
      } else {
        setStage({ kind: 'done', outcome })
        toast(outcome.summary)
        if (request.action === 'pushBranch' && watchAfter && jenkinsOn && outcome.branch) {
          watchAfterPush(outcome.branch)
        }
      }
    } catch (err) {
      const dirty = err instanceof DevDockError && err.code === 'DIRTY_TREE'
      setStage(dirty ? { kind: 'dirty' } : { kind: 'error', error: err })
      // Result toast for failures too (the dialog shows the details).
      toast(
        dirty
          ? 'Not updated: you have uncommitted changes.'
          : err instanceof Error
            ? err.message
            : String(err),
        dirty ? 'warning' : 'danger',
      )
    } finally {
      void qc.invalidateQueries({ queryKey: keys.repoStatus(repo.id) })
    }
  }

  /** Runs on after the dialog closes: a new branch's Jenkins job can take a scan to appear. */
  const watchAfterPush = (branch: string) =>
    void watchBranchBuilds(branch).then(
      (labels) =>
        labels.length
          ? toast(`Watching ${labels.join(', ')}: you'll be notified when the build finishes`)
          : toast(
              `Jenkins has no job for ${branch} yet. Watch it from Builds once Jenkins has picked the branch up.`,
              'warning',
            ),
      (err: unknown) => toast(err instanceof Error ? err.message : String(err), 'danger'),
    )

  const running = phase.kind === 'running' || phase.kind === 'planning'
  const label = ACTION_LABELS[request.action]
  const title = request.action === 'pushBase' ? `Push ${base} to origin` : `${label} — ${repo.name}`

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      wide
      dismissible={phase.kind !== 'running'}
      actions={
        <>
          <Button onClick={onClose} disabled={phase.kind === 'running'}>
            {phase.kind === 'done' || phase.kind === 'error' ? 'Close' : 'Cancel'}
          </Button>
          {phase.kind === 'ready' ? (
            <Button
              variant={
                request.action === 'abort' || request.action === 'pushBase' ? 'danger' : 'primary'
              }
              onClick={() => void run()}
            >
              {request.action === 'pushBase' ? `Push ${base}` : label}
            </Button>
          ) : null}
          {phase.kind === 'done' && phase.outcome.pushable ? (
            <Button variant="primary" onClick={() => plan({ action: 'pushBase', confirmed: true })}>
              Review push to origin…
            </Button>
          ) : null}
        </>
      }
    >
      {WHAT_IT_DOES[request.action] ? <p>{WHAT_IT_DOES[request.action]!(base)}</p> : null}

      {phase.kind === 'form' && request.action === 'newBranch' ? (
        <NewBranchForm initial={request} onSubmit={plan} onCancel={onClose} />
      ) : null}

      {request.action === 'updateBranch' && (phase.kind === 'ready' || phase.kind === 'dirty') ? (
        <SegmentedControl<UpdateStrategy>
          label="How to bring in the changes"
          options={[
            { value: 'merge', label: 'Merge' },
            { value: 'rebase', label: 'Rebase' },
          ]}
          value={request.strategy}
          onValue={(strategy) => plan({ ...request, strategy })}
        />
      ) : null}

      {request.action === 'pushBranch' && phase.kind === 'ready' ? (
        <PushOptions
          request={request}
          checkCommand={repo.checkCommand}
          checkWanted={Boolean(workflow?.checkBeforePush)}
          onCheck={(check) => plan({ ...request, check })}
          jenkinsOn={jenkinsOn}
          watchAfter={watchAfter}
          onWatchAfter={setWatchAfter}
        />
      ) : null}

      {phase.kind === 'ready' ? <CommandList commands={phase.commands} /> : null}
      {phase.kind === 'ready' && request.action === 'pushBase' ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <p>
            This changes origin: it publishes your local {base} to origin/{base}. Nothing is forced.
          </p>
        </div>
      ) : null}

      {phase.kind === 'dirty' && request.action === 'updateBranch' ? (
        <div className="notice notice-warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="stack">
            <p>
              You have uncommitted changes. Commit them first, or stash them: DevDock puts them
              away, updates the branch, then puts them back.
            </p>
            <div>
              <Button onClick={() => plan({ ...request, stash: true })}>
                Stash &amp; continue…
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {phase.kind === 'conflict' ? (
        <ConflictView
          outcome={phase.outcome}
          onOpenEditor={() => void openRepo(repo.id, 'editor')}
          onAbort={() => plan({ action: 'abort' })}
        />
      ) : null}

      {phase.kind === 'done' ? (
        <StatusPill tone="success">{phase.outcome.summary}</StatusPill>
      ) : null}
      {phase.kind === 'error' ? <ErrorNotice error={phase.error} /> : null}

      {runIds.length > 0 || running ? <ActivityLog text={output} /> : null}
    </Dialog>
  )
}

/** T5: run the check first; watch the branch's Jenkins build afterwards. */
function PushOptions({
  request,
  checkCommand,
  checkWanted,
  onCheck,
  jenkinsOn,
  watchAfter,
  onWatchAfter,
}: {
  request: Extract<ActionRequest, { action: 'pushBranch' }>
  checkCommand: string
  checkWanted: boolean
  onCheck: (check: boolean) => void
  jenkinsOn: boolean
  watchAfter: boolean
  onWatchAfter: (watch: boolean) => void
}) {
  return (
    <div className="stack">
      {checkCommand ? (
        <Checkbox
          label={`Run the check first (${checkCommand}): push only if it passes`}
          checked={Boolean(request.check)}
          onChecked={onCheck}
        />
      ) : checkWanted ? (
        <p className="muted">
          This repo has no check command yet: add one in its settings to run it before pushing.
        </p>
      ) : null}
      {jenkinsOn ? (
        <Checkbox
          label="Watch the Jenkins build after pushing"
          checked={watchAfter}
          onChecked={onWatchAfter}
        />
      ) : null}
    </div>
  )
}

function ConflictView({
  outcome,
  onOpenEditor,
  onAbort,
}: {
  outcome: Extract<ActionOutcome, { status: 'conflict' }>
  onOpenEditor: () => void
  onAbort: () => void
}) {
  return (
    <section className="conflict" aria-label="Conflicts">
      <div role="alert">
        <StatusPill tone="danger">{outcome.summary}</StatusPill>
      </div>
      <p>
        Resolve these files in your editor and finish the {outcome.operation} there, or abort to go
        back to where you were.
        {outcome.stashed ? ' Your stashed changes are put back after an abort.' : ''}
      </p>
      <ul className="conflict-files mono">
        {outcome.files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="button-row">
        <Button
          variant="primary"
          icon={<Code size={16} aria-hidden="true" />}
          onClick={onOpenEditor}
        >
          Open in VS Code
        </Button>
        {outcome.operation !== 'stash' ? (
          <Button variant="danger" onClick={onAbort}>
            Abort {outcome.operation}…
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function NewBranchForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: Extract<ActionRequest, { action: 'newBranch' }>
  onSubmit: (req: Extract<ActionRequest, { action: 'newBranch' }>) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState(initial.kind)
  const [key, setKey] = useState(initial.key ?? '')
  const [title, setTitle] = useState(initial.title)
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ action: 'newBranch', kind, key: key.trim() || undefined, title })
      }}
    >
      <SegmentedControl
        label="Type"
        options={[
          { value: 'feature', label: 'Feature' },
          { value: 'bugfix', label: 'Bugfix' },
        ]}
        value={kind}
        onValue={setKind}
      />
      <div className="field-row">
        <Field label="Ticket key" hint="Optional, e.g. NM-1234">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="mono input-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>
        <Field label="Title" hint="Becomes the slug: ASCII, kebab-case, 50 characters at most.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="button-row">
        <Button type="submit" variant="primary" disabled={!key.trim() && !title.trim()}>
          Preview branch
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
