import type { AgentLaunch } from '@shared/agents'
import { useCallback, useMemo, useState } from 'react'
import type { View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { bridge, useBridgeEvent } from '../../lib/devdock'
import { CommandPalette } from './CommandPalette'
import type { Command } from './commands'
import type { UtilityRequest } from '@shared/utilities'
import { useCommands } from './useCommands'

const close = () => void bridge.palette.close()
const goto = (view: View) => void bridge.app.showView({ view })
const requestAction = (id: string, request: ActionRequest) =>
  void bridge.repos.requestAction({ id, request })
// This window hides after a command, so the main window watches it and reports the result.
const watch = (link: string, pipeline?: boolean) => void bridge.watch.request({ link, pipeline })
const utility = (request: UtilityRequest) => void bridge.utilities.request(request)
const startWork = (key: string) => void bridge.tickets.request({ key })
const openTerminal = (repoId: string | null, agent?: AgentLaunch) =>
  void bridge.terminal.request({ repoId, agent })
// Commands with a dialog (or a result to report) are built as in the main window, then handed
// there by id: the main window runs its own copy, with its dialog.
const inMain = () => {}
const handOver = (c: Command): Command =>
  c.inMain ? { ...c, run: () => void bridge.commands.request({ id: c.id }) } : c

/** The global-shortcut palette window. It is hidden, not destroyed, so reset on each show. */
export function PaletteWindow() {
  const [resetKey, setResetKey] = useState(0)
  const onShown = useCallback(() => setResetKey((k) => k + 1), [])
  useBridgeEvent('palette:shown', onShown)
  const { commands, forQuery } = useCommands({
    goto,
    requestAction,
    watch,
    utility,
    startWork,
    openTerminal,
    confirm: inMain,
    prAction: inMain,
    ai: inMain,
    trigger: inMain,
  })
  const shown = useMemo(() => commands.map(handOver), [commands])
  return (
    <div className="palette-window">
      <CommandPalette key={resetKey} commands={shown} forQuery={forQuery} onClose={close} />
    </div>
  )
}
