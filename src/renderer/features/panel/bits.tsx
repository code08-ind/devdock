import type { ReactNode } from 'react'
import type { View } from '@shared/channels'
import type { UtilityRequest } from '@shared/utilities'
import { bridge } from '../../lib/devdock'

/** Depth lives in the main window: showing a view there hides the panel. */
export const goto = (view: View) => void bridge.app.showView({ view })
export const watch = (link: string, pipeline?: boolean) =>
  void bridge.watch.request({ link, pipeline })
export const openUtility = (request: UtilityRequest) => void bridge.utilities.request(request)

/** A titled group in a panel tab (the panel's TodaySection). */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-group" aria-label={title}>
      <h2 className="panel-group-title">{title}</h2>
      {children}
    </section>
  )
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="muted" role="status">
      Loading {what}…
    </p>
  )
}
