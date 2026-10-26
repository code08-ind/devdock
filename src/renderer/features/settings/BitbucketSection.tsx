import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { BITBUCKET_FLAVORS, type BitbucketFlavor } from '@shared/bitbucket'
import { CLOUD_WEB } from '@shared/prlink'
import type { Settings } from '@shared/settings'
import { prKeys } from '../../lib/bitbucket'
import { bridge, keys, unwrap, useUpdateSettings } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/Dialog'
import { ErrorNotice, StatusPill, useToast } from '../../ui/Feedback'
import { SegmentedControl, Toggle } from '../../ui/Field'
import { Section } from './Section'
import { TestConnection, TextSetting } from './ServiceBits'

const FLAVOR_NAME: Record<BitbucketFlavor, string> = {
  cloud: 'Bitbucket Cloud',
  datacenter: 'Bitbucket Data Center',
}
const FLAVORS = BITBUCKET_FLAVORS.map((value) => ({ value, label: FLAVOR_NAME[value] }))

/** SPEC 6.3 / 6.7: site type with Detect, URL, user name, Test connection, PR actions switch. */
export function BitbucketSection({ settings }: { settings: Settings }) {
  const bb = settings.bitbucket
  const demo = settings.general.demoMode
  const update = useUpdateSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const [warnActions, setWarnActions] = useState(false)
  const save = (patch: Partial<Settings['bitbucket']>, done: string) =>
    update.mutate(
      { bitbucket: patch },
      {
        onSuccess: () => {
          toast(done)
          void qc.invalidateQueries({ queryKey: prKeys.all })
          void qc.invalidateQueries({ queryKey: keys.watches })
        },
      },
    )
  const detect = useMutation({
    mutationFn: (baseUrl: string) => unwrap(bridge.bitbucket.detect({ baseUrl })),
    onSuccess: (found, baseUrl) => {
      const name = `${FLAVOR_NAME[found.flavor]}${found.version ? ` ${found.version}` : ''}`
      // Demo mode probes the demo site: report it, but don't change the real settings.
      if (demo) return toast(`Demo site is ${name}`)
      save(
        { flavor: found.flavor, baseUrl: found.flavor === 'cloud' ? '' : baseUrl },
        `Detected ${name}`,
      )
    },
  })

  return (
    <Section
      id="bitbucket"
      title="Bitbucket"
      description={
        bb.flavor === 'cloud'
          ? 'Bitbucket Cloud signs in with your user name or email and an API token or app password (Credentials below).'
          : 'Bitbucket Data Center signs in with an HTTP access token (Credentials below).'
      }
    >
      <Toggle
        label="Use Bitbucket"
        description="Turn off if your code is only on GitHub or GitLab."
        checked={bb.enabled}
        onChecked={(enabled) => save({ enabled }, `Bitbucket turned ${enabled ? 'on' : 'off'}`)}
      />
      <SegmentedControl
        label="Site type"
        options={FLAVORS}
        value={bb.flavor}
        onValue={(flavor) => save({ flavor }, 'Site type saved')}
      />
      <TextSetting
        label={bb.flavor === 'cloud' ? 'Site URL (optional)' : 'Server URL'}
        hint={
          bb.flavor === 'cloud'
            ? 'Leave empty for bitbucket.org. Detect works out the site type from a URL.'
            : 'e.g. https://bitbucket.example.com (with a context path like /bitbucket if your server has one). Detect checks it.'
        }
        value={bb.baseUrl}
        onSave={(baseUrl) => save({ baseUrl }, 'URL saved')}
        extra={(draft) => (
          <Button
            icon={<ScanSearch size={16} aria-hidden="true" />}
            disabled={detect.isPending}
            onClick={() => detect.mutate(draft || bb.baseUrl || CLOUD_WEB)}
          >
            {detect.isPending ? 'Detecting…' : 'Detect'}
          </Button>
        )}
      />
      {detect.error ? <ErrorNotice error={detect.error} /> : null}
      {bb.flavor === 'cloud' ? (
        <TextSetting
          label="User name or email"
          hint="Your Bitbucket user name (app password) or Atlassian account email (API token). Leave empty for a repository or workspace access token: it signs in as a bot, so My PRs and Reviewing stay empty."
          value={bb.username}
          validate={(v) => (v.includes(':') ? 'A user name or email has no ":".' : null)}
          onSave={(username) => save({ username }, 'User name saved')}
        />
      ) : null}
      <TestConnection
        // A new site/flavour/user makes an old result meaningless: start over.
        key={`${bb.flavor}|${bb.baseUrl}|${bb.username}`}
        demo={demo}
        test={() => unwrap(bridge.bitbucket.testConnection())}
      />

      <Toggle
        label="PR actions (approve, needs work, merge)"
        description="Off by default. Applies to Bitbucket, GitHub and GitLab. Use only if your role permits. Each action still asks you to confirm; merge also asks you to type the target branch."
        checked={settings.features.prActions}
        onChecked={(on) =>
          on
            ? setWarnActions(true)
            : update.mutate(
                { features: { prActions: false } },
                { onSuccess: () => toast('PR actions turned off') },
              )
        }
      />
      {settings.features.prActions ? (
        <div role="status">
          <StatusPill tone="warning">PR actions are on</StatusPill>
        </div>
      ) : null}
      <ConfirmDialog
        open={warnActions}
        title="Turn on PR actions?"
        body={
          <p>
            Use only if your role permits. DevDock will show Approve, Needs work and Merge on pull
            requests (and GitLab merge requests), and send them to Bitbucket, GitHub or GitLab as
            you once you confirm each one.
          </p>
        }
        confirmLabel="Turn on PR actions"
        onConfirm={() =>
          update.mutate(
            { features: { prActions: true } },
            { onSuccess: () => toast('PR actions turned on') },
          )
        }
        onClose={() => setWarnActions(false)}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
