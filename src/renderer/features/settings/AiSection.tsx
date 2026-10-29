import { useQuery } from '@tanstack/react-query'
import { AI_MODELS, formatUsd, type AiModelId } from '@shared/ai'
import type { Settings } from '@shared/settings'
import { bridge, keys, unwrap, useUpdateSettings } from '../../lib/devdock'
import { ErrorNotice } from '../../ui/Feedback'
import { Field, Select } from '../../ui/Field'
import { SecretRow } from './CredentialsSection'
import { Section } from './Section'

/** A short note at the model's price: about 600 tokens in, 1,200 out (thinking included). */
const noteCost = (input: number, output: number) => formatUsd((600 * input + 1200 * output) / 1e6)

/**
 * Settings → AI (P7-C-B): the user's own Anthropic key and the model. DevDock ships no key and
 * makes no AI call by itself: each request is shown first and sent only when the user confirms.
 */
export function AiSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const status = useQuery({
    queryKey: keys.secretsStatus,
    queryFn: () => unwrap(bridge.secrets.status()),
  })
  const available = status.data?.available ?? false
  const list = useQuery({
    queryKey: keys.secrets,
    queryFn: () => unwrap(bridge.secrets.list()),
    enabled: available,
  })
  const saved = (list.data ?? []).includes('anthropic.key')
  return (
    <Section
      id="ai"
      title="AI"
      description="Optional. With your own Anthropic API key, DevDock can draft a PR status note, word a review comment as a lesson and tidy your standup. Every request is shown to you first and sent only when you press Send; you pay Anthropic directly."
    >
      <SecretRow secretKey="anthropic.key" saved={saved} disabled={!available} />
      <p className="muted">
        Create a key at console.anthropic.com → API keys. It is stored encrypted on this computer
        and only DevDock&apos;s background process reads it.
      </p>
      <Field
        label="Model"
        hint="Prices are Anthropic's, per million tokens (input / output). A typical request costs about the amount shown."
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            options={AI_MODELS.map((m) => ({
              value: m.id as AiModelId,
              label: `${m.name} — $${m.input} / $${m.output}, about ${noteCost(m.input, m.output)} a request`,
            }))}
            value={settings.ai.model}
            disabled={update.isPending}
            onValue={(model) => update.mutate({ ai: { model } })}
          />
        )}
      </Field>
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
