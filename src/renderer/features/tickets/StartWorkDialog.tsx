import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import type { View } from '@shared/channels'
import type { JiraIssueDetail } from '@shared/jira'
import type { Agent, StartWorkResult } from '@shared/startwork'
import { AGENT_CLIS, MAX_AGENT_PROMPT } from '@shared/agents'
import {
  bridge,
  DevDockError,
  keys,
  unwrap,
  useSettings,
  useUpdateSettings,
} from '../../lib/devdock'
import { BRIEF_LOCATION_OPTIONS, jiraKeys } from '../../lib/jira'
import { forgetRuns, useOpenDevdockTerminal, useRepos, useRunOutput } from '../../lib/repos'
import { usePreferredAgent } from '../../lib/agents'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Checkbox, Field, SegmentedControl, Select } from '../../ui/Field'
import { CodeBlock, KeyValue } from '../../ui/Text'
import { ActivityLog, CommandList } from '../../ui/Run'

const AGENT_WHY: Record<Agent, string> = {
  'bug-fixer': 'It is a bug.',
  'spec-writer': 'The acceptance criteria need writing before building.',
  'feature-builder': 'It has acceptance criteria to build from.',
}

const TRANSITION_TEXT: Record<StartWorkResult['transition']['result'], string | null> = {
  off: null,
  declined: 'Left the Jira status as it was.',
  done: 'Moved to In Progress in Jira.',
  already: 'Already In Progress in Jira.',
  unavailable: null, // reported as a warning
  failed: null, // reported as a warning
}

type Stage =
  | { kind: 'preview' }
  | { kind: 'running'; runId: string }
  | { kind: 'done'; runId: string; result: StartWorkResult }
  | { kind: 'error'; runId: string; error: unknown }

/**
 * SPEC 6.5 Start work: pick a repo, review what will happen (branch, commands, brief location
 * and .gitignore warning, agent, message, transition), then run and show the result.
 */
export function StartWorkDialog({
  issue,
  onClose,
  onView,
}: {
  issue: JiraIssueDetail
  onClose: () => void
  onView: (v: View) => void
}) {
  const repos = useRepos()
  const settings = useSettings().data
  const updateSettings = useUpdateSettings()
  const toast = useToast()
  const agentCli = usePreferredAgent()
  const openTerminal = useOpenDevdockTerminal()
  const qc = useQueryClient()
  const [pickedRepo, setRepoId] = useState(repos[0]?.id ?? '')
  // A repo removed while the dialog is open falls back to the first one.
  const repoId = repos.some((r) => r.id === pickedRepo) ? pickedRepo : (repos[0]?.id ?? '')
  const workflow = settings?.workflow
  const [openEditor, setOpenEditor] = useState(workflow?.openEditorAfterStart ?? true)
  const [startServer, setStartServer] = useState(workflow?.startDevServerAfterStart ?? false)
  const hasDevCommand = (repos.find((r) => r.id === repoId)?.devCommand ?? '') !== ''
  // This run's lessons lines (P6-F), from Settings → Workflow; the preview follows them.
  const [lessons, setLessons] = useState({
    read: workflow?.pointAgentToLessons ?? true,
    add: workflow?.askAgentForLessons ?? true,
  })
  const [confirmTransition, setConfirmTransition] = useState(true)
  const [stage, setStage] = useState<Stage>({ kind: 'preview' })
  const runId = stage.kind === 'preview' ? null : stage.runId
  const output = useRunOutput(runId ? [runId] : [])
  // Every run this dialog started (also ones left behind by "Review again"), freed on close.
  const allRuns = useRef<string[]>([])
  useEffect(() => () => forgetRuns(allRuns.current), [])

  const location = settings?.features.briefLocation ?? 'repo'
  const plan = useQuery({
    queryKey: jiraKeys.startWorkPlan(issue.key, repoId, location, lessons),
    queryFn: () => unwrap(bridge.startwork.plan({ key: issue.key, repoId, lessons })),
    enabled: stage.kind === 'preview' && repoId !== '',
    staleTime: 0,
    gcTime: 0,
  })

  const start = async () => {
    if (!plan.data) return
    const id = crypto.randomUUID()
    allRuns.current.push(id)
    setStage({ kind: 'running', runId: id })
    try {
      const result = await unwrap(
        bridge.startwork.run({
          key: issue.key,
          repoId,
          runId: id,
          openEditor,
          lessons,
          agent: plan.data.agent,
          confirmTransition: plan.data.transitionEnabled && confirmTransition,
        }),
      )
      setStage({ kind: 'done', runId: id, result })
      // Settings → Workflow: the branch exists, so the dev server runs on it.
      if (startServer && hasDevCommand) {
        void unwrap(bridge.devserver.start({ id: repoId, kind: 'dev' })).catch((err: unknown) =>
          toast(
            `The branch is ready, but the dev server didn't start (${err instanceof Error ? err.message : 'unknown error'}). Start it from Repos.`,
            'warning',
          ),
        )
      }
      const copied = !result.warnings.some((w) => w.includes('clipboard'))
      toast(
        copied
          ? `Started work on ${issue.key}. The agent message is on the clipboard.`
          : `Started work on ${issue.key}, but the message couldn't be copied: copy it from the dialog.`,
        result.warnings.length ? 'warning' : 'success',
      )
    } catch (error) {
      setStage({ kind: 'error', runId: id, error })
      toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      void qc.invalidateQueries({ queryKey: keys.repoStatus(repoId) })
    }
  }

  const changedSincePreview =
    stage.kind === 'error' &&
    stage.error instanceof DevDockError &&
    stage.error.code === 'PRECONDITION_FAILED'
  const busy = stage.kind === 'running'

  return (
    <Dialog
      open
      wide
      title={`Start work on ${issue.key}`}
      onClose={onClose}
      dismissible={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {stage.kind === 'done' || stage.kind === 'error' ? 'Close' : 'Cancel'}
          </Button>
          {stage.kind === 'preview' && plan.data ? (
            <Button variant="primary" onClick={() => void start()}>
              {/* The click is the confirmation, so it says exactly what will happen (SPEC 7). */}
              {plan.data.transitionEnabled && confirmTransition
                ? 'Start work and move to In Progress'
                : 'Start work'}
            </Button>
          ) : null}
          {stage.kind === 'done' && agentCli ? (
            <Button
              variant="primary"
              onClick={() => {
                const prompt = stage.result.message
                const fits = prompt.length <= MAX_AGENT_PROMPT
                openTerminal(repoId, { id: agentCli.id, prompt: fits ? prompt : undefined })
                if (!fits) {
                  toast(
                    `The message is too long to hand to ${agentCli.name}: paste it from the clipboard.`,
                    'warning',
                  )
                }
                onClose()
              }}
            >
              Start {agentCli.name} now
            </Button>
          ) : null}
          {changedSincePreview ? (
            <Button variant="primary" onClick={() => setStage({ kind: 'preview' })}>
              Review again
            </Button>
          ) : null}
        </>
      }
    >
      <p>{issue.summary}</p>

      {repos.length === 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="stack">
            <p>Add the repo you work in first; Start work creates the branch there.</p>
            <div>
              <Button onClick={() => onView('repos')}>Go to Repos</Button>
            </div>
          </div>
        </div>
      ) : null}

      {stage.kind === 'preview' && repos.length > 0 ? (
        <>
          <Field label="Repo">
            {({ id }) => (
              <Select
                id={id}
                options={repos.map((r) => ({ value: r.id, label: r.name }))}
                value={repoId}
                onValue={setRepoId}
              />
            )}
          </Field>
          {plan.error ? <ErrorNotice error={plan.error} /> : null}
          {plan.isPending && repoId ? (
            <p className="muted" role="status">
              Checking the repo…
            </p>
          ) : null}
          {plan.data ? (
            <>
              <KeyValue
                items={[
                  [
                    'Agent',
                    <span key="a">
                      <strong>{plan.data.agent}</strong>{' '}
                      <span className="muted">{AGENT_WHY[plan.data.agent]}</span>
                    </span>,
                  ],
                  [
                    'Branch',
                    <span key="b" className="mono">
                      {plan.data.branch}
                    </span>,
                  ],
                  [
                    'Ticket brief',
                    <span key="p" className="mono">
                      {plan.data.briefPath}
                    </span>,
                  ],
                ]}
              />
              <CommandList commands={plan.data.commands} />
              <div>
                <SegmentedControl
                  label="Where to write TICKET.md"
                  options={BRIEF_LOCATION_OPTIONS}
                  value={location}
                  onValue={(briefLocation) =>
                    updateSettings.mutate({ features: { briefLocation } })
                  }
                />
                <p className="muted field-hint">
                  Changing this also changes the default in Settings → Jira.
                </p>
              </div>
              {plan.data.briefWouldBeCommitted ? (
                <div className="notice notice-warning" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <p>
                    docs/ai/specs isn&apos;t ignored by git in this repo, so TICKET.md (a copy of
                    the ticket) would show up in your next commit. Add <code>docs/ai/specs/</code>{' '}
                    to .gitignore, or write briefs to DevDock&apos;s data folder.
                  </p>
                </div>
              ) : null}
              <CodeBlock code={plan.data.message} label="Will be copied to the clipboard" />
              <div className="checks">
                {/* Lessons (P6-F): the message above follows these; defaults in Settings → Workflow. */}
                <Checkbox
                  label="Tell the agent to read the repo's lessons (once it has a lessons file)"
                  checked={lessons.read}
                  onChecked={(read) => setLessons({ ...lessons, read })}
                />
                <Checkbox
                  label="Ask the agent to add what it learned"
                  checked={lessons.add}
                  onChecked={(add) => setLessons({ ...lessons, add })}
                />
                <Checkbox
                  label="Open the repo in VS Code afterwards"
                  checked={openEditor}
                  onChecked={setOpenEditor}
                />
                <Checkbox
                  label={
                    hasDevCommand
                      ? 'Start the dev server afterwards'
                      : 'Start the dev server afterwards (set a dev command in the repo settings)'
                  }
                  checked={startServer && hasDevCommand}
                  disabled={!hasDevCommand}
                  onChecked={setStartServer}
                />
                {plan.data.transitionEnabled ? (
                  <Checkbox
                    label={`Move ${issue.key} to In Progress in Jira (if the workflow allows it)`}
                    checked={confirmTransition}
                    onChecked={setConfirmTransition}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {stage.kind === 'done' ? (
        <Result result={stage.result} agentFound={agentCli !== null} />
      ) : null}
      {stage.kind === 'error' ? <ErrorNotice error={stage.error} /> : null}
      {stage.kind !== 'preview' ? <ActivityLog text={output} /> : null}
    </Dialog>
  )
}

/** "Claude Code, Codex, Gemini CLI or GitHub Copilot CLI" (follows AGENT_CLIS). */
const AGENT_NAMES = AGENT_CLIS.map((a) => a.name)
  .join(', ')
  .replace(/, ([^,]*)$/, ' or $1')

function Result({ result, agentFound }: { result: StartWorkResult; agentFound: boolean }) {
  const transition = TRANSITION_TEXT[result.transition.result]
  return (
    <div className="stack">
      <div role="status">
        <StatusPill tone="success">Started work on {result.branch}</StatusPill>
      </div>
      <KeyValue
        items={[
          [
            'Branch',
            <span key="b" className="mono">
              {result.branch}
            </span>,
          ],
          [
            'Ticket brief',
            <span key="f" className="mono">
              {result.briefFile}
            </span>,
          ],
          ['Agent', result.agent],
          ...(transition ? [['Jira', transition] as [string, string]] : []),
        ]}
      />
      <CodeBlock code={result.message} label="On the clipboard: paste it into your agent" />
      {agentFound ? null : (
        <p className="muted">
          With {AGENT_NAMES} installed, DevDock can start it here in the repo with this message.
        </p>
      )}
      {result.warnings.map((w) => (
        <div key={w} className="notice notice-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <p>{w}</p>
        </div>
      ))}
    </div>
  )
}
