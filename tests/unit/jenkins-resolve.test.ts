import { describe, expect, it } from 'vitest'
import { myBuilds, resolvePrJob, type MyWork } from '../../src/main/services/jenkins/resolve'
import {
  DEFAULT_PROTECTED_JOBS,
  isJobPath,
  isProtectedJob,
  jobFromUrl,
  jobUrl,
  type BranchBuild,
} from '../../src/shared/jenkins'

const BASE = 'https://ci.example.com/jenkins'

const job = (project: string, name: string): BranchBuild => {
  const pr = /^PR-(\d+)$/.exec(name)
  return {
    project,
    job: `${project}/${name}`,
    branch: decodeURIComponent(name),
    kind: pr ? 'pr' : 'branch',
    prId: pr ? Number(pr[1]) : null,
    url: `${jobUrl(BASE, `${project}/${name}`)}/`,
    lastBuild: null,
  }
}

const TREE = [
  job('apps/web-app', 'develop'),
  job('apps/web-app', 'feature%2FNM-7-card'),
  job('apps/web-app', 'PR-42'),
  job('design-system', 'main'),
  job('design-system', 'feature%2Fbutton'),
  job('design-system', 'PR-42'),
  job('legacy-ui-pipeline', 'feature%2Fold-thing'),
  job('legacy-ui-pipeline', 'develop'),
]
const CONFIGURED = ['apps/web-app', 'design-system', 'legacy-ui-pipeline']

const pr = (over: Partial<Parameters<typeof resolvePrJob>[0]> = {}) => ({
  repo: 'web-app',
  id: 42,
  sourceBranch: 'feature/NM-7-card',
  buildUrls: [],
  ...over,
})

describe('job paths and links', () => {
  it('encodes each name again in /job/ URLs', () => {
    expect(jobUrl(`${BASE}/`, 'apps/web-app/feature%2Fx y')).toBe(
      `${BASE}/job/apps/job/web-app/job/feature%252Fx%20y`,
    )
  })

  it('reads job + build from classic links on the configured site', () => {
    expect(jobFromUrl(BASE, `${BASE}/job/apps/job/web-app/job/PR-42/7/display/redirect`)).toEqual({
      job: 'apps/web-app/PR-42',
      build: 7,
    })
    // Jenkins' root URL may say http behind an https proxy; host and port must match.
    expect(
      jobFromUrl(BASE, 'http://CI.example.com:443/jenkins/job/web-app/job/feature%252Fx/'),
    ).toEqual({ job: 'web-app/feature%2Fx', build: null })
    expect(jobFromUrl(BASE, `${BASE}/job/web-app/lastBuild/console`)).toEqual({
      job: 'web-app',
      build: null,
    })
  })

  it('refuses other hosts, other context paths and non-job links', () => {
    expect(jobFromUrl(BASE, 'https://other.example.com/jenkins/job/a/1/')).toBeNull()
    expect(jobFromUrl(BASE, 'https://ci.example.com/other/job/a/1/')).toBeNull()
    expect(jobFromUrl(BASE, `${BASE}/view/all/`)).toBeNull()
    expect(jobFromUrl(BASE, `${BASE}/job/%2E%2E/1/`)).toBeNull()
    expect(jobFromUrl(BASE, 'not a url')).toBeNull()
  })

  it('job path check', () => {
    expect(isJobPath('apps/web-app/feature%2Fx')).toBe(true)
    expect(isJobPath('My Folder/job (1)')).toBe(true)
    for (const bad of ['', 'a//b', '/a', 'a/', '..', 'a/../b', 'a\\b', 'a?b', 'a#b', 'a\nb']) {
      expect(isJobPath(bad), bad).toBe(false)
    }
  })
})

describe('Watch PR pipeline: PR → job resolution', () => {
  it('1. a build status link on this Jenkins wins, preferring one under a configured job', () => {
    const r = resolvePrJob(
      pr({
        buildUrls: [
          'https://other-ci.example.com/job/web-app/job/PR-42/3/',
          `${BASE}/job/visual-tests/9/`,
          `${BASE}/job/apps/job/web-app/job/PR-42/12/display/redirect`,
        ],
      }),
      TREE,
      BASE,
      CONFIGURED,
    )
    expect(r).toEqual({ ok: true, job: 'apps/web-app/PR-42', build: 12, via: 'build-status' })
  })

  it('…or any job on this Jenkins it links to', () => {
    const r = resolvePrJob(
      pr({ buildUrls: [`${BASE}/job/visual-tests/9/`] }),
      TREE,
      BASE,
      CONFIGURED,
    )
    expect(r).toEqual({ ok: true, job: 'visual-tests', build: 9, via: 'build-status' })
  })

  it('2. the PR-{id} job under the repo’s multibranch job (case-insensitive name)', () => {
    // design-system also has a PR-42: PR ids are per repo, so only web-app's counts.
    expect(resolvePrJob(pr({ repo: 'Web-App' }), TREE, BASE, CONFIGURED)).toEqual({
      ok: true,
      job: 'apps/web-app/PR-42',
      build: null,
      via: 'pr-job',
    })
    expect(resolvePrJob(pr({ repo: 'design-system' }), TREE, BASE, CONFIGURED)).toMatchObject({
      job: 'design-system/PR-42',
    })
  })

  it('…then the source branch’s job there', () => {
    expect(resolvePrJob(pr({ id: 99 }), TREE, BASE, CONFIGURED)).toEqual({
      ok: true,
      job: 'apps/web-app/feature%2FNM-7-card',
      build: null,
      via: 'branch',
    })
  })

  it('3. a job named otherwise: the branch under any configured job, if only one has it', () => {
    expect(
      resolvePrJob(
        pr({ repo: 'legacy-ui', id: 5, sourceBranch: 'feature/old-thing' }),
        TREE,
        BASE,
        CONFIGURED,
      ),
    ).toMatchObject({ ok: true, job: 'legacy-ui-pipeline/feature%2Fold-thing', via: 'branch' })
  })

  it('…else the PR-{id} job under any configured job, if only one has it', () => {
    const tree = [...TREE, job('WebApp-CI', 'PR-7')]
    expect(
      resolvePrJob(
        pr({ repo: 'webapp', id: 7, sourceBranch: 'feature/y' }),
        tree,
        BASE,
        CONFIGURED,
      ),
    ).toEqual({
      ok: true,
      job: 'WebApp-CI/PR-7',
      build: null,
      via: 'pr-job',
    })
    // PR-42 exists in two jobs: not a match.
    expect(
      resolvePrJob(pr({ repo: 'webapp', sourceBranch: 'feature/y' }), TREE, BASE, CONFIGURED).ok,
    ).toBe(false)
  })

  it('several candidates → says which, picks none', () => {
    const r = resolvePrJob(
      pr({ repo: 'other', id: 5, sourceBranch: 'develop' }),
      TREE,
      BASE,
      CONFIGURED,
    )
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.message).toMatch(
        /More than one.*apps\/web-app\/develop, legacy-ui-pipeline\/develop/,
      )
  })

  it('no match → a clear message naming where DevDock looked', () => {
    const r = resolvePrJob(
      pr({ repo: 'mobile', id: 3, sourceBranch: 'feature/x' }),
      TREE,
      BASE,
      CONFIGURED,
    )
    expect(r).toEqual({
      ok: false,
      message:
        'No Jenkins job found for mobile #3 (branch feature/x). DevDock looked in apps/web-app, design-system, legacy-ui-pipeline; if another job builds it, add that job in Settings → Jenkins.',
    })
    const none = resolvePrJob(pr(), [], BASE, [])
    expect(!none.ok && none.message).toMatch(
      /add your multibranch jobs in Settings → Jenkins first/,
    )
  })
})

describe('My branches', () => {
  const work = (over: Partial<MyWork> = {}): MyWork => ({ branches: [], prs: [], ...over })
  const jobs = (w: MyWork) => myBuilds(TREE, w).map((b) => b.job)

  it('local branches match within their repo’s job; PR jobs match my PRs by repo and id', () => {
    expect(
      jobs(
        work({
          branches: [
            { repo: 'web-app', name: 'develop' },
            { repo: 'web-app', name: 'feature/button' }, // only design-system has it
          ],
          prs: [{ repo: 'design-system', id: 42, branch: 'feature/button' }],
        }),
      ),
    ).toEqual(['apps/web-app/develop', 'design-system/feature%2Fbutton', 'design-system/PR-42'])
  })

  it('a repo with no job of its name (or no known slug) matches by branch name anywhere', () => {
    expect(jobs(work({ branches: [{ repo: 'legacy-ui', name: 'develop' }] }))).toEqual([
      'apps/web-app/develop',
      'legacy-ui-pipeline/develop',
    ])
    expect(jobs(work({ branches: [{ repo: null, name: 'main' }] }))).toEqual(['design-system/main'])
  })

  it('PR jobs under a job not named after the repo match by id alone', () => {
    const tree = [...TREE, job('WebApp-CI', 'PR-7'), job('WebApp-CI', 'PR-8')]
    expect(
      myBuilds(tree, work({ prs: [{ repo: 'webapp', id: 7, branch: 'feature/x' }] })).map(
        (b) => b.job,
      ),
    ).toEqual(['WebApp-CI/PR-7'])
    // …but a repo that has its own job doesn't borrow another repo's PR of the same id.
    expect(
      myBuilds(tree, work({ prs: [{ repo: 'web-app', id: 7, branch: 'feature/x' }] })),
    ).toEqual([])
  })

  it('nothing local and no PRs → nothing', () => {
    expect(jobs(work())).toEqual([])
  })
})

describe('protected jobs (SPEC 6.4)', () => {
  const p = (path: string, patterns: readonly string[] = DEFAULT_PROTECTED_JOBS) =>
    isProtectedJob(path, patterns)

  it('default patterns: prod, production, uat, release — anywhere in the path', () => {
    expect(p('deploy-prod')).toBe(true)
    expect(p('apps/deploy-prod')).toBe(true)
    expect(p('production/web')).toBe(true)
    expect(p('apps/uat-deploy')).toBe(true)
    expect(p('web-app/release%2F2.4')).toBe(true)
    expect(p('Release Train/web')).toBe(true) // a folder name protects everything under it
    expect(p('apps/deploy-dev')).toBe(false)
    expect(p('web-app/feature%2FDD-1')).toBe(false)
  })

  it('ignores case and Unicode width', () => {
    expect(p('apps/Deploy-PROD')).toBe(true)
    expect(p('APPS/UAT')).toBe(true)
    expect(p('apps/deploy-ｐｒｏｄ')).toBe(true) // full-width letters
  })

  it('an encoded spelling can’t hide a pattern', () => {
    expect(p('apps/deploy-%70rod')).toBe(true)
    expect(p('apps/deploy-%2570rod')).toBe(true)
  })

  it('the SPEC spelling "prod|production|uat|release" and * wildcards protect too', () => {
    expect(p('apps/deploy-prod', ['prod|production|uat|release'])).toBe(true)
    expect(p('apps/UAT', ['staging| uat '])).toBe(true)
    expect(p('apps/deploy-eu-prod', ['deploy-*-prod'])).toBe(true)
    expect(p('apps/deploy-dev', ['deploy-*-prod', '|', '*', '**'])).toBe(false)
  })

  it('custom patterns are substrings; blank ones never match everything', () => {
    expect(p('apps/deploy-staging', ['staging'])).toBe(true)
    expect(p('apps/deploy-dev', ['staging', ' ', ''])).toBe(false)
    expect(p('apps/a.b', ['.'])).toBe(true) // not a regex: "." is a dot
    expect(p('apps/ab', ['.'])).toBe(false)
  })
})
