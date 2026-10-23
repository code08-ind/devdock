import type { JiraFlavorApi } from './flavor'
import { text } from './json'
import { wikiToMarkdown } from './wiki'

/** Jira Data Center / Server: REST v2, personal access token as Bearer, wiki-markup rich text. */
export const datacenter: JiraFlavorApi = {
  flavor: 'datacenter',
  api: '/rest/api/2',
  authorization: ({ token }) => `Bearer ${token}`,
  searchUrl: (baseUrl, jql, fields, max) =>
    `${baseUrl}/rest/api/2/search?${new URLSearchParams({
      jql,
      fields: fields.join(','),
      maxResults: String(max),
    })}`,
  hints: {
    auth: "Check the personal access token in Settings → Jira, and that it hasn't expired or been revoked.",
    forbidden:
      'Jira Data Center needs a personal access token (sent as Bearer); some sites also restrict REST API access.',
  },
  richText: (value) => wikiToMarkdown(typeof value === 'string' ? value : ''),
  user: (raw) => ({
    displayName: text(raw.displayName) ?? 'Unknown user',
    account: text(raw.name) ?? text(raw.emailAddress),
  }),
}
