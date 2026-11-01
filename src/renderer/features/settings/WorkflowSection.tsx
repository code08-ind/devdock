import { LessonsPathSchema } from '@shared/lessons'
import type { Settings } from '@shared/settings'
import { queryClient, useUpdateSettings } from '../../lib/devdock'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, Select, Toggle } from '../../ui/Field'
import { useAgents } from '../../lib/agents'
import { AGENT_CLIS, type AgentPreference } from '@shared/agents'
import { Section } from './Section'
import { TextSetting } from './ServiceBits'

type Workflow = Settings['workflow']
/** The on/off options (everything but the path). */
type Option = Exclude<keyof Workflow, 'lessonsPath' | 'agentCli' | 'prOpenedStatus'>

/**
 * Workflow options (P6-F, owner request): the agent lessons file and what Start work does around
 * it. Each applies the next time Start work runs; the dialog shows the message they produce.
 */
export function WorkflowSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const w = settings.workflow
  const agents = useAgents().data
  const installed = (id: string) => agents?.find((a) => a.id === id)?.installed
  const agentOptions: { value: AgentPreference; label: string }[] = [
    { value: 'auto', label: 'The first one installed' },
    ...AGENT_CLIS.map((a) => ({
      value: a.id,
      label: agents && !installed(a.id) ? `${a.name} (not found)` : a.name,
    })),
  ]
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
      <Field
        label="Agent"
        hint="Start work offers to start this agent CLI in DevDock's terminal, in the repo, with the Start work message. DevDock looks for it on your shell's PATH and holds no keys: the CLI signs in its own way."
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            options={agentOptions}
            value={w.agentCli}
            disabled={update.isPending}
            onValue={(agentCli) => save({ agentCli })}
          />
        )}
      </Field>
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
      {toggle(
        'devServerAfterSwitch',
        'Start the dev server after a branch switch',
        'When a repo switches branch (in DevDock, your terminal or your editor), DevDock starts its dev server if it isn’t running. A running one is left as it is.',
      )}
      {toggle(
        'checkBeforePush',
        'Run the check command before Push branch',
        'Push branch starts with this ticked for repos with a check command (repo settings); it pushes only if the check passes.',
      )}
      {toggle(
        'watchBuildAfterPush',
        'Watch the Jenkins build after Push branch',
        "Push branch starts with this ticked; DevDock watches the branch's Jenkins build and notifies you when it ends.",
      )}
      {toggle(
        'moveTicketOnPr',
        'Offer to move the ticket when a PR opens',
        'When a pull request of yours opens with a Jira key in its branch or title, Today (and a notification) offers to move the ticket. DevDock asks before it changes Jira.',
      )}
      {w.moveTicketOnPr ? (
        <TextSetting
          label="Move it to"
          hint="The Jira status (or transition name) to move the ticket to, e.g. In Review or Code Review."
          value={w.prOpenedStatus}
          validate={(v) =>
            v.trim() === ''
              ? 'Enter a status'
              : v.trim().length > 100
                ? 'Use 100 characters at most'
                : null
          }
          onSave={(prOpenedStatus) =>
            save({ prOpenedStatus: prOpenedStatus.trim() }, 'Status saved')
          }
        />
      ) : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
