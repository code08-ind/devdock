import {
  QueryClient,
  focusManager,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import type { EventChannel } from '@shared/channels'
import type { ErrorCode, EventPayload, IpcEnvelope } from '@shared/ipc'
import type { Settings, SettingsPatch } from '@shared/settings'

/** A failed IPC call: `message` is human-readable, `details` goes behind a disclosure. */
export class DevDockError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message)
    this.name = 'DevDockError'
  }
}

/** Turns an IPC envelope into a value or a thrown DevDockError. */
export async function unwrap<T>(call: Promise<IpcEnvelope<T>>): Promise<T> {
  const r = await call
  if (r.ok) return r.data
  throw new DevDockError(r.error.code, r.error.message, r.error.details)
}

export const bridge = window.devdock

export const queryClient = new QueryClient({
  defaultOptions: {
    // Data is local IPC; refetch only when main says it changed.
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

/** Query keys. The `*All` roots invalidate every query in that area. */
// React Query refetches "on focus" via visibilitychange, which an Electron window doesn't fire
// when you switch apps. Use the window's focus/blur instead (SPEC 6.2: refresh on focus).
focusManager.setEventListener((setFocused) => {
  const onFocus = () => setFocused(true)
  const onBlur = () => setFocused(false)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }
})

export const keys = {
  settings: ['settings'],
  secretsAll: ['secrets'],
  secretsStatus: ['secrets', 'status'],
  secrets: ['secrets', 'list'],
  notificationsAll: ['notifications'],
  history: ['notifications', 'history'],
  pause: ['notifications', 'state'],
  repoStatusAll: ['repos', 'status'],
  repoStatus: (id: string) => ['repos', 'status', id] as const,
} as const

export function useBridgeEvent<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): void {
  useEffect(() => bridge.on(event, listener), [event, listener])
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => unwrap(bridge.settings.get()) })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => unwrap(bridge.settings.update(patch)),
    onSuccess: (s: Settings) => qc.setQueryData(keys.settings, s),
  })
}

export function usePauseState() {
  return useQuery({
    queryKey: keys.pause,
    queryFn: () => unwrap(bridge.notifications.state()),
  })
}

/** Keeps the query cache in step with changes made elsewhere (other window, tray, palette). */
const onSettingsChanged = (s: Settings) => queryClient.setQueryData(keys.settings, s)
const onNotificationsChanged = () => {
  void queryClient.invalidateQueries({ queryKey: keys.notificationsAll })
}

const onRepoChanged = ({ id }: { id: string }) => {
  void queryClient.invalidateQueries({ queryKey: keys.repoStatus(id) })
}

export function useMainEvents(): void {
  useBridgeEvent('settings:changed', onSettingsChanged)
  useBridgeEvent('notifications:changed', onNotificationsChanged)
  useBridgeEvent('repos:changed', onRepoChanged)
}
