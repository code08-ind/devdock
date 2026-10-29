import type { PrActionRequest, PrList, PrRef, PullRequest } from '@shared/bitbucket'
import type { CiActionRequest, CiLog, CiRun, CiRunDetail, CiRunRef, CiRunsResult } from '@shared/ci'
import type { HostConnection } from '@shared/hosting'
import { PROVIDER_NAMES, remoteProject, type CiProvider } from '@shared/providers'
import { providerWeb, type Settings } from '@shared/settings'
import type { ActionResult } from '../bitbucket/client'
import { siteKey } from '../bitbucket/service'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import type { HostClient } from './common'
import type { PrSource } from './hub'

/** What a GitHub / GitLab client is built from. */
export interface HostConfig {
  baseUrl: string
  token: string
}

export interface HostServiceDeps {
  provider: CiProvider
  http: HttpClient
  settings: () => Settings
  token: () => string | undefined
  /** Remote URLs of the registered repos (CI lists runs for the repos hosted there). */
  repoRemotes: () => Promise<string[]>
  /** Demo mode: the fixture site, and its projects (no registered repos needed). */
  demo: { config: HostConfig; projects: string[] }
  makeClient: (
    http: HttpClient,
    config: HostConfig,
    projects: () => Promise<string[]>,
  ) => HostClient
}

/**
 * GitHub or GitLab for the app (P7.05 / P7.06): config from Settings + the token secret, or
 * the demo fixtures; one cached client per configuration (it holds the ETag cache and the
 * rate-limit pause). Same shape as BitbucketService, so the hub and handlers treat them alike.
 */
export class HostService implements PrSource {
  private cached: { signature: string; client: HostClient } | null = null

  constructor(private readonly deps: HostServiceDeps) {}

  get name(): string {
    return PROVIDER_NAMES[this.deps.provider]
  }

  testConnection(): Promise<HostConnection> {
    return this.client().testConnection()
  }

  list(list: PrList): Promise<PullRequest[]> {
    return this.client().list(list)
  }

  pr(ref: PrRef): Promise<PullRequest> {
    return this.client().pr(ref)
  }

  /** The handler has already checked `features.prActions` and the confirmation. */
  act(request: PrActionRequest): Promise<ActionResult> {
    return this.client().act(request.ref, request.action, request.targetBranch)
  }

  runs(): Promise<CiRunsResult> {
    return this.client().runs()
  }

  runInfo(ref: CiRunRef): Promise<CiRun> {
    return this.client().runInfo(ref)
  }

  run(ref: CiRunRef): Promise<CiRunDetail> {
    return this.client().run(ref)
  }

  log(ref: CiRunRef, jobId: number): Promise<CiLog> {
    return this.client().log(ref, jobId)
  }

  /** The handler has already checked `features.ciActions` and the confirmation. */
  ciAct(request: CiActionRequest): Promise<CiRun> {
    return this.client().ciAct(request.ref, request.action)
  }

  /** Where PRs and runs are read from (`siteKey` spelling); null while turned off. */
  site(): string | null {
    const s = this.deps.settings()
    if (!s[this.deps.provider].enabled) return null
    if (this.deps.http.demo) return siteKey(this.deps.demo.config.baseUrl)
    return siteKey(providerWeb(s, this.deps.provider))
  }

  private client(): HostClient {
    const config = this.config()
    const signature = JSON.stringify(config)
    if (this.cached?.signature !== signature) {
      const projects = this.deps.http.demo
        ? () => Promise.resolve(this.deps.demo.projects)
        : () => this.projects(config.baseUrl)
      this.cached = {
        signature,
        client: this.deps.makeClient(this.deps.http, config, projects),
      }
    }
    return this.cached.client
  }

  /** Registered repos whose remote is on this site, as project paths (first spelling wins). */
  private async projects(baseUrl: string): Promise<string[]> {
    const host = new URL(baseUrl).hostname.toLowerCase()
    const root = new URL(baseUrl).pathname.replace(/^\/+|\/+$/g, '')
    const seen = new Set<string>()
    const out: string[] = []
    for (const url of await this.deps.repoRemotes()) {
      const remote = remoteProject(url)
      if (!remote || remote.host.replace(/^(www|ssh)\./, '') !== host.replace(/^www\./, '')) {
        continue
      }
      // A self-managed GitLab under a relative root has it in front of the group in HTTPS remotes.
      let path = remote.path
      if (root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        path = path.slice(root.length + 1)
      }
      if (this.deps.provider === 'github' && path.split('/').length !== 2) continue
      const key = path.toLowerCase()
      if (!seen.has(key) && seen.add(key)) out.push(path)
    }
    return out
  }

  private config(): HostConfig {
    const s = this.deps.settings()
    const name = this.name
    if (!s[this.deps.provider].enabled) {
      throw new ServiceError(
        'not_configured',
        `${name} is turned off. Turn it on in Settings → ${name}.`,
      )
    }
    if (this.deps.http.demo) return this.deps.demo.config
    const token = this.deps.token()
    if (!token) {
      throw new ServiceError(
        'not_configured',
        `${name} isn't set up yet: add a personal access token in Settings → ${name} (or turn on demo mode).`,
      )
    }
    return { baseUrl: providerWeb(s, this.deps.provider), token }
  }
}
