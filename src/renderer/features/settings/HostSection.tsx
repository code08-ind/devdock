import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { GITHUB_WEB, GITLAB_WEB, PROVIDER_NAMES, type CiProvider } from '@shared/providers'
import type { Settings } from '@shared/settings'
import { prKeys } from '../../lib/bitbucket'
import { bridge, keys, unwrap, useUpdateSettings } from '../../lib/devdock'
import { ciKeys } from '../../lib/providers'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { Toggle } from '../../ui/Field'
import { Section } from './Section'
import { TestConnection, TextSetting } from './ServiceBits'

const COPY: Record<CiProvider, { site: string; self: string; example: string; token: string }> = {
  github: {
    site: GITHUB_WEB,
    self: 'GitHub Enterprise Server URL',
    example: 'https://github.example.com',
    token:
      'Sign in with a personal access token (Credentials below): fine-grained with read access to Pull requests, Contents and Actions (write only for PR actions and re-runs), or classic with repo and workflow.',
  },
  gitlab: {
    site: GITLAB_WEB,
    self: 'Self-managed GitLab URL',
    example: 'https://gitlab.example.com (with a relative root like /gitlab if yours has one)',
    token:
      'Sign in with a personal access token (Credentials below) with the read_api scope; api only for approve, merge, retry and cancel.',
  },
}

/**
 * P7.05 / P7.06: GitHub or GitLab — on/off (off by default), the site (public or self-hosted),
 * Detect from the registered repos' remotes, Test connection.
 */
export function HostSection({ provider, settings }: { provider: CiProvider; settings: Settings }) {
  const name = PROVIDER_NAMES[provider]
  const copy = COPY[provider]
  const s = settings[provider]
  const demo = settings.general.demoMode
  const update = useUpdateSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const save = (patch: Partial<Settings['github']>, done: string) =>
    update.mutate(provider === 'github' ? { github: patch } : { gitlab: patch }, {
      onSuccess: () => {
        toast(done)
        void qc.invalidateQueries({ queryKey: prKeys.all })
        void qc.invalidateQueries({ queryKey: ciKeys.all })
        void qc.invalidateQueries({ queryKey: keys.watches })
      },
    })
  const detect = useMutation({
    mutationFn: () => unwrap(bridge.providers.detect()),
    onSuccess: (hosts) => {
      const mine = hosts.filter((h) => h.provider === provider)
      if (mine.length === 0) return toast(`None of your repos has a remote on ${name}.`)
      const self = mine.find((h) => h.host !== new URL(copy.site).hostname)
      if (self && !s.baseUrl) {
        save({ baseUrl: `https://${self.host}` }, `Found ${self.host}: saved as the ${name} site`)
        return
      }
      toast(
        `${name} repos found: ${mine.map((h) => `${h.repos.join(', ')} on ${h.host}`).join('; ')}`,
      )
    },
  })

  return (
    <Section id={provider} title={name} description={copy.token}>
      <Toggle
        label={`Use ${name}`}
        description={`Off by default. Shows your ${provider === 'gitlab' ? 'merge requests' : 'pull requests'} with the others, and ${provider === 'gitlab' ? 'GitLab pipelines' : 'GitHub Actions runs'} in Builds.`}
        checked={s.enabled}
        onChecked={(enabled) => save({ enabled }, `${name} turned ${enabled ? 'on' : 'off'}`)}
      />
      {s.enabled ? (
        <>
          <TextSetting
            label={`${copy.self} (optional)`}
            hint={`Leave empty for ${copy.site.replace('https://', '')}. e.g. ${copy.example}. Detect looks at your repos' remotes.`}
            value={s.baseUrl}
            onSave={(baseUrl) => save({ baseUrl }, 'URL saved')}
            extra={() => (
              <Button
                icon={<ScanSearch size={16} aria-hidden="true" />}
                disabled={detect.isPending}
                onClick={() => detect.mutate()}
              >
                {detect.isPending ? 'Detecting…' : 'Detect'}
              </Button>
            )}
          />
          {detect.error ? <ErrorNotice error={detect.error} /> : null}
          <TestConnection
            key={s.baseUrl}
            demo={demo}
            test={() =>
              unwrap(
                provider === 'github'
                  ? bridge.github.testConnection()
                  : bridge.gitlab.testConnection(),
              )
            }
          />
        </>
      ) : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}

/**
 * Owner decision (P7): re-run / retry / cancel on GitHub and GitLab sit behind this switch,
 * off by default, and still ask every time — the same pattern as PR actions.
 */
export function CiActionsSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const [warn, setWarn] = useState(false)
  const on = settings.features.ciActions
  return (
    <Section
      id="ci-actions"
      title="CI actions"
      description="For GitHub Actions runs and GitLab pipelines."
    >
      <Toggle
        label="CI actions (re-run, retry, cancel)"
        description="Off by default. Use only if your role permits. Each action still asks you to confirm."
        checked={on}
        onChecked={(next) =>
          next
            ? setWarn(true)
            : update.mutate(
                { features: { ciActions: false } },
                { onSuccess: () => toast('CI actions turned off') },
              )
        }
      />
      {on ? (
        <div role="status">
          <StatusPill tone="warning">CI actions are on</StatusPill>
        </div>
      ) : null}
      <ConfirmDialog
        open={warn}
        title="Turn on CI actions?"
        body={
          <p>
            Use only if your role permits. DevDock will show Re-run failed jobs, Retry failed jobs
            and Cancel on runs and pipelines, and send them to GitHub or GitLab as you once you
            confirm each one.
          </p>
        }
        confirmLabel="Turn on CI actions"
        onConfirm={() =>
          update.mutate(
            { features: { ciActions: true } },
            { onSuccess: () => toast('CI actions turned on') },
          )
        }
        onClose={() => setWarn(false)}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
