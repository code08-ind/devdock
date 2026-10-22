import { VIEWS, type View } from '@shared/channels'
import { useNotificationActions, useUpdateSettingsAction } from '../../lib/actions'
import { bridge, unwrap, usePauseState, useSettings } from '../../lib/devdock'
import { modLabel } from '../../lib/keyboard'
import { useAction } from '../../lib/useAction'
import { THEME_LABELS } from '../../ui/appearance'
import { buildCommands, type Command } from './commands'

/** The live command registry for either window; `goto` differs per window. */
export function useCommands(goto: (view: View) => void): Command[] {
  const { run } = useAction()
  const notifications = useNotificationActions()
  const update = useUpdateSettingsAction()
  const settings = useSettings().data
  const paused = usePauseState().data?.pausedUntil != null

  if (!settings) return []
  return buildCommands(
    {
      goto,
      viewShortcut: (i) => modLabel(String(i + 1)),
      theme: settings.appearance.theme,
      themeLabel: (t) => THEME_LABELS[t],
      demoMode: settings.general.demoMode,
      paused,
      update,
      pause: notifications.pause,
      resume: notifications.resume,
      openLogs: () => run(unwrap(bridge.app.openLogsFolder())),
      testNotification: notifications.test,
      quit: () => run(unwrap(bridge.app.quit())),
    },
    VIEWS,
  )
}
