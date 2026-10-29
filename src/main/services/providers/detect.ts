import type { RemoteHost } from '@shared/hosting'
import { hostOf, providerForHost, remoteProject, type ProviderHosts } from '@shared/providers'
import { providerWeb, type Settings } from '@shared/settings'

/** The hosts Settings point at, which decide a remote's provider (P7.04). */
export function configuredHosts(s: Settings): ProviderHosts {
  return {
    bitbucket: hostOf(s.bitbucket.baseUrl),
    github: hostOf(providerWeb(s, 'github')) ?? 'github.com',
    gitlab: hostOf(providerWeb(s, 'gitlab')) ?? 'gitlab.com',
  }
}

/**
 * Settings → Detect (P7.07): each host in the registered repos' remotes, the provider it
 * means, and which repos use it. Hosts DevDock can't place are listed with `provider: null`,
 * so the user sees why a repo's PRs or runs are missing.
 */
export function detectHosts(
  repos: readonly { name: string; remotes: readonly string[] }[],
  hosts: ProviderHosts,
): RemoteHost[] {
  const found = new Map<string, Set<string>>()
  for (const repo of repos) {
    for (const remote of repo.remotes) {
      const project = remoteProject(remote)
      if (!project) continue
      const host = project.host.replace(/^(www|ssh)\./, '')
      const names = found.get(host) ?? new Set<string>()
      names.add(repo.name)
      found.set(host, names)
    }
  }
  return [...found]
    .map(([host, names]) => ({
      host,
      provider: providerForHost(host, hosts),
      repos: [...names].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.repos.length - a.repos.length || a.host.localeCompare(b.host))
}
