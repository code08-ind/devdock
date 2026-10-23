import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlugZap, Trash2 } from 'lucide-react'
import { DEFAULT_JQL, type JiraFlavor } from '@shared/jira'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useUpdateSettings } from '../../lib/devdock'
import { BRIEF_LOCATION_OPTIONS, jiraKeys } from '../../lib/jira'
import { Button, IconButton } from '../../ui/Button'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl, Textarea, Toggle } from '../../ui/Field'
import { Section } from './Section'

const FLAVORS: { value: JiraFlavor; label: string }[] = [
  { value: 'cloud', label: 'Jira Cloud' },
  { value: 'datacenter', label: 'Jira Data Center' },
]

/** SPEC 6.5 / 6.7: site, auth, lists, Start work switches, and Test connection. */
export function JiraSection({ settings }: { settings: Settings }) {
  const jira = settings.jira
  const update = useUpdateSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const save = (patch: Partial<Settings['jira']>, done: string, onSaved?: () => void) =>
    update.mutate(
      { jira: patch },
      {
        onSuccess: () => {
          toast(done)
          onSaved?.()
          void qc.invalidateQueries({ queryKey: jiraKeys.all })
        },
      },
    )

  return (
    <Section
      id="jira"
      title="Jira"
      description={
        jira.flavor === 'cloud'
          ? 'Jira Cloud signs in with your account email and an API token (Credentials below).'
          : 'Jira Data Center signs in with a personal access token (Credentials below).'
      }
    >
      <SegmentedControl
        label="Site type"
        options={FLAVORS}
        value={jira.flavor}
        onValue={(flavor) => save({ flavor }, 'Site type saved')}
      />
      <TextSetting
        label="Site URL"
        hint={
          jira.flavor === 'cloud'
            ? 'e.g. https://your-team.atlassian.net'
            : 'e.g. https://jira.example.com (include a context path like /jira if your site has one)'
        }
        value={jira.baseUrl}
        onSave={(baseUrl) => save({ baseUrl }, 'Site URL saved')}
      />
      {jira.flavor === 'cloud' ? (
        <TextSetting
          label="Account email"
          value={jira.email}
          onSave={(email) => save({ email }, 'Account email saved')}
        />
      ) : null}
      <TestConnection
        // A new site/flavour/email makes an old result meaningless: start over.
        key={`${jira.flavor}|${jira.baseUrl}|${jira.email}`}
        demo={settings.general.demoMode}
      />

      <TextSetting
        label="My open issues (JQL)"
        hint={`Default: ${DEFAULT_JQL}`}
        value={jira.jql}
        multiline
        onSave={(jql) => save({ jql: jql || DEFAULT_JQL }, 'Query saved')}
      />
      <TextSetting
        label="Board id for Current sprint"
        hint="The number in your board's URL (…/boards/42). Leave empty to hide Current sprint."
        value={jira.boardId === null ? '' : String(jira.boardId)}
        inputMode="numeric"
        validate={(v) => (v && !/^\d{1,9}$/.test(v) ? 'Use the board number, e.g. 42.' : null)}
        onSave={(v) => save({ boardId: v ? Number(v) : null }, 'Board saved')}
      />
      <SavedQueries
        queries={jira.savedQueries}
        onChange={(savedQueries, done, onSaved) => save({ savedQueries }, done, onSaved)}
      />

      <Toggle
        label="Move the issue to In Progress on Start work"
        description="Off by default. When on, Start work asks you to confirm each time."
        checked={settings.features.jiraTransition}
        onChecked={(jiraTransition) => update.mutate({ features: { jiraTransition } })}
      />
      <SegmentedControl
        label="Where Start work writes TICKET.md"
        options={BRIEF_LOCATION_OPTIONS}
        value={settings.features.briefLocation}
        onValue={(briefLocation) => update.mutate({ features: { briefLocation } })}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

function TextSetting({
  label,
  hint,
  value,
  onSave,
  multiline = false,
  inputMode,
  validate,
}: {
  label: string
  hint?: string
  value: string
  onSave: (v: string) => void
  multiline?: boolean
  inputMode?: 'numeric'
  /** An error message for the draft, or null when it can be saved. */
  validate?: (draft: string) => string | null
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
        </form>
      )}
    </Field>
  )
}

function TestConnection({ demo }: { demo: boolean }) {
  const test = useMutation({ mutationFn: () => unwrap(bridge.jira.testConnection()) })
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

function SavedQueries({
  queries,
  onChange,
}: {
  queries: Settings['jira']['savedQueries']
  onChange: (next: Settings['jira']['savedQueries'], done: string, onSaved?: () => void) => void
}) {
  const [name, setName] = useState('')
  const [jql, setJql] = useState('')
  const taken = queries.some((q) => q.name === name.trim())
  return (
    <fieldset className="saved-queries">
      <legend className="field-label">Saved queries</legend>
      {queries.length === 0 ? (
        <p className="muted field-hint">None yet. Each one becomes a list in Tickets.</p>
      ) : (
        <ul className="list">
          {queries.map((q) => (
            <li key={q.name} className="list-row">
              <div>
                <strong>{q.name}</strong>
                <p className="mono muted">{q.jql}</p>
              </div>
              <IconButton
                label={`Remove ${q.name}`}
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={() =>
                  onChange(
                    queries.filter((x) => x.name !== q.name),
                    `Removed ${q.name}`,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault()
          // Cleared only once saved, so a rejected query keeps what was typed.
          onChange(
            [...queries, { name: name.trim(), jql: jql.trim() }],
            `Saved ${name.trim()}`,
            () => {
              setName('')
              setJql('')
            },
          )
        }}
      >
        <Field label="Name" error={taken ? 'A saved query has this name already.' : null}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="JQL">
          {({ id }) => (
            <Input
              id={id}
              className="mono"
              value={jql}
              spellCheck={false}
              onChange={(e) => setJql(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={!name.trim() || !jql.trim() || taken}>
          Add query
        </Button>
      </form>
    </fieldset>
  )
}
