import type { PullRequest } from '@shared/bitbucket'
import type { RepoConfig } from '@shared/settings'
import type { GitRunner } from '../git/exec'
import { parseRemotes } from '../git/parse'
import { listBranches } from '../git/repo'
import type { MyWork } from './resolve'

/** `web-app` from `git@host:proj/web-app.git`, `https://host/scm/proj/web-app.git`, …; null if none. */
export function repoSlug(remote: string): string | null {
  const last = remote
    .trim()
    .replace(/\/+$/, '')
    .split(/[/:]/)
    .pop()
    ?.replace(/\.git$/i, '')
  return last || null
}

/**
 * Local branches of the registered repos (with origin's slug) and my open PRs. A repo that
 * can't be read adds nothing; PRs are skipped when Bitbucket isn't set up or doesn't answer,
 * so "My branches" still shows local work.
 */
export async function collectMyWork(
  git: GitRunner,
  repos: RepoConfig[],
  myPrs: () => Promise<PullRequest[]>,
): Promise<MyWork> {
  const [local, prs] = await Promise.all([
    Promise.all(
      repos.map(async (repo) => {
        try {
          const remotes = parseRemotes((await git.run(['remote', '-v'], { cwd: repo.path })).stdout)
          const slug = remotes.origin ? repoSlug(remotes.origin) : null
          const { local: names } = await listBranches(git, repo.path)
          return names.map((name) => ({ repo: slug, name }))
        } catch {
          return []
        }
      }),
    ),
    myPrs().catch(() => [] as PullRequest[]),
  ])
  return {
    branches: local.flat(),
    prs: prs.map((pr) => ({ repo: pr.ref.repo, id: pr.ref.id, branch: pr.sourceBranch })),
  }
}
