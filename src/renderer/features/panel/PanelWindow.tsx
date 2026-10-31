import type { AgentLaunch } from '@shared/agents'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Search, Settings } from 'lucide-react'
import type { ActionRequest } from '@shared/repos'
import type { UtilityRequest } from '@shared/utilities'
import logo from '../../assets/logo.png'
import { useNotificationActions } from '../../lib/actions'
import { bridge, useBridgeEvent, usePauseState } from '../../lib/devdock'
import { useRepos } from '../../lib/repos'
import { Button, IconButton } from '../../ui/Button'
import { SegmentedControl } from '../../ui/Field'
import { CommandPalette } from '../palette/CommandPalette'
import { useCommandDialogs } from '../palette/CommandDialogs'
import { useCommands } from '../palette/useCommands'
import { ActionDialog } from '../repos/ActionDialog'
import { Announcer } from '../shell/Announcer'
import { StartWorkFor } from '../tickets/StartWorkFor'
import { goto, openUtility, watch } from './bits'
import { ReposTab } from './ReposTab'
import { TicketsTab } from './TicketsTab'
import { TodayTab } from './TodayTab'
import { ToolsTab } from './ToolsTab'

type Tab = 'today' | 'repos' | 'tickets' | 'tools'

const TABS: { value: Tab; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'repos', label: 'Repos' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'tools', label: 'Tools' },
]

const close = () => void bridge.panel.close()

/**
 * The menu-bar / tray panel (P6-E): the day at a glance and one-click actions, without opening
 * the main window. Actions that change a remote or stop a process confirm in the same dialogs
 * as the main window (SPEC 7); "Open DevDock" is there for anything deeper.
 */
export function PanelWindow() {
  const [tab, setTab] = useState<Tab>('today')
  const [searching, setSearching] = useState(false)
  // From the panel's own search: a repo action opens its dialog here, `kill <port>` the
  // port's stop dialog in Tools (`n` remounts it when the same port is asked for again).
  const [requested, setRequested] = useState<{ id: string; request: ActionRequest } | null>(null)
  const [stop, setStop] = useState<{ port: number; n: number } | null>(null)
  const body = useRef<HTMLDivElement>(null)

  const onShown = useCallback(() => {
    setSearching(false)
    body.current?.scrollTo(0, 0)
  }, [])
  useBridgeEvent('panel:shown', onShown)

  // Escape hides the panel, unless a dialog (it closes itself) or the search is taking it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open]')) return
      if (searching) setSearching(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searching])

  const requestAction = (id: string, request: ActionRequest) => setRequested({ id, request })
  // The terminal lives in the main window.
  const openTerminal = (repoId: string | null, agent?: AgentLaunch) =>
    void bridge.terminal.request({ repoId, agent })
  const utility = (request: UtilityRequest) => {
    const port = request.tab === 'ports' ? request.stopPort : undefined
    if (port === undefined) {
      openUtility(request)
      return
    }
    setStop((prev) => ({ port, n: (prev?.n ?? 0) + 1 }))
    setTab('tools')
  }
  const [startKey, setStartKey] = useState<string | null>(null)
  const commandDialogs = useCommandDialogs()
  const { commands, forQuery } = useCommands({
    confirm: commandDialogs.confirm,
    prAction: commandDialogs.prAction,
    ai: (request) => void commandDialogs.ai(request),
    goto,
    requestAction,
    watch,
    utility,
    startWork: setStartKey,
    openTerminal,
  })
  const repos = useRepos()
  const requestedRepo = requested ? repos.find((r) => r.id === requested.id) : undefined

  return (
    <div className="panel">
      <header className="panel-head">
        <img src={logo} alt="" width={24} height={24} className="panel-logo" />
        <h1 className="panel-title">DevDock</h1>
        <span className="row-actions">
          <PauseButton />
          <IconButton
            label="Settings"
            icon={<Settings size={16} aria-hidden="true" />}
            onClick={() => goto('settings')}
          />
        </span>
      </header>

      {searching ? (
        <div className="panel-search">
          <CommandPalette
            commands={commands}
            forQuery={forQuery}
            onClose={() => setSearching(false)}
          />
        </div>
      ) : (
        <>
          <button type="button" className="panel-search-button" onClick={() => setSearching(true)}>
            <Search size={16} aria-hidden="true" />
            Search every action
          </button>
          <div className="panel-tabs">
            <SegmentedControl label="Show" hideLabel options={TABS} value={tab} onValue={setTab} />
          </div>
          <div className="panel-body" ref={body}>
            {tab === 'today' ? <TodayTab /> : null}
            {tab === 'repos' ? <ReposTab /> : null}
            {tab === 'tickets' ? <TicketsTab /> : null}
            {tab === 'tools' ? <ToolsTab key={stop?.n} stopPort={stop?.port} /> : null}
          </div>
        </>
      )}

      <footer className="panel-foot">
        <Button variant="primary" onClick={() => goto('home')}>
          Open DevDock
        </Button>
      </footer>

      {commandDialogs.dialogs}
      {startKey ? (
        <StartWorkFor issueKey={startKey} onClose={() => setStartKey(null)} onView={goto} />
      ) : null}
      {requested && requestedRepo ? (
        <ActionDialog
          key={`${requested.id}:${requested.request.action}`}
          repo={requestedRepo}
          initial={requested.request}
          onClose={() => setRequested(null)}
        />
      ) : null}
      <Announcer />
    </div>
  )
}

function PauseButton() {
  const paused = usePauseState().data?.pausedUntil != null
  const n = useNotificationActions()
  return (
    <IconButton
      label={paused ? 'Resume notifications' : 'Pause notifications for 1 hour'}
      icon={
        paused ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />
      }
      disabled={n.pending}
      onClick={() => void (paused ? n.resume() : n.pause())}
    />
  )
}
