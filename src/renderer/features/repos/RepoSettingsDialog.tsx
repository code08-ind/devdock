import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { RepoPatch } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { bridge, unwrap } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { ConfirmDialog, Dialog } from '../../ui/Dialog'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, Textarea } from '../../ui/Field'

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Per-repo settings (SPEC 6.7 "Repos"): base branch, templates, protected patterns, dev command. */
export function RepoSettingsDialog({ repo, onClose }: { repo: RepoConfig; onClose: () => void }) {
  const toast = useToast()
  const { run } = useAction()
  const [draft, setDraft] = useState({
    name: repo.name,
    baseBranch: repo.baseBranch,
    feature: repo.branchTemplates.feature,
    bugfix: repo.branchTemplates.bugfix,
    protectedPatterns: repo.protectedPatterns.join('\n'),
    devCommand: repo.devCommand,
    checkCommand: repo.checkCommand,
  })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: (patch: RepoPatch) => unwrap(bridge.repos.update({ id: repo.id, patch })),
    onSuccess: () => {
      toast(`${draft.name} settings saved`)
      onClose()
    },
  })

  const submit = () =>
    save.mutate({
      name: draft.name,
      baseBranch: draft.baseBranch,
      branchTemplates: { feature: draft.feature, bugfix: draft.bugfix },
      protectedPatterns: lines(draft.protectedPatterns),
      devCommand: draft.devCommand,
      checkCommand: draft.checkCommand,
    })

  return (
    <Dialog
      open
      wide
      title={`${repo.name} settings`}
      onClose={onClose}
      actions={
        <>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>
            Remove from DevDock…
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            Save settings
          </Button>
        </>
      }
    >
      <p className="muted mono">{repo.path}</p>
      <div className="field-row">
        <Field label="Name">
          {({ id }) => <Input id={id} value={draft.name} onChange={set('name')} />}
        </Field>
        <Field label="Base branch" hint="Sync base and Update my branch use origin/<base>.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="mono"
              value={draft.baseBranch}
              onChange={set('baseBranch')}
            />
          )}
        </Field>
      </div>
      <div className="field-row">
        <Field label="Feature branch template" hint="{KEY} = ticket key, {slug} = title">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="mono"
              value={draft.feature}
              onChange={set('feature')}
            />
          )}
        </Field>
        <Field label="Bugfix branch template">
          {({ id }) => (
            <Input id={id} className="mono" value={draft.bugfix} onChange={set('bugfix')} />
          )}
        </Field>
      </div>
      <Field
        label="Protected branches"
        hint="One pattern per line; Push branch refuses these. * matches within one folder, ** across folders."
      >
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            mono
            rows={4}
            value={draft.protectedPatterns}
            onChange={set('protectedPatterns')}
          />
        )}
      </Field>
      <Field label="Dev server command" hint="Used by Start dev server.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            className="mono"
            value={draft.devCommand}
            onChange={set('devCommand')}
          />
        )}
      </Field>
      <Field
        label="Check command"
        hint="Optional, e.g. npm test. Push branch can run it first and pushes only if it passes (Settings → Workflow)."
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            className="mono"
            value={draft.checkCommand}
            placeholder="npm test"
            onChange={set('checkCommand')}
          />
        )}
      </Field>
      {save.error ? <ErrorNotice error={save.error} /> : null}

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${repo.name} from DevDock?`}
        body={<p>DevDock forgets this repo. The folder and its files are not touched.</p>}
        confirmLabel="Remove repo"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          void run(unwrap(bridge.repos.remove({ id: repo.id })), `${repo.name} removed`).then(
            (r) => r.ok && onClose(),
          )
        }
      />
    </Dialog>
  )
}
