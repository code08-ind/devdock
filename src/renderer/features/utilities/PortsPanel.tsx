import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Network, RefreshCw } from 'lucide-react'
import { PORT_FILTERS, type ListeningPort } from '@shared/utilities'
import { filterPorts, type PortFilter as Filter } from './pure'
import { DevDockError, bridge } from '../../lib/devdock'
import { usePorts, useStop, utilityKeys } from '../../lib/utilities'
import { Button, IconButton } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { EmptyState, ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl } from '../../ui/Field'

/**
 * SPEC 6.6 Ports: listening TCP ports with PID, process and command; quick filters; Stop with
 * a confirmation, and Force stop only after a second one. `stopPort` (palette `kill 5173`) opens
 * the stop dialog for that port's process.
 */
export function PortsPanel({ stopPort }: { stopPort?: number }) {
  const qc = useQueryClient()
  const ports = usePorts()
  const [filter, setFilter] = useState<Filter>('all')
  const [typed, setTyped] = useState(stopPort ? String(stopPort) : '')
  const [stopping, setStopping] = useState<ListeningPort | null>(null)
  // The palette asked for a port: open its dialog once the list has it.
  const [asked, setAsked] = useState(stopPort ?? null)
  const [askedNote, setAskedNote] = useState<string | null>(null)
  const rows = filterPorts(ports.data ?? [], filter, typed)
  // Only a scan made since this view opened: a cached list may name an old PID.
  if (asked !== null && ports.data && ports.isFetchedAfterMount && !ports.isFetching) {
    const target = ports.data.filter((p) => p.port === asked)
    setAsked(null)
    if (target.length === 1) setStopping(target[0]!)
    else
      setAskedNote(
        target.length === 0
          ? `Nothing is listening on port ${asked}.`
          : `${target.length} processes listen on port ${asked}: choose one below.`,
      )
  }

  return (
    <section className="prs-list" aria-label="Ports">
      <div className="ports-bar">
        <SegmentedControl
          label="Quick filter"
          options={[
            { value: 'all' as Filter, label: 'All' },
            ...PORT_FILTERS.map((f) => ({ value: f.label as Filter, label: f.label })),
          ]}
          value={filter}
          onValue={setFilter}
        />
        <Field label="Port or process">
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              value={typed}
              placeholder="5173"
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </Field>
        <IconButton
          label="Scan ports again"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          disabled={ports.isFetching}
          onClick={() => void qc.invalidateQueries({ queryKey: utilityKeys.ports })}
        />
      </div>
      {askedNote ? <p className="muted">{askedNote}</p> : null}
      {ports.error ? (
        <ErrorNotice error={ports.error} />
      ) : ports.isPending ? (
        <p className="muted" role="status">
          Scanning listening ports…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Network size={18} aria-hidden="true" />}
          title={
            ports.data?.length
              ? 'Nothing listening matches this filter.'
              : 'Nothing is listening on a TCP port.'
          }
        />
      ) : (
        <ul className="pr-list" aria-label="Listening ports">
          {rows.map((r) => (
            <li key={`${r.port}:${r.pid}`} className="pr-row">
              <div className="pr-row-head">
                <span className="mono pr-ref">:{r.port}</span>
                <span>{r.process}</span>
                <span className="muted">PID {r.pid}</span>
                <span className="muted mono">{r.addresses.join(', ')}</span>
                <span className="spacer" />
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`Stop ${r.process} on port ${r.port}`}
                  onClick={() => setStopping(r)}
                >
                  Stop
                </Button>
              </div>
              {r.command ? <p className="pr-meta mono port-command">{r.command}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {stopping ? <StopDialog row={stopping} onClose={() => setStopping(null)} /> : null}
    </section>
  )
}

/** Plain stop first; Force stop only after it, as its own confirmation (SPEC 6.6). */
function StopDialog({ row, onClose }: { row: ListeningPort; onClose: () => void }) {
  const stop = useStop()
  const toast = useToast()
  const [step, setStep] = useState<'confirm' | 'force'>('confirm')
  const windows = bridge.platform === 'win32'
  const name = `${row.process} (PID ${row.pid})`

  const send = (force: boolean) =>
    stop.mutate(
      {
        pid: row.pid,
        port: row.port,
        force,
        confirmed: true,
        ...(force ? { forceConfirmed: true as const } : {}),
      },
      {
        onSuccess: ({ stillListening }) => {
          if (stillListening) return setStep('force')
          toast(`Stopped ${name}; port ${row.port} is free`)
          onClose()
        },
        onError: (err) => {
          // Only a process that ignored the polite request gets the second step; anything else
          // (it exited, its PID changed, no permission) is shown as it is.
          if (err instanceof DevDockError && err.code === 'NOT_STOPPED' && !force) {
            stop.reset()
            setStep('force')
          }
        },
      },
    )

  return (
    <Dialog
      open
      title={step === 'confirm' ? `Stop ${name}?` : `Force stop ${name}?`}
      onClose={onClose}
      dismissible={!stop.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={stop.isPending}>
            Cancel
          </Button>
          <Button variant="danger" disabled={stop.isPending} onClick={() => send(step === 'force')}>
            {stop.isPending ? 'Stopping…' : step === 'confirm' ? 'Stop process' : 'Force stop'}
          </Button>
        </>
      }
    >
      {step === 'confirm' ? (
        <p>
          DevDock asks {row.process} to exit
          {windows ? ' (taskkill /PID … /T, with the processes it started)' : ' (SIGTERM)'}. It is
          listening on port {row.port}.
        </p>
      ) : (
        <p>
          It is still running. Force stop ends it at once
          {windows ? ' (taskkill /F)' : ' (SIGKILL)'}, without letting it save or clean up.
        </p>
      )}
      {row.command ? <p className="mono port-command">{row.command}</p> : null}
      {stop.error ? <ErrorNotice error={stop.error} /> : null}
    </Dialog>
  )
}
