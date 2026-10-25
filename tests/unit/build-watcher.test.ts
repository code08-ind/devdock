import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BuildWatcher,
  buildWatchKey,
  deploysBranch,
  type BuildWatcherDeps,
} from '../../src/main/services/jenkins/watcher'
import { ServiceError } from '../../src/main/services/service-error'
import type { NotifyInput } from '../../src/main/services/notifications'
import type { BuildDetail, JenkinsBuild } from '../../src/shared/jenkins'

const SITE = 'https://ci.example.com/jenkins'

const build = (job: string, number: number, state: JenkinsBuild['state']): JenkinsBuild => ({
  job,
  number,
  url: `${SITE}/job/${job}/${number}/`,
  state,
  startedAt: 1_000,
  durationMs: state === 'running' ? null : 95_000,
  estimatedMs: null,
})

/** A scripted Jenkins: per job, the builds that exist now (tests change them between polls). */
function fakeJenkins() {
  const builds = new Map<string, { build: JenkinsBuild; parameters: BuildDetail['parameters'] }[]>()
  const fail = new Map<string, ServiceError>()
  let site = SITE
  const jenkins: BuildWatcherDeps['jenkins'] = {
    site: () => site,
    deployJob: () => 'apps/deploy-dev',
    buildInfo: async ({ job, number }) => {
      const err = fail.get(job)
      if (err) throw err
      const found = builds.get(job)?.find((b) => b.build.number === number)
      if (!found) throw new ServiceError('not_found', 'Jenkins returned 404.', { status: 404 })
      return found.build
    },
    build: async ({ job, number }) => ({
      build: (await jenkins.buildInfo({ job, number }))!,
      stages: [
        { name: 'Install', state: 'success', startedAt: 1, durationMs: 1 },
        { name: 'Unit tests', state: 'failed', startedAt: 2, durationMs: 1 },
      ],
      parameters: [],
      causes: [],
    }),
    recentBuilds: async (job) => {
      const err = fail.get(job)
      if (err) throw err
      return [...(builds.get(job) ?? [])].reverse()
    },
    resolvePr: async () => ({ ok: false, message: 'No Jenkins job found for web-app #1.' }),
  }
  return {
    jenkins,
    set(
      job: string,
      number: number,
      state: JenkinsBuild['state'],
      params: Record<string, string> = {},
    ) {
      const list = builds.get(job) ?? []
      const entry = {
        build: build(job, number, state),
        parameters: Object.entries(params).map(([name, value]) => ({ name, value })),
      }
      builds.set(job, [...list.filter((b) => b.build.number !== number), entry])
    },
    fail,
    moveSite: (to: string) => (site = to),
  }
}

function setup(file = join(mkdtempSync(join(tmpdir(), 'devdock-bw-')), 'build-watches.json')) {
  const j = fakeJenkins()
  const notes: NotifyInput[] = []
  const onChange = vi.fn()
  const make = () =>
    new BuildWatcher({
      file,
      jenkins: j.jenkins,
      bitbucket: { pr: vi.fn(), site: () => 'https://bitbucket.org' },
      notify: (n) => notes.push(n),
      onChange,
    })
  return { j, notes, onChange, file, watcher: make(), make }
}

describe('build watcher', () => {
  it('a watched running build notifies exactly once when it finishes, and survives a restart', async () => {
    const t = setup()
    t.j.set('web-app/PR-42', 12, 'running')
    const item = await t.watcher.add({ kind: 'build', job: 'web-app/PR-42', number: 12 })
    expect(item).toMatchObject({ key: 'build:web-app/pr-42#12', number: 12, done: false })

    await t.watcher.poll()
    expect(t.notes).toEqual([]) // still running
    t.j.set('web-app/PR-42', 12, 'success')
    await t.watcher.poll()
    expect(t.notes).toEqual([
      {
        type: 'job-finished',
        title: 'Passed · web-app › PR-42 #12',
        body: 'web-app/PR-42\nTook 1 min 35 s',
        url: `${SITE}/job/web-app/PR-42/12/`,
        view: 'builds', // a click opens the Builds view, not the browser
      },
    ])
    await t.watcher.poll()
    // A new watcher on the same file: done, nothing polled or notified again.
    const restarted = t.make()
    await restarted.poll()
    expect(t.notes).toHaveLength(1)
    expect(restarted.list()[0]).toMatchObject({ done: true, build: { state: 'success' } })
  })

  it('a job watch waits for the next build, follows it, and says where a failure happened', async () => {
    const t = setup()
    t.j.set('web-app/develop', 230, 'success')
    const item = await t.watcher.add({ kind: 'job', job: 'web-app/develop' }, { label: 'develop' })
    expect(item).toMatchObject({ number: null, after: 230 })
    await t.watcher.poll()
    expect(t.watcher.list()[0]).toMatchObject({ number: null })

    t.j.set('web-app/develop', 231, 'running')
    t.j.set('web-app/develop', 232, 'running')
    await t.watcher.poll()
    expect(t.watcher.list()[0]).toMatchObject({ number: 231 }) // the first new one
    t.j.set('web-app/develop', 231, 'failed')
    await t.watcher.poll()
    expect(t.notes).toEqual([
      expect.objectContaining({
        title: 'Failed · develop #231',
        body: 'web-app/develop\nTook 1 min 35 s\nFailed at: Unit tests',
      }),
    ])
  })

  it('a job watch on a running job follows that build', async () => {
    const t = setup()
    t.j.set('web-app/develop', 230, 'running')
    expect(await t.watcher.add({ kind: 'job', job: 'web-app/develop' })).toMatchObject({
      number: 230,
    })
  })

  it('deploy watcher: follows only the deploy job’s builds for my branch', async () => {
    const t = setup()
    t.j.set('apps/deploy-dev', 57, 'success', { BRANCH: 'develop' })
    t.j.set('apps/deploy-dev', 58, 'running', { BRANCH: 'feature/other' })
    const item = await t.watcher.add({ kind: 'deploy', branch: 'feature/mine' })
    expect(item).toMatchObject({
      key: 'deploy:apps/deploy-dev@feature/mine',
      job: 'apps/deploy-dev',
      number: null,
      after: 58,
    })
    // Someone else's deploy starts first: not followed.
    t.j.set('apps/deploy-dev', 58, 'success', { BRANCH: 'feature/other' })
    t.j.set('apps/deploy-dev', 59, 'failed', { BRANCH: 'develop' })
    await t.watcher.poll()
    expect(t.watcher.list()[0]).toMatchObject({ number: null })
    t.j.set('apps/deploy-dev', 60, 'running', { BRANCH: 'origin/feature/mine' })
    await t.watcher.poll()
    expect(t.notes).toEqual([])
    t.j.set('apps/deploy-dev', 60, 'success', { BRANCH: 'origin/feature/mine' })
    await t.watcher.poll()
    expect(t.notes).toEqual([
      expect.objectContaining({
        title: 'Passed · apps › deploy-dev #60',
        body: 'Deploy of feature/mine · apps/deploy-dev\nTook 1 min 35 s',
      }),
    ])
  })

  it('a deploy already running for my branch is followed at once', async () => {
    const t = setup()
    t.j.set('apps/deploy-dev', 58, 'running', { BRANCH: 'feature/mine' })
    expect(await t.watcher.add({ kind: 'deploy', branch: 'feature/mine' })).toMatchObject({
      number: 58,
    })
  })

  it('a build that already finished is listed as done, without a notification', async () => {
    const t = setup()
    t.j.set('web-app/PR-42', 11, 'failed')
    expect(await t.watcher.add({ kind: 'build', job: 'web-app/PR-42', number: 11 })).toMatchObject({
      done: true,
    })
    await t.watcher.poll()
    expect(t.notes).toEqual([])
  })

  it('the same watch twice is one; a finished one is replaced by a fresh watch', async () => {
    const t = setup()
    t.j.set('web-app/develop', 1, 'running')
    const a = await t.watcher.add({ kind: 'job', job: 'web-app/develop' })
    const b = await t.watcher.add({ kind: 'job', job: 'Web-App/Develop' })
    expect(b).toBe(a)
    t.j.set('web-app/develop', 1, 'success')
    await t.watcher.poll()
    t.j.set('web-app/develop', 2, 'running')
    const again = await t.watcher.add({ kind: 'job', job: 'web-app/develop' })
    expect(again).toMatchObject({ number: 2, done: false })
    expect(t.watcher.list()).toHaveLength(1)
  })

  it('404/403 marks the item and goes on; any other failure stops the poll and is rethrown', async () => {
    const t = setup()
    t.j.set('a', 1, 'running')
    t.j.set('b', 1, 'running')
    t.j.set('c', 1, 'running')
    for (const job of ['c', 'b', 'a']) await t.watcher.add({ kind: 'build', job, number: 1 })
    t.j.fail.set('a', new ServiceError('not_found', 'gone (404)', { status: 404 }))
    t.j.set('b', 1, 'success')
    await t.watcher.poll()
    expect(t.watcher.list().find((w) => w.job === 'a')?.error).toBe('gone (404)')
    expect(t.notes).toHaveLength(1) // b still checked

    t.j.fail.set(
      'a',
      new ServiceError('auth', 'Jenkins rejected the credentials (401).', { status: 401 }),
    )
    t.j.set('c', 1, 'success')
    await expect(t.watcher.poll()).rejects.toMatchObject({ kind: 'auth' })
    expect(t.notes).toHaveLength(1) // c wasn't reached
  })

  it('watches on another Jenkins site are kept and marked, not polled', async () => {
    const t = setup()
    t.j.set('a', 1, 'running')
    await t.watcher.add({ kind: 'build', job: 'a', number: 1 })
    t.j.moveSite('https://other.example.com')
    t.j.set('a', 1, 'success')
    await t.watcher.poll()
    expect(t.notes).toEqual([])
    expect(t.watcher.list()[0]?.error).toMatch(/different Jenkins site/)
  })

  it('remove, clear finished, limit, and an unreadable file kept aside', async () => {
    const t = setup()
    for (let n = 1; n <= 50; n++) {
      t.j.set('a', n, n === 1 ? 'success' : 'running')
      await t.watcher.add({ kind: 'build', job: 'a', number: n })
    }
    t.j.set('a', 51, 'running')
    await expect(t.watcher.add({ kind: 'build', job: 'a', number: 51 })).rejects.toMatchObject({
      kind: 'limit',
    })
    t.watcher.clearFinished()
    expect(t.watcher.list()).toHaveLength(49)
    t.watcher.remove(buildWatchKey('build', 'a', 2))
    expect(t.make().list()).toHaveLength(48)

    writeFileSync(t.file, '{"version":1,"items":[{"nope":1}]}')
    expect(t.make().list()).toEqual([])
    expect(existsSync(`${t.file}.unreadable`)).toBe(true)
  })

  it('Watch PR pipeline: no matching job → the resolver’s message; a bad link never reaches Bitbucket', async () => {
    const t = setup()
    await expect(t.watcher.addPr('https://example.com/nope')).rejects.toMatchObject({
      kind: 'invalid',
    })
    const pr = vi.fn(async () => ({ ref: { owner: 'acme', repo: 'web-app', id: 1 } }))
    const watcher = new BuildWatcher({
      file: t.file,
      jenkins: t.j.jenkins,
      bitbucket: { pr: pr as never, site: () => 'https://bitbucket.org' },
      notify: vi.fn(),
      onChange: vi.fn(),
    })
    await expect(
      watcher.addPr('https://bitbucket.org/acme/web-app/pull-requests/1'),
    ).rejects.toMatchObject({ kind: 'unresolved', message: 'No Jenkins job found for web-app #1.' })
    expect(pr).toHaveBeenCalledTimes(1)
  })

  it('Watch PR pipeline: a running linked build is followed; a finished one → the job’s next build', async () => {
    const t = setup()
    const pr = { ref: { owner: 'acme', repo: 'web-app', id: 42 } }
    const make = (build: number) =>
      new BuildWatcher({
        file: t.file,
        jenkins: {
          ...t.j.jenkins,
          resolvePr: async () => ({ ok: true, job: 'web-app/PR-42', build, via: 'build-status' }),
        },
        bitbucket: { pr: (async () => pr) as never, site: () => 'https://bitbucket.org' },
        notify: vi.fn(),
        onChange: vi.fn(),
      })
    const link = 'https://bitbucket.org/acme/web-app/pull-requests/42'
    t.j.set('web-app/PR-42', 11, 'success')
    t.j.set('web-app/PR-42', 12, 'running')
    expect(await make(12).addPr(link)).toMatchObject({
      kind: 'build',
      number: 12,
      label: 'web-app #42 pipeline',
      pr: 'acme/web-app#42',
    })
    // The status still links to #11 (Jenkins hasn't reported the new push yet).
    t.j.set('web-app/PR-42', 12, 'success')
    const watcher = make(11)
    const item = await watcher.addPr(link)
    expect(item).toMatchObject({ kind: 'job', number: null, after: 12, done: false })
  })

  it('two adds in flight at 49 watches: only one fits', async () => {
    const t = setup()
    for (let n = 1; n <= 51; n++) t.j.set('a', n, 'running')
    for (let n = 1; n <= 49; n++) await t.watcher.add({ kind: 'build', job: 'a', number: n })
    const results = await Promise.allSettled([
      t.watcher.add({ kind: 'build', job: 'a', number: 50 }),
      t.watcher.add({ kind: 'build', job: 'a', number: 51 }),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(t.watcher.list()).toHaveLength(50)
  })

  it('a poll that read a watch which was removed and added again meanwhile is dropped', async () => {
    const t = setup()
    t.j.set('a', 1, 'running')
    await t.watcher.add({ kind: 'build', job: 'a', number: 1 })
    const original = t.j.jenkins.buildInfo
    let readAgain = false
    t.j.jenkins.buildInfo = async (ref) => {
      const build = await original(ref)
      if (!readAgain) {
        readAgain = true
        // While this read is in flight: the user removes the watch and adds it again.
        t.watcher.remove(buildWatchKey('build', 'a', 1))
        t.j.set('a', 1, 'running')
        await t.watcher.add({ kind: 'build', job: 'a', number: 1 })
        return { ...build, state: 'failed' }
      }
      return build
    }
    await t.watcher.poll()
    expect(t.notes).toEqual([])
    expect(t.watcher.list()[0]).toMatchObject({ done: false })
  })

  it('deploy builds are matched by a parameter naming the branch', () => {
    const p = (value: string) => [{ name: 'BRANCH', value }]
    expect(deploysBranch(p('feature/x'), 'feature/x')).toBe(true)
    expect(deploysBranch(p(' refs/heads/feature/x '), 'feature/x')).toBe(true)
    expect(deploysBranch(p('feature/x-2'), 'feature/x')).toBe(false)
    expect(deploysBranch([], 'feature/x')).toBe(false)
  })
})
