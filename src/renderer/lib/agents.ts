import { useQuery } from '@tanstack/react-query'
import { pickAgent, type AgentInfo } from '@shared/agents'
import { bridge, unwrap, useSettings } from './devdock'

/** Agent CLIs on PATH (P7-C). Looked up again when the window regains focus (one was installed). */
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => unwrap(bridge.agents.detect()),
    refetchOnWindowFocus: true,
  })
}

/** The agent Start work offers: Settings → Workflow → Agent when installed, else the first found. */
export function usePreferredAgent(): AgentInfo | null {
  const agents = useAgents().data ?? []
  const preference = useSettings().data?.workflow.agentCli ?? 'auto'
  return pickAgent(agents, preference)
}
