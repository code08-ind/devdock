import { useRef, useState } from 'react'
import { Download, ExternalLink, Pencil, Trash2, Upload } from 'lucide-react'
import {
  QuickLinkSchema,
  groupLinks,
  linksToJson,
  parseLinksJson,
  searchLinks,
  type QuickLink,
} from '@shared/links'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useUpdateSettings } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button, IconButton } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { EmptyState, ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input } from '../../ui/Field'

const newId = () => crypto.randomUUID()

/**
 * SPEC 6.6 Quick links: a launcher (name, URL, group) with search, add/edit/delete, and
 * import/export as a JSON file. The same links are palette commands.
 */
export function LinksPanel({ settings }: { settings: Settings }) {
  const links = settings.quickLinks
  const update = useUpdateSettings()
  const toast = useToast()
  const { run } = useAction()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<QuickLink | null>(null)
  const [deleting, setDeleting] = useState<QuickLink | null>(null)
  const [importError, setImportError] = useState<Error | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const save = (next: QuickLink[], message: string, then?: () => void) =>
    update.mutate(
      { quickLinks: next },
      {
        onSuccess: () => {
          toast(message)
          then?.()
        },
      },
    )
  const shown = groupLinks(searchLinks(links, query))

  return (
    <section className="stack" aria-label="Quick links">
      <div className="ports-bar">
        <Field label="Search links">
          {({ id }) => (
            <Input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
        </Field>
        <Button onClick={() => setEditing({ id: newId(), name: '', url: '', group: '' })}>
          Add link
        </Button>
        <Button
          icon={<Download size={16} aria-hidden="true" />}
          disabled={links.length === 0}
          onClick={() => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(
              new Blob([linksToJson(links)], { type: 'application/json' }),
            )
            a.download = 'devdock-links.json'
            a.click()
            // After the download has started (revoking at once can cancel it).
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
          }}
        >
          Export
        </Button>
        <Button
          icon={<Upload size={16} aria-hidden="true" />}
          onClick={() => file.current?.click()}
        >
          Import
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const picked = e.target.files?.[0]
            e.target.value = ''
            if (!picked) return
            try {
              const imported = parseLinksJson(await picked.text(), newId)
              // Added after the existing ones; an address already in the list is skipped (the
              // same file imported twice adds nothing), a clashing id gets a new one.
              const urls = new Set(links.map((l) => l.url))
              const ids = new Set(links.map((l) => l.id))
              const added = imported
                .filter((l) => !urls.has(l.url))
                .map((l) => (ids.has(l.id) ? { ...l, id: newId() } : l))
              setImportError(null)
              save(
                [...links, ...added],
                `Imported ${added.length} link${added.length === 1 ? '' : 's'}${imported.length > added.length ? ` (${imported.length - added.length} already there)` : ''}`,
              )
            } catch (err) {
              setImportError(err instanceof Error ? err : new Error(String(err)))
            }
          }}
        />
      </div>
      {importError ? <ErrorNotice error={importError} /> : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}

      {links.length === 0 ? (
        <EmptyState
          icon={<ExternalLink size={18} aria-hidden="true" />}
          title="No quick links yet. Add the AWS consoles, dashboards and boards you open every day; they show up in the command palette too."
        />
      ) : shown.length === 0 ? (
        <p className="muted">No link matches “{query}”.</p>
      ) : (
        shown.map((g) => (
          <div key={g.group || '(none)'} className="stack">
            <h3 className="field-label">{g.group || 'Other'}</h3>
            <ul className="pr-list" aria-label={g.group || 'Other links'}>
              {g.links.map((l) => (
                <li key={l.id} className="pr-row">
                  <div className="pr-row-head">
                    <span className="pr-ref">{l.name}</span>
                    <span className="muted mono port-command">{l.url}</span>
                    <span className="spacer" />
                    <IconButton
                      label={`Open ${l.name}`}
                      icon={<ExternalLink size={16} aria-hidden="true" />}
                      onClick={() => void run(unwrap(bridge.app.openExternal({ url: l.url })))}
                    />
                    <IconButton
                      label={`Edit ${l.name}`}
                      icon={<Pencil size={16} aria-hidden="true" />}
                      onClick={() => setEditing(l)}
                    />
                    <IconButton
                      label={`Delete ${l.name}`}
                      icon={<Trash2 size={16} aria-hidden="true" />}
                      onClick={() => setDeleting(l)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {editing ? (
        <LinkForm
          link={editing}
          groups={[...new Set(links.map((l) => l.group).filter(Boolean))]}
          onCancel={() => setEditing(null)}
          onSave={(l) => {
            const exists = links.some((x) => x.id === l.id)
            save(
              exists ? links.map((x) => (x.id === l.id ? l : x)) : [...links, l],
              exists ? 'Link saved' : 'Link added',
              // Closed only once saved: a failed save keeps the draft.
              () => setEditing(null),
            )
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        body={<p>The link is removed from DevDock and the command palette.</p>}
        confirmLabel="Delete link"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          save(
            links.filter((l) => l.id !== deleting.id),
            'Link deleted',
          )
        }
      />
    </section>
  )
}

function LinkForm({
  link,
  groups,
  onSave,
  onCancel,
}: {
  link: QuickLink
  groups: string[]
  onSave: (l: QuickLink) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(link)
  const parsed = QuickLinkSchema.safeParse(draft)
  const urlError =
    draft.url.trim() && !parsed.success
      ? (parsed.error.issues.find((i) => i.path[0] === 'url')?.message ?? null)
      : null
  return (
    <form
      className="link-form stack"
      aria-label={link.name ? `Edit ${link.name}` : 'New link'}
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed.success) onSave(parsed.data)
      }}
    >
      <Field label="Name">
        {({ id }) => (
          <Input
            id={id}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        )}
      </Field>
      <Field label="Address" error={urlError}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            className="mono"
            value={draft.url}
            placeholder="https://eu-west-1.console.aws.amazon.com/cloudwatch/home"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Group (optional)"
        hint={groups.length ? `Existing: ${groups.join(', ')}` : undefined}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={draft.group}
            placeholder="AWS"
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          />
        )}
      </Field>
      <div className="button-row">
        <Button type="submit" variant="primary" disabled={!parsed.success}>
          Save link
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
