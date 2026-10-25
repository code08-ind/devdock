import { describe, expect, it } from 'vitest'
import { ProxyServerSchema, proxyRules, type Diagnostics } from '../../src/shared/diagnostics'
import { SettingsSchema, type Settings } from '../../src/shared/settings'
import {
  DiagnosticsService,
  diagnosticsReport,
  scrub,
  withoutCredentials,
  type ReportInput,
} from '../../src/main/services/diagnostics'

const settings = (over: Record<string, unknown> = {}): Settings =>
  SettingsSchema.parse({
    version: 1,
    general: { demoMode: false },
    jira: {
      baseUrl: 'https://team.atlassian.net',
      email: 'priya.k@corp.example.com',
      jql: 'assignee = priya.k AND statusCategory != Done',
    },
    bitbucket: { baseUrl: 'https://bitbucket.org', username: 'aryan-g' },
    standup: { authorEmail: 'priya.k@corp.example.com' },
    quickLinks: [
      {
        id: 'a',
        name: 'Orders',
        url: 'https://eu-west-1.console.aws.amazon.com/x?acct=1',
        group: 'AWS',
      },
    ],
    repos: [
      {
        id: 'r1',
        name: 'web-app',
        path: '/Users/aryan/code/web-app',
        baseBranch: 'develop',
        protectedPatterns: ['main'],
        branchTemplates: { feature: 'feature/{key}-{slug}', bugfix: 'bugfix/{key}-{slug}' },
        devCommand: 'npm run dev',
      },
    ],
    ...over,
  })

const info: Diagnostics = {
  app: '0.1.0',
  electron: '45.0.0',
  chrome: '140',
  node: '22.19.0',
  systemNode: 'v22.11.0',
  git: 'git version 2.50.1',
  platform: 'darwin',
  arch: 'arm64',
  demoMode: false,
  proxies: [],
}

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  info,
  settings: settings(),
  log: '',
  tests: {},
  credentials: { Jira: true, Bitbucket: false, Jenkins: false },
  identity: { home: '/Users/aryan', user: 'aryan' },
  now: new Date('2026-10-25T12:00:00Z'),
  ...over,
})

describe('diagnostics (P6.04)', () => {
  it('the export keeps the shape but not who you are, wherever names appear', () => {
    const log = [
      '2026-10-25T10:00:00Z INFO  started',
      '2026-10-25T10:00:01Z ERROR GET https://x/api?token=abc123 failed for priya.k@corp.example.com in /Users/aryan/code',
      '2026-10-25T10:00:02Z INFO  Bitbucket: connected as aryan-g, /Volumes/Work/aryan/repo',
    ].join('\n')
    const text = diagnosticsReport(input({ log }))
    const report = JSON.parse(text)
    expect(report.info.git).toBe('git version 2.50.1')
    expect(report.settings.jira).toMatchObject({
      baseUrl: 'https://team.atlassian.net',
      email: '[REDACTED]',
      jql: 'assignee = [NAME] AND statusCategory != Done',
    })
    expect(report.settings.bitbucket.username).toBe('[REDACTED]')
    expect(report.settings.repos[0].path).toBe('~/code/web-app')
    expect(report.settings.quickLinks).toEqual([
      { name: 'Orders', group: 'AWS', host: 'eu-west-1.console.aws.amazon.com' },
    ])
    expect(report.credentialsSaved).toEqual({ Jira: true, Bitbucket: false, Jenkins: false })
    expect(report.log).toHaveLength(3)
    for (const leaked of ['abc123', 'priya', 'aryan']) {
      expect(text.toLowerCase()).not.toContain(leaked)
    }
  })

  it('only the last 200 log lines; empty account fields stay empty', () => {
    const log = Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n')
    const report = JSON.parse(
      diagnosticsReport(input({ log, settings: settings({ jira: {}, bitbucket: {} }) })),
    )
    expect(report.log).toHaveLength(200)
    expect(report.log[0]).toBe('line 250')
    expect(report.settings.jira.email).toBe('')
  })

  it('Windows homes in any case and slash, JSON-escaped too; network shares', () => {
    const who = { home: 'C:\\Users\\Aryan', user: 'Aryan' }
    expect(
      scrub(
        'C:\\Users\\Aryan\\x | c:/users/aryan/y | C:\\\\Users\\\\Aryan\\\\z | \\\\files\\team\\Aryan\\w',
        who,
      ),
    ).toBe('~\\x | ~/y | ~\\\\z | [PATH]')
  })

  it("short names aren't scrubbed (too many false hits); names inside words stay", () => {
    expect(scrub('dev ran npm run dev', { home: '', user: 'dev' })).toBe('dev ran npm run dev')
    expect(scrub('maryanne and aryan', { home: '', user: 'aryan' })).toBe('maryanne and [NAME]')
  })

  it('proxy routes lose credentials; a manual proxy is host:port without sign-in', () => {
    expect(withoutCredentials('PROXY bob:s3cret@proxy.corp:8080; DIRECT')).toBe(
      'PROXY [REDACTED]@proxy.corp:8080; DIRECT',
    )
    for (const ok of ['', 'proxy.corp:8080', 'http://proxy.corp:3128']) {
      expect(ProxyServerSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['proxy.corp', 'bob:pw@proxy:8080', 'socks5 x', 'http://p:1/path']) {
      expect(ProxyServerSchema.safeParse(bad).success, bad).toBe(false)
    }
    expect(proxyRules('proxy.corp:8080')).toBe('http://proxy.corp:8080')
    expect(proxyRules('https://p:443')).toBe('https://p:443')
  })

  it('info: tool versions (missing ones are null), proxy routes; the report keeps the last tests', async () => {
    const svc = new DiagnosticsService({
      versions: () => ({
        app: '0.1.0',
        electron: '45',
        chrome: '140',
        node: '22',
        platform: 'darwin',
        arch: 'arm64',
      }),
      run: async (file) => {
        if (file === 'node') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return { stdout: 'git version 2.50.1\n', stderr: '', code: 0 }
      },
      resolveProxy: async (url) => (url.includes('atlassian') ? 'PROXY u:p@proxy:3128' : 'DIRECT'),
      settings: () => settings(),
      credentials: async () => ['jira.token'],
      logFile: '/nonexistent/devdock.log',
      home: '/Users/aryan',
      user: 'aryan',
      now: () => new Date('2026-10-25T12:00:00Z'),
    })
    const d = await svc.info()
    expect(d).toMatchObject({ git: 'git version 2.50.1', systemNode: null, demoMode: false })
    expect(d.proxies).toEqual([
      {
        service: 'Jira',
        origin: 'https://team.atlassian.net',
        route: 'PROXY [REDACTED]@proxy:3128',
      },
      { service: 'Bitbucket', origin: 'https://bitbucket.org', route: 'DIRECT' },
      { service: 'Jenkins', origin: null, route: null },
    ])
    svc.recordTest('Jira', false, 'SERVICE_AUTH')
    svc.recordTest('Bitbucket', true, null)
    const report = JSON.parse(await svc.report())
    expect(report.lastConnectionTests).toEqual({
      Jira: { ok: false, code: 'SERVICE_AUTH', at: '2026-10-25T12:00:00.000Z' },
      Bitbucket: { ok: true, code: null, at: '2026-10-25T12:00:00.000Z' },
    })
    expect(report.credentialsSaved).toEqual({ Jira: true, Bitbucket: false, Jenkins: false })
    // A missing log file still exports.
    expect(report.log).toEqual([])
    expect(svc.fileName()).toBe('devdock-diagnostics-2026-10-25.json')
  })
})
