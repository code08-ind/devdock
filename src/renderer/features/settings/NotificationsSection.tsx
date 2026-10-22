import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import type { NotificationRecord } from '@shared/ipc'
import { NOTIFICATION_TYPES, type NotificationType, type Settings } from '@shared/settings'
import { useNotificationActions } from '../../lib/actions'
import { bridge, keys, unwrap, usePauseState, useUpdateSettings } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill } from '../../ui/Feedback'
import { Checkbox, Field, Input, Toggle } from '../../ui/Field'
import { Section } from './Section'

const TYPE_LABELS: Record<NotificationType, string> = {
  'build-finished': 'Build finished',
  'pr-comment': 'New PR comment',
  'pr-approval': 'PR approved',
  'pr-needs-work': 'PR marked needs work',
  'job-finished': 'Watched job finished',
}

const SUPPRESSED: Record<NonNullable<NotificationRecord['suppressedReason']>, string> = {
  'type-off': 'Not shown: type turned off',
  'quiet-hours': 'Not shown: quiet hours',
  paused: 'Not shown: paused',
}

const time = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function History() {
  const { run } = useAction()
  const [confirm, setConfirm] = useState(false)
  const { data = [], error } = useQuery({
    queryKey: keys.history,
    queryFn: () => unwrap(bridge.notifications.history()),
  })
  if (error) return <ErrorNotice error={error} />
  return (
    <div className="field">
      <div className="row-between">
        <h3 className="field-label">History</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={data.length === 0}
          onClick={() => setConfirm(true)}
        >
          Clear history
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Clear notification history?"
        body={<p>DevDock deletes the list of {data.length} past notifications.</p>}
        confirmLabel="Clear history"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={() => void run(unwrap(bridge.notifications.clear()), 'History cleared')}
      />
      {data.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <ul className="list" aria-label="Notification history">
          {data.slice(0, 20).map((n) => (
            <li key={n.id} className="list-row">
              <span className="tabular muted">{time(n.at)}</span>
              <span>
                {n.title} <span className="muted">— {n.body}</span>
              </span>
              {n.shown ? (
                <StatusPill tone="success">Shown</StatusPill>
              ) : (
                <StatusPill tone="neutral">
                  {n.suppressedReason ? SUPPRESSED[n.suppressedReason] : 'Not shown'}
                </StatusPill>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.length > 20 ? (
        <p className="muted field-hint">Showing the latest 20 of {data.length}.</p>
      ) : null}
    </div>
  )
}

export function NotificationsSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const actions = useNotificationActions()
  const pausedUntil = usePauseState().data?.pausedUntil ?? null
  const n = settings.notifications
  return (
    <Section id="notifications" title="Notifications">
      <div className="row-between">
        {pausedUntil ? (
          <StatusPill tone="warning">
            Paused until{' '}
            {new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </StatusPill>
        ) : (
          <StatusPill tone="success">Notifications on</StatusPill>
        )}
        <span className="button-row">
          {pausedUntil ? (
            <Button
              icon={<Bell size={16} aria-hidden="true" />}
              disabled={actions.pending}
              onClick={() => void actions.resume()}
            >
              Resume
            </Button>
          ) : (
            <Button
              icon={<BellOff size={16} aria-hidden="true" />}
              disabled={actions.pending}
              onClick={() => void actions.pause()}
            >
              Pause for 1 hour
            </Button>
          )}
          <Button disabled={actions.pending} onClick={() => void actions.test()}>
            Send test notification
          </Button>
        </span>
      </div>

      <fieldset className="checks">
        <legend className="field-label">Notify me about</legend>
        {NOTIFICATION_TYPES.map((t) => (
          <Checkbox
            key={t}
            label={TYPE_LABELS[t]}
            checked={n.types[t] !== false}
            onChecked={(on) => update.mutate({ notifications: { types: { [t]: on } } })}
          />
        ))}
      </fieldset>

      <Toggle
        label="Play a sound"
        checked={n.sound}
        onChecked={(sound) => update.mutate({ notifications: { sound } })}
      />
      <Toggle
        label="Quiet hours"
        description="Notifications are still recorded in history, just not shown."
        checked={n.quietHours.enabled}
        onChecked={(enabled) => update.mutate({ notifications: { quietHours: { enabled } } })}
      />
      {n.quietHours.enabled ? (
        <div className="field-row">
          <Field label="From">
            {({ id }) => (
              <Input
                id={id}
                type="time"
                className="input-time"
                value={n.quietHours.start}
                onChange={(e) =>
                  e.target.value &&
                  update.mutate({ notifications: { quietHours: { start: e.target.value } } })
                }
              />
            )}
          </Field>
          <Field label="Until">
            {({ id }) => (
              <Input
                id={id}
                type="time"
                className="input-time"
                value={n.quietHours.end}
                onChange={(e) =>
                  e.target.value &&
                  update.mutate({ notifications: { quietHours: { end: e.target.value } } })
                }
              />
            )}
          </Field>
        </div>
      ) : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
      <History />
    </Section>
  )
}
