import { z } from 'zod'

/**
 * SPEC 6.6 standup draft. "Yesterday" is the previous working day (Friday when today is
 * Monday), skipping configured holidays; activity is collected from its start until today's
 * start, so weekend work lands in Yesterday too. Dates are local calendar days.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A holiday as typed in Settings: `YYYY-MM-DD`, a real calendar date. */
export const HolidaySchema = z
  .string()
  .regex(DAY, 'Use YYYY-MM-DD')
  .refine((d) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    const date = new Date(y, m - 1, day)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === day
  }, 'Not a real date')

/** `YYYY-MM-DD` of a local date. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const isWorkingDay = (date: Date, holidays: ReadonlySet<string>) =>
  date.getDay() !== 0 && date.getDay() !== 6 && !holidays.has(dayKey(date))

/** The working day before `today` (local midnight). Gives up after 60 days of holidays. */
export function previousWorkingDay(today: Date, holidays: readonly string[] = []): Date {
  const off = new Set(holidays)
  const day = startOfDay(today)
  for (let i = 0; i < 60; i++) {
    // setDate handles month ends and DST (it moves the calendar day, not 24 h).
    day.setDate(day.getDate() - 1)
    if (isWorkingDay(day, off)) return day
  }
  return day
}

/** The period Yesterday covers: previous working day 00:00 → today 00:00. */
export function standupWindow(
  today: Date,
  holidays: readonly string[] = [],
): { from: Date; to: Date } {
  return { from: previousWorkingDay(today, holidays), to: startOfDay(today) }
}

export const StandupDraftSchema = z.object({
  /** The previous working day, `YYYY-MM-DD`. */
  yesterdayDate: z.string(),
  yesterday: z.array(z.string()),
  today: z.array(z.string()),
  blockers: z.array(z.string()),
  /** What couldn't be collected, in words ("Jira isn't set up: no ticket activity."). */
  notes: z.array(z.string()),
})
export type StandupDraft = z.infer<typeof StandupDraftSchema>

/** "Friday 24 October". */
export function longDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

const sections = (
  draft: Pick<StandupDraft, 'yesterdayDate' | 'yesterday' | 'today' | 'blockers'>,
) =>
  [
    [`Yesterday (${longDay(draft.yesterdayDate)})`, draft.yesterday],
    ['Today', draft.today],
    ['Blockers', draft.blockers],
  ] as const

/** Plain text for chat: a heading line per section, `- ` items, "None" when empty. */
export function draftText(
  draft: Pick<StandupDraft, 'yesterdayDate' | 'yesterday' | 'today' | 'blockers'>,
): string {
  return sections(draft)
    .map(([title, items]) =>
      [title, ...(items.length ? items : ['None']).map((i) => `- ${i}`)].join('\n'),
    )
    .join('\n\n')
}

/** Markdown: bold section names, bullet lists. */
export function draftMarkdown(
  draft: Pick<StandupDraft, 'yesterdayDate' | 'yesterday' | 'today' | 'blockers'>,
): string {
  return sections(draft)
    .map(([title, items]) =>
      [`**${title}**`, '', ...(items.length ? items : ['None']).map((i) => `- ${i}`)].join('\n'),
    )
    .join('\n\n')
}
