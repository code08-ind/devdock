import type { ReactNode } from 'react'
import { Kbd } from './Text'

/**
 * Hover/focus tooltip, pure CSS. It repeats what the wrapped control already exposes through
 * aria-label / aria-keyshortcuts, so it is hidden from assistive tech.
 */
export function Tooltip({
  text,
  shortcut,
  children,
}: {
  text: string
  shortcut?: string
  children: ReactNode
}) {
  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip" aria-hidden="true">
        {text}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </span>
    </span>
  )
}
