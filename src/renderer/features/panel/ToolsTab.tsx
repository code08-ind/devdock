import { Copy, ExternalLink } from 'lucide-react'
import { draftMarkdown, draftText } from '@shared/standup'
import { bridge, unwrap, useSettings } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { PortsPanel } from '../utilities/PortsPanel'
import { PanelSection, openUtility } from './bits'

/**
 * Standup, quick links and ports. `stopPort` (from `kill <port>` in the panel's search) opens
 * that port's stop dialog here, so stopping a process confirms in the panel.
 */
export function ToolsTab({ stopPort }: { stopPort?: number }) {
  const links = useSettings().data?.quickLinks ?? []
  const { run, pending } = useAction()
  const copyStandup = (format: 'text' | 'Markdown') =>
    void run(
      unwrap(bridge.standup.draft()).then((d) =>
        navigator.clipboard.writeText(format === 'text' ? draftText(d) : draftMarkdown(d)),
      ),
      `Standup copied as ${format}`,
    )
  return (
    <>
      <PanelSection title="Standup">
        <div className="button-row">
          <Button
            size="sm"
            variant="primary"
            icon={<Copy size={16} aria-hidden="true" />}
            disabled={pending}
            onClick={() => copyStandup('text')}
          >
            Copy as text
          </Button>
          <Button
            size="sm"
            icon={<Copy size={16} aria-hidden="true" />}
            disabled={pending}
            onClick={() => copyStandup('Markdown')}
          >
            Copy as Markdown
          </Button>
        </div>
      </PanelSection>
      <PanelSection title="Quick links">
        {links.length === 0 ? (
          <div className="today-setup">
            <p className="muted">No quick links yet.</p>
            <Button size="sm" onClick={() => openUtility({ tab: 'links' })}>
              Add links
            </Button>
          </div>
        ) : (
          <ul className="panel-links" aria-label="Quick links">
            {links.map((l) => (
              <li key={l.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ExternalLink size={16} aria-hidden="true" />}
                  onClick={() => void run(unwrap(bridge.app.openExternal({ url: l.url })))}
                >
                  {l.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {/* The ports list is its own "Ports" region; only its heading is added here. */}
      <div className="panel-group">
        <h2 className="panel-group-title">Ports</h2>
        <PortsPanel key={stopPort} stopPort={stopPort} />
      </div>
    </>
  )
}
