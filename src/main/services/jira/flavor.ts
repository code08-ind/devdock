import type { JiraFlavor, JiraUser } from '@shared/jira'
import type { ServiceHints } from '../service-error'

/** What differs between Jira Cloud and Data Center; JiraClient does the rest. */
export interface JiraFlavorApi {
  flavor: JiraFlavor
  /** e.g. `/rest/api/3`. */
  api: string
  authorization(creds: { email: string; token: string }): string
  /** URL for a JQL search returning `{ issues: [...] }`. */
  searchUrl(baseUrl: string, jql: string, fields: string[], max: number): string
  /** Description/comment value → Markdown. */
  richText(value: unknown): string
  user(raw: Record<string, unknown>): JiraUser
  /** Fix-it text for 401/403, in this flavour's auth terms. */
  hints: ServiceHints
}
