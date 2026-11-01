import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { jobPathFrom } from '@shared/jenkins'
import type { Settings, SettingsPatch } from '@shared/settings'
import { bridge, keys, unwrap, useUpdateSettings } from '../../lib/devdock'
import { jenkinsKeys } from '../../lib/jenkins'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Toggle } from '../../ui/Field'
import { Section } from './Section'
import { TestConnection, TextSetting } from './ServiceBits'

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Every line a job path (or a job link on this site): the message names the first bad one. */
function jobLinesError(text: string, baseUrl: string): string | null {
  const bad = lines(text).find((l) => jobPathFrom(l, baseUrl) === null)
  if (!bad) return null
  return /^https?:/i.test(bad)
    ? `${bad} isn't a job link on ${baseUrl || 'the Jenkins server above'}.`
    : `${bad} isn't a job path. Use the names from the job's address, e.g. apps/web-app.`
}

/** SPEC 6.4 / 6.7: server, user, jobs, deploy job, protected patterns, triggers + allow-list. */
export function JenkinsSection({ settings }: { settings: Settings }) {
  const jk = settings.jenkins
  const demo = settings.general.demoMode
  const update = useUpdateSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const [warnTriggers, setWarnTriggers] = useState(false)
  const save = (patch: SettingsPatch, done: string) =>
    update.mutate(patch, {
      onSuccess: () => {
        toast(done)
        void qc.invalidateQueries({ queryKey: jenkinsKeys.all })
        void qc.invalidateQueries({ queryKey: keys.buildWatches })
      },
    })
  const paths = (text: string) => lines(text).map((l) => jobPathFrom(l, jk.baseUrl)!)

  return (
    <Section
      id="jenkins"
      title="Jenkins"
      description="Jenkins signs in with your user name and an API token (Credentials below). Create the token under your Jenkins user → Security → API Token."
    >
      <TextSetting
        label="Server URL"
        hint="e.g. https://jenkins.example.com (with a context path like /jenkins if your server has one)."
        value={jk.baseUrl}
        onSave={(baseUrl) => save({ jenkins: { baseUrl } }, 'URL saved')}
      />
      <TextSetting
        label="User name"
        value={jk.username}
        validate={(v) => (v.includes(':') ? 'A user name has no ":".' : null)}
        onSave={(username) => save({ jenkins: { username } }, 'User name saved')}
      />
      <TestConnection
        key={`${jk.baseUrl}|${jk.username}`}
        service="Jenkins"
        demo={demo}
        test={async () => {
          const c = await unwrap(bridge.jenkins.testConnection())
          return { status: c.status, user: { displayName: c.user.fullName, account: c.user.id } }
        }}
      />
      <TextSetting
        label="Multibranch jobs for My branches"
        hint="One per line: the job's path (apps/web-app) or its link. Folders of multibranch jobs work too."
        multiline
        value={jk.jobs.join('\n')}
        validate={(v) => jobLinesError(v, jk.baseUrl)}
        onSave={(v) => save({ jenkins: { jobs: paths(v) } }, 'Jobs saved')}
      />
      <TextSetting
        label="Deploy job (optional)"
        hint="Followed for your branch by Watch deploy, read-only, e.g. apps/deploy-dev."
        value={jk.deployJob}
        validate={(v) => (v === '' ? null : jobLinesError(v, jk.baseUrl))}
        onSave={(v) =>
          save(
            { jenkins: { deployJob: v === '' ? '' : (jobPathFrom(v, jk.baseUrl) ?? '') } },
            'Deploy job saved',
          )
        }
      />
      <TextSetting
        label="Protected job patterns"
        hint="One per line. A job whose path contains any of these (any case; * matches anything) can never be triggered from DevDock."
        multiline
        value={jk.protectedPatterns.join('\n')}
        onSave={(v) =>
          save({ jenkins: { protectedPatterns: lines(v) } }, 'Protected patterns saved')
        }
      />
      {jk.protectedPatterns.length === 0 ? (
        <div>
          <StatusPill tone="warning">
            No protected patterns: any allowed job can be triggered
          </StatusPill>
        </div>
      ) : null}

      <Toggle
        label="Job triggers"
        description="Off by default. Use only if your role permits. Only the jobs listed below can be triggered, never a protected one, and each trigger asks you to confirm."
        checked={settings.features.jobTriggers}
        onChecked={(on) =>
          on
            ? setWarnTriggers(true)
            : update.mutate(
                { features: { jobTriggers: false } },
                { onSuccess: () => toast('Job triggers turned off') },
              )
        }
      />
      {settings.features.jobTriggers ? (
        <TextSetting
          label="Jobs DevDock may trigger"
          hint="One per line: the exact job path or link (a branch job is apps/web-app/feature%2Fx, as in its address)."
          multiline
          value={settings.features.allowedJobs.join('\n')}
          validate={(v) => jobLinesError(v, jk.baseUrl)}
          onSave={(v) => save({ features: { allowedJobs: paths(v) } }, 'Allowed jobs saved')}
        />
      ) : null}
      <ConfirmDialog
        open={warnTriggers}
        title="Turn on job triggers?"
        body={
          <p>
            Use only if your role permits. DevDock will show Trigger build on the jobs you list here
            (never on protected ones) and queue them in Jenkins as you once you confirm each one.
          </p>
        }
        confirmLabel="Turn on job triggers"
        onConfirm={() =>
          update.mutate(
            { features: { jobTriggers: true } },
            { onSuccess: () => toast('Job triggers turned on') },
          )
        }
        onClose={() => setWarnTriggers(false)}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
