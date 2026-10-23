import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Play, Square } from 'lucide-react'
import { BASELINE_SCRIPT, isActive, type DevServerState, type ServerKind } from '@shared/devserver'
import type { RepoConfig } from '@shared/settings'
import { bridge, unwrap } from '../../lib/devdock'
import { useDevServer, useDevServerLog } from '../../lib/devservers'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { StatusPill, type Tone } from '../../ui/Feedback'

const LABEL: Record<ServerKind, string> = { dev: 'Dev server', baseline: 'Baseline server' }

const STATUS: Record<DevServerState['status'], (s: DevServerState) => [Tone, string]> = {
  starting: () => ['info', 'Starting…'],
  running: (s) => ['success', `Running on port ${s.port}`],
  stopping: () => ['info', 'Stopping…'],
  stopped: () => ['neutral', 'Stopped'],
  failed: (s) => ['danger', `Failed: ${s.error ?? 'could not start'}`],
  exited: (s) => ['warning', `Exited with code ${s.exitCode ?? '?'}`],
}

/** Start/Stop, detected URL, and a live log for a repo's dev or baseline server (SPEC 6.2). */
export function DevServerPanel({ repo, kind }: { repo: RepoConfig; kind: ServerKind }) {
  const server = useDevServer(repo.id, kind)
  const { run, pending } = useAction()
  const [showLog, setShowLog] = useState(false)
  const log = useDevServerLog(repo.id, kind, showLog)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const active = server ? isActive(server.status) : false
  const label = LABEL[kind]
  const [tone, text] = server
    ? STATUS[server.status](server)
    : (['neutral', 'Not running'] as const)

  return (
    <section className="devserver" aria-label={`${label} for ${repo.name}`}>
      <div className="devserver-row">
        <span className="devserver-name">{label}</span>
        <code className="muted">
          {server?.command ?? (kind === 'dev' ? repo.devCommand : `node ${BASELINE_SCRIPT}`)}
        </code>
        <StatusPill tone={tone}>{text}</StatusPill>
        {server?.url && server.status === 'running' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink size={14} aria-hidden="true" />}
            onClick={() => void run(unwrap(bridge.app.openExternal({ url: server.url! })))}
          >
            {server.url}
          </Button>
        ) : null}
        <span className="spacer" />
        {active ? (
          <Button
            size="sm"
            variant="danger"
            icon={<Square size={14} aria-hidden="true" />}
            disabled={pending}
            onClick={() =>
              void run(unwrap(bridge.devserver.stop({ id: repo.id, kind })), `${label} stopped`)
            }
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Play size={14} aria-hidden="true" />}
            disabled={pending || server?.status === 'stopping'}
            onClick={() => {
              setShowLog(true)
              void run(unwrap(bridge.devserver.start({ id: repo.id, kind })))
            }}
          >
            Start {label.toLowerCase()}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showLog}
          onClick={() => setShowLog((v) => !v)}
        >
          {showLog ? 'Hide log' : 'Show log'}
        </Button>
      </div>
      {showLog ? (
        <pre
          ref={logRef}
          className="activity-log mono"
          role="log"
          aria-live="off"
          aria-label={`${label} log`}
          // A scrollable region must be reachable by keyboard (WCAG 2.1.1).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          {log || 'No output yet.'}
        </pre>
      ) : null}
    </section>
  )
}
