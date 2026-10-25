/**
 * Git hosting providers (P7.04). A pull request (GitLab: merge request) comes from Bitbucket,
 * GitHub or GitLab; the same lists, rows, watcher, notifications, Today, panel and palette
 * show all three. Dependency-free: `bitbucket.ts` (the PR model) imports it.
 */

export const PROVIDERS = ['bitbucket', 'github', 'gitlab'] as const
export type Provider = (typeof PROVIDERS)[number]

/** Providers that also run CI DevDock reads (Bitbucket's builds come from Jenkins). */
export const CI_PROVIDERS = ['github', 'gitlab'] as const
export type CiProvider = (typeof CI_PROVIDERS)[number]

export const PROVIDER_NAMES: Record<Provider, string> = {
  bitbucket: 'Bitbucket',
  github: 'GitHub',
  gitlab: 'GitLab',
}

/** What each provider calls a pull request. */
export const PR_NOUN: Record<Provider, string> = {
  bitbucket: 'pull request',
  github: 'pull request',
  gitlab: 'merge request',
}

export const GITHUB_WEB = 'https://github.com'
export const GITLAB_WEB = 'https://gitlab.com'

/** "Bitbucket", "Bitbucket or GitHub", "Bitbucket, GitHub or GitLab". */
export function providerList(providers: readonly Provider[]): string {
  const names = providers.map((p) => PROVIDER_NAMES[p])
  if (names.length <= 1) return names[0] ?? 'Bitbucket'
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

export interface RemoteProject {
  /** Lower-case host name of the remote (no port). */
  host: string
  /** `owner/repo` (GitHub, Bitbucket) or `group/sub/project` (GitLab), without `.git`. */
  path: string
}

/**
 * Host and project path of a git remote: scp-style (`git@host:path.git`), `ssh://`, `git://`
 * or `http(s)://`. Null for local paths and anything unreadable. A remote's host decides its
 * provider (`providerForHost`).
 */
export function remoteProject(remote: string): RemoteProject | null {
  const trimmed = remote.trim()
  const scp = /^(?:[\w.-]+@)?([A-Za-z0-9.-]+):(?!\/\/)\/?(.+?)(?:\.git)?\/?$/.exec(trimmed)
  const url =
    /^(?:https?|ssh|git(?:\+ssh)?):\/\/(?:[^@/\s]+@)?([A-Za-z0-9.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    )
  const m = url ?? scp
  if (!m || /^[A-Za-z]$/.test(m[1]!)) return null // `C:\…` is a Windows path, not scp
  const parts = m[2]!.split('/').filter(Boolean)
  if (parts.length < 2 || parts.some((p) => p === '.' || p === '..' || /\s/.test(p))) return null
  return { host: m[1]!.toLowerCase(), path: parts.join('/') }
}

/** Host name of a base URL, lower case; null when empty or unreadable. */
export function hostOf(baseUrl: string): string | null {
  if (!baseUrl) return null
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Configured hosts per provider: what decides a remote's provider. */
export interface ProviderHosts {
  bitbucket: string | null
  github: string
  gitlab: string
}

/**
 * The provider a remote host belongs to: the public sites, the hosts set in Settings (GitHub
 * Enterprise Server, self-managed GitLab, Bitbucket Data Center), else a name that says so
 * (`github.corp.example`, `gitlab.example.com`). Null when nothing matches.
 */
export function providerForHost(host: string, hosts: ProviderHosts): Provider | null {
  const h = host.toLowerCase().replace(/^(www|ssh)\./, '')
  if (h === 'bitbucket.org' || (hosts.bitbucket && h === hosts.bitbucket)) return 'bitbucket'
  if (h === 'github.com' || h === hosts.github) return 'github'
  if (h === 'gitlab.com' || h === hosts.gitlab) return 'gitlab'
  if (/(^|[.-])github([.-]|$)/.test(h)) return 'github'
  if (/(^|[.-])gitlab([.-]|$)/.test(h)) return 'gitlab'
  if (/(^|[.-])bitbucket([.-]|$)/.test(h)) return 'bitbucket'
  return null
}
