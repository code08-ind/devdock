import { z } from 'zod'
import { PROVIDERS } from './providers'

/** P7.05 / P7.06: what Test connection and Detect report for GitHub and GitLab. */

export const HostConnectionSchema = z.object({
  status: z.number().int(),
  user: z.object({ displayName: z.string(), account: z.string().nullable() }),
  /** The API the token was checked against. */
  apiUrl: z.string(),
  /** GitHub Enterprise Server / self-managed GitLab version, when the server says. */
  version: z.string().nullable(),
  /**
   * Classic GitHub tokens list their scopes (`X-OAuth-Scopes`); fine-grained tokens and GitLab
   * don't say. Shown so a missing scope is visible before a list fails.
   */
  scopes: z.string().nullable(),
})
export type HostConnection = z.infer<typeof HostConnectionSchema>

/** One host found in the registered repos' remotes (Settings → Detect). */
export const RemoteHostSchema = z.object({
  host: z.string(),
  provider: z.enum(PROVIDERS).nullable(),
  /** Registered repos with a remote on it. */
  repos: z.array(z.string()),
})
export type RemoteHost = z.infer<typeof RemoteHostSchema>
