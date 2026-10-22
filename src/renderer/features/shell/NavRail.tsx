import { Command as CommandIcon } from 'lucide-react'
import { VIEWS, type View } from '@shared/channels'
import { modAria, modLabel } from '../../lib/keyboard'
import { StatusPill } from '../../ui/Feedback'
import { Kbd } from '../../ui/Text'
import { VIEW_LABELS } from '../palette/commands'
import { VIEW_ICONS } from './views'

export function NavRail({
  view,
  onView,
  onPalette,
  demoMode,
}: {
  view: View
  onView: (v: View) => void
  onPalette: () => void
  demoMode: boolean
}) {
  return (
    <nav className="rail" aria-label="Main">
      <ul className="rail-list">
        {VIEWS.map((v, i) => (
          <li key={v}>
            <button
              type="button"
              className="rail-item"
              aria-current={v === view ? 'page' : undefined}
              aria-keyshortcuts={modAria(String(i + 1))}
              title={`${VIEW_LABELS[v]} (${modLabel(String(i + 1))})`}
              onClick={() => onView(v)}
            >
              {VIEW_ICONS[v]}
              <span>{VIEW_LABELS[v]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rail-foot">
        {demoMode ? <StatusPill tone="info">Demo mode</StatusPill> : null}
        <button
          type="button"
          className="rail-item"
          aria-keyshortcuts={modAria('K')}
          onClick={onPalette}
        >
          <CommandIcon size={18} aria-hidden="true" />
          <span>Commands</span>
          <Kbd>{modLabel('K')}</Kbd>
        </button>
      </div>
    </nav>
  )
}
