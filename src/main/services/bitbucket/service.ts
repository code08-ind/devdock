import type { ReviewComment } from '@shared/lessons'
import type {
  BitbucketConnection,
  BitbucketDetection,
  PrActionRequest,
  PrList,
  PrRef,
  PullRequest,
  RepoRef,
} from '@shared/bitbucket'
import { CLOUD_WEB, cloudRepoFromRemote, isCloudHost } from '@shared/prlink'
import type { Settings } from '@shared/settings'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { BitbucketClient, type ActionResult, type BitbucketConfig } from './client'
import { detectBitbucket } from './detect'

export interface BitbucketServiceDeps {
  http: HttpClient
  settings: () => Settings
  token: () => string | undefined
  /** Remote URLs of the registered repos (Cloud scans their bitbucket.org repos). */
  repoRemotes: () => Promise<string[]>
  /** Site used while demo mode is on (the MSW fixtures). */
  demo: { config: BitbucketConfig }
}

/**
 * One spelling per site: origin (default port dropped) + context path, lower case, no
 * trailing `/`. Every bitbucket.org host is Cloud's one site.
 */
export function siteKey(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (isCloudHost(url.hostname)) return CLOUD_WEB
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
}

/** Bitbucket for the app: config from Settings + the `bitbucket.token` secret, or the demo fixtures. */
export class BitbucketService {
  private cached: { signature: string; client: BitbucketClient } | null = null

  constructor(private readonly deps: BitbucketServiceDeps) {}

  /** Probes a base URL (the one being typed in Settings, so not the saved one). */
  async detect(baseUrl: string): Promise<BitbucketDetection> {
    const url = this.deps.http.demo ? this.deps.demo.config.baseUrl : baseUrl.replace(/\/+$/, '')
    return detectBitbucket(this.deps.http, url)
  }

  async testConnection(): Promise<BitbucketConnection> {
    return this.client().testConnection()
  }

  async list(list: PrList): Promise<PullRequest[]> {
    return this.client().list(list)
  }

  async pr(ref: PrRef): Promise<PullRequest> {
    return this.client().pr(ref)
  }

  /** Review comments on my recent PRs, for agent lessons (P6-F). */
  async reviewComments(): Promise<ReviewComment[]> {
    return this.client().reviewComments()
  }

  /** The handler has already checked `features.prActions` and the confirmation. */
  async act(request: PrActionRequest): Promise<ActionResult> {
    return this.client().act(request.ref, request.action, request.targetBranch)
  }

  /**
   * The site PRs are read from, lower case: the demo server, bitbucket.org or the DC URL.
   * Watched links must belong to it. Doesn't need a token (null when no DC URL is set).
   */
  site(): string | null {
    if (this.deps.http.demo) return siteKey(this.deps.demo.config.baseUrl)
    const { flavor, baseUrl } = this.deps.settings().bitbucket
    if (flavor === 'cloud') return siteKey(baseUrl || CLOUD_WEB)
    return baseUrl ? siteKey(baseUrl) : null
  }

  private client(): BitbucketClient {
    const config = this.config()
    const signature = JSON.stringify(config)
    if (this.cached?.signature !== signature) {
      this.cached = {
        signature,
        client: new BitbucketClient(this.deps.http, config, () => this.cloudRepos()),
      }
    }
    return this.cached.client
  }

  private async cloudRepos(): Promise<RepoRef[]> {
    const repos = (await this.deps.repoRemotes()).flatMap((url) => cloudRepoFromRemote(url) ?? [])
    // Workspace and repo slugs are case-insensitive on Cloud; the first spelling wins.
    const seen = new Set<string>()
    return repos.filter((r) => {
      const key = `${r.owner}/${r.repo}`.toLowerCase()
      return !seen.has(key) && seen.add(key)
    })
  }

  private config(): BitbucketConfig {
    if (this.deps.http.demo) return this.deps.demo.config
    const { flavor, baseUrl, username } = this.deps.settings().bitbucket
    const token = this.deps.token()
    const missing = [
      flavor === 'datacenter' && !baseUrl && 'the server URL',
      !token &&
        (flavor === 'cloud'
          ? 'an API token, app password or access token'
          : 'an HTTP access token'),
    ].filter(Boolean)
    if (missing.length) {
      throw new ServiceError(
        'not_configured',
        `Bitbucket isn't set up yet: add ${missing.join(', ')} in Settings → Bitbucket (or turn on demo mode).`,
      )
    }
    return {
      flavor,
      // Cloud is always bitbucket.org unless a URL was given.
      baseUrl: baseUrl || CLOUD_WEB,
      username: flavor === 'cloud' ? username : '',
      token: token!,
    }
  }
}
