import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  AI_FEATURE_LABELS,
  AI_PROVIDER_INFO,
  aiModel,
  formatUsd,
  type AiPrepare,
  type AiPreview,
  type AiResult,
} from '@shared/ai'
import { bridge, unwrap } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorNotice } from '../../ui/Feedback'
import { CodeBlock, KeyValue } from '../../ui/Text'

type Stage =
  | { kind: 'preparing' }
  | { kind: 'preview'; preview: AiPreview }
  | { kind: 'sending'; preview: AiPreview }
  | { kind: 'done'; preview: AiPreview; result: AiResult }
  | { kind: 'error'; error: unknown; preview?: AiPreview }

/**
 * One AI request (P7-C-B; any provider since T6): main prepares it, this shows exactly what
 * will be sent, to which provider and model and about what it costs, and sends it only when the user presses Send. The answer can
 * be copied, or handed to the caller with `onUse` (e.g. into the lesson being edited).
 */
export function AiDialog({
  request,
  onClose,
  onUse,
}: {
  request: AiPrepare
  onClose: () => void
  onUse?: { label: string; use: (text: string) => void }
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'preparing' })
  // The request as it was when the dialog opened: callers build it inline on every render, and
  // each prepare is a new held request in main.
  const [asked] = useState(request)

  useEffect(() => {
    let live = true
    unwrap(bridge.ai.prepare(asked)).then(
      (preview) => live && setStage({ kind: 'preview', preview }),
      (error: unknown) => live && setStage({ kind: 'error', error }),
    )
    return () => {
      live = false
    }
  }, [asked])

  const send = async (preview: AiPreview) => {
    setStage({ kind: 'sending', preview })
    try {
      const result = await unwrap(bridge.ai.run({ id: preview.id }))
      setStage({ kind: 'done', preview, result })
    } catch (error) {
      setStage({ kind: 'error', error, preview })
    }
  }

  const sending = stage.kind === 'sending'
  return (
    <Dialog
      open
      wide
      title={AI_FEATURE_LABELS[asked.feature]}
      onClose={onClose}
      dismissible={!sending}
      actions={
        <>
          <Button onClick={onClose} disabled={sending}>
            {stage.kind === 'done' || stage.kind === 'error' ? 'Close' : 'Cancel'}
          </Button>
          {stage.kind === 'preview' || stage.kind === 'sending' ? (
            <Button
              variant="primary"
              disabled={sending}
              onClick={() => stage.kind === 'preview' && void send(stage.preview)}
            >
              {sending
                ? 'Sending…'
                : `Send to ${AI_PROVIDER_INFO[stage.preview.provider].assistant}`}
            </Button>
          ) : null}
          {stage.kind === 'done' && onUse ? (
            <Button
              variant="primary"
              onClick={() => {
                onUse.use(stage.result.text)
                onClose()
              }}
            >
              {onUse.label}
            </Button>
          ) : null}
        </>
      }
    >
      {stage.kind === 'preparing' ? <p role="status">Preparing the request…</p> : null}
      {/* T12: one live region, there from the start (a region added with its text is often
          not read): the answer itself, not the buttons around it. */}
      <p className="visually-hidden" role="status">
        {stage.kind === 'done'
          ? `${AI_PROVIDER_INFO[stage.preview.provider].assistant}'s answer: ${stage.result.text}`
          : ''}
      </p>
      {stage.kind === 'preview' || stage.kind === 'sending' ? (
        <Preview preview={stage.preview} />
      ) : null}
      {stage.kind === 'done' ? <Answer preview={stage.preview} result={stage.result} /> : null}
      {stage.kind === 'error' ? <ErrorNotice error={stage.error} /> : null}
    </Dialog>
  )
}

function Preview({ preview }: { preview: AiPreview }) {
  return (
    <div className="stack">
      <p>
        {preview.demo
          ? 'Demo mode: a sample answer is made on this computer. Nothing is sent.'
          : `Nothing has been sent yet. Press Send to send the text below to ${AI_PROVIDER_INFO[preview.provider].name} with your API key.`}
      </p>
      <KeyValue
        items={[
          ['Provider', AI_PROVIDER_INFO[preview.provider].name],
          ['Model', aiModel(preview.model).name],
          [
            'About',
            `${formatUsd(preview.estimatedCostUsd)} (at most ${formatUsd(preview.maxCostUsd)})`,
          ],
          ['Size', `about ${preview.estimatedInputTokens.toLocaleString('en')} tokens`],
        ]}
      />
      {preview.fallback && !preview.demo ? (
        <p className="muted">
          If Claude declines, Anthropic may answer with another Claude model; the answer says which.
        </p>
      ) : null}
      <CodeBlock code={preview.prompt} label="The text that will be sent" />
      <details>
        <summary>Instructions sent with it</summary>
        <CodeBlock code={preview.system} label="Instructions" />
      </details>
    </div>
  )
}

function Answer({ preview, result }: { preview: AiPreview; result: AiResult }) {
  // Anthropic's fallback may answer a declined request with another model. (Other providers
  // name a dated snapshot of the chosen model, which isn't a different one.)
  const other = preview.fallback && result.model !== preview.model
  const assistant = AI_PROVIDER_INFO[preview.provider].assistant
  return (
    <div className="stack">
      <CodeBlock code={result.text} label={`${assistant}'s answer`} />
      {result.truncated ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <p>The answer hit its length limit and may stop mid-sentence.</p>
        </div>
      ) : null}
      <p className="muted">
        {result.inputTokens.toLocaleString('en')} tokens in,{' '}
        {result.outputTokens.toLocaleString('en')} out — {formatUsd(result.costUsd)}
        {preview.demo ? ' (demo: not charged)' : ''}.
        {other ? ` Answered by ${result.model} (Anthropic's fallback for declined requests).` : ''}
      </p>
    </div>
  )
}
