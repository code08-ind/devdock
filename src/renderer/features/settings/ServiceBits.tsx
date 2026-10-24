import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PlugZap } from 'lucide-react'
import { Button } from '../../ui/Button'
import { ErrorNotice, StatusPill } from '../../ui/Feedback'
import { Field, Input, Textarea } from '../../ui/Field'

/** Pieces shared by the service sections (Jira, Bitbucket; Jenkins in P4). */

/** A text setting with its own Save (a draft, so typing doesn't save each keystroke). */
export function TextSetting({
  label,
  hint,
  value,
  onSave,
  multiline = false,
  inputMode,
  validate,
  extra,
}: {
  label: string
  hint?: string
  value: string
  onSave: (v: string) => void
  multiline?: boolean
  inputMode?: 'numeric'
  /** An error message for the draft, or null when it can be saved. */
  validate?: (draft: string) => string | null
  /** More buttons beside Save, given the draft (e.g. Bitbucket's Detect probes what is typed). */
  extra?: (draft: string) => ReactNode
}) {
  const [draft, setDraft] = useState(value)
  // Follow changes made elsewhere (import, Clear all data, the other window): otherwise a stale
  // draft could be saved back over them.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value)
  }
  const error = validate?.(draft.trim()) ?? null
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!error) onSave(draft.trim())
          }}
        >
          {multiline ? (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              mono
              rows={2}
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={draft}
              inputMode={inputMode}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <Button type="submit" disabled={draft.trim() === value || error !== null}>
            Save
          </Button>
          {extra?.(draft.trim())}
        </form>
      )}
    </Field>
  )
}

/** A service's connection result: the HTTP status and who the credentials signed in as. */
export interface Connection {
  status: number
  user: { displayName: string; account: string | null }
}

/** SPEC 6.7 "Test connection (shows the HTTP status, the user it authenticated as, and a hint)". */
export function TestConnection({
  demo,
  test: run,
}: {
  demo: boolean
  test: () => Promise<Connection>
}) {
  const test = useMutation({ mutationFn: run })
  return (
    <div className="stack">
      <div className="button-row">
        <Button
          icon={<PlugZap size={16} aria-hidden="true" />}
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        {demo ? <span className="muted">Demo mode is on: this tests the demo site.</span> : null}
      </div>
      {test.isPending ? (
        <p className="muted" role="status">
          Connecting…
        </p>
      ) : null}
      {test.data ? (
        <div role="status">
          <StatusPill tone="success">
            Connected (HTTP {test.data.status}) as {test.data.user.displayName}
            {test.data.user.account ? ` (${test.data.user.account})` : ''}
          </StatusPill>
        </div>
      ) : null}
      {test.error ? <ErrorNotice error={test.error} /> : null}
    </div>
  )
}
