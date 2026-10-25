import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FolderOpen, Upload } from 'lucide-react'
import type { Settings } from '@shared/settings'
import { bridge, keys, unwrap, useUpdateSettings, DevDockError } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { ConfirmDialog, Dialog } from '../../ui/Dialog'
import { ErrorDetails, ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Textarea } from '../../ui/Field'
import { CodeBlock } from '../../ui/Text'
import { Section } from './Section'

function LinksField({ hosts }: { hosts: string[] }) {
  const update = useUpdateSettings()
  const [draft, setDraft] = useState(hosts.join('\n'))
  const parsed = draft
    .split('\n')
    .map((h) => h.trim())
    .filter(Boolean)
  const unchanged = parsed.join('\n') === hosts.join('\n')
  return (
    <Field
      label="Links DevDock may open in your browser"
      hint="One host per line. Subdomains are included, e.g. atlassian.net covers team.atlassian.net."
      error={update.error ? update.error.message : null}
    >
      {({ id, describedBy }) => (
        <div className="stack">
          <Textarea
            id={id}
            aria-describedby={describedBy}
            mono
            rows={4}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <ErrorDetails error={update.error} />
          <div>
            <Button
              disabled={unchanged || update.isPending}
              onClick={() => update.mutate({ links: { allowedHosts: parsed } })}
            >
              Save links
            </Button>
          </div>
        </div>
      )}
    </Field>
  )
}

function ImportExport() {
  const qc = useQueryClient()
  const { run, pending } = useAction()
  const toast = useToast()
  const [exported, setExported] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [json, setJson] = useState('')
  // A mutation (not useAction) so the error shows inside the dialog, next to the JSON.
  const importer = useMutation({
    mutationFn: (text: string) => unwrap(bridge.settings.import({ json: text })),
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s)
      setImporting(false)
      setJson('')
      toast('Settings imported')
    },
  })
  const closeImport = () => {
    setImporting(false)
    importer.reset()
  }

  return (
    <div className="button-row">
      <Button
        icon={<Download size={16} aria-hidden="true" />}
        disabled={pending}
        onClick={() =>
          void run(unwrap(bridge.settings.export())).then((r) => r.ok && setExported(r.value))
        }
      >
        Export settings
      </Button>
      <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => setImporting(true)}>
        Import settings
      </Button>

      <Dialog
        open={exported !== null}
        title="Export settings"
        onClose={() => setExported(null)}
        actions={
          <Button variant="primary" onClick={() => setExported(null)}>
            Done
          </Button>
        }
      >
        <p className="muted">Credentials are never included.</p>
        {exported ? <CodeBlock code={exported} label="settings.json" /> : null}
      </Dialog>

      <Dialog
        open={importing}
        title="Import settings"
        onClose={closeImport}
        actions={
          <>
            <Button onClick={closeImport}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!json.trim() || importer.isPending}
              onClick={() => importer.mutate(json)}
            >
              Replace my settings
            </Button>
          </>
        }
      >
        <Field label="Settings JSON" hint="Replaces all current settings. Credentials are kept.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              mono
              rows={8}
              spellCheck={false}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          )}
        </Field>
        {importer.error ? <ErrorNotice error={importer.error} /> : null}
      </Dialog>
    </div>
  )
}

type Danger = 'credentials' | 'reset' | 'everything' | null

/** Destructive actions; each confirmation says exactly what goes and what stays. */
function DangerZone() {
  const qc = useQueryClient()
  const { run } = useAction()
  const [confirm, setConfirm] = useState<Danger>(null)
  const close = () => setConfirm(null)

  const clearCredentials = () => unwrap(bridge.secrets.clearAll())
  const resetSettings = async () => {
    qc.setQueryData(keys.settings, await unwrap(bridge.settings.reset()))
  }
  const refresh = () => qc.invalidateQueries({ queryKey: keys.secretsAll })
  /** Every part is tried; one that fails is named (the others are cleared regardless). */
  const clearEverything = async () => {
    const parts: [string, () => Promise<unknown>][] = [
      ['credentials', clearCredentials],
      ['env profiles', () => unwrap(bridge.envprofiles.clearAll({ confirmed: true }))],
      ['notification history', () => unwrap(bridge.notifications.clear())],
      ['settings', resetSettings],
    ]
    const results = await Promise.allSettled(parts.map(([, fn]) => fn()))
    const failed = parts.filter((_, i) => results[i]!.status === 'rejected').map(([what]) => what)
    if (failed.length) {
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      throw new DevDockError(
        'INTERNAL',
        `Couldn't clear ${failed.join(', ')}; everything else was cleared.`,
        first.reason instanceof Error ? first.reason.message : String(first.reason),
      )
    }
  }

  return (
    <div className="danger-zone">
      <h3 className="field-label">Danger zone</h3>
      <div className="button-row">
        <Button variant="danger" onClick={() => setConfirm('credentials')}>
          Clear credentials
        </Button>
        <Button variant="danger" onClick={() => setConfirm('reset')}>
          Reset settings
        </Button>
        <Button variant="danger" onClick={() => setConfirm('everything')}>
          Clear all data
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === 'credentials'}
        title="Clear all credentials?"
        body={<p>DevDock deletes every stored token (Bitbucket, Jenkins, Jira). Settings stay.</p>}
        confirmLabel="Clear credentials"
        danger
        onClose={close}
        onConfirm={() => void run(clearCredentials(), 'Credentials cleared').then(refresh)}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        title="Reset all settings?"
        body={
          <p>
            Every setting goes back to its default, including theme, shortcut and link list.
            Credentials and notification history are kept.
          </p>
        }
        confirmLabel="Reset settings"
        danger
        onClose={close}
        onConfirm={() => void run(resetSettings(), 'Settings reset')}
      />
      <ConfirmDialog
        open={confirm === 'everything'}
        title="Clear all DevDock data?"
        body={
          <p>
            DevDock deletes every stored token and saved env profile, clears notification history
            and resets every setting to its default. Log files stay so you can still report
            problems.
          </p>
        }
        confirmLabel="Clear all data"
        danger
        onClose={close}
        onConfirm={() => void run(clearEverything(), 'All data cleared').then(refresh)}
      />
    </div>
  )
}

export function DataSection({ settings }: { settings: Settings }) {
  const { run } = useAction()
  return (
    <>
      <Section id="links" title="Links">
        <LinksField
          key={settings.links.allowedHosts.join(',')}
          hosts={settings.links.allowedHosts}
        />
      </Section>
      <Section id="data" title="Data and logs">
        <div className="button-row">
          <Button
            icon={<FolderOpen size={16} aria-hidden="true" />}
            onClick={() => void run(unwrap(bridge.app.openLogsFolder()))}
          >
            Open logs folder
          </Button>
        </div>
        <p className="muted field-hint">Logs never contain tokens or passwords.</p>
        <ImportExport />
        <DangerZone />
      </Section>
    </>
  )
}
