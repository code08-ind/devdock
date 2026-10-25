import { useState } from 'react'
import type { View } from '@shared/channels'
import type { UtilityRequest } from '@shared/utilities'
import { useSettings } from '../../lib/devdock'
import { useRepos } from '../../lib/repos'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Feedback'
import { Field, Select, SegmentedControl } from '../../ui/Field'
import { FolderGit2 } from 'lucide-react'
import { CachesPanel } from './CachesPanel'
import { EnvPanel } from './EnvPanel'
import { LessonsPanel } from './LessonsPanel'
import { LinksPanel } from './LinksPanel'
import { PortsPanel } from './PortsPanel'
import { StandupPanel } from './StandupPanel'

type UtilityTab = UtilityRequest['tab']

const TABS: { value: UtilityTab; label: string }[] = [
  { value: 'ports', label: 'Ports' },
  { value: 'caches', label: 'Clean caches' },
  { value: 'env', label: 'Env profiles' },
  { value: 'links', label: 'Quick links' },
  { value: 'standup', label: 'Standup' },
  { value: 'lessons', label: 'Lessons' },
]

/** SPEC 6.6 Utilities: ports, clean caches, env profiles, quick links, standup draft; lessons (P6-F). */
export function UtilitiesPage({
  request,
  onView,
}: {
  request?: UtilityRequest
  onView: (v: View) => void
}) {
  const settings = useSettings().data
  const repos = useRepos()
  const [tab, setTab] = useState<UtilityTab>(request?.tab ?? 'ports')
  const [repoId, setRepoId] = useState<string | null>(null)
  const repo = repos.find((r) => r.id === repoId) ?? repos[0]
  if (!settings) return null
  const needsRepo = tab === 'caches' || tab === 'env' || tab === 'lessons'

  return (
    <div className="prs">
      <SegmentedControl label="Utility" options={TABS} value={tab} onValue={setTab} />
      {needsRepo && repo ? (
        // Shown with one repo too: it says which repo these actions touch.
        <Field label="Repo">
          {({ id }) => (
            <Select
              id={id}
              options={repos.map((r) => ({ value: r.id, label: r.name }))}
              value={repo.id}
              disabled={repos.length === 1}
              onValue={setRepoId}
            />
          )}
        </Field>
      ) : null}
      {needsRepo && !repo ? (
        <EmptyState
          icon={<FolderGit2 size={18} aria-hidden="true" />}
          title="Add a repo first: clean caches, env profiles and lessons work on a registered repo."
          action={<Button onClick={() => onView('repos')}>Open Repos</Button>}
        />
      ) : tab === 'ports' ? (
        <PortsPanel stopPort={request?.stopPort} />
      ) : tab === 'caches' ? (
        <CachesPanel key={repo!.id} repoId={repo!.id} />
      ) : tab === 'env' ? (
        <EnvPanel key={repo!.id} repoId={repo!.id} />
      ) : tab === 'lessons' ? (
        <LessonsPanel key={repo!.id} repoId={repo!.id} onView={onView} />
      ) : tab === 'links' ? (
        <LinksPanel settings={settings} />
      ) : (
        <StandupPanel />
      )}
    </div>
  )
}
