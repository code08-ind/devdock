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
  type AgentCliId,
  type AgentLaunch,
  type AgentStatus,
} from '@shared/agents'
import type { TerminalProgram } from './terminal/manager'
import { findOnPath, type ShellEnv } from './terminal/shell'

/** Where each agent CLI was found (null = not installed). Main only: paths stay out of the UI. */
export interface AgentInfo {
  id: AgentCliId
  name: string
  path: string | null
}

/**
 * Finds each agent CLI on PATH. Windows: `<name>.exe`, then npm's `<name>.cmd` — never the
 * extensionless sh shim npm puts beside it, which Windows can't start.
 */
export function detectAgents(e: ShellEnv): AgentInfo[] {
  return AGENT_CLIS.map((a) => ({
    id: a.id,
    name: a.name,
    path:
      e.platform === 'win32'
        ? (findOnPath(`${a.command}.exe`, e) ?? findOnPath(`${a.command}.cmd`, e))
        : findOnPath(a.command, e),
  }))
}

export const agentStatus = (agents: AgentInfo[]): AgentStatus[] =>
  agents.map(({ id, name, path }) => ({ id, name, installed: path !== null }))

export class AgentNotFoundError extends Error {
  constructor(name: string) {
    super(`${name} isn't installed, or isn't on your shell's PATH. Install it, then try again.`)
    this.name = 'AgentNotFoundError'
  }
}

/** The process to start for `launch`, from what `detectAgents` found. */
export function agentSpawn(
  launch: AgentLaunch,
  agents: AgentInfo[],
  platform: NodeJS.Platform,
): TerminalProgram {
  const cli = agentCli(launch.id)
  const file = agents.find((a) => a.id === launch.id)?.path
  if (!file) throw new AgentNotFoundError(cli.name)
  const script = platform === 'win32' && /\.(cmd|bat)$/i.test(basename(file))
  if (launch.prompt && script && !isCmdSafePrompt(launch.prompt)) {
    return {
      file,
      args: [],
      name: cli.name,
      note: `${cli.name} started without its first message: Windows would read parts of it as commands. Paste it yourself (Start work copies it to the clipboard).`,
    }
  }
  return {
    file,
    args: launch.prompt ? cli.promptArgs(launch.prompt) : [],
    name: cli.name,
    note: null,
  }
}
