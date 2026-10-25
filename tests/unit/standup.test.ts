import { describe, expect, it } from 'vitest'
import { standupDraft, type StandupDeps } from '../../src/main/services/standup'
import { ServiceError } from '../../src/main/services/service-error'
import {
  HolidaySchema,
  dayKey,
  draftMarkdown,
  draftText,
  previousWorkingDay,
  standupWindow,
} from '../../src/shared/standup'

const day = (key: string, h = 9) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, h)
}
const prev = (key: string, holidays: string[] = []) =>
  dayKey(previousWorkingDay(day(key), holidays))

describe('previous working day (SPEC 6.6)', () => {
  it('Monday → Friday; other weekdays → the day before; weekend → Friday', () => {
    expect(prev('2026-10-26')).toBe('2026-10-23') // Mon → Fri
    expect(prev('2026-10-27')).toBe('2026-10-26') // Tue → Mon
    expect(prev('2026-10-24')).toBe('2026-10-23') // Sat → Fri
    expect(prev('2026-10-25')).toBe('2026-10-23') // Sun → Fri
  })

  it('skips configured holidays like weekends, several in a row too', () => {
    expect(prev('2026-10-27', ['2026-10-26'])).toBe('2026-10-23') // Tue after a holiday Monday
    expect(prev('2026-10-26', ['2026-10-23'])).toBe('2026-10-22') // Mon after a holiday Friday
    expect(prev('2026-12-28', ['2026-12-25', '2026-12-24'])).toBe('2026-12-23')
  })

  it('crosses month and year ends', () => {
    expect(prev('2026-11-02')).toBe('2026-10-30')
    expect(prev('2027-01-01')).toBe('2026-12-31')
    expect(prev('2027-01-04', ['2027-01-01'])).toBe('2026-12-31')
  })

  it('window: previous working day 00:00 → today 00:00 (weekend work included)', () => {
    const { from, to } = standupWindow(day('2026-10-26', 9))
    expect(from).toEqual(new Date(2026, 9, 23))
    expect(to).toEqual(new Date(2026, 9, 26))
  })

  it('holiday entries must be real dates', () => {
    expect(HolidaySchema.safeParse('2026-12-25').success).toBe(true)
    for (const bad of ['2026-02-30', '25/12/2026', '2026-13-01', '']) {
      expect(HolidaySchema.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe('draft text', () => {
  const draft = {
    yesterdayDate: '2026-10-23',
    yesterday: ['web-app: Fix focus', 'Merged PR web-app #401 Remember filter'],
    today: ['DD-101: Date picker (In Progress)'],
    blockers: [],
  }
  it('plain text with "None" for an empty section', () => {
    expect(draftText(draft)).toBe(
      [
        'Yesterday (Friday 23 October)',
        '- web-app: Fix focus',
        '- Merged PR web-app #401 Remember filter',
        '',
        'Today',
        '- DD-101: Date picker (In Progress)',
        '',
        'Blockers',
        '- None',
      ].join('\n'),
    )
  })
  it('Markdown with bold section names', () => {
    expect(draftMarkdown(draft)).toMatch(/^\*\*Yesterday \(Friday 23 October\)\*\*\n\n- web-app/)
    expect(draftMarkdown(draft)).toMatch(/\*\*Blockers\*\*\n\n- None$/)
  })
})

describe('collecting the draft', () => {
  const base: StandupDeps = {
    holidays: () => [],
    commits: async () => [],
    prs: async () => [],
    jira: { statusChangedByMe: async () => [], inProgress: async () => [] },
  }
  it('a source that is not set up becomes a note; the rest still fill the draft', async () => {
    const draft = await standupDraft(
      {
        ...base,
        commits: async () => [
          { repo: 'web-app', subject: 'Fix focus', at: '2026-10-23T10:00:00Z' },
          { repo: 'web-app', subject: 'Fix focus', at: '2026-10-23T11:00:00Z' }, // cherry-pick
        ],
        jira: {
          statusChangedByMe: async () => {
            throw new ServiceError('not_configured', 'Jira isn’t set up yet')
          },
          inProgress: async () => {
            throw new ServiceError('network', 'Couldn’t reach Jira.')
          },
        },
      },
      day('2026-10-26'),
    )
    expect(draft).toMatchObject({
      yesterdayDate: '2026-10-23',
      yesterday: ['web-app: Fix focus'],
      today: [],
      notes: [
        'Jira activity: not set up, so not included.',
        "Jira in-progress tickets: couldn't be read (Couldn’t reach Jira.).",
      ],
    })
  })
})
