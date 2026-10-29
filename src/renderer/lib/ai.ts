import { useSecrets, useSettings } from './devdock'

/**
 * Whether the AI features can be offered (P7-C-B): the user saved an Anthropic key, or demo mode
 * is on (the demo Claude answers locally). Without either, the buttons stay hidden.
 */
export function useAiAvailable(): boolean {
  const demo = useSettings().data?.general.demoMode ?? false
  const { saved } = useSecrets()
  return demo || saved.has('anthropic.key')
}
