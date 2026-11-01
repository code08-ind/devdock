import { useEffect, useRef } from 'react'
import type { PlannedCommand } from '@shared/repos'

/** Shared by every dialog that runs git: the disclosure before, the streamed log during. */

/** Shows an argument the way you'd type it in a shell (quoted when it has spaces). */
const shellArg = (a: string) =>
  /^[\w@%+=:,./{}-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`

export function CommandList({ commands }: { commands: PlannedCommand[] }) {
  return (
    <details className="commands" open>
      <summary>Commands that will run</summary>
      <ol className="mono">
        {commands.map((c, i) => (
          <li key={i}>
            {c.program ?? 'git'} {c.args.map(shellArg).join(' ')}
            {c.note ? <span className="muted"> — {c.note}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  )
}

export function ActivityLog({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    // Scrollable by keyboard; not a live region (raw git output would flood screen readers —
    // the result is announced by the toast and the status line instead).
    <pre
      ref={ref}
      className="activity-log mono"
      role="log"
      aria-live="off"
      aria-label="Git output"
      // A scrollable region must be reachable by keyboard (WCAG 2.1.1).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      {text || 'Waiting for output…'}
    </pre>
  )
}
