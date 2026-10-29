/**
 * Agent CLIs (P7-C): which of them are on PATH (the login shell's PATH is merged in at start),
 * and how to start one. The CLI is the PTY's process itself — started with an argument array,
 * never through a shell — so nothing in a ticket's text is ever run as a command.
 */
import { basename } from 'node:path'
import {
  AGENT_CLIS,
  agentCli,
  isCmdSafePrompt,
  type AgentInfo,
  type AgentLaunch,
} from '@shared/agents'
import { findOnPath, type ShellEnv } from './terminal/shell'

/** Finds each agent CLI on PATH (on Windows also npm's `.cmd` scripts). */
export function detectAgents(e: ShellEnv): AgentInfo[] {
  return AGENT_CLIS.map((a) => ({
    id: a.id,
    name: a.name,
    path:
      findOnPath(a.command, e) ??
      (e.platform === 'win32' ? findOnPath(`${a.command}.cmd`, e) : null),
  }))
}

export interface AgentSpawn {
  file: string
  args: string[]
  /** Tab tooltip / title part: the CLI's name. */
  name: string
  /** Said in the terminal before the CLI starts (e.g. why the prompt was left out). */
  note: string | null
}

export class AgentNotFoundError extends Error {
  constructor(name: string) {
    super(
      `${name} isn't installed, or isn't on your shell's PATH. Install it, then reopen DevDock.`,
    )
    this.name = 'AgentNotFoundError'
  }
}

/** The process to start for `launch`, from what `detectAgents` found. */
export function agentSpawn(
  launch: AgentLaunch,
  agents: AgentInfo[],
  platform: NodeJS.Platform,
): AgentSpawn {
  const cli = agentCli(launch.id)
  const file = agents.find((a) => a.id === launch.id)?.path
  if (!file) throw new AgentNotFoundError(cli.name)
  const script = platform === 'win32' && /\.(cmd|bat)$/i.test(basename(file))
  if (launch.prompt && script && !isCmdSafePrompt(launch.prompt)) {
    return {
      file,
      args: [],
      name: cli.name,
      note: `${cli.name} started without the Start work message (Windows would read parts of it as commands). It is on your clipboard: paste it.`,
    }
  }
  return {
    file,
    args: launch.prompt ? cli.promptArgs(launch.prompt) : [],
    name: cli.name,
    note: null,
  }
}
