import { describe, expect, it } from 'vitest'
import { acceptanceSection, extractLinks, sprintName } from '../../src/main/services/jira/model'

describe('sprintName', () => {
  it('prefers the active sprint, else the last one', () => {
    expect(
      sprintName([
        { name: 'S1', state: 'closed' },
        { name: 'S2', state: 'active' },
        { name: 'S3', state: 'future' },
      ]),
    ).toBe('S2')
    expect(
      sprintName([
        { name: 'S1', state: 'closed' },
        { name: 'S3', state: 'future' },
      ]),
    ).toBe('S3')
  })
  it('parses legacy Data Center strings', () => {
    expect(
      sprintName([
        'com.atlassian.greenhopper.service.sprint.Sprint@1[id=1,rapidViewId=2,state=ACTIVE,name=Team Sprint 4,goal=,sequence=1]',
      ]),
    ).toBe('Team Sprint 4')
  })
  it('null for empty or missing values', () => {
    expect(sprintName(null)).toBeNull()
    expect(sprintName([])).toBeNull()
    expect(sprintName(['garbage'])).toBeNull()
  })
})

describe('acceptanceSection', () => {
  it('a heading section, ending at the next heading of the same or higher level', () => {
    expect(
      acceptanceSection(
        'Intro\n\n## Acceptance criteria\n- a\n- b\n### Detail\nkept\n## Notes\nnot kept',
      ),
    ).toBe('- a\n- b\n### Detail\nkept')
  })
  it('a bold title, ending at the next bold title', () => {
    expect(acceptanceSection('**Acceptance Criteria:**\n1. works\n\n**Out of scope**\nx')).toBe(
      '1. works',
    )
  })
  it('a plain "Acceptance criteria:" line, also with text on the same line', () => {
    expect(acceptanceSection('Acceptance criteria:\n- it works')).toBe('- it works')
    expect(acceptanceSection('Acceptance criteria: totals add up')).toBe('totals add up')
  })
  it('emphasis in the heading is ignored', () => {
    expect(acceptanceSection('### *Acceptance Criteria*\nok')).toBe('ok')
  })
  it('null when there is no section or it is empty', () => {
    expect(acceptanceSection('Make the dashboard feel faster.')).toBeNull()
    expect(acceptanceSection('## Acceptance criteria\n\n## Next')).toBeNull()
    // A list item that merely mentions the words is not a section.
    expect(acceptanceSection('- check acceptance criteria with PM')).toBeNull()
  })
})

describe('extractLinks', () => {
  it('finds Figma and Confluence (Cloud and self-hosted) URLs, de-duplicated, in order', () => {
    const md = [
      'Design [here](https://www.figma.com/design/AbC/File?node-id=1-2).',
      'Proto: <https://figma.com/proto/XyZ/Flow>',
      'Spec https://acme.atlassian.net/wiki/spaces/ENG/pages/42/Spec, again https://www.figma.com/design/AbC/File?node-id=1-2',
      'Old wiki https://confluence.example.com/display/OPS/Runbook and https://intranet.example.com/pages/viewpage.action?pageId=9',
    ].join('\n')
    expect(extractLinks(md)).toEqual([
      { kind: 'figma', url: 'https://www.figma.com/design/AbC/File?node-id=1-2' },
      { kind: 'figma', url: 'https://figma.com/proto/XyZ/Flow' },
      { kind: 'confluence', url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/42/Spec' },
      { kind: 'confluence', url: 'https://confluence.example.com/display/OPS/Runbook' },
      { kind: 'confluence', url: 'https://intranet.example.com/pages/viewpage.action?pageId=9' },
    ])
  })
  it('ignores other links, Jira itself, and look-alike hosts', () => {
    expect(
      extractLinks(
        'https://acme.atlassian.net/browse/NM-1 https://en.wikipedia.org/wiki/Figma https://notfigma.com/x https://figma.com.evil.test/x https://github.com/o/display/r/ https://example.com/blog/pages/viewpage.action',
      ),
    ).toEqual([])
  })
})
