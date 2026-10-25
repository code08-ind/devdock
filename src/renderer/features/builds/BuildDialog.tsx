import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { jobLabel, type BuildRef } from '@shared/jenkins'
import { bridge, unwrap } from '../../lib/devdock'
import { useBuild } from '../../lib/jenkins'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice } from '../../ui/Feedback'
import { KeyValue } from '../../ui/Text'
import { BuildPill, BuildTimes, StagePill, duration } from './BuildBits'
import { ConsoleTail } from './ConsoleTail'

/** One build (SPEC 6.4): status, duration, stages (or "stages unavailable"), link, console tail. */
export function BuildDialog({ build: ref, onClose }: { build: BuildRef; onClose: () => void }) {
  const query = useBuild(ref)
  const { run } = useAction()
  const detail = query.data

  return (
    <Dialog
      open
      wide
      title={`${jobLabel(ref.job)} #${ref.number}`}
      onClose={onClose}
      actions={
        <>
          {detail ? (
            <Button
              icon={<ExternalLink size={16} aria-hidden="true" />}
              onClick={() => void run(unwrap(bridge.app.openExternal({ url: detail.build.url })))}
            >
              Open in Jenkins
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {query.error ? <ErrorNotice error={query.error} /> : null}
      {detail ? (
        <>
          <p className="build-head">
            <BuildPill build={detail.build} />
            <BuildTimes build={detail.build} />
          </p>
          {detail.stages === null ? (
            <p className="muted">Stages unavailable: this job doesn't report Pipeline stages.</p>
          ) : detail.stages.length === 0 ? (
            <p className="muted">No stages yet.</p>
          ) : (
            <ol className="stage-list" aria-label="Stages">
              {detail.stages.map((s, i) => (
                <li key={`${i}:${s.name}`} className="stage">
                  <span className="stage-name">{s.name}</span>
                  <StagePill state={s.state} />
                  {s.durationMs !== null && s.state !== 'skipped' ? (
                    <span className="muted">{duration(s.durationMs)}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {detail.parameters.length || detail.causes.length ? (
            <KeyValue
              items={[
                ...(detail.causes.length
                  ? [['Cause', detail.causes.join('; ')] as [string, ReactNode]]
                  : []),
                ...detail.parameters.map((p): [string, ReactNode] => [
                  p.name,
                  <span className="mono">{p.value}</span>,
                ]),
              ]}
            />
          ) : null}
        </>
      ) : query.isPending ? (
        <p className="muted" role="status">
          Loading the build from Jenkins…
        </p>
      ) : null}
      <ConsoleTail build={ref} />
    </Dialog>
  )
}
