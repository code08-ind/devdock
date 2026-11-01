import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useUpdateSettings } from '../../lib/devdock'
import { formatAccelerator } from '../../lib/keyboard'
import { useUpdateStatus } from '../../lib/updates'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, Toggle } from '../../ui/Field'
import { Section } from './Section'

function ShortcutField({ current }: { current: string }) {
  const [draft, setDraft] = useState(current)
  const [problem, setProblem] = useState<string | null>(null)
  const { run, pending } = useAction()
  const toast = useToast()

  const save = async () => {
    const r = await run(unwrap(bridge.shortcut.set({ accelerator: draft.trim() })))
    if (!r.ok) return
    const result = r.value
    if (result.ok) {
      setProblem(null)
      toast(`Palette shortcut set to ${formatAccelerator(result.accelerator)}`)
    } else {
      setProblem(result.reason)
    }
  }

  return (
    <Field
      label="Command palette shortcut"
      hint={
        <>
          Works from any app. Current: <strong>{formatAccelerator(current)}</strong>. Use Electron
          names, e.g. CommandOrControl+Shift+Space.
        </>
      }
      error={problem}
    >
      {({ id, describedBy }) => (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Input
            id={id}
            aria-describedby={describedBy}
            className="mono"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" disabled={pending || draft.trim() === current}>
            Save shortcut
          </Button>
        </form>
      )}
    </Field>
  )
}

function IntervalField({
  label,
  value,
  min,
  max,
  onSave,
}: {
  label: string
  value: number
  min: number
  max: number
  onSave: (v: number) => void
}) {
  return (
    <Field label={label} hint={`${min}–${max} seconds`}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          type="number"
          className="tabular input-number"
          min={min}
          max={max}
          defaultValue={value}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (Number.isInteger(v) && v >= min && v <= max && v !== value) onSave(v)
            else e.target.value = String(value)
          }}
        />
      )}
    </Field>
  )
}

/** T9: the update notice's switch, where things stand, Check now and Download. */
function UpdateCheck({ on, onChecked }: { on: boolean; onChecked: (on: boolean) => void }) {
  const status = useUpdateStatus().data
  const { run, pending } = useAction()
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const line = !status
    ? null
    : status.demo
      ? `DevDock ${status.current}. Demo mode makes no network calls, so updates aren't checked.`
      : status.url
        ? `DevDock ${status.latest} is available (you have ${status.current}).`
        : status.error
          ? `DevDock ${status.current}. ${status.error}`
          : status.noRelease
            ? `DevDock ${status.current}. No release is published yet.`
            : status.checkedAt
              ? `DevDock ${status.current} is up to date (checked at ${time(status.checkedAt)}).`
              : `DevDock ${status.current}.`
  return (
    <div className="stack">
      <Toggle
        label="Check for updates"
        description="Once a day DevDock asks GitHub whether a newer version is out and tells you; it never installs anything by itself. Nothing about you is sent."
        checked={on}
        onChecked={onChecked}
      />
      {line ? (
        <div className="button-row">
          <span role="status">{line}</span>
          {status?.url ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={14} aria-hidden="true" />}
              disabled={pending}
              onClick={() => void run(unwrap(bridge.updates.open()))}
            >
              Download {status.latest}
            </Button>
          ) : null}
          {!status?.demo ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => void run(unwrap(bridge.updates.check()))}
            >
              Check now
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function GeneralSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const saveInterval = (polling: Partial<Settings['polling']>) =>
    update.mutate({ polling }, { onSuccess: () => toast('Refresh interval saved') })
  const g = settings.general
  return (
    <Section id="general" title="General">
      <ShortcutField key={g.paletteShortcut} current={g.paletteShortcut} />
      <Toggle
        label="Keep running in the tray when the window closes"
        description="When off, closing the window quits DevDock."
        checked={g.closeToTray}
        onChecked={(closeToTray) => update.mutate({ general: { closeToTray } })}
      />
      <Toggle
        label="Launch at login"
        description="Only takes effect in the installed app."
        checked={g.launchAtLogin}
        onChecked={(launchAtLogin) => update.mutate({ general: { launchAtLogin } })}
      />
      <UpdateCheck
        on={g.checkUpdates}
        onChecked={(checkUpdates) => update.mutate({ general: { checkUpdates } })}
      />
      <div className="field-row">
        <IntervalField
          key={`fg-${settings.polling.foregroundSec}`}
          label="Refresh while the window is open"
          value={settings.polling.foregroundSec}
          min={15}
          max={3600}
          onSave={(foregroundSec) => saveInterval({ foregroundSec })}
        />
        <IntervalField
          key={`bg-${settings.polling.backgroundSec}`}
          label="Refresh in the background"
          value={settings.polling.backgroundSec}
          min={30}
          max={7200}
          onSave={(backgroundSec) => saveInterval({ backgroundSec })}
        />
      </div>
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
