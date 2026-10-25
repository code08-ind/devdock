import { useCallback, useState } from 'react'
import type { View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { bridge, useBridgeEvent } from '../../lib/devdock'
import { CommandPalette } from './CommandPalette'
import type { UtilityRequest } from '@shared/utilities'
import { useCommands } from './useCommands'

const close = () => void bridge.palette.close()
const goto = (view: View) => void bridge.app.showView({ view })
const requestAction = (id: string, request: ActionRequest) =>
  void bridge.repos.requestAction({ id, request })
// This window hides after a command, so the main window watches it and reports the result.
const watch = (link: string, pipeline?: boolean) => void bridge.watch.request({ link, pipeline })
const utility = (request: UtilityRequest) => void bridge.utilities.request(request)

/** The global-shortcut palette window. It is hidden, not destroyed, so reset on each show. */
export function PaletteWindow() {
  const [resetKey, setResetKey] = useState(0)
  const onShown = useCallback(() => setResetKey((k) => k + 1), [])
  useBridgeEvent('palette:shown', onShown)
  const { commands, forQuery } = useCommands(goto, requestAction, watch, utility)
  return (
    <div className="palette-window">
      <CommandPalette key={resetKey} commands={commands} forQuery={forQuery} onClose={close} />
    </div>
  )
}
