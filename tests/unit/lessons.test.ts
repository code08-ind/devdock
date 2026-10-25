import { describe, expect, it } from 'vitest'
import {
  LESSONS_HEADER,
  LessonTextSchema,
  LessonsPathSchema,
  appendLessons,
  lessonFromComment,
  lessonsNote,
  parseLessons,
  type ReviewComment,
} from '../../src/shared/lessons'

const comment = (text: string, path: string | null = null): ReviewComment => ({
  id: '1',
  pr: 'web-app #415',
  prTitle: 'Checkout card',
  author: 'Priya Reviewer',
  text,
  path,
  createdAt: null,
})

describe('agent lessons (P6-F)', () => {
  it('a new file starts with the header; lessons become list items', () => {
    const { text, added } = appendLessons(null, ['Use the Money helper for totals'])
    expect(added).toBe(1)
    expect(text.startsWith(LESSONS_HEADER.trimEnd())).toBe(true)
    expect(parseLessons(text)).toEqual(['Use the Money helper for totals'])
  })

  it('appends to an existing file, keeping it byte for byte and its line endings', () => {
    const before = '# Mine\r\n\r\nNotes.\r\n\r\n- First\r\n\r\n\r\n'
    const { text, added } = appendLessons(before, ['Second'])
    expect(added).toBe(1)
    expect(text).toBe('# Mine\r\n\r\nNotes.\r\n\r\n- First\r\n- Second\r\n')
  })

  it('skips lessons already there (case, spaces and the source in brackets ignored) and repeats', () => {
    const before = appendLessons(null, ['Use the Money helper (web-app #415)']).text
    const { text, added } = appendLessons(before, [
      'use the  money helper (web-app #420, src/a.ts)',
      'Name tests after behaviour',
      'Name tests after behaviour',
    ])
    expect(added).toBe(1)
    expect(parseLessons(text)).toEqual([
      'Use the Money helper (web-app #415)',
      'Name tests after behaviour',
    ])
    expect(appendLessons(text, ['Name tests after behaviour'])).toEqual({ text, added: 0 })
  })

  it('a comment becomes one line: quotes, code and link syntax flattened, source added', () => {
    const c = comment(
      '> old line\nPlease use **`formatMoney`** here,\n```ts\nx()\n```\nsee [the guide](https://x.y/z).',
      'src/Checkout.tsx',
    )
    expect(lessonFromComment(c)).toBe(
      'Please use formatMoney here, see the guide. (web-app #415, src/Checkout.tsx)',
    )
    expect(lessonFromComment(comment('a'.repeat(400))).length).toBeLessThan(330)
  })

  it('lesson text and path validation', () => {
    expect(LessonTextSchema.safeParse('ok fine').success).toBe(true)
    expect(LessonTextSchema.safeParse('two\nlines').success).toBe(false)
    expect(LessonsPathSchema.safeParse('docs/ai/LESSONS.md').success).toBe(true)
    for (const bad of ['/etc/x.md', 'C:\\x.md', '../x.md', 'docs/../../x.md', 'docs/notes.txt']) {
      expect(LessonsPathSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('the agent message note: read only when the file exists, add either way', () => {
    const both = { pointToLessons: true, askForLessons: true }
    expect(lessonsNote(both, 'docs/ai/LESSONS.md', true)).toBe(
      'Read docs/ai/LESSONS.md first. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
    expect(lessonsNote(both, 'L.md', false)).toBe(
      'When you finish, add what you learned to L.md, one line each.',
    )
    expect(lessonsNote({ pointToLessons: false, askForLessons: false }, 'L.md', true)).toBeNull()
  })
})

describe('grouping repeated review comments', () => {
  it('the same reviewer saying the same thing on several PRs is one lesson listing them all', async () => {
    const { groupComments } = await import('../../src/shared/lessons')
    const c = (id: string, pr: string, author: string, text: string, path: string | null) => ({
      id,
      pr,
      prTitle: '',
      author,
      text,
      path,
      createdAt: null,
    })
    const grouped = groupComments([
      c('1', 'web-app #415', 'Priya', 'Use formatMoney', 'a.ts'),
      c('2', 'web-app #412', 'Priya', 'use  formatMoney', 'a.ts'),
      c('3', 'design-system #88', 'Priya', 'Use formatMoney', 'b.ts'),
      c('4', 'web-app #412', 'Sam', 'Use formatMoney', null),
    ])
    expect(grouped.map((g) => [g.id, g.author, g.pr, g.path])).toEqual([
      ['1', 'Priya', 'web-app #415, #412, design-system #88', null],
      ['4', 'Sam', 'web-app #412', null],
    ])
  })
})
