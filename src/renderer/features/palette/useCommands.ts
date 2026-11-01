import { useQueries } from '@tanstack/react-query'
import type { AgentLaunch } from '@shared/agents'
import { usePreferredAgent } from '../../lib/agents'
import { useAiAvailable } from '../../lib/ai'
import { PROVIDER_ACTIONS, providerOf, type PrAction, type PullRequest } from '@shared/bitbucket'
import {
  CI_ACTION_COPY,
  CI_ACTIONS,
  ciActionAllowed,
  ciRunLabel,
  type CiAction,
  type CiRun,
} from '@shared/ci'
import { isActive } from '@shared/devserver'
import { jobLabel, triggerRefusal, type BranchBuild } from '@shared/jenkins'
import { enabledCi, enabledProviders } from '@shared/settings'
import { VIEWS, type View } from '@shared/channels'
import type { ActionRequest } from '@shared/repos'
import type { UtilityRequest } from '@shared/utilities'
import { useNotificationActions, useUpdateSettingsAction } from '../../lib/actions'
import { usePrList, useRemoveWatch, useWatches } from '../../lib/bitbucket'
import { bridge, isSetUp, keys, unwrap, usePauseState, useSettings } from '../../lib/devdock'
import { useDevServers } from '../../lib/devservers'
import {
  useAddBuildWatch,
  useBranches,
  useBuildWatches,
  useClearFinished,
  useRemoveBuildWatch,
} from '../../lib/jenkins'
import { useJiraList } from '../../lib/jira'
import {
  useCiRuns,
  useCiWatches,
  useClearFinishedRuns,
  useRemoveCiWatch,
} from '../../lib/providers'
import { modLabel } from '../../lib/keyboard'
import { OPEN_LABELS, useOpenRepo, useRepos } from '../../lib/repos'
import { ticketMoveConfirm, useAcceptTicketMove, useTicketMoves } from '../../lib/ticketmoves'
import { useAction } from '../../lib/useAction'
import { THEME_LABELS } from '../../ui/appearance'
import { useToast } from '../../ui/Feedback'
import { watchLabel } from '../builds/BuildBits'
import { MINE, OTHERS } from '../prs/actions'
import { prLabel } from '../prs/PrBits'
import type { AiCommandRequest } from './CommandDialogs'
import { buildCommands, queryCommands, type Command, type ConfirmRequest } from './commands'

const isOpen = (pr: PullRequest) => pr.state === 'open'
/** The actions a provider's API offers (GitLab has no request changes). */
const actionsFor = (pr: PullRequest, wanted: readonly PrAction[]) =>
  wanted.filter((a) => PROVIDER_ACTIONS[providerOf(pr.ref)].includes(a))

/** What each window does with commands that show something (the rest run the same anywhere). */
export interface CommandHandlers {
  goto: (view: View) => void
  /** Opens a repo action's dialog (commands shown first). */
  requestAction: (id: string, request: ActionRequest) => void
  watch: (link: string, pipeline?: boolean) => void
  utility: (request: UtilityRequest) => void
  /** Opens Start work for an issue key. */
  startWork: (key: string) => void
  /** A new DevDock terminal tab (in a repo, or the home folder), in the main window. */
  openTerminal: (repoId: string | null, agent?: AgentLaunch) => void
  /** Windows that can show dialogs (main, panel): stopping a process and PR actions ask first. */
  confirm?: (request: ConfirmRequest) => void
  prAction?: (pr: PullRequest, action: PrAction) => void
  /** The AI preview dialog (P7-C-B), in the same windows. */
  ai?: (request: AiCommandRequest) => void
  /** The trigger-build dialog (parameters, confirmation), in the same windows. */
  trigger?: (row: BranchBuild) => void
  /** The CI action confirmation (re-run / retry / cancel), in the same windows. */
  ciAction?: (run: CiRun, action: CiAction) => void
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
  const toast = useToast()
  const notifications = useNotificationActions()
  const update = useUpdateSettingsAction()
  const openRepo = useOpenRepo()
  const settings = useSettings().data
  const agent = usePreferredAgent()
  const paused = usePauseState().data?.pausedUntil != null
  const repos = useRepos()
  const servers = useDevServers()
  const watches = useWatches().data ?? []
  const removeWatch = useRemoveWatch()
  // My open issues for "Start work on …": asked for only once Jira is set up.
  const issues =
    useJiraList(settings && isSetUp(settings, 'jira') ? { list: 'mine' } : null).data ?? []

  // PR actions once turned on in Settings: merge mine, approve / needs work on the ones I review.
  const prsOn = settings ? enabledProviders(settings).length > 0 : false
  const prActionsOn = Boolean(settings?.features.prActions && prsOn)
  // AI status notes need the same lists (only where the AI dialog can show).
  const aiOn = useAiAvailable() && Boolean(h.ai)
  const listsOn = prActionsOn || (aiOn && prsOn)
  const mine = usePrList('mine', listsOn).data ?? []
  const reviewing = usePrList('reviewing', listsOn).data ?? []
  const aiPrs = aiOn
    ? [...mine, ...reviewing]
        .filter(isOpen)
        .filter((pr, i, all) => all.findIndex((p) => p.key === pr.key) === i)
    : []
  const openPrs = !prActionsOn
    ? []
    : [
        ...mine
          .filter(isOpen)
          .flatMap((pr) => actionsFor(pr, MINE).map((action) => ({ pr, action }))),
        ...reviewing
          .filter(isOpen)
          .flatMap((pr) => actionsFor(pr, OTHERS).map((action) => ({ pr, action }))),
      ]
  const jenkinsWatches = useBuildWatches().data ?? []
  const runWatches = useCiWatches().data ?? []
  // Jenkins builds and GitHub / GitLab runs are both "watched builds" here.
  const builds = [
    ...jenkinsWatches.map((w) => ({ key: w.key, label: watchLabel(w), done: w.done, ci: false })),
    ...runWatches.map((w) => ({ key: w.key, label: ciRunLabel(w.run), done: w.done, ci: true })),
  ]
  // CI actions (Settings → Actions → CI actions): my recent runs and the watched ones.
  const ciOn = Boolean(settings?.features.ciActions)
  const ciProviders = settings ? enabledCi(settings) : []
  const githubRuns = useCiRuns('github', ciOn && ciProviders.includes('github')).data?.runs ?? []
  const gitlabRuns = useCiRuns('gitlab', ciOn && ciProviders.includes('gitlab')).data?.runs ?? []
  const ciRuns: CiRun[] = !ciOn
    ? []
    : [...githubRuns, ...gitlabRuns, ...runWatches.map((w) => w.run)].filter(
        (r, i, all) =>
          ciProviders.includes(r.ref.provider) && all.findIndex((x) => x.key === r.key) === i,
      )
  const removeRun = useRemoveCiWatch()
  const clearFinishedRuns = useClearFinishedRuns()
  const removeBuild = useRemoveBuildWatch()
  const clearFinished = useClearFinished()
  const addBuildWatch = useAddBuildWatch()
  const ticketMoves = useTicketMoves().data ?? []
  const acceptMove = useAcceptTicketMove()
  // My branches' jobs, for Trigger build / Watch deploy: asked for only once Jenkins is set up.
  const jenkinsOn = settings ? isSetUp(settings, 'jenkins') : false
  const branchRows = useBranches(jenkinsOn).data?.builds ?? []
  // Which repos have a baseline server script (repo status; shared with Repos' polled query).
  const statuses = useQueries({
    queries: repos.map((r) => ({
      queryKey: keys.repoStatus(r.id),
      queryFn: () => unwrap(bridge.repos.status({ id: r.id })),
      staleTime: 60_000,
    })),
  })

  const quickLinks = settings?.quickLinks ?? []
  const openLink = (url: string) => run(unwrap(bridge.app.openExternal({ url })))
  const configured = {
    prs: prsOn,
    jenkins: settings ? isSetUp(settings, 'jenkins') : false,
    jira: settings ? isSetUp(settings, 'jira') : false,
  }
  const forQuery = (query: string) =>
    queryCommands(query, { ...h, quickLinks, openLink, repos, configured })
  if (!settings) return { commands: [], forQuery }
  const commands = buildCommands(
    {
      ...h,
      agent: agent ? { id: agent.id, name: agent.name } : null,
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
      baselines: repos.flatMap((r, i) => {
        const s = servers.find((d) => d.repoId === r.id && d.kind === 'baseline')
        const running = s ? isActive(s.status) : false
        return running || statuses[i]?.data?.hasBaseline ? [{ repoId: r.id, running }] : []
      }),
      devServer: (id, start, kind = 'dev') => {
        const label = kind === 'dev' ? 'Dev server' : 'Baseline server'
        return run(
          start
            ? unwrap(bridge.devserver.start({ id, kind }))
            : unwrap(bridge.devserver.stop({ id, kind })),
          start ? `${label} starting` : `${label} stopped`,
        )
      },
      branchBuilds: jenkinsOn
        ? branchRows.map((b) => ({
            job: b.job,
            label: jobLabel(b.job),
            branch: b.branch,
            triggers: triggerRefusal(b.job, settings) === null,
            deploys:
              b.kind === 'branch' &&
              (settings.general.demoMode || settings.jenkins.deployJob !== ''),
          }))
        : [],
      trigger: h.trigger
        ? (job) => {
            const row = branchRows.find((b) => b.job === job)
            if (row) h.trigger?.(row)
          }
        : undefined,
      ciActions: ciRuns.flatMap((run) =>
        CI_ACTIONS.filter((a) => ciActionAllowed(a, run.state)).map((action) => ({
          key: run.key,
          action,
          title: `${CI_ACTION_COPY[run.ref.provider][action]}: ${ciRunLabel(run)}`,
        })),
      ),
      ciAction: h.ciAction
        ? (key, action) => {
            const run = ciRuns.find((r) => r.key === key)
            if (run) h.ciAction?.(run, action)
          }
        : undefined,
      watchDeploy: (branch) =>
        run(
          addBuildWatch.mutateAsync({ kind: 'deploy', branch }),
          `Watching the deploy of ${branch}`,
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
      buildWatches: builds.map((w) => ({ key: w.key, label: w.label })),
      finishedBuilds: builds.some((w) => w.done),
      unwatchBuild: (key) => {
        const w = builds.find((b) => b.key === key)
        const remove = w?.ci ? removeRun : removeBuild
        return run(remove.mutateAsync(key), `Stopped watching ${w ? w.label : 'it'}`)
      },
      clearFinishedBuilds: () =>
        run(
          Promise.all([clearFinished.mutateAsync(), clearFinishedRuns.mutateAsync()]),
          'Cleared finished build watches',
        ),
      aiPrs: aiPrs.map((pr) => ({ key: pr.key, label: prLabel(pr) })),
      ai:
        aiOn && h.ai
          ? (request) => {
              if (request.feature === 'standup') return h.ai?.(request)
              const pr = aiPrs.find((p) => p.key === request.key)
              if (pr) h.ai?.({ feature: 'pr-summary', pr })
            }
          : undefined,
      ticketMoves: ticketMoves.map((o) => ({
        prKey: o.prKey,
        key: o.key,
        status: o.status,
        confirm: ticketMoveConfirm(o),
      })),
      moveTicket: (prKey) =>
        run(acceptMove.mutateAsync(prKey)).then((r) => {
          if (r.ok) toast(r.value.message, r.value.result === 'done' ? undefined : 'warning')
        }),
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
