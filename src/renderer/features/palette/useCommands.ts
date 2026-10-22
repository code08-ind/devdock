import { VIEWS, type View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import { useNotificationActions, useUpdateSettingsAction } from '../../lib/actions'
import { bridge, unwrap, usePauseState, useSettings } from '../../lib/devdock'
import { modLabel } from '../../lib/keyboard'
import { OPEN_LABELS, useOpenRepo, useRepos } from '../../lib/repos'
import { useAction } from '../../lib/useAction'
import { THEME_LABELS } from '../../ui/appearance'
import { buildCommands, type Command } from './commands'

/**
 * The live command registry for either window. `goto` and `requestAction` differ per window:
 * the main window handles them in place, the palette window forwards them to the main window.
 */
export function useCommands(
  goto: (view: View) => void,
  requestAction: (id: string, request: ActionRequest) => void,
): Command[] {
  const { run } = useAction()
  const notifications = useNotificationActions()
  const update = useUpdateSettingsAction()
  const openRepo = useOpenRepo()
  const settings = useSettings().data
  const paused = usePauseState().data?.pausedUntil != null
  const repos = useRepos()

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
      repos,
      requestAction,
      openRepo,
      openLabels: OPEN_LABELS,
    },
    VIEWS,
  )
}
