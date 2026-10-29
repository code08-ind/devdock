import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, RefreshCw, Sparkles } from 'lucide-react'
import { draftMarkdown, draftText, longDay, type StandupDraft } from '@shared/standup'
import { useStandupDraft, utilityKeys } from '../../lib/utilities'
import { Button, IconButton } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Textarea } from '../../ui/Field'
import { fromLines, toLines } from './pure'
import { useAiAvailable } from '../../lib/ai'
import { AiDialog } from '../ai/AiDialog'

type Section = 'yesterday' | 'today' | 'blockers'

/**
 * SPEC 6.6 Standup draft: Yesterday (previous working day), Today (in-progress tickets),
 * Blockers — each editable, one item per line — then copy as plain text or Markdown.
 */
export function StandupPanel() {
  const query = useStandupDraft()
  const qc = useQueryClient()
  if (!query.data) {
    if (query.error) return <ErrorNotice error={query.error} />
    return (
      <p className="muted" role="status">
        Collecting your commits, pull requests and tickets…
      </p>
    )
  }
  return (
    <>
      {/* Collect again failed: say so next to the draft, which keeps your edits. */}
      {query.error ? <ErrorNotice error={query.error} /> : null}
      <DraftEditor
        // A regenerated draft replaces the edits.
        key={query.dataUpdatedAt}
        draft={query.data}
        regenerating={query.isFetching}
        onRegenerate={() => void qc.invalidateQueries({ queryKey: utilityKeys.standup })}
      />
    </>
  )
}

function DraftEditor({
  draft,
  regenerating,
  onRegenerate,
}: {
  draft: StandupDraft
  regenerating: boolean
  onRegenerate: () => void
}) {
  const toast = useToast()
  const aiAvailable = useAiAvailable()
  const [polishing, setPolishing] = useState(false)
  const [text, setText] = useState<Record<Section, string>>({
    yesterday: toLines(draft.yesterday),
    today: toLines(draft.today),
    blockers: toLines(draft.blockers),
  })
  const edited = {
    yesterdayDate: draft.yesterdayDate,
    yesterday: fromLines(text.yesterday),
    today: fromLines(text.today),
    blockers: fromLines(text.blockers),
  }
  const copy = (value: string, what: string) =>
    void navigator.clipboard.writeText(value).then(
      () => toast(`Standup copied as ${what}`),
      () => toast('Could not copy the standup'),
    )
  const field = (key: Section, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          rows={Math.max(3, fromLines(text[key]).length + 1)}
          value={text[key]}
          onChange={(e) => setText({ ...text, [key]: e.target.value })}
        />
      )}
    </Field>
  )

  return (
    <section className="stack" aria-label="Standup">
      <div className="row-between">
        <p className="muted">Covers {longDay(draft.yesterdayDate)} until this morning.</p>
        <IconButton
          label="Collect again (replaces your edits)"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          disabled={regenerating}
          onClick={onRegenerate}
        />
      </div>
      {draft.notes.map((n) => (
        <p key={n} className="muted">
          {n}
        </p>
      ))}
      {field('yesterday', `Yesterday (${longDay(draft.yesterdayDate)})`, 'One item per line.')}
      {field('today', 'Today', 'Prefilled from your in-progress tickets.')}
      {field('blockers', 'Blockers', 'Leave empty for "None".')}
      <div className="button-row">
        <Button
          variant="primary"
          icon={<Copy size={16} aria-hidden="true" />}
          onClick={() => copy(draftText(edited), 'text')}
        >
          Copy as text
        </Button>
        <Button
          icon={<Copy size={16} aria-hidden="true" />}
          onClick={() => copy(draftMarkdown(edited), 'Markdown')}
        >
          Copy as Markdown
        </Button>
        {aiAvailable ? (
          <Button
            icon={<Sparkles size={16} aria-hidden="true" />}
            onClick={() => setPolishing(true)}
          >
            Polish with Claude
          </Button>
        ) : null}
      </div>
      {polishing ? (
        <AiDialog
          request={{ feature: 'standup', draft: edited }}
          onClose={() => setPolishing(false)}
        />
      ) : null}
    </section>
  )
}
