import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isInProgress, type JiraIssueDetail } from '@shared/jira'
import { lessonsNote } from '@shared/lessons'
import type { RepoConfig, Settings } from '@shared/settings'
import type {
  Agent,
  StartWorkPlan,
  StartWorkRequest,
  StartWorkResult,
  StartWorkRun,
} from '@shared/startwork'
import type { GitActions, OutputListener } from './git/actions'
import type { GitRunner } from './git/exec'
import { agentMessage, briefRelativePath, buildBrief, classify } from './jira/brief'
import type { JiraService } from './jira/service'

export interface StartWorkDeps {
  jira: Pick<JiraService, 'issue' | 'transitionToInProgress'>
  actions: Pick<GitActions, 'planNewBranch' | 'run'>
  git: GitRunner
  repo: (id: string) => RepoConfig
  settings: () => Settings
  /** Whether the repo has an agent lessons file (P6-F): the message says to read it. */
  lessonsExist: (repoId: string) => Promise<boolean>
  /** DevDock's own folder for briefs when Settings → brief location is "DevDock data". */
  briefsDir: string
  writeClipboard: (text: string) => void
  openEditor: (repo: RepoConfig) => Promise<void>
  now?: () => Date
}

/**
 * `changed`: the ticket no longer matches the preview (nothing was changed).
 * `brief`: the branch exists but TICKET.md couldn't be written.
 */
export class StartWorkError extends Error {
  constructor(
    readonly kind: 'changed' | 'brief',
    message: string,
  ) {
    super(message)
    this.name = 'StartWorkError'
  }
}

interface BriefTarget {
  file: string
  /** How the agent message refers to it: repo-relative, or absolute outside the repo. */
  ref: string
  location: 'repo' | 'appData'
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * SPEC 6.5 "Start work": branch from a fresh base, TICKET.md brief, agent classification,
 * clipboard message, optional transition, open in VS Code. `plan()` changes nothing.
 */
export class StartWorkService {
  constructor(private readonly deps: StartWorkDeps) {}

  async plan(req: StartWorkRequest): Promise<StartWorkPlan> {
    const repo = this.deps.repo(req.repoId)
    const issue = await this.issue(req.key)
    const { agent, reason } = classify(issue)
    const { branch, commands } = await this.deps.actions.planNewBranch(
      repo,
      branchRequest(issue, agent),
    )
    const target = this.briefTarget(repo, req.key)
    return {
      key: issue.key,
      summary: issue.summary,
      agent,
      reason,
      branch,
      commands,
      briefPath: target.ref,
      briefLocation: target.location,
      briefWouldBeCommitted:
        target.location === 'repo' ? await this.wouldBeCommitted(repo, target.ref) : null,
      message: await this.message(repo, agent, target.ref, issue, req.lessons),
      transitionEnabled: this.deps.settings().features.jiraTransition,
    }
  }

  async run(req: StartWorkRun, onOutput?: OutputListener): Promise<StartWorkResult> {
    const repo = this.deps.repo(req.repoId)
    const issue = await this.issue(req.key)
    const { agent } = classify(issue)
    // The dialog showed an agent, branch template and message: don't silently do something else.
    if (agent !== req.agent) {
      throw new StartWorkError(
        'changed',
        `${issue.key} changed since the preview (it now needs the ${agent} agent). Review it again.`,
      )
    }

    // 2. Branch from a fresh base (fetch + checkout -b … origin/<base>), with GitActions' checks.
    // newBranch either finishes or throws a GitError.
    const outcome = await this.deps.actions.run(repo, branchRequest(issue, agent), onOutput)
    const branch = outcome.status === 'done' ? outcome.branch : undefined
    if (!branch) throw new StartWorkError('changed', 'Creating the branch did not finish.')

    // 3. Brief. Past this point the branch exists, so errors say so.
    const target = this.briefTarget(repo, req.key)
    try {
      mkdirSync(dirname(target.file), { recursive: true })
      const note = await this.lessonsNote(repo, req.lessons)
      writeFileSync(
        target.file,
        buildBrief(issue, (this.deps.now ?? (() => new Date()))(), note),
        'utf8',
      )
    } catch (err) {
      throw new StartWorkError(
        'brief',
        `Created ${branch}, but couldn't write ${target.file}: ${messageOf(err)}`,
      )
    }

    // 5. Ready message on the clipboard.
    const warnings: string[] = []
    const message = await this.message(repo, agent, target.ref, issue, req.lessons)
    try {
      this.deps.writeClipboard(message)
    } catch (err) {
      warnings.push(`Couldn't copy the message to the clipboard: ${messageOf(err)}`)
    }

    // 6. Optional transition.
    const transition = await this.transition(issue, req.confirmTransition)
    if (transition.result === 'failed' || transition.result === 'unavailable') {
      warnings.push(transition.detail ?? 'The issue was not moved to In Progress.')
    }
    if (req.openEditor) {
      try {
        await this.deps.openEditor(repo)
      } catch (err) {
        warnings.push(`Couldn't open VS Code: ${messageOf(err)}`)
      }
    }
    return { branch, briefFile: target.file, agent, message, transition, warnings }
  }

  /**
   * The ready message, plus the lessons note (P6-F): read the repo's lessons file when it
   * exists, and add to it when done — as the dialog ticked them, else Settings → Workflow.
   */
  private async message(
    repo: RepoConfig,
    agent: Agent,
    briefRef: string,
    issue: JiraIssueDetail,
    lessons: StartWorkRequest['lessons'],
  ): Promise<string> {
    const note = await this.lessonsNote(repo, lessons)
    const base = agentMessage(agent, briefRef, issue)
    return note ? `${base} ${note}` : base
  }

  /** The lessons lines as this run ticked them, else as Settings → Workflow has them. */
  private async lessonsNote(
    repo: RepoConfig,
    lessons: StartWorkRequest['lessons'],
  ): Promise<string | null> {
    const { lessonsPath, pointAgentToLessons, askAgentForLessons } = this.deps.settings().workflow
    return lessonsNote(
      {
        pointToLessons: lessons?.read ?? pointAgentToLessons,
        askForLessons: lessons?.add ?? askAgentForLessons,
      },
      lessonsPath,
      await this.deps.lessonsExist(repo.id),
    )
  }

  /** The issue, refusing a response for a different key (the key becomes a file path). */
  private async issue(key: string): Promise<JiraIssueDetail> {
    const issue = await this.deps.jira.issue(key)
    if (issue.key !== key) {
      throw new StartWorkError('changed', `Jira returned ${issue.key} for ${key} (moved issue?).`)
    }
    return issue
  }

  /**
   * Needs the setting (main-process only) **and** the user's confirmation for this run
   * (SPEC 6.5 step 6 "optional, off by default"; SPEC 7 confirmation).
   */
  private async transition(
    issue: JiraIssueDetail,
    confirmed: boolean,
  ): Promise<StartWorkResult['transition']> {
    if (!this.deps.settings().features.jiraTransition) return { result: 'off' }
    if (!confirmed) return { result: 'declined' }
    if (isInProgress(issue.status)) return { result: 'already' }
    try {
      const result = await this.deps.jira.transitionToInProgress(issue.key)
      return result === 'done'
        ? { result: 'done' }
        : {
            result: 'unavailable',
            detail: `${issue.key} has no "In Progress" transition from "${issue.status}"; it was left as is.`,
          }
    } catch (err) {
      return {
        result: 'failed',
        detail: `Moving ${issue.key} to In Progress failed: ${messageOf(err)}`,
      }
    }
  }

  private briefTarget(repo: RepoConfig, key: string): BriefTarget {
    const rel = briefRelativePath(key)
    if (this.deps.settings().features.briefLocation === 'appData') {
      const file = join(this.deps.briefsDir, key, 'TICKET.md')
      return { file, ref: file, location: 'appData' }
    }
    return { file: join(repo.path, ...rel.split('/')), ref: rel, location: 'repo' }
  }

  /**
   * Whether the brief would show up for commit. `check-ignore` honours every ignore source
   * (.gitignore, info/exclude, global) and treats an already-tracked file as not ignored, since
   * ignoring doesn't untrack it.
   */
  private async wouldBeCommitted(repo: RepoConfig, rel: string): Promise<boolean> {
    const r = await this.deps.git.run(['check-ignore', '-q', '--', rel], {
      cwd: repo.path,
      okCodes: [1],
    })
    return r.exitCode !== 0
  }
}

/** Bugs get the bugfix template, everything else the feature one; named from key + summary. */
function branchRequest(issue: JiraIssueDetail, agent: Agent) {
  return {
    action: 'newBranch' as const,
    kind: agent === 'bug-fixer' ? ('bugfix' as const) : ('feature' as const),
    key: issue.key,
    title: issue.summary,
  }
}
