import { useState } from 'react'
import { Code, FolderOpen, Settings2, Terminal } from 'lucide-react'
import type { ActionRequest, OpenTarget } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { ACTION_LABELS, OPEN_LABELS, useOpenRepo, useRepoStatus } from '../../lib/repos'
import { Button, IconButton } from '../../ui/Button'
import { ActionDialog } from './ActionDialog'
import { RepoSettingsDialog } from './RepoSettingsDialog'
import { RepoStatusError, RepoStatusLine } from './RepoStatusLine'

export function RepoCard({ repo }: { repo: RepoConfig }) {
  const status = useRepoStatus(repo.id)
  const openRepo = useOpenRepo()
  const [action, setAction] = useState<ActionRequest | null>(null)
  const [editing, setEditing] = useState(false)
  const s = status.data
  /** A merge or rebase is waiting to be resolved or aborted. */
  const inProgress = s?.operation != null

  const open = (target: OpenTarget) => void openRepo(repo.id, target)

  const actionButton = (req: ActionRequest, primary = false, disabled = false) => (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      disabled={disabled || (inProgress && req.action !== 'abort')}
      onClick={() => setAction(req)}
    >
      {ACTION_LABELS[req.action]}
    </Button>
  )

  return (
    <article className="repo-card" aria-labelledby={`repo-${repo.id}`}>
      <header className="repo-card-head">
        <div>
          <h2 id={`repo-${repo.id}`}>{repo.name}</h2>
          <p className="muted mono repo-path">{repo.path}</p>
        </div>
        <div className="button-row">
          <IconButton
            label={OPEN_LABELS.editor}
            icon={<Code size={16} aria-hidden="true" />}
            onClick={() => open('editor')}
          />
          <IconButton
            label={OPEN_LABELS.terminal}
            icon={<Terminal size={16} aria-hidden="true" />}
            onClick={() => open('terminal')}
          />
          <IconButton
            label={OPEN_LABELS.files}
            icon={<FolderOpen size={16} aria-hidden="true" />}
            onClick={() => open('files')}
          />
          <IconButton
            label={`${repo.name} settings`}
            icon={<Settings2 size={16} aria-hidden="true" />}
            onClick={() => setEditing(true)}
          />
        </div>
      </header>

      {s ? <RepoStatusLine repo={repo} status={s} /> : null}
      {status.error ? <RepoStatusError message={status.error.message} /> : null}
      {status.isPending ? <p className="muted">Reading status…</p> : null}

      <div className="button-row repo-actions">
        {inProgress ? (
          <>
            <Button size="sm" variant="primary" onClick={() => open('editor')}>
              Resolve in VS Code
            </Button>
            {actionButton({ action: 'abort' })}
          </>
        ) : null}
        {actionButton({ action: 'fetchAll' })}
        {actionButton({ action: 'syncBase' })}
        {actionButton(
          { action: 'updateBranch', strategy: 'merge', stash: false },
          !inProgress,
          !s?.branch || s.branch === repo.baseBranch,
        )}
        {actionButton({ action: 'newBranch', kind: 'feature', title: '' })}
        {actionButton({ action: 'pushBranch' }, false, !s?.branch)}
        {s?.hasUpstreamRemote ? actionButton({ action: 'syncFork' }) : null}
      </div>

      {action ? (
        <ActionDialog repo={repo} initial={action} onClose={() => setAction(null)} />
      ) : null}
      {editing ? <RepoSettingsDialog repo={repo} onClose={() => setEditing(false)} /> : null}
    </article>
  )
}
