import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SettingsPatch } from '@shared/settings'
import { bridge, keys, unwrap } from './devdock'
import { useAction } from './useAction'

/** Notification actions shared by Settings and the command palette (same wording in both). */
export function useNotificationActions() {
  const { run, pending } = useAction()
  return {
    pending,
    pause: () =>
      run(unwrap(bridge.notifications.pause({ minutes: 60 })), 'Notifications paused for 1 hour'),
    resume: () => run(unwrap(bridge.notifications.resume()), 'Notifications resumed'),
    test: () =>
      run(unwrap(bridge.notifications.test({ type: 'build-finished' })), 'Test notification sent'),
  }
}

/** Settings update whose failures surface as a toast (for callers without an inline error slot). */
export function useUpdateSettingsAction() {
  const qc = useQueryClient()
  const { run } = useAction()
  const m = useMutation({
    mutationFn: (patch: SettingsPatch) => unwrap(bridge.settings.update(patch)),
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  })
  return (patch: SettingsPatch) => run(m.mutateAsync(patch))
}
