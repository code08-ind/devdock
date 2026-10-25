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
  return disabledReason(req, repo, s) !== null
}

/** Why the action is off right now (shown on hover), or null when it can run. */
export function disabledReason(
  req: ActionRequest,
  repo: RepoConfig,
  s: RepoStatus | undefined,
): string | null {
  if (s?.operation != null && req.action !== 'abort') {
    return `Finish or abort the ${s.operation} first`
  }
  if (req.action === 'updateBranch') {
    if (!s?.branch) return 'Check out a branch first'
    if (s.branch === repo.baseBranch)
      return `You're on ${repo.baseBranch}: switch to your branch to update it`
  }
  if (req.action === 'pushBranch' && !s?.branch) return 'Check out a branch first'
  return null
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
  const reason = disabledReason(request, repo, status)
  return (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      disabled={reason !== null}
      title={reason ?? undefined}
      onClick={() => onPick(request)}
    >
      {ACTION_LABELS[request.action]}
    </Button>
  )
}
