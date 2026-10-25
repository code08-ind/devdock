import type { PullRequest } from '@shared/bitbucket'
import type {
  BranchBuild,
  BranchesResult,
  BuildDetail,
  BuildRef,
  ConsoleChunk,
  JenkinsConnection,
  JobPath,
} from '@shared/jenkins'
import type { Settings } from '@shared/settings'
import type { HttpClient } from '../http'
import { ServiceError } from '../service-error'
import { mapLimit } from '../async'
import { JenkinsClient, type JenkinsConfig } from './client'
import { myBuilds, resolvePrJob, type MyWork, type PrJobResolution } from './resolve'

export interface JenkinsDemo {
  config: JenkinsConfig
  /** Stands in for Settings → Jenkins → jobs while demo mode is on. */
  jobs: JobPath[]
}

export interface JenkinsServiceDeps {
  http: HttpClient
  settings: () => Settings
  token: () => string | undefined
  /** Local branches of the registered repos and my open PRs ("My branches"). */
  myWork: () => Promise<MyWork>
  demo: JenkinsDemo
}

/** Configured jobs read at once. */
const JOB_CONCURRENCY = 4

/** Jenkins for the app: config from Settings + the `jenkins.token` secret, or the demo fixtures. */
export class JenkinsService {
  private cached: { signature: string; client: JenkinsClient } | null = null

  constructor(private readonly deps: JenkinsServiceDeps) {}

  async testConnection(): Promise<JenkinsConnection> {
    return this.client().testConnection()
  }

  /**
   * SPEC 6.4 "My branches": the last build of each branch I have locally or in open PRs,
   * newest first. A configured job that can't be read (404, 403) is listed in `skipped`; any
   * other failure (auth, network) fails the whole list.
   */
  async branches(): Promise<BranchesResult> {
    const [{ builds, skipped }, work] = await Promise.all([this.allBranches(), this.deps.myWork()])
    const mine = myBuilds(builds, work)
    mine.sort((a, b) => (b.lastBuild?.startedAt ?? 0) - (a.lastBuild?.startedAt ?? 0))
    return { builds: mine, skipped }
  }

  async build(ref: BuildRef): Promise<BuildDetail> {
    return this.client().build(ref)
  }

  async console(ref: BuildRef, start: number): Promise<ConsoleChunk> {
    return this.client().console(ref, start)
  }

  /** "Watch PR pipeline": the job that builds this PR, or why none was found. */
  async resolvePr(pr: PullRequest): Promise<PrJobResolution> {
    const { builds } = await this.allBranches()
    return resolvePrJob(
      {
        repo: pr.ref.repo,
        id: pr.ref.id,
        sourceBranch: pr.sourceBranch,
        buildUrls: pr.build.statuses.flatMap((s) => s.url ?? []),
      },
      builds,
      this.config().baseUrl,
      this.jobs(),
    )
  }

  private async allBranches(): Promise<{
    builds: BranchBuild[]
    skipped: BranchesResult['skipped']
  }> {
    const client = this.client()
    const jobs = this.jobs()
    if (jobs.length === 0) {
      throw new ServiceError(
        'not_configured',
        'No Jenkins jobs to show yet: add your multibranch pipeline jobs in Settings → Jenkins.',
      )
    }
    const lists = await mapLimit(jobs, JOB_CONCURRENCY, async (job) => {
      try {
        return { job, builds: await client.branches(job), message: null }
      } catch (err) {
        if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
          return { job, builds: [], message: err.message }
        }
        throw err
      }
    })
    // In Settings order (mapLimit keeps it), whichever job answered first.
    return {
      builds: lists.flatMap((l) => l.builds),
      skipped: lists.flatMap((l) =>
        l.message === null ? [] : [{ job: l.job, message: l.message }],
      ),
    }
  }

  private jobs(): JobPath[] {
    return this.deps.http.demo ? this.deps.demo.jobs : this.deps.settings().jenkins.jobs
  }

  private client(): JenkinsClient {
    const config = this.config()
    const signature = JSON.stringify(config)
    if (this.cached?.signature !== signature) {
      this.cached = { signature, client: new JenkinsClient(this.deps.http, config) }
    }
    return this.cached.client
  }

  private config(): JenkinsConfig {
    if (this.deps.http.demo) return this.deps.demo.config
    const { baseUrl, username } = this.deps.settings().jenkins
    const token = this.deps.token()
    const missing = [
      !baseUrl && 'the server URL',
      !username && 'your user name',
      !token && 'an API token',
    ].filter(Boolean)
    if (missing.length) {
      throw new ServiceError(
        'not_configured',
        `Jenkins isn't set up yet: add ${missing.join(', ')} in Settings → Jenkins (or turn on demo mode).`,
      )
    }
    return { baseUrl, username, token: token! }
  }
}
