/** Diagnostics screen data and the redacted export (P6.04). */
import { readFile } from 'node:fs/promises'
import { SERVICES, type Diagnostics, type ProxyRoute, type ServiceName } from '@shared/diagnostics'
import type { Settings } from '@shared/settings'
import { REDACTED, redact } from './logger'
import type { CommandRunner } from './process/ports'

export interface DiagnosticsDeps {
  versions: () => Pick<Diagnostics, 'app' | 'electron' | 'chrome' | 'node' | 'platform' | 'arch'>
  run: CommandRunner
  /** Electron's session.resolveProxy. */
  resolveProxy: (url: string) => Promise<string>
  settings: () => Settings
  /** Names of the credentials saved (never their values). */
  credentials: () => Promise<string[]>
  logFile: string
  home: string
  /** The OS account name: it shows up in paths outside the home folder too. */
  user: string
  now?: () => Date
}

/** Log lines in the export: enough to see the last few errors. */
export const LOG_TAIL_LINES = 200

/** A connection test's outcome, kept for the report (no message text: it can name people). */
export interface TestRecord {
  ok: boolean
  /** The error code when it failed (SERVICE_AUTH, PROXY, …). */
  code: string | null
  at: string
}

export class DiagnosticsService {
  private readonly tests = new Map<ServiceName, TestRecord>()

  constructor(private readonly deps: DiagnosticsDeps) {}

  /** Called for every Test connection (one service or all), so the report can show the last. */
  recordTest(service: ServiceName, ok: boolean, code: string | null): void {
    this.tests.set(service, { ok, code, at: this.now().toISOString() })
  }

  async info(): Promise<Diagnostics> {
    const settings = this.deps.settings()
    const [git, systemNode, proxies] = await Promise.all([
      this.version('git', ['--version']),
      this.version('node', ['--version']),
      Promise.all(SERVICES.map(([service, key]) => this.route(service, settings[key].baseUrl))),
    ])
    return {
      ...this.deps.versions(),
      git,
      systemNode,
      demoMode: settings.general.demoMode,
      proxies,
    }
  }

  /** The export: info, settings, tests, the log's tail — personal data and credentials removed. */
  async report(): Promise<string> {
    const [info, log, saved] = await Promise.all([
      this.info(),
      readFile(this.deps.logFile, 'utf8').catch(() => ''),
      this.deps.credentials().catch((): string[] => []),
    ])
    const credentials = {} as Record<ServiceName, boolean>
    for (const [name, key] of SERVICES) credentials[name] = saved.includes(`${key}.token`)
    return diagnosticsReport({
      info,
      settings: this.deps.settings(),
      log,
      tests: Object.fromEntries(this.tests),
      credentials,
      identity: { home: this.deps.home, user: this.deps.user },
      now: this.now(),
    })
  }

  /** "devdock-diagnostics-2026-10-25.json". */
  fileName(): string {
    return `devdock-diagnostics-${this.now().toISOString().slice(0, 10)}.json`
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))()
  }

  private async version(file: string, args: string[]): Promise<string | null> {
    try {
      const { stdout, code } = await this.deps.run(file, args)
      return code === 0 ? firstLine(stdout) : null
    } catch {
      return null // not installed
    }
  }

  private async route(service: ServiceName, baseUrl: string): Promise<ProxyRoute> {
    const origin = originOf(baseUrl)
    if (!origin) return { service, origin: null, route: null }
    const route = await this.deps.resolveProxy(origin).catch(() => null)
    return { service, origin, route: route === null ? null : withoutCredentials(route) }
  }
}

const firstLine = (s: string) => s.split(/\r?\n/)[0]?.trim() || null

const originOf = (url: string) => {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}

/** "PROXY user:pass@host:8080" → "PROXY [REDACTED]@host:8080". */
export const withoutCredentials = (route: string) =>
  route.replace(/[^\s;@]+:[^\s;@]+@/g, `${REDACTED}@`)

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
/** \\server\share\… (and as JSON writes it), not part of a drive path like C:\\Users. */
const UNC = /(?<![\w:])\\{2,4}[^\\\s"]+(\\{1,2}[^\\\s"]+)+/g
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Identity {
  home: string
  /** OS account name. */
  user: string
  /** Account names and emails from Settings. */
  names?: readonly string[]
}

/**
 * One text for logs and values: credentials and emails removed; the home folder (any slash
 * direction or case, also JSON-escaped) becomes ~; network-share paths become [PATH]; account
 * names become [NAME] wherever they appear.
 */
export function scrub(text: string, who: Identity): string {
  let out = redact(text).replace(EMAIL, '[EMAIL]')
  if (who.home) {
    // C:\Users\Me, C:/Users/Me, C:\\Users\\Me (JSON): any separator run, any case.
    const parts = who.home
      .split(/[\\/]+/)
      .filter(Boolean)
      .map(escapeRe)
    const lead = /^[\\/]/.test(who.home) ? '[\\\\/]+' : ''
    out = out.replace(new RegExp(lead + parts.join('[\\\\/]+'), 'gi'), '~')
  }
  out = out.replace(UNC, '[PATH]')
  // Shorter names ("dev", "bob") would also hit ordinary words.
  const names = [who.user, ...(who.names ?? [])].filter((n) => n.trim().length >= 4)
  for (const name of names) {
    out = out.replace(new RegExp(`(?<![\\w.-])${escapeRe(name)}(?![\\w-])`, 'gi'), '[NAME]')
  }
  return out
}

export interface ReportInput {
  info: Diagnostics
  settings: Settings
  log: string
  tests: Partial<Record<ServiceName, TestRecord>>
  credentials: Record<ServiceName, boolean>
  identity: Omit<Identity, 'names'>
  now: Date
}

/**
 * The exported report. Pure. Settings keep their shape but not who you are: account names and
 * emails are replaced everywhere they appear (JQL, logs, commands too), repo paths start at ~,
 * quick links keep only their host. Credentials are never stored in settings; only whether
 * each is saved is reported.
 */
export function diagnosticsReport(r: ReportInput): string {
  const { settings } = r
  const hide = (v: string) => (v ? REDACTED : '')
  const safeSettings = {
    ...settings,
    jira: { ...settings.jira, email: hide(settings.jira.email) },
    bitbucket: { ...settings.bitbucket, username: hide(settings.bitbucket.username) },
    jenkins: { ...settings.jenkins, username: hide(settings.jenkins.username) },
    standup: { ...settings.standup, authorEmail: hide(settings.standup.authorEmail) },
    quickLinks: settings.quickLinks.map((l) => ({
      name: l.name,
      group: l.group,
      host: hostOf(l.url),
    })),
  }
  const tail = r.log.split(/\r?\n/).filter(Boolean).slice(-LOG_TAIL_LINES)
  const report = {
    generatedAt: r.now.toISOString(),
    note: 'DevDock diagnostics. No credentials; account names, emails and your home folder are replaced.',
    info: r.info,
    credentialsSaved: r.credentials,
    lastConnectionTests: r.tests,
    settings: safeSettings,
    log: tail,
  }
  const names = [
    settings.jira.email,
    settings.bitbucket.username,
    settings.jenkins.username,
    settings.standup.authorEmail,
    // The part before @ often appears alone (user names, JQL).
    ...[settings.jira.email, settings.standup.authorEmail].map((e) => e.split('@')[0] ?? ''),
  ]
  return scrub(JSON.stringify(report, null, 2), { ...r.identity, names })
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
