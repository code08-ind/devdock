import { Loading } from '../../ui/Feedback'
import { ArrowUpRight } from 'lucide-react'
import { isLive } from '@shared/bitbucket'
import { usePrList, useWatchedKeys, useWatches } from '../../lib/bitbucket'
import { byLiveFirst, useBuildWatches } from '../../lib/jenkins'
import { useJiraList } from '../../lib/jira'
import { IconButton } from '../../ui/Button'
import { watchLabel } from '../builds/BuildBits'
import { WatchedRunRow } from '../builds/CiRuns'
import { ciRunLabel } from '@shared/ci'
import { useCiWatches } from '../../lib/providers'
import { PrRow } from '../prs/PrRow'
import { SetUp, WatchedBuildRow } from '../today/TodayPage'
import { PanelSection, goto } from './bits'
import { TicketList, inProgress } from './TicketsTab'

/** The day at a glance: my PRs, other watched PRs, watched builds, tickets in progress. */
export function TodayTab() {
  const mine = usePrList('mine')
  const watchedKeys = useWatchedKeys()
  const mineKeys = new Set((mine.data ?? []).map((p) => p.key))
  const otherWatched = (useWatches().data ?? []).filter((w) => isLive(w) && !mineKeys.has(w.key))
  const builds = byLiveFirst(useBuildWatches().data ?? [])
  const runs = [...(useCiWatches().data ?? [])].sort((a, b) => Number(a.done) - Number(b.done))
  const tickets = useJiraList({ list: 'mine' })
  const started = (tickets.data ?? []).filter(inProgress)
  return (
    <>
      <PanelSection title="My pull requests">
        {mine.error ? (
          <SetUp error={mine.error} onView={goto} />
        ) : mine.isPending || !mine.data ? (
          <Loading what="pull requests" />
        ) : mine.data.length === 0 ? (
          <p className="muted">You have no open pull requests.</p>
        ) : (
          <ul className="pr-list" aria-label="My pull requests">
            {mine.data.map((pr) => (
              <PrRow key={pr.key} pr={pr} watchKey={watchedKeys.has(pr.key) ? pr.key : undefined} />
            ))}
          </ul>
        )}
      </PanelSection>
      {otherWatched.length ? (
        <PanelSection title="Watched pull requests">
          <ul className="pr-list" aria-label="Watched pull requests">
            {otherWatched.map((w) => (
              <PrRow key={w.key} pr={w.pr} watchKey={w.key} showAuthor />
            ))}
          </ul>
        </PanelSection>
      ) : null}
      <PanelSection title="Watched builds">
        {builds.length === 0 && runs.length === 0 ? (
          <p className="muted">No builds watched. Watch one from Builds or a pull request.</p>
        ) : (
          <ul className="pr-list" aria-label="Watched builds">
            {builds.map((w) => (
              <WatchedBuildRow
                key={w.key}
                watch={w}
                actions={
                  <IconButton
                    label={`Show ${watchLabel(w)} in Builds`}
                    icon={<ArrowUpRight size={16} aria-hidden="true" />}
                    onClick={() => goto('builds')}
                  />
                }
              />
            ))}
            {runs.map((w) => (
              <WatchedRunRow
                key={w.key}
                watch={w}
                actions={
                  <IconButton
                    label={`Show ${ciRunLabel(w.run)} in Builds`}
                    icon={<ArrowUpRight size={16} aria-hidden="true" />}
                    onClick={() => goto('builds')}
                  />
                }
              />
            ))}
          </ul>
        )}
      </PanelSection>
      <PanelSection title="In progress">
        {tickets.error ? (
          <SetUp error={tickets.error} onView={goto} />
        ) : tickets.isPending ? (
          <Loading what="tickets" />
        ) : started.length === 0 ? (
          <p className="muted">Nothing in progress. Start work from the Tickets tab.</p>
        ) : (
          <TicketList issues={started} label="Tickets in progress" />
        )}
      </PanelSection>
    </>
  )
}
