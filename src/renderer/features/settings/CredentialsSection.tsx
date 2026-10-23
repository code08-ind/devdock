import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { SECRET_KEYS, type SecretKey } from '@shared/ipc'
import { bridge, keys, unwrap } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill } from '../../ui/Feedback'
import { Field, Input } from '../../ui/Field'
import { Section } from './Section'

const SECRET_LABELS: Record<SecretKey, string> = {
  'bitbucket.token': 'Bitbucket access token',
  'jenkins.token': 'Jenkins API token',
  'jira.token': 'Jira API token or personal access token',
}

function SecretRow({
  secretKey,
  saved,
  disabled,
}: {
  secretKey: SecretKey
  saved: boolean
  disabled: boolean
}) {
  const qc = useQueryClient()
  const { run, pending } = useAction()
  const [value, setValue] = useState('')
  const [confirm, setConfirm] = useState(false)
  const label = SECRET_LABELS[secretKey]
  const refresh = () => qc.invalidateQueries({ queryKey: keys.secrets })

  const save = async () => {
    const r = await run(unwrap(bridge.secrets.set({ key: secretKey, value })), `${label} saved`)
    // On failure keep what was pasted so the user can retry.
    if (!r.ok) return
    setValue('')
    await refresh()
  }

  return (
    <div className="secret-row">
      <Field
        label={label}
        hint={saved ? 'Saved and encrypted. Enter a new value to replace it.' : undefined}
      >
        {({ id, describedBy }) => (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (value) void save()
            }}
          >
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={saved ? '••••••••' : 'Paste token'}
              value={value}
              disabled={disabled}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" disabled={disabled || pending || !value}>
              Save
            </Button>
            {saved ? (
              <Button variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
                Remove
              </Button>
            ) : null}
          </form>
        )}
      </Field>
      {saved ? (
        <StatusPill tone="success">Saved</StatusPill>
      ) : (
        <StatusPill tone="neutral">Not set</StatusPill>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Remove ${label}?`}
        body={<p>DevDock deletes the stored token. You can paste it again later.</p>}
        confirmLabel="Remove token"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          void run(unwrap(bridge.secrets.delete({ key: secretKey })), `${label} removed`).then(
            refresh,
          )
        }
      />
    </div>
  )
}

/** Tokens go in, never come back out: the renderer only learns which keys are set. */
export function CredentialsSection() {
  const status = useQuery({
    queryKey: keys.secretsStatus,
    queryFn: () => unwrap(bridge.secrets.status()),
  })
  const available = status.data?.available ?? false
  const list = useQuery({
    queryKey: keys.secrets,
    queryFn: () => unwrap(bridge.secrets.list()),
    enabled: available,
  })
  const saved = new Set(list.data ?? [])

  return (
    <Section
      id="credentials"
      title="Credentials"
      description={
        status.data?.available
          ? `Encrypted with ${status.data.backend}. Tokens never leave this computer's DevDock process.`
          : undefined
      }
    >
      {status.data && !status.data.available ? (
        <div className="notice notice-warning" role="alert">
          <KeyRound size={16} aria-hidden="true" />
          <p>{status.data.reason}</p>
        </div>
      ) : null}
      {status.error ? <ErrorNotice error={status.error} /> : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {SECRET_KEYS.map((k) => (
        <SecretRow key={k} secretKey={k} saved={saved.has(k)} disabled={!available} />
      ))}
    </Section>
  )
}
