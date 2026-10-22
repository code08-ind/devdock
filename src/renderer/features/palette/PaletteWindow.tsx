import { useCallback, useState } from 'react'
import type { View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { bridge, useBridgeEvent } from '../../lib/devdock'
import { CommandPalette } from './CommandPalette'
import { useCommands } from './useCommands'

const close = () => void bridge.palette.close()
const goto = (view: View) => void bridge.app.showView({ view })
const requestAction = (id: string, request: ActionRequest) =>
  void bridge.repos.requestAction({ id, request })

/** The global-shortcut palette window. It is hidden, not destroyed, so reset on each show. */
export function PaletteWindow() {
  const [resetKey, setResetKey] = useState(0)
  const onShown = useCallback(() => setResetKey((k) => k + 1), [])
  useBridgeEvent('palette:shown', onShown)
  const commands = useCommands(goto, requestAction)
  return (
    <div className="palette-window">
      <CommandPalette key={resetKey} commands={commands} onClose={close} />
    </div>
  )
}
