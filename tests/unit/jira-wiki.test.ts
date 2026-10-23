import { describe, expect, it } from 'vitest'
import { wikiToMarkdown } from '../../src/main/services/jira/wiki'

describe('wikiToMarkdown (Data Center)', () => {
  it('headings and paragraphs', () => {
    expect(wikiToMarkdown('h1. Title\nSome text.\n\nh3. Sub')).toBe(
      '# Title\nSome text.\n\n### Sub',
    )
  })

  it('bold, italic, strike, underline, citation, monospace', () => {
    expect(
      wikiToMarkdown('*bold* and _italic_ and -gone- and +under+ and ??cite?? and {{x = 1}}'),
    ).toBe('**bold** and *italic* and ~~gone~~ and under and *cite* and `x = 1`')
  })

  it("doesn't treat hyphens, underscores or asterisks inside words as markup", () => {
    expect(wikiToMarkdown('a well-known snake_case_name and 2*3*4')).toBe(
      'a well-known snake_case_name and 2*3*4',
    )
  })

  it('links, bare URLs and mentions; underscores in URLs survive', () => {
    expect(
      wikiToMarkdown(
        'See [the design|https://www.figma.com/file/AB_cd/My_File] or [https://example.com/x_y] by [~jdoe]. Raw: https://example.com/a_b_c',
      ),
    ).toBe(
      'See [the design](https://www.figma.com/file/AB_cd/My_File) or <https://example.com/x_y> by @jdoe. Raw: https://example.com/a_b_c',
    )
  })

  it('code blocks keep their content verbatim, with a language', () => {
    expect(wikiToMarkdown('{code:java}\nint *a* = _b_;\n{code}')).toBe(
      '```java\nint *a* = _b_;\n```',
    )
    expect(wikiToMarkdown('{code:title=Foo.ts|language=ts}const x = 1{code}')).toBe(
      '```ts\nconst x = 1\n```',
    )
    expect(wikiToMarkdown('{noformat}\n*raw*\n{noformat}')).toBe('```\n*raw*\n```')
  })

  it('bullet, numbered, nested and mixed lists', () => {
    expect(wikiToMarkdown('* one\n** nested\n* two\n# first\n## sub\n#* mixed\n- dash')).toBe(
      '- one\n  - nested\n- two\n1. first\n   1. sub\n   - mixed\n- dash',
    )
  })

  it('tables with and without a header row', () => {
    expect(wikiToMarkdown('||Key||Value||\n|a|*b*|\n|c|d|')).toBe(
      '| Key | Value |\n| --- | --- |\n| a | **b** |\n| c | d |',
    )
    expect(wikiToMarkdown('|x|y|')).toBe('|  |  |\n| --- | --- |\n| x | y |')
  })

  it('quotes and rules', () => {
    expect(wikiToMarkdown('bq. quoted line')).toBe('> quoted line')
    expect(wikiToMarkdown('{quote}\nfirst\n\nsecond\n{quote}')).toBe('> first\n>\n> second')
    expect(wikiToMarkdown('a\n----\nb')).toBe('a\n---\nb')
  })

  it('drops colour macros, converts \\\\ line breaks, normalises CRLF', () => {
    expect(wikiToMarkdown('{color:red}warning{color}\r\nline\\\\next')).toBe(
      'warning\nline  \nnext',
    )
  })

  it('empty input', () => {
    expect(wikiToMarkdown(null)).toBe('')
    expect(wikiToMarkdown('')).toBe('')
  })

  it('a link or code with a pipe inside a table cell stays one cell', () => {
    expect(wikiToMarkdown('||Doc||Note||\n|see [docs|https://x.example.com/a]|{{a|b}}|')).toBe(
      '| Doc | Note |\n| --- | --- |\n| see [docs](https://x.example.com/a) | `a\\|b` |',
    )
  })
})
