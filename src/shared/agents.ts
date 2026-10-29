/**
 * Agent CLIs (P7-C): coding agents the user has installed (Claude Code, Codex, Gemini CLI,
 * GitHub Copilot CLI) that DevDock starts in its own terminal, in a repo, with the Start work
 * message as the first prompt. DevDock holds no keys for them: each CLI signs in its own way.
 * Free of Node and DOM so main, renderer and tests share it.
 */
import { z } from 'zod'

export const AGENT_CLI_IDS = ['claude', 'codex', 'gemini', 'copilot'] as const
export type AgentCliId = (typeof AGENT_CLI_IDS)[number]

export interface AgentCli {
  id: AgentCliId
  /** The product's name, as its makers write it. */
  name: string
  /** The executable looked up on PATH. */
  command: string
  /** Arguments that start an interactive session with `prompt` as the first message. */
  promptArgs: (prompt: string) => string[]
}

export const AGENT_CLIS: readonly AgentCli[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', promptArgs: (p) => [p] },
  { id: 'codex', name: 'Codex', command: 'codex', promptArgs: (p) => [p] },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', promptArgs: (p) => ['-i', p] },
  { id: 'copilot', name: 'GitHub Copilot CLI', command: 'copilot', promptArgs: (p) => ['-i', p] },
]

export const agentCli = (id: AgentCliId): AgentCli => AGENT_CLIS.find((a) => a.id === id)!

/** Longest first prompt DevDock passes (a Start work message is a few hundred characters). */
export const MAX_AGENT_PROMPT = 4000

export const AgentCliIdSchema = z.enum(AGENT_CLI_IDS)

export const AgentLaunchSchema = z.object({
  id: AgentCliIdSchema,
  /** The first message; missing = the CLI starts with an empty prompt. */
  prompt: z.string().min(1).max(MAX_AGENT_PROMPT).optional(),
})
export type AgentLaunch = z.infer<typeof AgentLaunchSchema>

export const AgentInfoSchema = z.object({
  id: AgentCliIdSchema,
  name: z.string(),
  /** Where it was found on PATH; null = not installed (or not on the login shell's PATH). */
  path: z.string().nullable(),
})
export type AgentInfo = z.infer<typeof AgentInfoSchema>

/** Settings → Workflow → Agent: `auto` = the first installed one in AGENT_CLIS order. */
export const AgentPreferenceSchema = z.enum(['auto', ...AGENT_CLI_IDS])
export type AgentPreference = z.infer<typeof AgentPreferenceSchema>

/** The agent Start work offers: the preferred one when installed, else the first installed. */
export function pickAgent(agents: AgentInfo[], preference: AgentPreference): AgentInfo | null {
  const installed = agents.filter((a) => a.path)
  if (preference !== 'auto') {
    const chosen = installed.find((a) => a.id === preference)
    if (chosen) return chosen
  }
  return installed[0] ?? null
}

/**
 * Windows: npm installs these CLIs as `.cmd` scripts, and cmd.exe parses a script's arguments
 * again (`&`, `|`, `%VAR%`, `^`, quotes…), so a prompt goes to one only when it holds none of
 * those characters. Start work messages (agent name, brief path, Figma link) normally pass.
 */
export function isCmdSafePrompt(prompt: string): boolean {
  return /^[A-Za-z0-9 .,:;/\\_\-+=@#?~[\]{}']*$/.test(prompt)
}
