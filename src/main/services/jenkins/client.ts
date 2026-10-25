import {
  displayName,
  isJobPath,
  jobUrl,
  type BranchBuild,
  type BuildDetail,
  type BuildRef,
  type ConsoleChunk,
  type JenkinsBuild,
  type JenkinsConnection,
  type JobPath,
} from '@shared/jenkins'
import type { HttpClient } from '../http'
import { num, obj, text } from '../json'
import { readJson, send, type RestTarget } from '../rest'
import { ServiceError, type ServiceHints } from '../service-error'
import { consoleChunk } from './console'
import { buildActions, buildState, buildTimes, parseStages } from './wfapi'

export interface JenkinsConfig {
  baseUrl: string
  username: string
  /** API token (Jenkins user → Security → API Token). */
  token: string
}

export const jenkinsHints: ServiceHints = {
  auth: 'Check the user name and API token in Settings → Jenkins (create a token under your Jenkins user → Security → API Token).',
  forbidden:
    'Your Jenkins user may lack Overall/Read or Job/Read permission, or Jenkins refused the crumb.',
}

/** Folders, multibranch jobs and organization folders hold jobs instead of builds. */
const CONTAINER = /Folder|MultiBranchProject|OrganizationFolder/
/** Organization folder → repo multibranch job → branch jobs. */
const MAX_DEPTH = 2
const LAST_BUILD = 'lastBuild[number,result,building,timestamp,duration,estimatedDuration]'
const TREE = `_class,jobs[_class,name,${LAST_BUILD}]`
const PR_JOB = /^PR-(\d+)$/

interface Crumb {
  field: string
  value: string
  /** Session cookie the crumb is bound to (older Jenkins); sent back with the POST. */
  cookie: string | null
}

/** One Jenkins site (SPEC 6.4): Basic auth with an API token, crumbs for POSTs. */
export class JenkinsClient {
  private readonly target: RestTarget
  private readonly base: string
  private crumb: Promise<Crumb | null> | null = null

  constructor(
    private readonly http: HttpClient,
    config: JenkinsConfig,
    timeoutMs = 20_000,
  ) {
    this.base = config.baseUrl.replace(/\/+$/, '')
    this.target = {
      service: 'Jenkins',
      authorization: `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}`,
      hints: jenkinsHints,
      timeoutMs,
    }
  }

  /** "Test connection": who the credentials authenticate as. */
  async testConnection(): Promise<JenkinsConnection> {
    const res = await this.get(`${this.base}/me/api/json?tree=id,fullName`)
    const me = obj(await readJson(this.target, res))
    const id = text(me.id)
    if (!id || id === 'anonymous') {
      throw new ServiceError(
        'auth',
        `Jenkins answered as an anonymous user, so the credentials weren't accepted. ${jenkinsHints.auth}`,
        { status: res.status },
      )
    }
    return {
      status: res.status,
      user: { id, fullName: text(me.fullName) ?? id },
      version: res.headers.get('x-jenkins'),
    }
  }

  /**
   * Every branch and PR job under a configured job (a multibranch job, or a folder of them,
   * two levels deep), each with its last build. Child names from the server are checked
   * before they go into a URL; ones that don't pass are left out.
   */
  async branches(project: JobPath): Promise<BranchBuild[]> {
    const out: BranchBuild[] = []
    const walk = async (path: JobPath, depth: number): Promise<void> => {
      const node = obj(await this.json(`${jobUrl(this.base, path)}/api/json?tree=${TREE}`))
      const jobs = Array.isArray(node.jobs) ? node.jobs : []
      for (const raw of jobs) {
        const child = obj(raw)
        const name = text(child.name)
        const childPath = `${path}/${name}`
        if (!name || !isJobPath(childPath)) continue
        if (CONTAINER.test(text(child._class) ?? '')) {
          if (depth < MAX_DEPTH) await walk(childPath, depth + 1)
          continue
        }
        const pr = PR_JOB.exec(name)
        const last = child.lastBuild
        out.push({
          project: path,
          job: childPath,
          branch: displayName(name),
          kind: pr ? 'pr' : 'branch',
          prId: pr ? Number(pr[1]) : null,
          url: `${jobUrl(this.base, childPath)}/`,
          lastBuild: num(obj(last).number) === null ? null : this.toBuild(childPath, last),
        })
      }
    }
    await walk(project, 1)
    return out
  }

  /** One build with its stages (null when `wfapi` isn't there), parameters and causes. */
  async build({ job, number }: BuildRef): Promise<BuildDetail> {
    const url = `${jobUrl(this.base, job)}/${number}`
    const raw = await this.json(
      `${url}/api/json?tree=number,result,building,timestamp,duration,estimatedDuration,actions[parameters[_class,name,value],causes[shortDescription]]`,
    )
    return {
      build: this.toBuild(job, raw),
      stages: await this.stages(url),
      ...buildActions(raw),
    }
  }

  /** The console from byte `start` (SPEC 6.4 console tail). */
  async console({ job, number }: BuildRef, start: number): Promise<ConsoleChunk> {
    const res = await this.get(
      `${jobUrl(this.base, job)}/${number}/logText/progressiveText?start=${start}`,
      'text/plain',
    )
    return consoleChunk(start, new Uint8Array(await res.arrayBuffer()), {
      textSize: res.headers.get('x-text-size'),
      moreData: res.headers.get('x-more-data'),
    })
  }

  /**
   * Queues a build (`build`, or `buildWithParameters` when there are parameters) and returns
   * the queue item link from `Location`. Callers check the switch, allow-list and protected
   * patterns first: this only sends.
   */
  async trigger(job: JobPath, parameters: Record<string, string>): Promise<string | null> {
    const withParams = Object.keys(parameters).length > 0
    const res = await this.post(
      `${jobUrl(this.base, job)}/${withParams ? 'buildWithParameters' : 'build'}`,
      withParams ? new URLSearchParams(parameters) : undefined,
    )
    return res.headers.get('location')
  }

  /** Pipeline stages; null when the Pipeline REST API isn't installed or this isn't a Pipeline. */
  private async stages(buildUrl: string): Promise<BuildDetail['stages']> {
    try {
      return parseStages(await this.json(`${buildUrl}/wfapi/describe`))
    } catch (err) {
      if (err instanceof ServiceError && (err.kind === 'not_found' || err.kind === 'bad_response'))
        return null
      throw err
    }
  }

  private toBuild(job: JobPath, raw: unknown): JenkinsBuild {
    const number = num(obj(raw).number)
    if (number === null) {
      throw new ServiceError('bad_response', `Jenkins sent a build of ${job} without a number.`)
    }
    return {
      job,
      number,
      url: `${jobUrl(this.base, job)}/${number}/`,
      state: buildState(raw),
      ...buildTimes(raw),
    }
  }

  private get(url: string, accept = 'application/json'): Promise<Response> {
    return send(this.http, this.target, url, { method: 'GET', headers: { Accept: accept } })
  }

  private async json(url: string): Promise<unknown> {
    return readJson(this.target, await this.get(url))
  }

  /**
   * A POST with a crumb. Jenkins answers 403 when the crumb is missing, expired or bound to
   * another session, so a 403 fetches a fresh crumb and tries once more.
   */
  private async post(url: string, body?: URLSearchParams): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const crumb = await this.getCrumb()
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (crumb) headers[crumb.field] = crumb.value
      if (crumb?.cookie) headers.Cookie = crumb.cookie
      try {
        return await send(this.http, this.target, url, { method: 'POST', headers, body })
      } catch (err) {
        if (attempt > 0 || !(err instanceof ServiceError) || err.kind !== 'forbidden') throw err
        this.crumb = null
      }
    }
  }

  /** Cached until a POST is refused. Null when CSRF protection is off (no crumb issuer). */
  private getCrumb(): Promise<Crumb | null> {
    this.crumb ??= this.fetchCrumb().catch((err: unknown) => {
      this.crumb = null
      throw err
    })
    return this.crumb
  }

  private async fetchCrumb(): Promise<Crumb | null> {
    let res: Response
    try {
      res = await this.get(`${this.base}/crumbIssuer/api/json`)
    } catch (err) {
      if (err instanceof ServiceError && err.kind === 'not_found') return null
      throw err
    }
    const body = obj(await readJson(this.target, res))
    const field = text(body.crumbRequestField)
    const value = text(body.crumb)
    // The field becomes a header name: only a token Jenkins could plausibly use.
    if (!field || !value || !/^[A-Za-z0-9-]{1,64}$/.test(field)) {
      throw new ServiceError('bad_response', "Jenkins' crumb issuer gave an unusable answer.")
    }
    return { field, value, cookie: sessionCookie(res.headers) }
  }
}

/** `JSESSIONID…=…` pairs from `Set-Cookie`, as a `Cookie` header value; null when none. */
export function sessionCookie(headers: Headers): string | null {
  const all = headers.getSetCookie?.() ?? []
  const pairs = all
    .map((c) => c.split(';', 1)[0]!.trim())
    .filter((pair) => /^JSESSIONID[^=]*=[^;\s]+$/.test(pair))
  return pairs.length ? pairs.join('; ') : null
}
