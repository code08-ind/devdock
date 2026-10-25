import { LessonsPathSchema } from '@shared/lessons'
import type { Settings } from '@shared/settings'
import { queryClient, useUpdateSettings } from '../../lib/devdock'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Toggle } from '../../ui/Field'
import { Section } from './Section'
import { TextSetting } from './ServiceBits'

type Workflow = Settings['workflow']
/** The on/off options (everything but the path). */
type Option = Exclude<keyof Workflow, 'lessonsPath'>

/**
 * Workflow options (P6-F, owner request): the agent lessons file and what Start work does around
 * it. Each applies the next time Start work runs; the dialog shows the message they produce.
 */
export function WorkflowSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const w = settings.workflow
  const save = (patch: Partial<Workflow>, done?: string) =>
    update.mutate(
      { workflow: patch },
      {
        onSuccess: () => {
          if (done) toast(done)
          // The Start work preview and the lessons tab read these.
          void queryClient.invalidateQueries({ queryKey: ['startwork'] })
          void queryClient.invalidateQueries({ queryKey: ['lessons'] })
        },
      },
    )
  const toggle = (key: Option, label: string, description: string) => (
    <Toggle
      label={label}
      description={description}
      checked={w[key]}
      disabled={update.isPending}
      onChecked={(on) => save({ [key]: on })}
    />
  )
  return (
    <Section
      id="workflow"
      title="Workflow"
      description="What Start work hands your agent, and what happens around it."
    >
      <TextSetting
        label="Lessons file"
        hint="Inside each repo. Pick lessons from review comments in Utilities → Lessons; your agent adds its own."
        value={w.lessonsPath}
        validate={(v) => {
          const r = LessonsPathSchema.safeParse(v)
          return r.success ? null : (r.error.issues[0]?.message ?? 'Not a valid path')
        }}
        onSave={(lessonsPath) => save({ lessonsPath: lessonsPath.trim() }, 'Lessons file saved')}
      />
      {toggle(
        'pointAgentToLessons',
        'Tell the agent to read the lessons',
        'The Start work message says "Read <lessons file> first" when the repo has one.',
      )}
      {toggle(
        'askAgentForLessons',
        'Ask the agent to add what it learned',
        'The Start work message asks the agent to add new lessons to the file when it finishes.',
      )}
      {toggle(
        'openEditorAfterStart',
        'Open the repo in VS Code after Start work',
        'The Start work dialog starts with this ticked; you can still untick it there.',
      )}
      {toggle(
        'startDevServerAfterStart',
        'Start the dev server after Start work',
        "Runs the repo's dev command once the branch exists.",
      )}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
