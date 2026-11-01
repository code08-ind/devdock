import { z } from 'zod'

/** Diagnostics (SPEC 6.7 / P6.04): what's running, through which proxy. */

/** The services DevDock talks to, as people name them, with their settings key. */
export const SERVICES = [
  ['Jira', 'jira'],
  ['Bitbucket', 'bitbucket'],
  ['Jenkins', 'jenkins'],
  ['GitHub', 'github'],
  ['GitLab', 'gitlab'],
  ['Anthropic', 'anthropic'],
  ['OpenAI', 'openai'],
  ['Google Gemini', 'google'],
] as const
export type ServiceName = (typeof SERVICES)[number][0]
export type ServiceKey = (typeof SERVICES)[number][1]

/** The keychain entry each service's credential is saved under. */
export const credentialOf = (key: ServiceKey) => (isAiKey(key) ? `${key}.key` : `${key}.token`)

/** The AI providers' rows (T6): tested through the active provider only. */
export const isAiKey = (key: ServiceKey): key is 'anthropic' | 'openai' | 'google' =>
  key === 'anthropic' || key === 'openai' || key === 'google'

/** Each AI provider's diagnostics row. */
export const AI_SERVICE_NAME = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
} as const satisfies Record<'anthropic' | 'openai' | 'google', ServiceName>

export const ProxyRouteSchema = z.object({
  service: z.enum(SERVICES.map(([name]) => name) as [ServiceName, ...ServiceName[]]),
  /** The service's origin, or null when it isn't set up. */
  origin: z.string().nullable(),
  /** Chromium's answer for that origin ("DIRECT", "PROXY host:port; DIRECT"), credentials removed. */
  route: z.string().nullable(),
})
export type ProxyRoute = z.infer<typeof ProxyRouteSchema>

export const DiagnosticsSchema = z.object({
  app: z.string(),
  electron: z.string(),
  chrome: z.string(),
  /** Node inside Electron (what DevDock runs on). */
  node: z.string(),
  /** `node --version` on PATH, if installed (dev servers use it). */
  systemNode: z.string().nullable(),
  /** `git --version`, if installed. */
  git: z.string().nullable(),
  platform: z.string(),
  arch: z.string(),
  demoMode: z.boolean(),
  proxies: z.array(ProxyRouteSchema),
})
export type Diagnostics = z.infer<typeof DiagnosticsSchema>

/**
 * A manual proxy (SPEC 5 "manual proxy override"): `host:port` or `http(s)://host:port`, no
 * credentials (proxy sign-in uses the system's own prompt). Empty with "system" mode.
 */
export const ProxyServerSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^(https?:\/\/)?[\w.-]+(:\d{1,5})$/.test(v), {
    message: 'Use host:port, e.g. proxy.corp.example:8080',
  })
  .refine((v) => !v.includes('@'), {
    message: "Leave sign-in details out; you'll be asked for them",
  })

/** Chromium's proxy rules for a manual proxy ("http://host:port" → "host:port" with scheme). */
export function proxyRules(server: string): string {
  const s = server.trim()
  return /^https?:\/\//.test(s) ? s : `http://${s}`
}
