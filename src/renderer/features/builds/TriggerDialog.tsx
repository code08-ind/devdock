import { useState, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import { jobLabel, type BranchBuild, type ParameterDefinition } from '@shared/jenkins'
import { useAddBuildWatch, useParameters, useTrigger } from '../../lib/jenkins'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Checkbox, Field, Input, Select, Textarea } from '../../ui/Field'
import { KeyValue } from '../../ui/Text'

/**
 * SPEC 6.4 "Trigger build / build with parameters": the confirmation lists the job, the branch
 * and every parameter as it will be sent. Password parameters are left to their Jenkins
 * defaults: DevDock never asks for or sends secrets for a build.
 */
export function TriggerDialog({ row, onClose }: { row: BranchBuild; onClose: () => void }) {
  const params = useParameters(row.job)
  const trigger = useTrigger()
  const watch = useAddBuildWatch()
  const { run } = useAction()
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const editable = (params.data ?? []).filter((p) => p.type !== 'password')
  // A choice shows (and sends) its default only when it is one of the choices.
  const valueOf = (p: ParameterDefinition) =>
    values[p.name] ??
    (p.type === 'choice' && p.choices.length && !p.choices.includes(p.defaultValue)
      ? p.choices[0]!
      : p.defaultValue)
  const sent = Object.fromEntries(editable.map((p) => [p.name, valueOf(p)]))
  const label = jobLabel(row.job)

  const submit = () =>
    trigger.mutate(
      { job: row.job, parameters: sent, confirmed: true },
      {
        // Queued: close at once (a second click must not queue another), then watch the
        // build that starts next — not one already running. A failed watch is its own toast.
        onSuccess: () => {
          toast(`Build queued for ${label}`)
          onClose()
          void run(
            watch.mutateAsync({ kind: 'job', job: row.job, next: true }),
            `Watching ${label}: you'll be notified when the build finishes`,
          )
        },
      },
    )

  return (
    <Dialog
      open
      title={`Trigger a build of ${label}?`}
      onClose={onClose}
      dismissible={!trigger.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={trigger.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Play size={16} aria-hidden="true" />}
            disabled={trigger.isPending || params.isPending || !!params.error}
            onClick={submit}
          >
            {trigger.isPending ? 'Queuing…' : 'Trigger build'}
          </Button>
        </>
      }
    >
      <p>Jenkins runs this job as you. DevDock watches the build and notifies you when it ends.</p>
      <KeyValue
        items={[
          ['Job', <span className="mono">{row.job}</span>],
          ['Branch', <span className="mono">{row.branch}</span>],
          ...Object.entries(sent).map(([k, v]): [string, ReactNode] => [
            k,
            <span className="mono">{v === '' ? '(empty)' : v}</span>,
          ]),
        ]}
      />
      {params.isPending ? (
        <p className="muted" role="status">
          Reading the job's parameters…
        </p>
      ) : null}
      {params.error ? <ErrorNotice error={params.error} /> : null}
      {editable.map((p) => (
        <ParameterField
          key={p.name}
          def={p}
          value={valueOf(p)}
          onValue={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
        />
      ))}
      {(params.data ?? []).some((p) => p.type === 'password') ? (
        <p className="muted">Password parameters keep their Jenkins defaults.</p>
      ) : null}
      {trigger.error ? <ErrorNotice error={trigger.error} /> : null}
    </Dialog>
  )
}

function ParameterField({
  def,
  value,
  onValue,
}: {
  def: ParameterDefinition
  value: string
  onValue: (v: string) => void
}) {
  if (def.type === 'boolean') {
    return (
      <Checkbox label={def.name} checked={value === 'true'} onChecked={(c) => onValue(String(c))} />
    )
  }
  return (
    <Field label={def.name} hint={def.description || undefined}>
      {({ id, describedBy }) =>
        def.type === 'choice' && def.choices.length ? (
          <Select
            id={id}
            aria-describedby={describedBy}
            options={def.choices.map((c) => ({ value: c, label: c }))}
            value={value}
            onValue={onValue}
          />
        ) : def.type === 'text' ? (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            mono
            rows={3}
            value={value}
            onChange={(e) => onValue(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            aria-describedby={describedBy}
            className="mono"
            value={value}
            spellCheck={false}
            onChange={(e) => onValue(e.target.value)}
          />
        )
      }
    </Field>
  )
}
