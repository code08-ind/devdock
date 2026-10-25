import { describe, expect, it } from 'vitest'
import { linkHosts } from '../../src/main/security'
import {
  groupLinks,
  linksToJson,
  parseLinksJson,
  searchLinks,
  type QuickLink,
} from '../../src/shared/links'
import { SettingsSchema, defaultSettings } from '../../src/shared/settings'

const LINKS: QuickLink[] = [
  {
    id: '1',
    name: 'Orders dashboard',
    url: 'https://eu-west-1.console.aws.amazon.com/cloudwatch/home#dashboards:name=orders',
    group: 'AWS',
  },
  {
    id: '2',
    name: 'Checkout Figma',
    url: 'https://www.figma.com/file/abc/Checkout',
    group: 'Design',
  },
  {
    id: '3',
    name: 'Team board',
    url: 'https://acme.atlassian.net/jira/software/projects/DD/boards/7',
    group: '',
  },
  {
    id: '4',
    name: 'Lambda logs',
    url: 'https://eu-west-1.console.aws.amazon.com/cloudwatch/home#logsV2:',
    group: 'AWS',
  },
]

let n = 0
const newId = () => `new-${++n}`

describe('quick links (SPEC 6.6)', () => {
  it('export → import round trip', () => {
    expect(parseLinksJson(linksToJson(LINKS), newId)).toEqual(LINKS)
  })

  it('import accepts a bare array, fills or de-duplicates ids, and names the bad link', () => {
    const imported = parseLinksJson(
      JSON.stringify([
        { name: 'A', url: 'https://a.example.com' },
        { id: 'x', name: 'B', url: 'https://b.example.com' },
        { id: 'x', name: 'C', url: 'https://c.example.com', group: 'G' },
      ]),
      newId,
    )
    expect(imported.map((l) => [l.id.startsWith('new-') ? 'new' : l.id, l.name, l.group])).toEqual([
      ['new', 'A', ''],
      ['x', 'B', ''],
      ['new', 'C', 'G'],
    ])
    expect(() => parseLinksJson('nope', newId)).toThrow("That file isn't JSON.")
    expect(() => parseLinksJson('{"x":1}', newId)).toThrow(/no links list/)
    expect(() =>
      parseLinksJson(
        JSON.stringify([
          { name: 'A', url: 'https://ok.example.com' },
          { name: 'B', url: 'javascript:alert(1)' },
        ]),
        newId,
      ),
    ).toThrow(/^Link 2: Use an http\(s\) address/)
    expect(() =>
      parseLinksJson(JSON.stringify([{ name: 'A', url: 'https://u:p@x.example.com' }]), newId),
    ).toThrow(/Link 1/)
  })

  it('search matches every word in name, group or host', () => {
    expect(searchLinks(LINKS, 'aws logs').map((l) => l.id)).toEqual(['4'])
    expect(searchLinks(LINKS, 'figma').map((l) => l.id)).toEqual(['2'])
    expect(searchLinks(LINKS, '  ').map((l) => l.id)).toEqual(['1', '2', '3', '4'])
  })

  it('groups in first-seen order, ungrouped last', () => {
    expect(groupLinks(LINKS).map((g) => [g.group, g.links.map((l) => l.id)])).toEqual([
      ['AWS', ['1', '4']],
      ['Design', ['2']],
      ['', ['3']],
    ])
  })

  it('settings keep them (validated), and their hosts may be opened', () => {
    const s = SettingsSchema.parse({ ...defaultSettings(), quickLinks: LINKS })
    expect(linkHosts(s, false)).toEqual(
      expect.arrayContaining(['eu-west-1.console.aws.amazon.com', 'www.figma.com']),
    )
    expect(() =>
      SettingsSchema.parse({
        ...defaultSettings(),
        quickLinks: [{ id: '1', name: 'x', url: 'file:///etc/passwd' }],
      }),
    ).toThrow()
  })
})
