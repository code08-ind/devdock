import { useState } from 'react'
import { UPDATE_STRATEGIES, type Settings } from '@shared/settings'
import { useUpdateSettings } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Input, SegmentedControl } from '../../ui/Field'
import { Section } from './Section'

const strategyOptions = UPDATE_STRATEGIES.map((s) => ({
  value: s,
  label: s === 'merge' ? 'Merge' : 'Rebase',
}))

/** Global git preferences (SPEC 6.2); per-repo settings live on each repo in Repos. */
export function GitSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const [editor, setEditor] = useState(settings.git.editorPath)
  return (
    <Section id="git" title="Git" description="Per-repo settings are on each repo in Repos.">
      <SegmentedControl
        label="Update my branch uses"
        options={strategyOptions}
        value={settings.git.updateStrategy}
        onValue={(updateStrategy) => update.mutate({ git: { updateStrategy } })}
      />
      <Field
        label="VS Code command"
        hint="code, code-insiders, codium or cursor — or the full path to one of them."
      >
        {({ id, describedBy }) => (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              update.mutate(
                { git: { editorPath: editor.trim() } },
                { onSuccess: () => toast('VS Code command saved') },
              )
            }}
          >
            <Input
              id={id}
              aria-describedby={describedBy}
              className="mono"
              value={editor}
              spellCheck={false}
              onChange={(e) => setEditor(e.target.value)}
            />
            <Button
              type="submit"
              disabled={editor.trim() === settings.git.editorPath || update.isPending}
            >
              Save
            </Button>
          </form>
        )}
      </Field>
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
