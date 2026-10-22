import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel } from '../shared/channels'

// Build `devdock.<ns>.<method>()` from the allow-list. Nothing outside it is reachable.
const api: Record<string, unknown> = {}
for (const channel of INVOKE_CHANNELS) {
  const [ns, method] = channel.split(':') as [string, string]
  const group = (api[ns] ??= {}) as Record<string, unknown>
  group[method] = (payload?: unknown) => ipcRenderer.invoke(channel, payload)
}

const events = new Set<string>(EVENT_CHANNELS)

api.on = (event: EventChannel, listener: (payload: unknown) => void) => {
  if (!events.has(event)) throw new Error(`Unknown event: ${String(event)}`)
  const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(event, wrapped)
  return () => ipcRenderer.removeListener(event, wrapped)
}
api.platform = process.platform

contextBridge.exposeInMainWorld('devdock', api)
