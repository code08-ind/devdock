import { HolidaySchema } from '@shared/standup'
import type { Settings } from '@shared/settings'
import { queryClient, useUpdateSettings } from '../../lib/devdock'
import { utilityKeys } from '../../lib/utilities'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Section } from './Section'
import { TextSetting } from './ServiceBits'
import { fromLines } from '../utilities/pure'

/** SPEC 6.6 standup: whose commits count, and which days aren't working days. */
export function StandupSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const save = (patch: Partial<Settings['standup']>, done: string) =>
    update.mutate(
      { standup: patch },
      {
        onSuccess: () => {
          toast(done)
          void queryClient.invalidateQueries({ queryKey: utilityKeys.standup })
        },
      },
    )
  return (
    <Section
      id="standup"
      title="Standup"
      description="The standup draft lists your commits, pull requests and ticket moves since the previous working day."
    >
      <TextSetting
        label="Git author email"
        hint="Your commits across the registered repos are found by this email (as in git config user.email)."
        value={settings.standup.authorEmail}
        validate={(v) => (v && !/^[^\s@]+@[^\s@]+$/.test(v) ? 'Use an email address.' : null)}
        onSave={(authorEmail) => save({ authorEmail }, 'Author email saved')}
      />
      <TextSetting
        label="Holidays"
        hint="One date per line (YYYY-MM-DD). Like weekends, they're skipped when working out Yesterday."
        multiline
        value={settings.standup.holidays.join('\n')}
        validate={(v) => {
          const bad = fromLines(v).find((d) => !HolidaySchema.safeParse(d).success)
          return bad ? `${bad} isn't a date in YYYY-MM-DD form.` : null
        }}
        onSave={(v) => save({ holidays: [...new Set(fromLines(v))].sort() }, 'Holidays saved')}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
