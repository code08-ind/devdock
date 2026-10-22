import { CalendarCheck } from 'lucide-react'
import type { View } from '@shared/channels'
import type { RepoConfig } from '@shared/settings'
import { useRepoStatus, useRepos } from '../../lib/repos'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Feedback'
import { RepoStatusError, RepoStatusLine } from '../repos/RepoStatusLine'
import { EMPTY_COPY } from '../shell/views'

function RepoRow({ repo }: { repo: RepoConfig }) {
  const status = useRepoStatus(repo.id)
  return (
    <li className="today-repo">
      <span className="today-repo-name">{repo.name}</span>
      {status.data ? <RepoStatusLine repo={repo} status={status.data} /> : null}
      {status.error ? <RepoStatusError message={status.error.message} /> : null}
    </li>
  )
}

/** Today (SPEC 6.1). Repo status lands in Phase 1; PRs, builds and tickets join in Phases 2–4. */
export function TodayPage({ onView }: { onView: (v: View) => void }) {
  const repos = useRepos()
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck size={18} aria-hidden="true" />}
        title={EMPTY_COPY.today}
        action={<Button onClick={() => onView('repos')}>Add a repo</Button>}
      />
    )
  }
  return (
    <section className="today-section" aria-labelledby="today-repos">
      <div className="row-between">
        <h2 id="today-repos">Repos</h2>
        <Button size="sm" variant="ghost" onClick={() => onView('repos')}>
          Open Repos
        </Button>
      </div>
      <ul className="today-repos">
        {repos.map((r) => (
          <RepoRow key={r.id} repo={r} />
        ))}
      </ul>
    </section>
  )
}
