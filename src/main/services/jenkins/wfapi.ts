import type { BuildResult, Stage, StageState } from '@shared/jenkins'
import { num, obj, text } from '../json'

/**
 * Pipeline REST API (`wfapi`, the Pipeline: Stage View plugin) and the build JSON, mapped onto
 * the shared model. Pure.
 */

const STAGE_STATUS: Record<string, StageState> = {
  SUCCESS: 'success',
  FAILED: 'failed',
  UNSTABLE: 'unstable',
  ABORTED: 'aborted',
  IN_PROGRESS: 'running',
  PAUSED_PENDING_INPUT: 'paused',
  QUEUED: 'queued',
  NOT_EXECUTED: 'skipped',
}

/** Jenkins sends 0 (or -1) for "not started". */
const epoch = (v: unknown): number | null => {
  const n = num(v)
  return n && n > 0 ? n : null
}

/**
 * Stages from `GET …/{n}/wfapi/describe`. Null when the answer has no `stages` list (not a
 * Pipeline build), which the UI shows as "stages unavailable". A running stage's duration is
 * the time so far, so it is left out.
 */
export function parseStages(body: unknown): Stage[] | null {
  const stages = obj(body).stages
  if (!Array.isArray(stages)) return null
  return stages.map((raw) => {
    const s = obj(raw)
    const state = STAGE_STATUS[text(s.status) ?? ''] ?? 'unknown'
    return {
      name: text(s.name) ?? 'Unnamed stage',
      state,
      startedAt: epoch(s.startTimeMillis),
      durationMs: state === 'running' || state === 'queued' ? null : num(s.durationMillis),
    }
  })
}

const RESULT: Record<string, BuildResult> = {
  SUCCESS: 'success',
  FAILURE: 'failed',
  UNSTABLE: 'unstable',
  ABORTED: 'aborted',
  NOT_BUILT: 'not_built',
}

/** A build's state from `building` + `result` (`result` stays null until it finishes). */
export function buildState(raw: unknown): BuildResult {
  const b = obj(raw)
  if (b.building === true) return 'running'
  const result = text(b.result)
  // Finished but not yet recorded (post-build steps): still running as far as a watcher cares.
  return result ? (RESULT[result] ?? 'failed') : 'running'
}

/** The build fields of the job/build JSON (`timestamp`, `duration`, `estimatedDuration`). */
export function buildTimes(raw: unknown): {
  startedAt: number | null
  durationMs: number | null
  estimatedMs: number | null
} {
  const b = obj(raw)
  const running = buildState(b) === 'running'
  const duration = num(b.duration)
  return {
    startedAt: epoch(b.timestamp),
    durationMs: running || duration === null ? null : duration,
    estimatedMs: epoch(b.estimatedDuration),
  }
}

/**
 * Parameters and causes from a build's `actions`. Password and file parameters are skipped:
 * Jenkins masks the first and the second has no value to show.
 */
export function buildActions(raw: unknown): {
  parameters: { name: string; value: string }[]
  causes: string[]
} {
  const actions = obj(raw).actions
  const parameters: { name: string; value: string }[] = []
  const causes: string[] = []
  for (const action of Array.isArray(actions) ? actions : []) {
    const a = obj(action)
    for (const p of Array.isArray(a.parameters) ? a.parameters : []) {
      const param = obj(p)
      const name = text(param.name)
      if (!name || /Password|FileParameter/i.test(text(param._class) ?? '')) continue
      const value = param.value
      parameters.push({
        name,
        value: typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value),
      })
    }
    for (const c of Array.isArray(a.causes) ? a.causes : []) {
      const description = text(obj(c).shortDescription)
      if (description) causes.push(description)
    }
  }
  return { parameters, causes }
}
