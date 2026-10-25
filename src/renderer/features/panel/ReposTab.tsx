import { useState } from 'react'
import { Code, Terminal } from 'lucide-react'
import type { ActionRequest } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { OPEN_LABELS, useOpenRepo, useRepoStatus, useRepos } from '../../lib/repos'
import { Button, IconButton } from '../../ui/Button'
import { ActionDialog } from '../repos/ActionDialog'
import { DevServerPanel } from '../repos/DevServerPanel'
import { RepoActionButton } from '../repos/RepoActionButton'
import { RepoStatusError, RepoStatusLine } from '../repos/RepoStatusLine'
import { Loading, goto } from './bits'

export function ReposTab() {
  const repos = useRepos()
  if (repos.length === 0) {
    return (
      <div className="today-setup">
        <p className="muted">No repos added yet.</p>
        <Button size="sm" onClick={() => goto('repos')}>
          Add a repo
        </Button>
      </div>
    )
  }
  return (
    <ul className="panel-repos" aria-label="Repos">
      {repos.map((r) => (
        <PanelRepo key={r.id} repo={r} />
      ))}
    </ul>
  )
}

/** One repo: status and the everyday actions; each opens the same dialog as the Repos view. */
function PanelRepo({ repo }: { repo: RepoConfig }) {
  const status = useRepoStatus(repo.id)
  const openRepo = useOpenRepo()
  const [action, setAction] = useState<ActionRequest | null>(null)
  const s = status.data
  const inProgress = s?.operation != null
  const act = (request: ActionRequest, primary = false) => (
    <RepoActionButton
      repo={repo}
      status={s}
      request={request}
      primary={primary}
      onPick={setAction}
    />
  )
  return (
    <li className="panel-repo" aria-label={repo.name}>
      <div className="row-between">
        <h3 className="panel-repo-name">{repo.name}</h3>
        <span className="row-actions">
          <IconButton
            label={`${OPEN_LABELS.editor}: ${repo.name}`}
            icon={<Code size={16} aria-hidden="true" />}
            onClick={() => void openRepo(repo.id, 'editor')}
          />
          <IconButton
            label={`${OPEN_LABELS.terminal}: ${repo.name}`}
            icon={<Terminal size={16} aria-hidden="true" />}
            onClick={() => void openRepo(repo.id, 'terminal')}
          />
        </span>
      </div>
      {s ? <RepoStatusLine repo={repo} status={s} /> : null}
      {status.error ? <RepoStatusError error={status.error} /> : null}
      {status.isPending ? <Loading what="status" /> : null}
      <div className="button-row">
        {inProgress ? act({ action: 'abort' }, true) : null}
        {act({ action: 'syncBase' })}
        {act({ action: 'updateBranch', strategy: 'merge', stash: false }, !inProgress)}
        {act({ action: 'pushBranch' })}
      </div>
      <DevServerPanel repo={repo} kind="dev" />
      {action ? (
        <ActionDialog repo={repo} initial={action} onClose={() => setAction(null)} />
      ) : null}
    </li>
  )
}
