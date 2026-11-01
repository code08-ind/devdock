import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CiWatcher, finishedNotice } from '../../src/main/services/ci/watcher'
import { configuredHosts, detectHosts } from '../../src/main/services/providers/detect'
import { PrHub, type PrSource } from '../../src/main/services/providers/hub'
import { ProviderRest, stripAnsi } from '../../src/main/services/providers/rest'
import { hostMessage, withHostWords } from '../../src/main/services/providers/common'
import { ServiceError } from '../../src/main/services/service-error'
import { prRefFromLink } from '../../src/main/services/watch'
import { watchedForTray } from '../../src/main/tray'
import { PrRefSchema, prKey, refLabel, type PullRequest } from '../../src/shared/bitbucket'
import {
  CiRunRefSchema,
  ciActionAllowed,
  parseRunLink,
  type CiRun,
  type CiRunRef,
} from '../../src/shared/ci'
import { parseAnyPrLink, withinSite } from '../../src/shared/prlink'
import { providerForHost, providerList, remoteProject } from '../../src/shared/providers'
import { SettingsSchema, defaultSettings, enabledProviders } from '../../src/shared/settings'
import { ScriptedHttp, json } from '../fixtures/jira'

describe('remotes and hosts (P7.04)', () => {
  it('reads scp, ssh and https remotes; refuses local paths and odd ones', () => {
    expect(remoteProject('git@github.com:acme/web.git')).toEqual({
      host: 'github.com',
      path: 'acme/web',
    })
    expect(remoteProject('ssh://git@gitlab.corp.example:2222/acme/web/checkout.git')).toEqual({
      host: 'gitlab.corp.example',
      path: 'acme/web/checkout',
    })
    expect(remoteProject('https://user@GitHub.com/acme/web/')).toEqual({
      host: 'github.com',
      path: 'acme/web',
    })
    expect(remoteProject('C:\\code\\web')).toBeNull()
    expect(remoteProject('/srv/git/web.git')).toBeNull()
    expect(remoteProject('https://github.com/acme/../web')).toBeNull()
  })

  it('a host decides the provider: public sites, configured hosts, then names', () => {
    const hosts = { bitbucket: 'bb.corp', github: 'code.corp', gitlab: 'gitlab.com' }
    expect(providerForHost('github.com', hosts)).toBe('github')
    expect(providerForHost('code.corp', hosts)).toBe('github')
    expect(providerForHost('bb.corp', hosts)).toBe('bitbucket')
    expect(providerForHost('ssh.gitlab.example.com', hosts)).toBe('gitlab')
    expect(providerForHost('git.example.com', hosts)).toBeNull()
    expect(providerList(['bitbucket', 'github', 'gitlab'])).toBe('Bitbucket, GitHub or GitLab')
  })

  it('Detect groups the repos by host and names each provider', () => {
    const s = SettingsSchema.parse({
      ...defaultSettings(),
      github: { enabled: true, baseUrl: 'https://code.corp' },
    })
    const found = detectHosts(
      [
        { name: 'web', remotes: ['git@code.corp:acme/web.git', 'https://github.com/me/web.git'] },
        { name: 'api', remotes: ['git@code.corp:acme/api.git'] },
        { name: 'local', remotes: ['/srv/git/x.git', 'git@odd.example:a/b.git'] },
      ],
      configuredHosts(s),
    )
    expect(found).toEqual([
      { host: 'code.corp', provider: 'github', repos: ['api', 'web'] },
      { host: 'github.com', provider: 'github', repos: ['web'] },
      { host: 'odd.example', provider: null, repos: ['local'] },
    ])
  })
})

describe('PR refs and links for every provider', () => {
  it('refs: subgroups only on GitLab; keys and labels per provider; old refs are Bitbucket', () => {
    expect(
      PrRefSchema.safeParse({ provider: 'gitlab', owner: 'a/b', repo: 'c', id: 1 }).success,
    ).toBe(true)
    expect(
      PrRefSchema.safeParse({ provider: 'github', owner: 'a/b', repo: 'c', id: 1 }).success,
    ).toBe(false)
    expect(
      PrRefSchema.safeParse({ provider: 'github', owner: '~me', repo: 'c', id: 1 }).success,
    ).toBe(false)
    const old = { owner: 'PROJ', repo: 'web', id: 4 }
    expect(prKey(old)).toBe('proj/web#4')
    expect(prKey({ provider: 'gitlab', owner: 'A/b', repo: 'c', id: 2 })).toBe('gitlab:a/b/c#2')
    expect(refLabel({ provider: 'gitlab', owner: 'a', repo: 'c', id: 2 })).toBe('c !2')
    expect(refLabel(old)).toBe('web #4')
  })

  it('parses GitHub, GitHub Enterprise and GitLab (subgroups) links; Bitbucket still wins its own', () => {
    expect(parseAnyPrLink('github.com/acme/web/pull/12/files')).toMatchObject({
      provider: 'github',
      baseUrl: 'https://github.com',
      ref: { owner: 'acme', repo: 'web', id: 12 },
    })
    expect(
      parseAnyPrLink('https://gitlab.com/acme/web/checkout/-/merge_requests/7/diffs'),
    ).toMatchObject({ provider: 'gitlab', ref: { owner: 'acme/web', repo: 'checkout', id: 7 } })
    expect(parseAnyPrLink('https://bitbucket.org/acme/web/pull-requests/3')).toMatchObject({
      provider: 'bitbucket',
    })
    expect(parseAnyPrLink('https://github.com/acme/web/issues/12')).toBeNull()
    expect(parseAnyPrLink('https://github.com/acme/web/pull/x')).toBeNull()
  })

  it('a link is checked against the configured site; a GitLab relative root comes off the group', () => {
    const gh = parseAnyPrLink('https://github.com/acme/web/pull/1')!
    expect(withinSite(gh, 'https://github.com')).not.toBeNull()
    expect(withinSite(gh, 'https://code.corp')).toBeNull()
    const gl = parseAnyPrLink('https://corp.example/gitlab/acme/web/-/merge_requests/9')!
    expect(withinSite(gl, 'https://corp.example/gitlab')?.ref.owner).toBe('acme')
    expect(withinSite(gl, 'https://gitlab.com')).toBeNull()
  })

  it('prRefFromLink asks each provider for its own site before any request', () => {
    const site = vi.fn((p: string) =>
      p === 'github' ? 'https://github.com' : p === 'gitlab' ? null : 'https://bitbucket.org',
    )
    expect(prRefFromLink('https://github.com/a/b/pull/2', site as never).ref).toMatchObject({
      provider: 'github',
    })
    expect(() => prRefFromLink('https://gitlab.com/a/b/-/merge_requests/2', site as never)).toThrow(
      /Turn on GitLab in Settings → GitLab/,
    )
    expect(() => prRefFromLink('https://ghe.corp/a/b/pull/2', site as never)).toThrow(
      /DevDock reads GitHub from https:\/\/github.com/,
    )
  })
})

describe('run links and CI rules', () => {
  it('parses Actions run and GitLab pipeline links', () => {
    expect(parseRunLink('https://github.com/acme/web/actions/runs/123/job/9')).toEqual({
      origin: 'https://github.com',
      ref: { provider: 'github', project: 'acme/web', id: 123 },
    })
    expect(parseRunLink('gitlab.com/acme/web/checkout/-/pipelines/55')).toEqual({
      origin: 'https://gitlab.com',
      ref: { provider: 'gitlab', project: 'acme/web/checkout', id: 55 },
    })
    expect(parseRunLink('https://github.com/acme/web/actions')).toBeNull()
    expect(CiRunRefSchema.safeParse({ provider: 'github', project: 'a/b/c', id: 1 }).success).toBe(
      false,
    )
  })

  it('retry only after a failure or cancel; cancel only while it runs', () => {
    expect(ciActionAllowed('retry', 'failed')).toBe(true)
    expect(ciActionAllowed('retry', 'cancelled')).toBe(true)
    expect(ciActionAllowed('retry', 'success')).toBe(false)
    expect(ciActionAllowed('cancel', 'running')).toBe(true)
    expect(ciActionAllowed('cancel', 'queued')).toBe(true)
    expect(ciActionAllowed('cancel', 'failed')).toBe(false)
  })
})

describe('ProviderRest', () => {
  const target = {
    service: 'GitHub',
    authorization: 'Bearer secret',
    hints: { auth: 'Check the token.', forbidden: 'No access.' },
    timeoutMs: 5000,
    etags: true,
    rateLimit: (res: Response) =>
      res.status === 429
        ? new ServiceError('rate_limited', 'slow down', { status: 429, retryAfterSec: 30 })
        : null,
  }

  it('conditional GETs: a 304 answers from the cached body', async () => {
    let calls = 0
    const http = new ScriptedHttp([
      (r) => {
        calls++
        return r.headers.get('if-none-match') === '"v1"'
          ? new Response(null, { status: 304 })
          : json({ n: calls }, { headers: { etag: '"v1"' } })
      },
    ])
    const rest = new ProviderRest(http, target)
    expect((await rest.json('https://api/x')).body).toEqual({ n: 1 })
    expect((await rest.json('https://api/x')).body).toEqual({ n: 1 })
    expect(http.requests[1]!.headers.get('if-none-match')).toBe('"v1"')
  })

  it('after a rate limit, requests are refused without the network until it passes', async () => {
    let now = 1_000_000
    const http = new ScriptedHttp([() => new Response('', { status: 429 })])
    const rest = new ProviderRest(http, target, () => now)
    await expect(rest.json('https://api/x')).rejects.toMatchObject({ kind: 'rate_limited' })
    await expect(rest.json('https://api/y')).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 30,
    })
    expect(http.requests).toHaveLength(1)
    now += 31_000
    await expect(rest.json('https://api/z')).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(http.requests).toHaveLength(2)
  })

  it('log redirects: followed without the token, only to https; the tail starts on a line', async () => {
    const http = new ScriptedHttp([
      (r) =>
        r.url === 'https://api/log'
          ? new Response(null, { status: 302, headers: { location: 'https://blob/log?sig=1' } })
          : undefined,
      (r) =>
        r.url === 'https://api/insecure'
          ? new Response(null, { status: 302, headers: { location: 'http://blob/log' } })
          : undefined,
      (r) =>
        r.url.startsWith('https://blob/')
          ? new Response(`first\nsecond\n\u001b[31mthird\u001b[0m`)
          : undefined,
    ])
    const rest = new ProviderRest(http, target)
    const tail = await rest.textTail('https://api/log', 14)
    expect(tail).toEqual({ text: 'third', truncated: true })
    const storage = http.requests.find((r) => r.url.startsWith('https://blob/'))!
    expect(storage.headers.get('authorization')).toBeNull()
    expect(http.requests[0]!.headers.get('authorization')).toBe('Bearer secret')
    await expect(rest.textTail('https://api/insecure', 100)).rejects.toThrow(/won't follow/)
    expect(stripAnsi('\u001b[1;32mok\u001b[0m')).toBe('ok')
  })

  it('log redirects: every hop checked; an opaque redirect is refused, not followed with the token', async () => {
    const http = new ScriptedHttp([
      (r) =>
        r.url === 'https://api/two'
          ? new Response(null, { status: 302, headers: { location: 'https://blob/a' } })
          : undefined,
      (r) =>
        r.url === 'https://blob/a'
          ? new Response(null, { status: 302, headers: { location: 'http://blob/b' } })
          : undefined,
      (r) => (r.url === 'https://api/opaque' ? Response.error() : undefined),
      (r) =>
        r.url === 'https://api/big' ? new Response(`${'x'.repeat(500_000)}\nlast line`) : undefined,
    ])
    const rest = new ProviderRest(http, target)
    await expect(rest.textTail('https://api/two', 100)).rejects.toThrow(/won't follow/)
    expect(http.requests.some((r) => r.url.startsWith('http://'))).toBe(false)
    await expect(rest.textTail('https://api/opaque', 100)).rejects.toThrow(/won't follow/)
    expect(http.requests.filter((r) => r.url === 'https://api/opaque')).toHaveLength(1)
    expect(await rest.textTail('https://api/big', 64)).toEqual({
      text: 'last line',
      truncated: true,
    })
  })

  it("the server's words are added to a refused request (GitHub and GitLab shapes)", () => {
    expect(hostMessage('{"message":"Validation Failed","errors":[{"message":"no"}]}')).toBe(
      'Validation Failed no',
    )
    expect(hostMessage('{"message":{"base":["is locked"]}}')).toBe('base is locked')
    expect(hostMessage('{"error":"insufficient_scope"}')).toBe('insufficient_scope')
    expect(hostMessage('not json')).toBeNull()
    const err = withHostWords(
      'GitLab',
      new ServiceError('forbidden', 'No access.', {
        status: 403,
        details: '{"message":"403 Forbidden"}',
      }),
    ) as ServiceError
    expect(err.message).toBe('No access. GitLab said: “403 Forbidden”')
    const server = new ServiceError('server', 'Down.', { status: 502, details: '{"message":"x"}' })
    expect(withHostWords('GitLab', server)).toBe(server)
  })
})

describe('PrHub', () => {
  const pr = (key: string, updatedAt: string) => ({ key, updatedAt }) as PullRequest
  const source = (over: Partial<PrSource> = {}): PrSource => ({
    list: vi.fn(async () => []),
    pr: vi.fn(),
    changes: vi.fn(),
    act: vi.fn(),
    site: () => null,
    ...over,
  })

  it('routes by provider; merges lists newest first, skipping a provider that fails', async () => {
    const github = source({ list: async () => [pr('g', '2026-10-26T10:00:00Z')] })
    const gitlab = source({
      list: async () => {
        throw new ServiceError('not_configured', 'off')
      },
    })
    const bitbucket = source({ list: async () => [pr('b', '2026-10-26T11:00:00Z')] })
    const hub = new PrHub({ bitbucket, github, gitlab })
    expect(
      (await hub.listAll(['bitbucket', 'github', 'gitlab'], 'mine')).map((p) => p.key),
    ).toEqual(['b', 'g'])
    await expect(hub.listAll(['gitlab'], 'mine')).rejects.toThrow('off')
    expect(await hub.listAll([], 'mine')).toEqual([])
  })

  it('refuses an action the provider has no API for, before asking it', async () => {
    const gitlab = source()
    const hub = new PrHub({ bitbucket: source(), github: source(), gitlab })
    await expect(
      hub.act({
        ref: { provider: 'gitlab', owner: 'a', repo: 'b', id: 1 },
        action: 'needs_work',
        confirmed: true,
      } as never),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    expect(gitlab.act).not.toHaveBeenCalled()
  })

  it('enabledProviders: Bitbucket on and GitHub / GitLab off by default', () => {
    expect(enabledProviders(defaultSettings())).toEqual(['bitbucket'])
  })
})

const run = (ref: CiRunRef, state: CiRun['state'], over: Partial<CiRun> = {}): CiRun => ({
  key: `${ref.provider}:${ref.project}@${ref.id}`.toLowerCase(),
  ref,
  name: 'CI',
  number: 4,
  event: 'push',
  branch: 'main',
  sha: null,
  title: 'Fix it',
  actor: 'me',
  state,
  url: `https://github.com/${ref.project}/actions/runs/${ref.id}`,
  createdAt: 1000,
  startedAt: 1000,
  durationMs: state === 'running' ? null : 60_000,
  attempt: 1,
  ...over,
})

describe('CiWatcher', () => {
  const REF: CiRunRef = { provider: 'github', project: 'acme/web', id: 7 }
  function setup(site: string | null = 'https://github.com') {
    const states: CiRun['state'][] = []
    const runInfo = vi.fn(async (ref: CiRunRef) => run(ref, states.shift() ?? 'running'))
    const notify = vi.fn()
    const file = join(mkdtempSync(join(tmpdir(), 'devdock-ci-')), 'ci.json')
    const siteFn = vi.fn(() => site)
    const watcher = new CiWatcher({
      file,
      ci: { runInfo, site: siteFn },
      notify,
      onChange: vi.fn(),
    })
    return { watcher, states, runInfo, notify, file, siteFn }
  }

  it('watches until finished, notifies once, and remembers it after a restart', async () => {
    const t = setup()
    await t.watcher.add({ ref: REF })
    t.states.push('running', 'failed')
    await t.watcher.poll()
    expect(t.notify).not.toHaveBeenCalled()
    await t.watcher.poll()
    expect(t.notify).toHaveBeenCalledTimes(1)
    expect(t.notify.mock.calls[0]![0]).toMatchObject({
      type: 'job-finished',
      title: 'Failed · web CI #4',
      view: 'builds',
    })
    await t.watcher.poll()
    expect(t.runInfo).toHaveBeenCalledTimes(3) // add + 2 polls; done ones aren't polled

    const again = new CiWatcher({
      file: t.file,
      ci: { runInfo: t.runInfo, site: () => 'https://github.com' },
      notify: t.notify,
      onChange: vi.fn(),
    })
    expect(again.list()[0]).toMatchObject({ done: true, run: { state: 'failed' } })
  })

  it('a re-run from DevDock follows the run again', async () => {
    const t = setup()
    t.states.push('failed')
    await t.watcher.add({ ref: REF })
    expect(t.watcher.list()[0]!.done).toBe(true)
    t.watcher.restarted(run(REF, 'running', { attempt: 2 }))
    expect(t.watcher.list()[0]).toMatchObject({ done: false, run: { attempt: 2 } })
  })

  it('links: only on the configured site; a GitLab relative root comes off', async () => {
    const t = setup()
    await expect(
      t.watcher.add({ link: 'https://ghe.corp/a/b/actions/runs/1' }),
    ).rejects.toMatchObject({
      kind: 'other-site',
    })
    await expect(t.watcher.add({ link: 'https://github.com/a/b/pull/1' })).rejects.toMatchObject({
      kind: 'invalid',
    })
    expect(t.runInfo).not.toHaveBeenCalled()
    const gl = setup('https://corp.example/gitlab')
    await gl.watcher.add({ link: 'https://corp.example/gitlab/acme/web/-/pipelines/3' })
    expect(gl.runInfo.mock.calls[0]![0]).toEqual({ provider: 'gitlab', project: 'acme/web', id: 3 })
  })

  it('a provider turned off (or moved) marks the watch instead of polling it', async () => {
    const t = setup()
    await t.watcher.add({ ref: REF })
    t.siteFn.mockReturnValue(null)
    await t.watcher.poll()
    expect(t.watcher.list()[0]!.error).toMatch(/different GitHub site/)
    expect(t.runInfo).toHaveBeenCalledTimes(1)
  })

  it('a gone run is marked; auth failures stop the poll for the scheduler', async () => {
    const t = setup()
    await t.watcher.add({ ref: REF })
    t.runInfo.mockRejectedValueOnce(new ServiceError('not_found', 'gone'))
    await t.watcher.poll()
    expect(t.watcher.list()[0]!.error).toBe('gone')
    t.runInfo.mockRejectedValueOnce(new ServiceError('auth', 'bad token'))
    await expect(t.watcher.poll()).rejects.toThrow('bad token')
  })

  it('finished runs colour the tray dot; labels say which run', () => {
    const watch = {
      key: 'k',
      ref: REF,
      site: 'https://github.com',
      addedAt: 0,
      checkedAt: 0,
      run: run(REF, 'failed'),
      done: true,
      error: null,
    }
    expect(watchedForTray([], [], [watch])).toEqual([
      { label: 'web CI #4', state: 'failed', finishedAt: 61_000 },
    ])
    expect(finishedNotice(run(REF, 'success')).body).toBe('Fix it on main')
  })
})
