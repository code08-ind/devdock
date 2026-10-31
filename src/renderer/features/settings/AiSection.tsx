import { useMutation } from '@tanstack/react-query'
import { PlugZap } from 'lucide-react'
import {
  AI_MODELS,
  aiCost,
  aiModel,
  formatUsd,
  TYPICAL_OUTPUT_TOKENS,
  type AiModelId,
} from '@shared/ai'
import type { Settings } from '@shared/settings'
import { bridge, unwrap, useSecrets, useUpdateSettings } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { ErrorNotice, StatusPill } from '../../ui/Feedback'
import { Field, Select } from '../../ui/Field'
import { SecretRow } from './CredentialsSection'
import { Section } from './Section'

/** A typical request at the model's price: about 600 tokens in, a typical answer out. */
const typicalCost = (model: AiModelId) => formatUsd(aiCost(model, 600, TYPICAL_OUTPUT_TOKENS))

/**
 * Settings → AI (P7-C-B): the user's own Anthropic key and the model. DevDock ships no key and
 * makes no AI call by itself: each request is shown first and sent only when the user confirms.
 */
export function AiSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const { available, list, saved: secrets } = useSecrets()
  const saved = secrets.has('anthropic.key')
  const demo = settings.general.demoMode
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
              label: `${m.name} — $${m.input} / $${m.output}, about ${typicalCost(m.id)} a request`,
            }))}
            value={settings.ai.model}
            disabled={update.isPending}
            onValue={(model) => update.mutate({ ai: { model } })}
          />
        )}
      </Field>
      {saved || demo ? <AiTest demo={demo} model={settings.ai.model} /> : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

/**
 * Test connection for the key: `GET /v1/models`, which is free (no tokens). Says whether the key
 * works and whether the chosen model is one it can use.
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
