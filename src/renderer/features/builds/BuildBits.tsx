import {
  jobLabel,
  type BuildResult,
  type BuildWatch,
  type JenkinsBuild,
  type StageState,
} from '@shared/jenkins'
import { StatusPill, type Tone } from '../../ui/Feedback'
import { ago } from '../prs/PrBits'

/** Small pieces shared by the Builds view, the build dialog and Today. */

const RESULT: Record<BuildResult, [Tone, string]> = {
  success: ['success', 'Passed'],
  failed: ['danger', 'Failed'],
  unstable: ['warning', 'Unstable'],
  aborted: ['neutral', 'Aborted'],
  not_built: ['neutral', 'Not built'],
  running: ['info', 'Running'],
}

export function BuildPill({ build }: { build: JenkinsBuild | null }) {
  if (!build) return <StatusPill tone="neutral">No builds yet</StatusPill>
  const [tone, text] = RESULT[build.state]
  return <StatusPill tone={tone}>{text}</StatusPill>
}

const STAGE: Record<StageState, [Tone, string]> = {
  success: ['success', 'Passed'],
  failed: ['danger', 'Failed'],
  unstable: ['warning', 'Unstable'],
  aborted: ['neutral', 'Aborted'],
  running: ['info', 'Running'],
  paused: ['warning', 'Waiting for input'],
  queued: ['neutral', 'Queued'],
  skipped: ['neutral', 'Skipped'],
  unknown: ['neutral', 'Unknown'],
}

export function StagePill({ state }: { state: StageState }) {
  const [tone, text] = STAGE[state]
  return <StatusPill tone={tone}>{text}</StatusPill>
}

/** "42 s" / "3 min 5 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/** "Started 5 min ago · took 2 min 50 s", or the estimate while it runs. */
export function BuildTimes({ build }: { build: JenkinsBuild }) {
  const started = build.startedAt ? `Started ${ago(build.startedAt)}` : null
  const length =
    build.durationMs !== null
      ? `took ${duration(build.durationMs)}`
      : build.estimatedMs !== null
        ? `usually takes ${duration(build.estimatedMs)}`
        : null
  const text = [started, length].filter(Boolean).join(', ')
  return text ? <span className="muted">{text}</span> : null
}

/** A watch's name: what was asked for ("web-app #412 pipeline") or the job. */
export const watchLabel = (w: BuildWatch) => w.label ?? jobLabel(w.job)

/** A watch's name, build number and state: the head of a watch row (Builds, Today). */
export function WatchHead({ watch: w }: { watch: BuildWatch }) {
  return (
    <>
      <span className="mono pr-ref">
        {watchLabel(w)}
        {w.number !== null ? ` #${w.number}` : ''}
      </span>
      {w.build ? <BuildPill build={w.build} /> : <StatusPill tone="neutral">Waiting</StatusPill>}
    </>
  )
}

/** What a watch is doing now, in words. */
export function watchNote(w: BuildWatch): string {
  if (w.error) return w.error
  if (w.done) return 'Finished: no longer checked.'
  const checked = w.checkedAt ? `Checked ${ago(w.checkedAt)}.` : ''
  if (w.number === null) {
    return w.kind === 'deploy'
      ? `Waiting for a deploy of ${w.branch} to start. ${checked}`
      : `Waiting for the next build to start. ${checked}`
  }
  return `Watching: you'll be notified when it finishes. ${checked}`
}
