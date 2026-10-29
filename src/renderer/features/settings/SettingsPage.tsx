import { DENSITIES, FONT_SIZES, MOTION_MODES, THEMES, type Settings } from '@shared/settings'
import { useSettings, useUpdateSettings } from '../../lib/devdock'
import { DENSITY_LABELS, MOTION_LABELS, THEME_LABELS } from '../../ui/appearance'
import { ErrorNotice } from '../../ui/Feedback'
import { Field, SegmentedControl, Select, Toggle } from '../../ui/Field'
import { BitbucketSection } from './BitbucketSection'
import { CredentialsSection } from './CredentialsSection'
import { DataSection } from './DataSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import { GeneralSection } from './GeneralSection'
import { GitSection } from './GitSection'
import { ActionsSection, HostSection } from './HostSection'
import { JenkinsSection } from './JenkinsSection'
import { JiraSection } from './JiraSection'
import { StandupSection } from './StandupSection'
import { TerminalSection } from './TerminalSection'
import { WorkflowSection } from './WorkflowSection'
import { NotificationsSection } from './NotificationsSection'
import { Section } from './Section'

const themeOptions = THEMES.map((t) => ({ value: t, label: THEME_LABELS[t] }))
const fontOptions = FONT_SIZES.map((s) => ({ value: s, label: `${s}px` }))
const densityOptions = DENSITIES.map((d) => ({ value: d, label: DENSITY_LABELS[d] }))
const motionOptions = MOTION_MODES.map((m) => ({ value: m, label: MOTION_LABELS[m] }))

function AppearanceSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const a = settings.appearance
  return (
    <Section id="appearance" title="Appearance" description="Changes apply right away.">
      <SegmentedControl
        label="Theme"
        options={themeOptions}
        value={a.theme}
        onValue={(theme) => update.mutate({ appearance: { theme } })}
      />
      <Field label="Font size">
        {({ id }) => (
          <Select
            id={id}
            options={fontOptions}
            value={a.fontSize}
            onValue={(fontSize) => update.mutate({ appearance: { fontSize } })}
          />
        )}
      </Field>
      <SegmentedControl
        label="Density"
        options={densityOptions}
        value={a.density}
        onValue={(density) => update.mutate({ appearance: { density } })}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

function AccessibilitySection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const a = settings.accessibility
  return (
    <Section id="accessibility" title="Accessibility" description="Changes apply right away.">
      <SegmentedControl
        label="Reduce motion"
        options={motionOptions}
        value={a.reduceMotion}
        onValue={(reduceMotion) => update.mutate({ accessibility: { reduceMotion } })}
      />
      <Toggle
        label="Larger click targets"
        description="Buttons, switches and tabs at least 44 × 44 pixels."
        checked={a.largerTargets}
        onChecked={(largerTargets) => update.mutate({ accessibility: { largerTargets } })}
      />
      <Toggle
        label="Underline links"
        checked={a.underlineLinks}
        onChecked={(underlineLinks) => update.mutate({ accessibility: { underlineLinks } })}
      />
      <Toggle
        label="Always show the focus ring"
        description="Also after a click, not only when you move with the keyboard."
        checked={a.focusAlways}
        onChecked={(focusAlways) => update.mutate({ accessibility: { focusAlways } })}
      />
      <Toggle
        label="Read out background events"
        description="Screen readers also announce notifications (build finished, PR changed) while the DevDock window or menu-bar panel is open, as well as the system showing them."
        checked={a.announce}
        onChecked={(announce) => update.mutate({ accessibility: { announce } })}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

function DemoSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  return (
    <Section id="demo" title="Demo mode">
      <Toggle
        label="Use demo data"
        description="Runs every screen on built-in sample data. No network calls and no credentials are used."
        checked={settings.general.demoMode}
        onChecked={(demoMode) => update.mutate({ general: { demoMode } })}
      />
    </Section>
  )
}

export function SettingsPage() {
  const { data: settings, error } = useSettings()
  if (error) return <ErrorNotice error={error} />
  if (!settings) return null
  return (
    <div className="settings">
      <AppearanceSection settings={settings} />
      <AccessibilitySection settings={settings} />
      <DemoSection settings={settings} />
      <GeneralSection settings={settings} />
      <GitSection settings={settings} />
      <TerminalSection settings={settings} />
      <BitbucketSection settings={settings} />
      <HostSection provider="github" settings={settings} />
      <HostSection provider="gitlab" settings={settings} />
      <ActionsSection settings={settings} />
      <JenkinsSection settings={settings} />
      <JiraSection settings={settings} />
      <StandupSection settings={settings} />
      <WorkflowSection settings={settings} />
      <NotificationsSection settings={settings} />
      <CredentialsSection />
      <DiagnosticsSection settings={settings} />
      <DataSection settings={settings} />
    </div>
  )
}
