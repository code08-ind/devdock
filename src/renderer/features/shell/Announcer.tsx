import { useCallback, useEffect, useRef, useState } from 'react'
import { bridge, useBridgeEvent, useSettings } from '../../lib/devdock'

/**
 * Settings → Accessibility → "Read out background events": each notification shown while the
 * main window is open (build finished, PR changed) is also put in a polite live region, so a
 * screen reader announces it without moving focus. Notifications held back (type off, quiet
 * hours, paused) stay silent here too.
 */
export function Announcer() {
  const on = useSettings().data?.accessibility.announce ?? false
  const [text, setText] = useState('')
  // Only what arrives after the window opened; the history before that was never announced.
  const since = useRef(Infinity)
  useEffect(() => {
    since.current = Date.now()
  }, [])

  const onChanged = useCallback(() => {
    if (!on) return
    void bridge.notifications.history().then((r) => {
      if (!r.ok) return
      const fresh = r.data.filter((n) => n.at > since.current && n.shown)
      if (fresh.length === 0) return
      since.current = Math.max(...fresh.map((n) => n.at))
      setText(fresh.map((n) => `${n.title}. ${n.body}`).join(' '))
    })
  }, [on])
  useBridgeEvent('notifications:changed', onChanged)

  return (
    <div className="visually-hidden" role="status" aria-live="polite" data-testid="announcer">
      {on ? text : ''}
    </div>
  )
}
