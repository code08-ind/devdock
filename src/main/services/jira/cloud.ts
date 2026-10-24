import { adfToMarkdown } from './adf'
import type { JiraFlavorApi } from './flavor'
import { text } from '../json'

/** Jira Cloud: REST v3, Basic auth with account email + API token, ADF rich text. */
export const cloud: JiraFlavorApi = {
  flavor: 'cloud',
  api: '/rest/api/3',
  authorization: ({ email, token }) =>
    `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`,
  // `/search` was retired on Cloud in favour of `/search/jql` (token-paginated).
  searchUrl: (baseUrl, jql, fields, max) =>
    `${baseUrl}/rest/api/3/search/jql?${new URLSearchParams({
      jql,
      fields: fields.join(','),
      maxResults: String(max),
    })}`,
  richText: adfToMarkdown,
  hints: {
    auth: "Check the account email and API token in Settings → Jira, and that the token hasn't expired or been revoked.",
    forbidden:
      'Jira Cloud needs the account email with an API token (not your password or a personal access token).',
  },
  user: (raw) => ({
    displayName: text(raw.displayName) ?? 'Unknown user',
    account: text(raw.emailAddress) ?? text(raw.accountId),
  }),
}
