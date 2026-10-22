import { useState } from 'react'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useUpdateSettings } from '../../lib/devdock'
import { formatAccelerator } from '../../lib/keyboard'
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
