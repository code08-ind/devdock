import { describe, expect, it } from 'vitest'
import { adfToMarkdown, type AdfNode } from '../../src/main/services/jira/adf'

const doc = (...content: AdfNode[]): AdfNode => ({ type: 'doc', content })
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: AdfNode['marks'] & object): AdfNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks } : {}),
})
const mark = (type: string, attrs?: Record<string, unknown>) => ({
  type,
  ...(attrs ? { attrs } : {}),
})
const li = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content })
const md = (...content: AdfNode[]) => adfToMarkdown(doc(...content))

describe('adfToMarkdown', () => {
  it('paragraphs are separated by a blank line', () => {
    expect(md(p(t('One.')), p(t('Two.')))).toBe('One.\n\nTwo.')
  })

  it('text marks: strong, em, code, strike, link, and combinations', () => {
    expect(
      md(p(t('b', mark('strong')), t(' '), t('i', mark('em')), t(' '), t('x()', mark('code')))),
    ).toBe('**b** *i* `x()`')
    expect(md(p(t('gone', mark('strike'))))).toBe('~~gone~~')
    expect(md(p(t('docs', mark('link', { href: 'https://example.com/a' }))))).toBe(
      '[docs](https://example.com/a)',
    )
    expect(md(p(t('both', mark('strong'), mark('em'))))).toBe('***both***')
    expect(md(p(t('bold link', mark('strong'), mark('link', { href: 'https://x.test' }))))).toBe(
      '[**bold link**](https://x.test)',
    )
    // Code wins over other emphasis; backticks inside code use a double fence.
    expect(md(p(t('a`b', mark('code'), mark('strong'))))).toBe('`` a`b ``')
    // A leading/trailing backtick needs the space padding to stay inside the span.
    expect(md(p(t('`x', mark('code'))))).toBe('`` `x ``')
  })

  it('keeps spaces outside emphasis delimiters', () => {
    expect(md(p(t('Hello'), t(' world ', mark('strong')), t('!')))).toBe('Hello **world** !')
  })

  it('hard breaks', () => {
    expect(md(p(t('a'), { type: 'hardBreak' }, t('b')))).toBe('a  \nb')
  })

  it('headings 1–6 (clamped)', () => {
    const h = (level: number) => ({ type: 'heading', attrs: { level }, content: [t('Title')] })
    expect(md(h(1))).toBe('# Title')
    expect(md(h(3))).toBe('### Title')
    expect(md(h(6))).toBe('###### Title')
    expect(md(h(9))).toBe('###### Title')
  })

  it('bullet lists, nested lists, multi-paragraph items', () => {
    const nested = {
      type: 'bulletList',
      content: [li(p(t('child')))],
    }
    expect(
      md({
        type: 'bulletList',
        content: [li(p(t('one'))), li(p(t('two')), nested), li(p(t('three')), p(t('more')))],
      }),
    ).toBe('- one\n- two\n  - child\n- three\n  more')
  })

  it('ordered lists honour the start number', () => {
    expect(
      md({ type: 'orderedList', attrs: { order: 3 }, content: [li(p(t('c'))), li(p(t('d')))] }),
    ).toBe('3. c\n4. d')
    expect(md({ type: 'orderedList', content: [li(p(t('a')))] })).toBe('1. a')
  })

  it('task lists', () => {
    expect(
      md({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'DONE' }, content: [t('shipped')] },
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('test')] },
        ],
      }),
    ).toBe('- [x] shipped\n- [ ] test')
  })

  it('code blocks with and without a language', () => {
    expect(
      md({ type: 'codeBlock', attrs: { language: 'ts' }, content: [t('let a = 1\nlet b = 2')] }),
    ).toBe('```ts\nlet a = 1\nlet b = 2\n```')
    expect(md({ type: 'codeBlock', content: [t('plain')] })).toBe('```\nplain\n```')
    expect(md({ type: 'codeBlock', content: [t('```nested```')] })).toBe('~~~\n```nested```\n~~~')
  })

  it('mentions, emoji, inline cards, status and date', () => {
    expect(
      md(
        p(
          { type: 'mention', attrs: { id: '1', text: '@Ada Example' } },
          t(' '),
          { type: 'mention', attrs: { id: '2', text: 'Bob' } },
          t(' '),
          { type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } },
          t(' '),
          { type: 'inlineCard', attrs: { url: 'https://example.com/card' } },
          t(' '),
          { type: 'status', attrs: { text: 'BLOCKED' } },
          t(' '),
          { type: 'date', attrs: { timestamp: '1767225600000' } },
        ),
      ),
    ).toBe('@Ada Example @Bob 😄 <https://example.com/card> [BLOCKED] 2026-01-01')
  })

  it('tables with a header row; pipes and line breaks in cells are escaped', () => {
    const cell = (type: string, ...content: AdfNode[]) => ({ type, content })
    const row = (...content: AdfNode[]) => ({ type: 'tableRow', content })
    expect(
      md({
        type: 'table',
        content: [
          row(cell('tableHeader', p(t('Key'))), cell('tableHeader', p(t('Value')))),
          row(cell('tableCell', p(t('a|b'))), cell('tableCell', p(t('one')), p(t('two')))),
          row(cell('tableCell', p(t('short row')))),
        ],
      }),
    ).toBe('| Key | Value |\n| --- | --- |\n| a\\|b | one<br>two |\n| short row |  |')
  })

  it('tables without a header row get an empty one (Markdown requires it)', () => {
    expect(
      md({
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('x'))] }] }],
      }),
    ).toBe('|  |\n| --- |\n| x |')
  })

  it('blockquote, panel, rule, expand and media placeholders', () => {
    expect(md({ type: 'blockquote', content: [p(t('quoted')), p(t('more'))] })).toBe(
      '> quoted\n>\n> more',
    )
    expect(md({ type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('careful'))] })).toBe(
      '> **Warning:** careful',
    )
    expect(md(p(t('a')), { type: 'rule' }, p(t('b')))).toBe('a\n\n---\n\nb')
    expect(md({ type: 'expand', attrs: { title: 'Logs' }, content: [p(t('trace'))] })).toBe(
      '**Logs**\n\ntrace',
    )
    expect(md({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x' } }] })).toBe(
      '_[attachment]_',
    )
  })

  it('unknown nodes keep their text', () => {
    expect(md({ type: 'fancyNewBlock', content: [p(t('still here'))] })).toBe('still here')
    expect(md(p({ type: 'fancyInline', text: 'inline too' }))).toBe('inline too')
  })

  it('tolerates empty or non-ADF input', () => {
    expect(adfToMarkdown(null)).toBe('')
    expect(adfToMarkdown(undefined)).toBe('')
    expect(adfToMarkdown('already text')).toBe('already text')
    expect(adfToMarkdown(doc())).toBe('')
  })
})
