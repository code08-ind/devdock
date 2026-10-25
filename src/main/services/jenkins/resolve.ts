import { displayName, jobFromUrl, type BranchBuild, type JobPath } from '@shared/jenkins'

/**
 * Which branch jobs are "mine" (SPEC 6.4 "branches I have locally or in open PRs") and which
 * job runs a PR's pipeline ("Watch PR pipeline"). Pure.
 *
 * A multibranch job belongs to a repo when its own name is the repo slug (Bitbucket Branch
 * Source names them that way). A branch or PR whose repo matches no configured job is matched
 * by branch name / PR id alone, so differently named jobs (`WebApp-CI`) still work.
 */

export interface MyWork {
  /** Local branches of the registered repos; `repo` is the remote's slug (null if unknown). */
  branches: { repo: string | null; name: string }[]
  /** My open pull requests. */
  prs: { repo: string; id: number; branch: string }[]
}

const ownName = (path: JobPath) => displayName(path.slice(path.lastIndexOf('/') + 1))
const isRepoJob = (project: JobPath, repo: string) =>
  ownName(project).toLowerCase() === repo.toLowerCase()

export function myBuilds(builds: BranchBuild[], work: MyWork): BranchBuild[] {
  const projects = [...new Set(builds.map((b) => b.project))]
  const hasJob = (repo: string) => projects.some((p) => isRepoJob(p, repo))
  const wanted = [...work.branches, ...work.prs.map((p) => ({ repo: p.repo, name: p.branch }))]
  const inScope = (project: JobPath, repo: string | null) =>
    repo === null || !hasJob(repo) || isRepoJob(project, repo)
  return builds.filter((b) =>
    b.kind === 'pr'
      ? work.prs.some((p) => p.id === b.prId && inScope(b.project, p.repo))
      : wanted.some((w) => w.name === b.branch && inScope(b.project, w.repo)),
  )
}

export interface PrPipelineTarget {
  repo: string
  id: number
  sourceBranch: string
  /** Links of the build statuses Bitbucket shows on the PR. */
  buildUrls: string[]
}

export type PrJobResolution =
  | {
      ok: true
      job: JobPath
      /** Known when it came from a build status link. */
      build: number | null
      via: 'build-status' | 'pr-job' | 'branch'
    }
  | { ok: false; message: string }

/**
 * PR → job, most direct first: (1) a build status link on the PR that points at this Jenkins
 * (preferring one under a configured job); (2) the `PR-{id}` job, then the source branch's
 * job, under the repo's multibranch job; (3) the source branch's job under any configured
 * job, if exactly one has it, else the `PR-{id}` job under any configured job, if exactly one
 * has it. Otherwise a message saying where DevDock looked.
 */
export function resolvePrJob(
  pr: PrPipelineTarget,
  builds: BranchBuild[],
  baseUrl: string,
  configured: JobPath[],
): PrJobResolution {
  const linked = pr.buildUrls.flatMap((u) => jobFromUrl(baseUrl, u) ?? [])
  const known = new Set(builds.map((b) => b.job))
  const fromStatus = linked.find((l) => known.has(l.job)) ?? linked[0]
  if (fromStatus) return { ok: true, ...fromStatus, via: 'build-status' }

  const inRepo = builds.filter((b) => isRepoJob(b.project, pr.repo))
  const prJob = inRepo.find((b) => b.kind === 'pr' && b.prId === pr.id)
  if (prJob) return { ok: true, job: prJob.job, build: null, via: 'pr-job' }
  const isBranch = (b: BranchBuild) => b.kind === 'branch' && b.branch === pr.sourceBranch
  const branchJob = inRepo.find(isBranch)
  if (branchJob) return { ok: true, job: branchJob.job, build: null, via: 'branch' }

  const anywhere = builds.filter(isBranch)
  if (anywhere.length === 1) {
    return { ok: true, job: anywhere[0]!.job, build: null, via: 'branch' }
  }
  const prJobs = builds.filter((b) => b.kind === 'pr' && b.prId === pr.id)
  if (anywhere.length === 0 && prJobs.length === 1) {
    return { ok: true, job: prJobs[0]!.job, build: null, via: 'pr-job' }
  }
  const label = `${pr.repo} #${pr.id} (branch ${pr.sourceBranch})`
  if (anywhere.length > 1) {
    return {
      ok: false,
      message: `More than one Jenkins job builds ${label}: ${anywhere.map((b) => b.job).join(', ')}. Open the build from the Builds view instead.`,
    }
  }
  if (configured.length === 0) {
    return {
      ok: false,
      message: `No Jenkins job found for ${label}: add your multibranch jobs in Settings → Jenkins first.`,
    }
  }
  return {
    ok: false,
    message: `No Jenkins job found for ${label}. DevDock looked in ${configured.join(', ')}; if another job builds it, add that job in Settings → Jenkins.`,
  }
}
