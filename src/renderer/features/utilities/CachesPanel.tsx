import { useState } from 'react'
import { HEAVY_CACHE, formatBytes, type CacheEntry } from '@shared/utilities'
import { useCachePlan, useClean } from '../../lib/utilities'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Checkbox } from '../../ui/Field'

const size = (e: CacheEntry) =>
  e.symlink
    ? 'link (its target is kept)'
    : `${e.approximate ? 'at least ' : ''}${formatBytes(e.bytes)}`

/**
 * SPEC 6.6 Clean caches: `node_modules/.vite`, `dist`, `coverage` with their sizes, removed after
 * a confirmation listing them; `node_modules` itself only after a second confirmation.
 */
export function CachesPanel({ repoId }: { repoId: string }) {
  const plan = useCachePlan(repoId)
  const clean = useClean(repoId)
  const toast = useToast()
  const [withModules, setWithModules] = useState(false)
  const [step, setStep] = useState<'none' | 'confirm' | 'modules'>('none')
  const present = (plan.data?.entries ?? []).filter((e) => e.exists)
  const heavy = plan.data?.heavy
  const listed = [
    ...present.filter((e) => !(withModules && e.path.startsWith(`${HEAVY_CACHE}/`))),
    ...(withModules && heavy?.exists ? [heavy] : []),
  ]
  const total = listed.reduce((sum, e) => sum + e.bytes, 0)

  const run = () =>
    clean.mutate(
      { includeNodeModules: withModules },
      {
        onSuccess: (r) => {
          toast(
            r.removed.length
              ? `Removed ${r.removed.join(', ')} (${formatBytes(r.freedBytes)} freed)`
              : 'Nothing to remove',
          )
          setWithModules(false)
        },
        onSettled: () => setStep('none'),
      },
    )

  if (plan.error) return <ErrorNotice error={plan.error} />
  if (!plan.data) {
    return (
      <p className="muted" role="status">
        Measuring caches…
      </p>
    )
  }
  return (
    <section className="stack" aria-label="Clean caches">
      <ul className="stage-list" aria-label="Cache folders">
        {plan.data.entries.map((e) => (
          <li key={e.path} className="stage">
            <span className="stage-name mono">{e.path}</span>
            <span className="muted">{e.exists ? size(e) : 'not there'}</span>
          </li>
        ))}
      </ul>
      {heavy?.exists ? (
        <Checkbox
          label={`Also remove ${HEAVY_CACHE} (${size(heavy)}) — you'll need to install again`}
          checked={withModules}
          onChecked={setWithModules}
        />
      ) : null}
      <div className="button-row">
        <Button
          variant="danger"
          disabled={listed.length === 0 || clean.isPending}
          onClick={() => setStep('confirm')}
        >
          {clean.isPending ? 'Removing…' : 'Clean caches'}
        </Button>
        {listed.length === 0 ? <span className="muted">Nothing to remove.</span> : null}
      </div>
      {clean.error ? <ErrorNotice error={clean.error} /> : null}
      <ConfirmDialog
        open={step === 'confirm'}
        title={`Remove ${listed.length === 1 ? 'this folder' : `these ${listed.length} folders`}?`}
        body={
          <>
            <ul>
              {listed.map((e) => (
                <li key={e.path}>
                  <span className="mono">{e.path}</span> — {size(e)}
                </li>
              ))}
            </ul>
            <p>{formatBytes(total)} in all. They are rebuilt the next time you build or test.</p>
          </>
        }
        confirmLabel={withModules ? 'Continue' : 'Remove'}
        danger
        onClose={() => setStep((s) => (s === 'confirm' ? 'none' : s))}
        onConfirm={() => (withModules ? setStep('modules') : run())}
      />
      <ConfirmDialog
        open={step === 'modules'}
        title={`Remove ${HEAVY_CACHE} too?`}
        body={
          <p>
            Every installed package of this repo goes ({heavy ? size(heavy) : ''}). Run your package
            manager's install afterwards.
          </p>
        }
        confirmLabel={`Remove ${HEAVY_CACHE}`}
        danger
        onClose={() => setStep('none')}
        onConfirm={run}
      />
    </section>
  )
}
