import { DENSITIES, FONT_SIZES, THEMES, type Settings } from '@shared/settings'
import { useSettings, useUpdateSettings } from '../../lib/devdock'
import { DENSITY_LABELS, THEME_LABELS } from '../../ui/appearance'
import { ErrorNotice } from '../../ui/Feedback'
import { Field, SegmentedControl, Select, Toggle } from '../../ui/Field'
import { BitbucketSection } from './BitbucketSection'
import { CredentialsSection } from './CredentialsSection'
import { DataSection } from './DataSection'
import { GeneralSection } from './GeneralSection'
import { GitSection } from './GitSection'
import { JenkinsSection } from './JenkinsSection'
import { JiraSection } from './JiraSection'
import { NotificationsSection } from './NotificationsSection'
import { Section } from './Section'

const themeOptions = THEMES.map((t) => ({ value: t, label: THEME_LABELS[t] }))
const fontOptions = FONT_SIZES.map((s) => ({ value: s, label: `${s}px` }))
const densityOptions = DENSITIES.map((d) => ({ value: d, label: DENSITY_LABELS[d] }))

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
      <DemoSection settings={settings} />
      <GeneralSection settings={settings} />
      <GitSection settings={settings} />
      <BitbucketSection settings={settings} />
      <JenkinsSection settings={settings} />
      <JiraSection settings={settings} />
      <NotificationsSection settings={settings} />
      <CredentialsSection />
      <DataSection settings={settings} />
    </div>
  )
}
