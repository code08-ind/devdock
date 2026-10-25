import type { ActionRequest, RepoStatus } from '@shared/repos'
import type { RepoConfig } from '@shared/settings'
import { ACTION_LABELS } from '../../lib/repos'
import { Button } from '../../ui/Button'

/**
 * Off while a merge or rebase waits to be resolved (only Abort works then), and when there is
 * no branch to act on: Update my branch needs a branch other than the base, Push one at all.
 */
export function actionDisabled(
  req: ActionRequest,
  repo: RepoConfig,
  s: RepoStatus | undefined,
): boolean {
  if (s?.operation != null && req.action !== 'abort') return true
  if (req.action === 'updateBranch') return !s?.branch || s.branch === repo.baseBranch
  if (req.action === 'pushBranch') return !s?.branch
  return false
}

/** One git action for a repo; picking it opens the action dialog (commands shown first). */
export function RepoActionButton({
  repo,
  status,
  request,
  primary = false,
  onPick,
}: {
  repo: RepoConfig
  status: RepoStatus | undefined
  request: ActionRequest
  primary?: boolean
  onPick: (request: ActionRequest) => void
}) {
  return (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      disabled={actionDisabled(request, repo, status)}
      onClick={() => onPick(request)}
    >
      {ACTION_LABELS[request.action]}
    </Button>
  )
}
