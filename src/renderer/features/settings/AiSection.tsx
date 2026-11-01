import { useMutation } from '@tanstack/react-query'
import { PlugZap } from 'lucide-react'
import {
  AI_PROVIDER_INFO,
  AI_PROVIDERS,
  activeModel,
  aiCost,
  aiModel,
  aiPrice,
  priceChange,
  formatUsd,
  modelPatch,
  modelsOf,
  TYPICAL_OUTPUT_TOKENS,
  type AiModelId,
  type AiProvider,
} from '@shared/ai'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useSecrets, useUpdateSettings } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { ErrorNotice, StatusPill } from '../../ui/Feedback'
import { Field, SegmentedControl, Select } from '../../ui/Field'
import { SecretRow } from './CredentialsSection'
import { Section } from './Section'

/** A typical request at the model's price: about 600 tokens in, a typical answer out. */
const typicalCost = (model: AiModelId) => formatUsd(aiCost(model, 600, TYPICAL_OUTPUT_TOKENS))

/** "$4 / $20", plus an announced change ("; $8 / $40 from 1 Dec"). */
function priceLabel(id: AiModelId): string {
  const now = aiPrice(id)
  const label = `$${now.input} / $${now.output}`
  const change = priceChange(id)
  // Already past the change: today's price is the new one.
  if (!change || now.input === change.then.input) return label
  const m = change
  const from = new Date(`${m.until}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() + 1)
  const day = from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${label} (then $${m.then.input} / $${m.then.output} from ${day})`
}

const PROVIDER_OPTIONS = AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_INFO[p].name }))

/**
 * Settings → AI (P7-C-B; OpenAI and Google since T6): the active provider, its key and its
 * model. DevDock ships no key and makes no AI call by itself: each request is shown first and
 * sent only when the user confirms. Each provider keeps its own key and model when switching.
 */
export function AiSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const { available, list, saved: secrets } = useSecrets()
  const provider = settings.ai.provider
  const info = AI_PROVIDER_INFO[provider]
  const saved = secrets.has(info.secret)
  const demo = settings.general.demoMode
  const model = activeModel(settings.ai)
  return (
    <Section
      id="ai"
      title="AI"
      description="Optional. With your own API key (Anthropic, OpenAI or Google), DevDock can draft a PR status note, word a review comment as a lesson and tidy your standup. Every request is shown to you first and sent only when you press Send; you pay the provider directly."
    >
      <SegmentedControl<AiProvider>
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={provider}
        onValue={(p) => update.mutate({ ai: { provider: p } })}
      />
      <SecretRow key={info.secret} secretKey={info.secret} saved={saved} disabled={!available} />
      <p className="muted">
        {info.keyHelp} It is stored encrypted on this computer and only DevDock&apos;s background
        process reads it.
      </p>
      <Field
        label="Model"
        hint={`Prices are ${info.name}'s, per million tokens (input / output). A typical request costs about the amount shown.`}
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            options={modelsOf(provider).map((m) => ({
              value: m.id as AiModelId,
              label: `${m.name} — ${priceLabel(m.id)}, about ${typicalCost(m.id)} a request`,
            }))}
            value={model}
            disabled={update.isPending}
            onValue={(id) => update.mutate({ ai: modelPatch(id) })}
          />
        )}
      </Field>
      {saved || demo ? <AiTest key={provider} demo={demo} model={model} /> : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

/**
 * Test connection for the active provider's key: its models list, which is free (no tokens).
 * Says whether the key works and whether the chosen model is one it can use.
 */
function AiTest({ demo, model }: { demo: boolean; model: AiModelId }) {
  const test = useMutation({ mutationFn: () => unwrap(bridge.ai.testConnection()) })
  const name = aiModel(model).name
  return (
    <div className="stack">
      <div className="button-row">
        <Button
          icon={<PlugZap size={16} aria-hidden="true" />}
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        <span className="muted">
          {demo
            ? 'Demo mode is on: this tests the demo key.'
            : 'Free: lists your models, uses no tokens.'}
        </span>
      </div>
      {test.isPending ? (
        <p className="muted" role="status">
          Connecting…
        </p>
      ) : null}
      {test.data ? (
        <div role="status" className="stack">
          <StatusPill tone="success">
            Key works (HTTP {test.data.status}): {test.data.models.length} models available
          </StatusPill>
          {test.data.models.includes(model) ? null : (
            <StatusPill tone="warning">
              {name} isn&apos;t one of them: pick another model above.
            </StatusPill>
          )}
        </div>
      ) : null}
      {test.error ? <ErrorNotice error={test.error} /> : null}
    </div>
  )
}
