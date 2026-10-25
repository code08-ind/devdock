import type { PrAction, PullRequest } from '@shared/bitbucket'
import { VIEWS, type View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import type { UtilityRequest } from '@shared/utilities'
import { useNotificationActions, useUpdateSettingsAction } from '../../lib/actions'
import { usePrList, useRemoveWatch, useWatches } from '../../lib/bitbucket'
import { bridge, isSetUp, unwrap, usePauseState, useSettings } from '../../lib/devdock'
import { useDevServers } from '../../lib/devservers'
import { useBuildWatches, useClearFinished, useRemoveBuildWatch } from '../../lib/jenkins'
import { useJiraList } from '../../lib/jira'
import { modLabel } from '../../lib/keyboard'
import { OPEN_LABELS, useOpenRepo, useRepos } from '../../lib/repos'
import { useAction } from '../../lib/useAction'
import { THEME_LABELS } from '../../ui/appearance'
import { watchLabel } from '../builds/BuildBits'
import { MINE, OTHERS } from '../prs/actions'
import { prLabel } from '../prs/PrBits'
import { buildCommands, queryCommands, type Command, type ConfirmRequest } from './commands'

const isOpen = (pr: PullRequest) => pr.state === 'open'

/** What each window does with commands that show something (the rest run the same anywhere). */
export interface CommandHandlers {
  goto: (view: View) => void
  /** Opens a repo action's dialog (commands shown first). */
  requestAction: (id: string, request: ActionRequest) => void
  watch: (link: string, pipeline?: boolean) => void
  utility: (request: UtilityRequest) => void
  /** Opens Start work for an issue key. */
  startWork: (key: string) => void
  /** Windows that can show dialogs (main, panel): stopping a process and PR actions ask first. */
  confirm?: (request: ConfirmRequest) => void
  prAction?: (pr: PullRequest, action: PrAction) => void
}

/**
 * The live command registry for any window. The handlers differ per window: the main window
 * and the panel act in place, the palette window forwards to the main window.
 */
export function useCommands(h: CommandHandlers): {
  commands: Command[]
  forQuery: (query: string) => Command[]
} {
  const { run } = useAction()
  const notifications = useNotificationActions()
  const update = useUpdateSettingsAction()
  const openRepo = useOpenRepo()
  const settings = useSettings().data
  const paused = usePauseState().data?.pausedUntil != null
  const repos = useRepos()
  const servers = useDevServers()
  const watches = useWatches().data ?? []
  const removeWatch = useRemoveWatch()
  // My open issues for "Start work on …": asked for only once Jira is set up.
  const issues =
    useJiraList(settings && isSetUp(settings, 'jira') ? { list: 'mine' } : null).data ?? []

  // PR actions once turned on in Settings: merge mine, approve / needs work on the ones I review.
  const prActionsOn = Boolean(settings?.features.prActions && isSetUp(settings, 'bitbucket'))
  const mine = usePrList('mine', prActionsOn).data ?? []
  const reviewing = usePrList('reviewing', prActionsOn).data ?? []
  const openPrs = [
    ...mine.filter(isOpen).flatMap((pr) => MINE.map((action) => ({ pr, action }))),
    ...reviewing.filter(isOpen).flatMap((pr) => OTHERS.map((action) => ({ pr, action }))),
  ]
  const builds = useBuildWatches().data ?? []
  const removeBuild = useRemoveBuildWatch()
  const clearFinished = useClearFinished()

  const quickLinks = settings?.quickLinks ?? []
  const openLink = (url: string) => run(unwrap(bridge.app.openExternal({ url })))
  const configured = {
    bitbucket: settings ? isSetUp(settings, 'bitbucket') : false,
    jenkins: settings ? isSetUp(settings, 'jenkins') : false,
    jira: settings ? isSetUp(settings, 'jira') : false,
  }
  const forQuery = (query: string) =>
    queryCommands(query, { ...h, quickLinks, openLink, repos, configured })
  if (!settings) return { commands: [], forQuery }
  const commands = buildCommands(
    {
      ...h,
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
      openRepo,
      openLabels: OPEN_LABELS,
      quickLinks,
      openLink,
      devServers: repos.map((r) => {
        const s = servers.find((d) => d.repoId === r.id && d.kind === 'dev')
        return {
          repoId: r.id,
          running: s?.status === 'running' || s?.status === 'starting',
        }
      }),
      devServer: (id, start) =>
        run(
          start
            ? unwrap(bridge.devserver.start({ id, kind: 'dev' }))
            : unwrap(bridge.devserver.stop({ id, kind: 'dev' })),
          start ? 'Dev server starting' : 'Dev server stopped',
        ),
      issues,
      configured,
      prActions: openPrs.map(({ pr, action }) => ({ key: pr.key, label: prLabel(pr), action })),
      prAction: h.prAction
        ? (key, action) => {
            const found = openPrs.find((p) => p.pr.key === key)
            if (found) h.prAction?.(found.pr, action)
          }
        : undefined,
      buildWatches: builds.map((w) => ({ key: w.key, label: watchLabel(w) })),
      finishedBuilds: builds.some((w) => w.done),
      unwatchBuild: (key) => {
        const w = builds.find((b) => b.key === key)
        return run(removeBuild.mutateAsync(key), `Stopped watching ${w ? watchLabel(w) : 'it'}`)
      },
      clearFinishedBuilds: () => run(clearFinished.mutateAsync(), 'Cleared finished build watches'),
      watches: watches.map((w) => ({ key: w.key, label: prLabel(w.pr) })),
      unwatch: (key) => {
        const w = watches.find((x) => x.key === key)
        return run(removeWatch.mutateAsync(key), `Stopped watching ${w ? prLabel(w.pr) : 'it'}`)
      },
    },
    VIEWS,
  )
  return { commands, forQuery }
}
