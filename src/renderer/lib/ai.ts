import { useQuery } from '@tanstack/react-query'
import { bridge, keys, unwrap, useSettings } from './devdock'

/**
 * Whether the AI features can be offered (P7-C-B): the user saved an Anthropic key, or demo mode
 * is on (the demo Claude answers locally). Without either, the buttons stay hidden.
 */
export function useAiAvailable(): boolean {
  const demo = useSettings().data?.general.demoMode ?? false
  const list = useQuery({
    queryKey: keys.secrets,
    queryFn: () => unwrap(bridge.secrets.list()),
    enabled: !demo,
  })
  return demo || (list.data ?? []).includes('anthropic.key')
}
