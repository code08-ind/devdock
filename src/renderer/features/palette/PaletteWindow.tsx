import { useCallback, useState } from 'react'
import type { View } from '@shared/channels'
import { bridge, useBridgeEvent } from '../../lib/devdock'
import { CommandPalette } from './CommandPalette'
import { useCommands } from './useCommands'

const close = () => void bridge.palette.close()
const goto = (view: View) => void bridge.app.showView({ view })

/** The global-shortcut palette window. It is hidden, not destroyed, so reset on each show. */
export function PaletteWindow() {
  const [resetKey, setResetKey] = useState(0)
  const onShown = useCallback(() => setResetKey((k) => k + 1), [])
  useBridgeEvent('palette:shown', onShown)
  const commands = useCommands(goto)
  return (
    <div className="palette-window">
      <CommandPalette key={resetKey} commands={commands} onClose={close} />
    </div>
  )
}
