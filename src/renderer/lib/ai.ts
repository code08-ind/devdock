import { AI_PROVIDER_INFO } from '@shared/ai'
import { useSecrets, useSettings } from './devdock'

/**
 * Whether the AI features can be offered (P7-C-B; any provider since T6): the user saved a key
 * for the active provider (Settings → AI), or demo mode is on (the demo answers locally).
 * Without either, the buttons stay hidden.
 */
export function useAiAvailable(): boolean {
  const settings = useSettings().data
  const { saved } = useSecrets()
  if (!settings) return false
  return settings.general.demoMode || saved.has(AI_PROVIDER_INFO[settings.ai.provider].secret)
}

/** The active provider's assistant, as buttons name it: "Claude", "GPT" or "Gemini". */
export function useAiAssistant(): string {
  const provider = useSettings().data?.ai.provider ?? 'anthropic'
  return AI_PROVIDER_INFO[provider].assistant
}
