import { describe, expect, it } from 'vitest'
import {
  agentMessage,
  briefRelativePath,
  buildBrief,
  classify,
  demoteHeadings,
} from '../../src/main/services/jira/brief'
import { JiraClient, type JiraConfig } from '../../src/main/services/jira/client'
import type { JiraIssueDetail } from '../../src/shared/jira'
import { ScriptedHttp, json, on } from '../fixtures/jira'

const issue = (over: Partial<JiraIssueDetail> = {}): JiraIssueDetail => ({
  key: 'NM-1234',
  url: 'https://acme.atlassian.net/browse/NM-1234',
  type: 'Story',
  priority: 'Medium',
  status: 'To Do',
  statusCategory: 'new',
  summary: 'Saved cards on the profile page',
  sprint: 'Sprint 42',
  fixVersions: ['2.5.0'],
  assignee: 'Ada Example',
  updated: '2026-10-20T10:00:00.000+0000',
  description: 'Customers want to manage cards.',
  acceptanceCriteria: '- Cards are listed with brand and last 4 digits',
  links: [],
  comments: [],
  ...over,
})

describe('classify (SPEC 6.5 step 4)', () => {
  it('Bug (and Defect) → bug-fixer, whatever the criteria', () => {
    expect(classify(issue({ type: 'Bug', acceptanceCriteria: null })).agent).toBe('bug-fixer')
    expect(classify(issue({ type: 'Production Defect' })).agent).toBe('bug-fixer')
  })
  it('Story/Task with usable criteria → feature-builder', () => {
    expect(classify(issue()).agent).toBe('feature-builder')
    expect(classify(issue({ type: 'Task' })).agent).toBe('feature-builder')
  })
  it.each([
    [null, 'no acceptance criteria'],
    ['   ', 'no acceptance criteria'],
    ['TBD', 'placeholder acceptance criteria'],
    ['- ?', 'placeholder acceptance criteria'],
    ['- works', 'unclear acceptance criteria'],
  ])('Story/Task with criteria %j → spec-writer (%s)', (ac, why) => {
    const c = classify(issue({ acceptanceCriteria: ac }))
    expect(c).toEqual({ agent: 'spec-writer', reason: `Story with ${why}` })
    expect(classify(issue({ type: 'Task', acceptanceCriteria: ac })).agent).toBe('spec-writer')
  })
})

describe('classify: other issue types', () => {
  it('only Story/Task go to spec-writer for unclear criteria; Epic etc. → feature-builder', () => {
    expect(classify(issue({ type: 'Epic', acceptanceCriteria: null }))).toEqual({
      agent: 'feature-builder',
      reason: 'Epic',
    })
    expect(classify(issue({ type: 'Sub-task', acceptanceCriteria: null })).agent).toBe(
      'spec-writer',
    )
  })
})

describe('agentMessage (SPEC 6.5 step 5)', () => {
  it('matches the SPEC example, with the first Figma link', () => {
    const withFigma = issue({
      links: [
        { kind: 'confluence', url: 'https://acme.atlassian.net/wiki/spaces/X/pages/1' },
        { kind: 'figma', url: 'https://www.figma.com/design/Ab/Cards' },
        { kind: 'figma', url: 'https://www.figma.com/design/Zz/Other' },
      ],
    })
    expect(agentMessage('spec-writer', briefRelativePath('NM-1234'), withFigma)).toBe(
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/NM-1234/TICKET.md. Figma: https://www.figma.com/design/Ab/Cards.',
    )
  })
  it('omits Figma when there is none; uses the given brief path as is', () => {
    expect(agentMessage('bug-fixer', '/Users/me/DevDock/briefs/NM-1/TICKET.md', issue())).toBe(
      'Use the bug-fixer agent. Ticket brief: /Users/me/DevDock/briefs/NM-1/TICKET.md.',
    )
  })
})

describe('buildBrief (SPEC 6.5 step 3)', () => {
  const full = issue({
    description: '## Background\nCards.\n\n```md\n# not a heading\n```',
    links: [{ kind: 'figma', url: 'https://www.figma.com/design/Ab/Cards' }],
    comments: [
      { author: 'Pat Example', created: '2026-10-19T09:00:00.000+0100', body: '# Big\nok' },
    ],
  })
  const md = buildBrief(full, new Date('2026-10-23T12:00:00Z'))

  it('has the sections in order: summary, description, AC, links, comments', () => {
    const outsideCode = md.replace(/```[\s\S]*?```/g, '')
    const headings = outsideCode.split('\n').filter((l) => /^#{1,2} /.test(l))
    expect(headings).toEqual([
      '# NM-1234: Saved cards on the profile page',
      '## Summary',
      '## Description',
      '## Acceptance criteria',
      '## Links',
      '## Comments (last 1)',
    ])
  })
  it('includes the ticket facts and content', () => {
    expect(md).toContain('- **Type:** Story')
    expect(md).toContain('- **Sprint:** Sprint 42')
    expect(md).toContain('- **Fix version:** 2.5.0')
    expect(md).toContain('- **Jira:** https://acme.atlassian.net/browse/NM-1234')
    expect(md).toContain('- Cards are listed with brand and last 4 digits')
    expect(md).toContain('- Figma: https://www.figma.com/design/Ab/Cards')
    expect(md).toContain('### Pat Example — 2026-10-19')
    expect(md).toContain('2026-10-23')
  })
  it('nests description and comment headings under the brief sections; code is untouched', () => {
    expect(md).toContain('#### Background')
    expect(md).toContain('```md\n# not a heading\n```')
    expect(md).toContain('#### Big')
  })
  it('says so when parts are missing', () => {
    const bare = buildBrief(
      issue({ description: '', acceptanceCriteria: null, sprint: null, fixVersions: [] }),
      new Date(),
    )
    expect(bare).toContain('_No description._')
    expect(bare).toContain('_None in the ticket. Clarify them before building._')
    expect(bare).toContain('_None found in the description._')
    expect(bare).toContain('_No comments._')
    expect(bare).not.toContain('**Sprint:**')
  })
  it('criteria found in the description appear once, in their own section', () => {
    const description = 'Intro.\n\n## Acceptance criteria\n- a b c works\n\n## Notes\nkeep me'
    const md = buildBrief(issue({ description, acceptanceCriteria: '- a b c works' }), new Date())
    expect(md.match(/- a b c works/g)).toHaveLength(1)
    expect(md).toContain('#### Notes\nkeep me')
    // From a custom field: the description is left as it is.
    const field = buildBrief(
      issue({
        description: '## Acceptance criteria\n- old text here',
        acceptanceCriteria: '- from the field',
      }),
      new Date(),
    )
    expect(field).toContain('- old text here')
    expect(field).toContain('- from the field')
  })
  it('no comments: plain heading', () => {
    expect(buildBrief(issue(), new Date())).toContain('## Comments\n\n_No comments._')
  })
  it('demoteHeadings caps at h6', () => {
    expect(demoteHeadings('##### deep', 3)).toBe('###### deep')
  })
})

describe('JiraClient.transitionToInProgress', () => {
  const config: JiraConfig = {
    flavor: 'cloud',
    baseUrl: 'https://acme.atlassian.net',
    email: 'a@example.com',
    token: 't',
  }
  const withTransitions = (transitions: unknown[]) =>
    new ScriptedHttp([
      (r) =>
        r.method === 'POST' && r.url.endsWith('/transitions')
          ? new Response(null, { status: 204 })
          : undefined,
      on('/transitions', () => json({ transitions })),
    ])

  it('posts the transition whose name or target status is "In Progress"', async () => {
    const http = withTransitions([
      { id: '11', name: 'Close', to: { name: 'Done' } },
      { id: 21, name: 'Start progress', to: { name: 'In progress' } },
    ])
    expect(await new JiraClient(http, config).transitionToInProgress('NM-1')).toBe('done')
    const post = http.requests.find((r) => r.method === 'POST')!
    expect(post.url).toBe('https://acme.atlassian.net/rest/api/3/issue/NM-1/transitions')
    expect(post.headers.get('content-type')).toBe('application/json')
    expect(await post.json()).toEqual({ transition: { id: '21' } })
  })

  it('does nothing when no such transition exists', async () => {
    const http = withTransitions([{ id: '11', name: 'Close', to: { name: 'Done' } }])
    expect(await new JiraClient(http, config).transitionToInProgress('NM-1')).toBe('unavailable')
    expect(http.requests.some((r) => r.method === 'POST')).toBe(false)
  })
})
