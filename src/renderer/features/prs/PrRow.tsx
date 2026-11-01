import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, ExternalLink, Sparkles } from 'lucide-react'
import { providerOf, type PrAction, type PullRequest } from '@shared/bitbucket'
import { PROVIDER_NAMES } from '@shared/providers'
import { useAddWatch, useRemoveWatch } from '../../lib/bitbucket'
import { bridge, unwrap } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button, IconButton } from '../../ui/Button'
import { AgeOf, BuildPill, ReviewState, StatePill, prLabel } from './PrBits'
import { ACTION_COPY } from './actions'
import { PrActionDialog } from './PrActionDialog'
import { useAiAssistant, useAiAvailable } from '../../lib/ai'
import { AiDialog } from '../ai/AiDialog'

/**
 * One PR (SPEC 6.3 card): title, source → target, build, reviews, open threads, conflicts,
 * age and the link. `actions` is empty unless PR actions are on in Settings.
 */
export function PrRow({
  pr,
  watchKey,
  actions = [],
  showAuthor = false,
  children,
}: {
  pr: PullRequest
  /** The watch key when this PR is watched; undefined when not. */
  watchKey: string | undefined
  actions?: readonly PrAction[]
  showAuthor?: boolean
  /** Extra lines under the row (a watch's last check or error). */
  children?: ReactNode
}) {
  const { run, pending } = useAction()
  const addWatch = useAddWatch()
  const removeWatch = useRemoveWatch()
  const [acting, setActing] = useState<PrAction | null>(null)
  const aiAvailable = useAiAvailable()
  const assistant = useAiAssistant()
  const [noting, setNoting] = useState(false)
  const label = prLabel(pr)
  const provider = PROVIDER_NAMES[providerOf(pr.ref)]

  const toggleWatch = () =>
    watchKey
      ? void run(removeWatch.mutateAsync(watchKey), `Stopped watching ${label}`)
      : void run(addWatch.mutateAsync(pr.url), `Watching ${label}`)

  return (
    <li className="pr-row">
      <div className="pr-row-head">
        <span className="mono pr-ref">{label}</span>
        {/* Bitbucket rows look as before P7; the others say where they live. */}
        {pr.ref.provider ? <span className="muted pr-provider">{provider}</span> : null}
        <StatePill pr={pr} />
        <BuildPill pr={pr} />
        <ReviewState pr={pr} />
        <span className="row-actions">
          <IconButton
            label={watchKey ? `Stop watching ${label}` : `Watch ${label}`}
            icon={
              watchKey ? (
                <EyeOff size={16} aria-hidden="true" />
              ) : (
                <Eye size={16} aria-hidden="true" />
              )
            }
            // One toggle at a time: a double click mustn't send a second add/remove.
            disabled={pending}
            onClick={toggleWatch}
          />
          {aiAvailable ? (
            <IconButton
              label={`Summarise ${label} with ${assistant}`}
              icon={<Sparkles size={16} aria-hidden="true" />}
              onClick={() => setNoting(true)}
            />
          ) : null}
          <IconButton
            label={`Open ${label} in ${provider}`}
            icon={<ExternalLink size={16} aria-hidden="true" />}
            onClick={() => void run(unwrap(bridge.app.openExternal({ url: pr.url })))}
          />
        </span>
      </div>
      <h3 className="pr-title">{pr.title}</h3>
      <p className="pr-meta">
        <span className="mono pr-branches">
          {pr.sourceBranch} → {pr.targetBranch}
        </span>
        <AgeOf pr={pr} />
        {showAuthor ? <span className="muted">by {pr.author}</span> : null}
      </p>
      {actions.length ? (
        <div className="button-row">
          {actions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'merge' ? 'secondary' : 'ghost'}
              icon={ACTION_COPY[a].icon}
              aria-label={`${ACTION_COPY[a].verb} ${label}`}
              onClick={() => setActing(a)}
            >
              {ACTION_COPY[a].button}
            </Button>
          ))}
        </div>
      ) : null}
      {children}
      {acting ? <PrActionDialog pr={pr} action={acting} onClose={() => setActing(null)} /> : null}
      {noting ? (
        <AiDialog
          request={{ feature: 'pr-summary', ref: pr.ref }}
          onClose={() => setNoting(false)}
        />
      ) : null}
    </li>
  )
}
