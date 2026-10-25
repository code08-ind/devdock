/**
 * Security baseline (SPEC §5). Pure helpers are exported for unit tests; `installSecurity`
 * wires them into Electron.
 */
import type { App, WebContents } from 'electron'
import { providerWeb, type Settings } from '@shared/settings'
import { DEMO_HOSTS, DEMO_ORIGIN } from './demo/origin'

export const WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
} as const

export const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Dev only: Vite's React Refresh preamble is an inline script and HMR uses a websocket. */
export const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

function hostMatches(hostname: string, allowed: string): boolean {
  const h = hostname.toLowerCase()
  const a = allowed.toLowerCase().replace(/^\*\./, '')
  return h === a || h.endsWith(`.${a}`)
}

export type ExternalUrlVerdict = { ok: true; url: string } | { ok: false; reason: string }

/** Only http(s) URLs whose host is (a subdomain of) an allow-listed host may be opened. */
export function checkExternalUrl(raw: string, allowedHosts: readonly string[]): ExternalUrlVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'Not a valid URL.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `Links using "${url.protocol}" are not allowed.` }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Links with embedded credentials are not allowed.' }
  }
  if (!allowedHosts.some((a) => hostMatches(url.hostname, a))) {
    return {
      ok: false,
      reason: `${url.hostname} is not in the link allowlist. Add it in Settings → Links.`,
    }
  }
  return { ok: true, url: url.toString() }
}

/** Whether an in-app navigation stays on the app's own origin. */
export function isAppUrl(target: string, appOrigin: string): boolean {
  try {
    const t = new URL(target)
    if (appOrigin === 'file://') return t.protocol === 'file:'
    return t.origin === new URL(appOrigin).origin
  } catch {
    return false
  }
}

export interface SecurityDeps {
  appOrigin: string
  isDev: boolean
  /** Called for blocked new-window requests so allowed links still open in the browser. */
  onExternalRequest: (url: string) => void
  onBlocked: (kind: 'navigate' | 'window' | 'webview' | 'permission', detail: string) => void
}

export function hardenWebContents(contents: WebContents, deps: SecurityDeps): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, deps.appOrigin)) {
      event.preventDefault()
      deps.onBlocked('navigate', url)
    }
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, deps.appOrigin)) {
      event.preventDefault()
      deps.onBlocked('navigate', url)
    }
  })
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    deps.onBlocked('webview', '')
  })
  contents.setWindowOpenHandler(({ url }) => {
    deps.onBlocked('window', url)
    deps.onExternalRequest(url)
    return { action: 'deny' }
  })
}

export function installSecurity(app: App, deps: SecurityDeps): void {
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents, deps))
  app.whenReady().then(async () => {
    const { session } = await import('electron')
    const csp = deps.isDev ? CSP_DEV : CSP_PROD
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      })
    })
    // No camera, mic, geolocation, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      const allowed = permission === 'clipboard-sanitized-write'
      if (!allowed) deps.onBlocked('permission', permission)
      cb(allowed)
    })
  })
}

/**
 * Hosts links may open in the browser (SPEC 5): the user's list, the configured services, the
 * demo fixtures' host in demo mode, and local dev servers (P1 "Start dev server" URL).
 * Shared by `app:openExternal` and notification clicks.
 */
export function linkHosts(settings: Settings, demo: boolean): string[] {
  return [
    ...settings.links.allowedHosts,
    ...serviceHosts(settings),
    // Quick links the user added are theirs to open (SPEC 6.6).
    ...settings.quickLinks.flatMap((l) => {
      try {
        return [new URL(l.url).hostname]
      } catch {
        return []
      }
    }),
    ...(demo ? [new URL(DEMO_ORIGIN).hostname, ...DEMO_HOSTS] : []),
    'localhost',
    '127.0.0.1',
    '[::1]',
  ]
}

/** Hosts of the services configured in Settings (links to them may be opened). */
function serviceHosts(settings: Settings): string[] {
  // GitHub / GitLab (P7): their site, public or self-hosted, while turned on.
  const hosting = (['github', 'gitlab'] as const).flatMap((p) =>
    settings[p].enabled ? [providerWeb(settings, p)] : [],
  )
  return [
    settings.jira.baseUrl,
    settings.bitbucket.baseUrl,
    settings.jenkins.baseUrl,
    ...hosting,
  ].flatMap(
    (url) => {
      try {
        return url ? [new URL(url).hostname] : []
      } catch {
        return []
      }
    },
  )
}
