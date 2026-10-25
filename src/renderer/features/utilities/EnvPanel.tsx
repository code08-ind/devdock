import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ENV_FILE, ProfileNameSchema, type EnvDiffRow } from '@shared/envprofiles'
import { bridge, unwrap } from '../../lib/devdock'
import { useEnvAction, useEnvState } from '../../lib/utilities'
import { useAction } from '../../lib/useAction'
import { ago } from '../prs/PrBits'
import { Button, IconButton } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast, type Tone } from '../../ui/Feedback'
import { Field, Input, Select } from '../../ui/Field'

/**
 * SPEC 6.6 Env profiles for one repo: the current `.env.local` (keys, values masked, revealed one
 * at a time), save it as a named profile, switch between profiles (a backup is kept), undo the
 * last switch, and a key-names-only diff.
 */
export function EnvPanel({ repoId }: { repoId: string }) {
  const state = useEnvState(repoId)
  const toast = useToast()
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<
    | { kind: 'switch' | 'delete'; name: string }
    | { kind: 'restore' }
    | { kind: 'replace'; name: string }
    | null
  >(null)
  const act = useEnvAction(repoId, (job: () => Promise<unknown>) => job())
  const done = (message: string) => ({
    onSuccess: () => toast(message),
    onSettled: () => setConfirm(null),
  })
  const nameError =
    name.trim() && !ProfileNameSchema.safeParse(name).success
      ? 'Use letters, digits, ".", "_" or "-" (e.g. dev-api).'
      : null
  const save = (replace: boolean) => {
    const saved = name.trim()
    act.mutate(() => unwrap(bridge.envprofiles.save({ id: repoId, name: saved, replace })), {
      onSuccess: () => {
        toast(`Saved ${ENV_FILE} as ${saved}`)
        setName('')
      },
    })
  }

  if (state.error) return <ErrorNotice error={state.error} />
  if (!state.data)
    return (
      <p className="muted" role="status">
        Reading {ENV_FILE}…
      </p>
    )
  const { current, profiles, backups } = state.data
  const names = profiles.map((p) => p.name)

  return (
    <section className="stack" aria-label="Env profiles">
      <h3 className="field-label">
        {ENV_FILE} now{' '}
        {current.matches ? <StatusPill tone="success">Same as {current.matches}</StatusPill> : null}
      </h3>
      {current.exists ? (
        <EnvValues key={state.dataUpdatedAt} repoId={repoId} profile={null} keys={current.keys} />
      ) : (
        <p className="muted">This repo has no {ENV_FILE}.</p>
      )}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || nameError) return
          if (names.includes(name.trim())) setConfirm({ kind: 'replace', name: name.trim() })
          else save(false)
        }}
      >
        <Field label={`Save ${ENV_FILE} as a profile`} error={nameError}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              placeholder="dev-api"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          disabled={!current.exists || !name.trim() || !!nameError || act.isPending}
        >
          Save profile
        </Button>
      </form>

      {profiles.length ? (
        <ul className="pr-list" aria-label="Env profiles">
          {profiles.map((p) => (
            <li key={p.name} className="pr-row">
              <div className="pr-row-head">
                <span className="mono pr-ref">{p.name}</span>
                <span className="muted">
                  {p.keys.length} key{p.keys.length === 1 ? '' : 's'}, saved {ago(p.savedAt)}
                </span>
                <span className="spacer" />
                <Button
                  size="sm"
                  disabled={act.isPending || current.matches === p.name}
                  aria-label={`Switch ${ENV_FILE} to ${p.name}`}
                  onClick={() => setConfirm({ kind: 'switch', name: p.name })}
                >
                  Switch to this
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  aria-label={`Delete profile ${p.name}`}
                  onClick={() => setConfirm({ kind: 'delete', name: p.name })}
                >
                  Delete
                </Button>
              </div>
              <EnvValues repoId={repoId} profile={p.name} keys={p.keys} collapsed />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No saved profiles yet. Save the current file to start.</p>
      )}

      {backups.length ? (
        <div className="button-row">
          <Button disabled={act.isPending} onClick={() => setConfirm({ kind: 'restore' })}>
            Undo last switch
          </Button>
          <span className="muted">
            {backups.length} backup{backups.length === 1 ? '' : 's'} kept, newest{' '}
            {ago(backups[0]!.at)}
          </span>
        </div>
      ) : null}

      {profiles.length + (current.exists ? 1 : 0) >= 2 ? (
        <EnvDiff repoId={repoId} names={names} hasCurrent={current.exists} />
      ) : null}
      {act.error ? <ErrorNotice error={act.error} /> : null}

      <ConfirmDialog
        open={confirm?.kind === 'switch'}
        title={`Switch ${ENV_FILE} to ${confirm?.kind === 'switch' ? confirm.name : ''}?`}
        body={
          <p>
            DevDock replaces this repo's {ENV_FILE} with the saved profile and keeps a backup of the
            current file (Undo last switch puts it back). Restart the dev server to pick it up.
          </p>
        }
        confirmLabel="Switch"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== 'switch') return
          const target = confirm.name
          act.mutate(
            () => unwrap(bridge.envprofiles.switch({ id: repoId, name: target, confirmed: true })),
            done(`${ENV_FILE} switched to ${target}`),
          )
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'restore'}
        title="Undo the last switch?"
        body={
          <p>
            DevDock puts back {ENV_FILE} as it was before the last switch. The file as it is now is
            kept as a backup, so you can swap back.
          </p>
        }
        confirmLabel="Undo last switch"
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          act.mutate(
            () => unwrap(bridge.envprofiles.restore({ id: repoId, confirmed: true })),
            done(`${ENV_FILE} restored`),
          )
        }
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title={`Delete profile ${confirm?.kind === 'delete' ? confirm.name : ''}?`}
        body={<p>Its saved copy is deleted from DevDock. {ENV_FILE} itself isn't changed.</p>}
        confirmLabel="Delete profile"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== 'delete') return
          const target = confirm.name
          act.mutate(
            () => unwrap(bridge.envprofiles.delete({ id: repoId, name: target, confirmed: true })),
            done(`Deleted profile ${target}`),
          )
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'replace'}
        title={`Replace profile ${confirm?.kind === 'replace' ? confirm.name : ''}?`}
        body={<p>The saved profile of that name is overwritten with {ENV_FILE} as it is now.</p>}
        confirmLabel="Replace profile"
        onClose={() => setConfirm(null)}
        onConfirm={() => save(true)}
      />
    </section>
  )
}

/** Keys with masked values; Reveal fetches one value from the main process. */
function EnvValues({
  repoId,
  profile,
  keys,
  collapsed = false,
}: {
  repoId: string
  profile: string | null
  keys: string[]
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  const [shown, setShown] = useState<Record<string, string>>({})
  const { run } = useAction()
  const where = profile ?? ENV_FILE
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Show keys
        </Button>
      </div>
    )
  }
  return (
    <div className="stack">
      {collapsed ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false)
              setShown({}) // revealed values don't outlive the list
            }}
          >
            Hide keys
          </Button>
        </div>
      ) : null}
      <dl className="kv env-values" aria-label={`Keys in ${where}`}>
        {keys.map((key) => (
          <div key={key} className="kv-row">
            <dt className="mono">{key}</dt>
            <dd className="env-value">
              <span className="mono">{key in shown ? shown[key] || '(empty)' : '••••••••'}</span>
              <IconButton
                label={key in shown ? `Hide ${key}` : `Reveal ${key} in ${where}`}
                icon={
                  key in shown ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )
                }
                onClick={() => {
                  if (key in shown) {
                    setShown(({ [key]: _, ...rest }) => rest)
                    return
                  }
                  void run(unwrap(bridge.envprofiles.reveal({ id: repoId, profile, key }))).then(
                    (r) => {
                      if (r.ok) setShown((s) => ({ ...s, [key]: r.value }))
                    },
                  )
                }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const CHANGE: Record<EnvDiffRow['change'], [Tone, string]> = {
  added: ['success', 'Added'],
  removed: ['danger', 'Removed'],
  changed: ['warning', 'Changed'],
  same: ['neutral', 'Same'],
}

/** Two sources (a profile or the current file), compared by key names only. */
function EnvDiff({
  repoId,
  names,
  hasCurrent,
}: {
  repoId: string
  names: string[]
  hasCurrent: boolean
}) {
  // Not a valid profile name (it starts with a dot), so it can't collide with one.
  const CURRENT = ENV_FILE
  const options = [
    ...(hasCurrent ? [{ value: CURRENT, label: `${ENV_FILE} now` }] : []),
    ...names.map((n) => ({ value: n, label: n })),
  ]
  const [first, setA] = useState(options[0]!.value)
  const a = options.some((o) => o.value === first) ? first : options[0]!.value
  const [picked, setB] = useState(options[1]!.value)
  // A profile deleted while picked falls back to the second option.
  const b = options.some((o) => o.value === picked) ? picked : options[1]!.value
  const [rows, setRows] = useState<EnvDiffRow[] | null>(null)
  const { run, pending } = useAction()
  const src = (v: string) => (v === CURRENT ? null : v)
  return (
    <div className="stack">
      <h3 className="field-label">Compare (key names only)</h3>
      <div className="inline-form">
        <Select
          aria-label="From"
          options={options}
          value={a}
          onValue={(v) => {
            setA(v)
            setRows(null)
          }}
        />
        <Select
          aria-label="To"
          options={options}
          value={b}
          onValue={(v) => {
            setB(v)
            setRows(null)
          }}
        />
        <Button
          disabled={pending || a === b}
          onClick={() =>
            void run(unwrap(bridge.envprofiles.diff({ id: repoId, a: src(a), b: src(b) }))).then(
              (r) => r.ok && setRows(r.value),
            )
          }
        >
          Compare
        </Button>
      </div>
      {rows ? (
        rows.every((r) => r.change === 'same') ? (
          <p className="muted">Same keys and values.</p>
        ) : (
          <ul className="stage-list" aria-label="Differences">
            {rows
              .filter((r) => r.change !== 'same')
              .map((r) => (
                <li key={r.key} className="stage">
                  <span className="stage-name mono">{r.key}</span>
                  <StatusPill tone={CHANGE[r.change][0]}>{CHANGE[r.change][1]}</StatusPill>
                </li>
              ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
