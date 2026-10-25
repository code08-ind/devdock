import { useCallback, useEffect, useRef, useState } from 'react'
import { VIEWS, type View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { useAddWatch } from '../../lib/bitbucket'
import { useWatchPipeline } from '../../lib/jenkins'
import { useBridgeEvent, useSettings } from '../../lib/devdock'
import { hasMod } from '../../lib/keyboard'
import { useAction } from '../../lib/useAction'
import { useRepos } from '../../lib/repos'
import { Button } from '../../ui/Button'
import { useModal } from '../../ui/Dialog'
import { EmptyState, useToast } from '../../ui/Feedback'
import { watchLabel } from '../builds/BuildBits'
import { BuildsPage } from '../builds/BuildsPage'
import { CommandPalette } from '../palette/CommandPalette'
import { useCommandDialogs } from '../palette/CommandDialogs'
import { VIEW_LABELS } from '../palette/commands'
import { useCommands } from '../palette/useCommands'
import { prLabel } from '../prs/PrBits'
import { PrsPage } from '../prs/PrsPage'
import { ActionDialog } from '../repos/ActionDialog'
import { ReposPage } from '../repos/ReposPage'
import { SettingsPage } from '../settings/SettingsPage'
import { StartWorkFor } from '../tickets/StartWorkFor'
import { TicketsPage } from '../tickets/TicketsPage'
import { HomePage } from '../home/HomePage'
import { TodayPage } from '../today/TodayPage'
import type { UtilityRequest } from '@shared/utilities'
import { UtilitiesPage } from '../utilities/UtilitiesPage'
import { NavRail } from './NavRail'
import { EMPTY_COPY, VIEW_ICONS } from './views'

function ViewBody({
  view,
  onView,
  onPalette,
  buildsKey,
  utility,
  onUtility,
}: {
  onUtility: (request: UtilityRequest) => void
  buildsKey: number
  /** The palette's last request for Utilities (remounts the view on its tab). */
  utility: { n: number; request: UtilityRequest } | null
  view: View
  onView: (v: View) => void
  onPalette: () => void
}) {
  if (view === 'settings') return <SettingsPage />
  if (view === 'repos') return <ReposPage />
  if (view === 'home') {
    return <HomePage onView={onView} onUtility={onUtility} onPalette={onPalette} />
  }
  if (view === 'today') return <TodayPage onView={onView} />
  if (view === 'tickets') return <TicketsPage onView={onView} />
  if (view === 'prs') return <PrsPage onView={onView} />
  // Remounted (key) after a pipeline watch from the palette, so it opens on Watched.
  if (view === 'builds') return <BuildsPage key={buildsKey} onView={onView} />
  if (view === 'utilities') {
    return <UtilitiesPage key={utility?.n ?? 0} request={utility?.request} onView={onView} />
  }
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
    <dialog
      ref={ref}
      className="palette-dialog"
      aria-label="Command palette"
      // The close event arrives a moment after closing: if the palette was opened again in
      // between (a quick ⌘K, Esc, ⌘K), it must not close the new one.
      onClose={() => {
        if (!ref.current?.open) onClose()
      }}
    >
      {open ? children : null}
    </dialog>
  )
}

export function App() {
  const settings = useSettings().data
  // DevDock opens on Home, the launcher (user request, P6-A).
  const [view, setView] = useState<View>('home')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [buildsKey, setBuildsKey] = useState(0)
  const [utility, setUtility] = useState<{ n: number; request: UtilityRequest } | null>(null)
  const openUtility = useCallback((request: UtilityRequest) => {
    setUtility((u) => ({ n: (u?.n ?? 0) + 1, request }))
    setView('utilities')
  }, [])
  useBridgeEvent('utilities:requested', openUtility)
  const [requested, setRequested] = useState<{ id: string; request: ActionRequest } | null>(null)
  const repos = useRepos()
  const requestedRepo = requested ? repos.find((r) => r.id === requested.id) : undefined
  const requestAction = useCallback((id: string, request: ActionRequest) => {
    setView('repos')
    setRequested({ id, request })
  }, [])
  // `watch <link>` / `pipeline <link>` from either palette: show PRs or Builds and report the
  // result here (toast).
  const { run } = useAction()
  const toast = useToast()
  const addWatch = useAddWatch().mutateAsync
  const watchPipeline = useWatchPipeline().mutateAsync
  const watchLink = useCallback(
    (link: string, pipeline = false) => {
      if (pipeline) {
        setView('builds')
        void run(watchPipeline(link)).then((r) => {
          if (!r.ok) return
          toast(`Watching ${watchLabel(r.value)}`)
          setBuildsKey((k) => k + 1)
        })
        return
      }
      setView('prs')
      void run(addWatch(link)).then((r) => {
        if (r.ok) toast(`Watching ${prLabel(r.value.pr)}`)
      })
    },
    [run, toast, addWatch, watchPipeline],
  )
  // `branch <KEY>` (palette or palette window): Start work over whatever view is showing.
  const [startKey, setStartKey] = useState<string | null>(null)
  const onTicketRequested = useCallback(({ key }: { key: string }) => setStartKey(key), [])
  useBridgeEvent('tickets:requested', onTicketRequested)
  const commandDialogs = useCommandDialogs()
  const { commands, forQuery } = useCommands({
    confirm: commandDialogs.confirm,
    prAction: commandDialogs.prAction,
    goto: setView,
    requestAction,
    watch: watchLink,
    utility: openUtility,
    startWork: setStartKey,
  })
  const main = useRef<HTMLElement>(null)

  useBridgeEvent('nav:goto', setView)
  // From the palette window: run the action in this window's dialog.
  const onActionRequested = useCallback(
    ({ id, request }: { id: string; request: ActionRequest }) => requestAction(id, request),
    [requestAction],
  )
  useBridgeEvent('repos:actionRequested', onActionRequested)
  const onWatchRequested = useCallback(
    ({ link, pipeline }: { link: string; pipeline?: boolean }) => watchLink(link, pipeline),
    [watchLink],
  )
  useBridgeEvent('watch:requested', onWatchRequested)

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
        {/* Home has its own heading, in its welcome header. */}
        {view === 'home' ? null : (
          <h1 className="view-title" tabIndex={-1}>
            {VIEW_LABELS[view]}
          </h1>
        )}
        <ViewBody
          view={view}
          onView={setView}
          onPalette={() => setPaletteOpen(true)}
          buildsKey={buildsKey}
          utility={utility}
          onUtility={openUtility}
        />
      </main>
      {startKey ? (
        <StartWorkFor issueKey={startKey} onClose={() => setStartKey(null)} onView={setView} />
      ) : null}
      {commandDialogs.dialogs}
      {requested && requestedRepo ? (
        <ActionDialog
          key={`${requested.id}:${requested.request.action}`}
          repo={requestedRepo}
          initial={requested.request}
          onClose={() => setRequested(null)}
        />
      ) : null}
      <PaletteOverlay open={paletteOpen} onClose={() => setPaletteOpen(false)}>
        <CommandPalette
          commands={commands}
          forQuery={forQuery}
          onClose={() => setPaletteOpen(false)}
        />
      </PaletteOverlay>
    </div>
  )
}
