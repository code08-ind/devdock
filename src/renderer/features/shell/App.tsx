import { useCallback, useEffect, useRef, useState } from 'react'
import { VIEWS, type View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { useBridgeEvent, useSettings } from '../../lib/devdock'
import { hasMod } from '../../lib/keyboard'
import { useRepos } from '../../lib/repos'
import { Button } from '../../ui/Button'
import { useModal } from '../../ui/Dialog'
import { EmptyState } from '../../ui/Feedback'
import { CommandPalette } from '../palette/CommandPalette'
import { VIEW_LABELS } from '../palette/commands'
import { useCommands } from '../palette/useCommands'
import { ActionDialog } from '../repos/ActionDialog'
import { ReposPage } from '../repos/ReposPage'
import { SettingsPage } from '../settings/SettingsPage'
import { TicketsPage } from '../tickets/TicketsPage'
import { TodayPage } from '../today/TodayPage'
import { NavRail } from './NavRail'
import { EMPTY_COPY, VIEW_ICONS } from './views'

function ViewBody({
  view,
  onView,
  onPalette,
}: {
  view: View
  onView: (v: View) => void
  onPalette: () => void
}) {
  if (view === 'settings') return <SettingsPage />
  if (view === 'repos') return <ReposPage />
  if (view === 'today') return <TodayPage onView={onView} />
  if (view === 'tickets') return <TicketsPage onView={onView} />
  return (
    <EmptyState
      icon={VIEW_ICONS[view]}
      title={EMPTY_COPY[view]}
      action={
        view === 'utilities' ? (
          <Button onClick={onPalette}>Open command palette</Button>
        ) : (
          <Button onClick={() => onView('settings')}>Open Settings</Button>
        )
      }
    />
  )
}

/** In-window palette (Cmd/Ctrl+K) in a modal <dialog> so focus stays inside it. */
function PaletteOverlay({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useModal(ref, open)
  return (
    <dialog ref={ref} className="palette-dialog" aria-label="Command palette" onClose={onClose}>
      {open ? children : null}
    </dialog>
  )
}

export function App() {
  const settings = useSettings().data
  const [view, setView] = useState<View>('today')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [requested, setRequested] = useState<{ id: string; request: ActionRequest } | null>(null)
  const repos = useRepos()
  const requestedRepo = requested ? repos.find((r) => r.id === requested.id) : undefined
  const requestAction = useCallback((id: string, request: ActionRequest) => {
    setView('repos')
    setRequested({ id, request })
  }, [])
  const commands = useCommands(setView, requestAction)
  const main = useRef<HTMLElement>(null)

  useBridgeEvent('nav:goto', setView)
  // From the palette window: run the action in this window's dialog.
  const onActionRequested = useCallback(
    ({ id, request }: { id: string; request: ActionRequest }) => requestAction(id, request),
    [requestAction],
  )
  useBridgeEvent('repos:actionRequested', onActionRequested)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      const n = Number(k)
      if (k === 'k') setPaletteOpen((o) => !o)
      // Behind an open dialog the views are inert; don't switch them.
      else if (document.querySelector('dialog[open]')) return
      else if (k === ',') setView('settings')
      else if (n >= 1 && n <= VIEWS.length) setView(VIEWS[n - 1]!)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Move focus to the new view's heading so keyboard and screen-reader users land in it.
  useEffect(() => {
    main.current?.querySelector('h1')?.focus()
  }, [view])

  return (
    <div className="app">
      <NavRail
        view={view}
        onView={setView}
        onPalette={() => setPaletteOpen(true)}
        demoMode={settings?.general.demoMode ?? false}
      />
      <main ref={main} className="content" data-view={view}>
        <h1 className="view-title" tabIndex={-1}>
          {VIEW_LABELS[view]}
        </h1>
        <ViewBody view={view} onView={setView} onPalette={() => setPaletteOpen(true)} />
      </main>
      {requested && requestedRepo ? (
        <ActionDialog
          key={`${requested.id}:${requested.request.action}`}
          repo={requestedRepo}
          initial={requested.request}
          onClose={() => setRequested(null)}
        />
      ) : null}
      <PaletteOverlay open={paletteOpen} onClose={() => setPaletteOpen(false)}>
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      </PaletteOverlay>
    </div>
  )
}
