import { FolderGit2, Plus } from 'lucide-react'
import { bridge, unwrap } from '../../lib/devdock'
import { useRepos } from '../../lib/repos'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Feedback'
import { RepoCard } from './RepoCard'

/** Adds a repo: native folder picker, then validation and detection in the main process. */
export function useAddRepo() {
  const { run, pending } = useAction()
  const add = async () => {
    const picked = await run(unwrap(bridge.repos.pickFolder()))
    if (!picked.ok || !picked.value) return
    await run(unwrap(bridge.repos.add({ path: picked.value })), 'Repo added')
  }
  return { add, pending }
}

export function ReposPage() {
  const repos = useRepos()
  const { add, pending } = useAddRepo()
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 size={18} aria-hidden="true" />}
        title="No repos added yet. Add a local git repo to see its branch and sync status."
        action={
          <Button
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            disabled={pending}
            onClick={() => void add()}
          >
            Add repo
          </Button>
        }
      />
    )
  }
  return (
    <div className="repos">
      <div className="row-between">
        <p className="muted">
          Status refreshes when you switch back to DevDock, every 2 minutes, and when you change
          branch.
        </p>
        <Button
          icon={<Plus size={16} aria-hidden="true" />}
          disabled={pending}
          onClick={() => void add()}
        >
          Add repo
        </Button>
      </div>
      {repos.map((r) => (
        <RepoCard key={r.id} repo={r} />
      ))}
    </div>
  )
}
