import type {
  BitbucketConnection,
  BitbucketDetection,
  PrList,
  PrRef,
  PullRequest,
  RepoRef,
} from '@shared/bitbucket'
import { CLOUD_WEB, cloudRepoFromRemote } from '@shared/prlink'
import type { Settings } from '@shared/settings'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { BitbucketClient, type BitbucketConfig } from './client'
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
