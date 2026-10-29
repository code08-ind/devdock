import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, PlugZap, Save } from 'lucide-react'
import {
  ProxyServerSchema,
  SERVICES,
  type Diagnostics,
  type ServiceName,
} from '@shared/diagnostics'
import type { Settings } from '@shared/settings'
import { bridge, isSetUp, queryClient, unwrap, useUpdateSettings } from '../../lib/devdock'
import { useAction } from '../../lib/useAction'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { ErrorDetails, ErrorNotice, Loading, StatusPill, useToast } from '../../ui/Feedback'
import { SegmentedControl } from '../../ui/Field'
import { CodeBlock, KeyValue } from '../../ui/Text'
import { TextSetting } from './ServiceBits'
import { Section } from './Section'

type Result = { ok: true; who: string } | { ok: false; error: unknown } | 'skipped' | 'testing'

/** Each service's Test connection, answering who it connected as. */
const TEST: Record<ServiceName, () => Promise<string>> = {
  Jira: async () => (await unwrap(bridge.jira.testConnection())).user.displayName,
  Bitbucket: async () => (await unwrap(bridge.bitbucket.testConnection())).user.displayName,
  Jenkins: async () => (await unwrap(bridge.jenkins.testConnection())).user.fullName,
  GitHub: async () => (await unwrap(bridge.github.testConnection())).user.displayName,
  GitLab: async () => (await unwrap(bridge.gitlab.testConnection())).user.displayName,
}

/**
 * Diagnostics (P6.04): versions, the proxy each service goes through, every connection tested
 * at once, and a report to send with a bug — names, emails and credentials removed.
 */
export function DiagnosticsSection({ settings }: { settings: Settings }) {
  const info = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => unwrap(bridge.diagnostics.info()),
    staleTime: 0,
  })
  const [results, setResults] = useState<Partial<Record<ServiceName, Result>>>({})
  const [report, setReport] = useState<string | null>(null)
  const { run, pending } = useAction()
  const toast = useToast()

  const testAll = () => {
    for (const [name, key] of SERVICES) {
      if (!isSetUp(settings, key)) {
        setResults((r) => ({ ...r, [name]: 'skipped' }))
        continue
      }
      setResults((r) => ({ ...r, [name]: 'testing' }))
      TEST[name]().then(
        (who) => setResults((r) => ({ ...r, [name]: { ok: true, who } })),
        (error: unknown) => setResults((r) => ({ ...r, [name]: { ok: false, error } })),
      )
    }
  }
  const testing = Object.values(results).includes('testing')

  return (
    <Section
      id="diagnostics"
      title="Diagnostics"
      description="What DevDock runs on and how it reaches your services. Include the report when you ask for help."
    >
      {info.error ? (
        <ErrorNotice error={info.error} />
      ) : !info.data ? (
        <Loading what="versions" />
      ) : (
        <Versions d={info.data} />
      )}

      <ProxySetting settings={settings} />

      <h3 className="group-title">Connections</h3>
      <ul className="diag-tests" aria-label="Connection tests">
        {SERVICES.map(([name]) => (
          <li key={name} className="diag-test">
            <span className="diag-service">{name}</span>
            <TestResult result={results[name]} />
          </li>
        ))}
      </ul>

      <div className="button-row">
        <Button
          icon={<PlugZap size={16} aria-hidden="true" />}
          disabled={testing}
          onClick={testAll}
        >
          Test all connections
        </Button>
        <Button
          icon={<Download size={16} aria-hidden="true" />}
          disabled={pending}
          onClick={() =>
            void run(unwrap(bridge.diagnostics.export())).then((r) => r.ok && setReport(r.value))
          }
        >
          Export diagnostics
        </Button>
      </div>

      <Dialog
        open={report !== null}
        title="Diagnostics report"
        wide
        onClose={() => setReport(null)}
        actions={
          <>
            <Button onClick={() => setReport(null)}>Close</Button>
            <Button
              variant="primary"
              icon={<Save size={16} aria-hidden="true" />}
              disabled={pending}
              onClick={() =>
                void run(unwrap(bridge.diagnostics.save())).then((r) => {
                  if (r.ok && r.value.path) toast(`Saved the report to ${r.value.path}`)
                })
              }
            >
              Save as file…
            </Button>
          </>
        }
      >
        <p className="muted">
          No credentials; account names, emails and your home folder are replaced. Check it before
          you send it.
        </p>
        {report ? <CodeBlock code={report} label="devdock-diagnostics.json" /> : null}
      </Dialog>
    </Section>
  )
}

/** SPEC 5: the system proxy, or one typed here (no sign-in details: the system asks for them). */
function ProxySetting({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const save = (patch: Partial<Settings['network']>) =>
    update.mutate(
      { network: patch },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['diagnostics'] }) },
    )
  const { proxyMode, proxyServer } = settings.network
  return (
    <>
      <SegmentedControl
        label="Proxy"
        options={[
          { value: 'system' as const, label: 'Use the system proxy' },
          { value: 'manual' as const, label: 'Use this proxy' },
        ]}
        value={proxyMode}
        onValue={(mode) => save({ proxyMode: mode })}
      />
      {proxyMode === 'manual' ? (
        <TextSetting
          label="Proxy server"
          hint="host:port, e.g. proxy.corp.example:8080. Used for Jira, Bitbucket and Jenkins."
          value={proxyServer}
          validate={(v) => {
            const r = ProxyServerSchema.safeParse(v)
            return r.success ? null : (r.error.issues[0]?.message ?? 'Not a proxy address')
          }}
          onSave={(server) => save({ proxyServer: server.trim() })}
        />
      ) : null}
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </>
  )
}

function Versions({ d }: { d: Diagnostics }) {
  const missing = (why: string) => <span className="muted">{why}</span>
  return (
    <>
      <KeyValue
        items={[
          ['DevDock', d.app],
          ['Mode', d.demoMode ? 'Demo data' : 'Your services'],
          ['Electron', d.electron],
          ['Chromium', d.chrome],
          ['Node (in DevDock)', d.node],
          [
            'Node on your PATH',
            d.systemNode ?? missing("Not found: dev servers that use node won't start"),
          ],
          ['Git', d.git ?? missing('Not found: repo actions need git on your PATH')],
          ['Platform', `${d.platform} ${d.arch}`],
        ]}
      />
      <h3 className="group-title">Proxy in use</h3>
      {d.demoMode ? (
        <p className="muted">Demo mode answers inside DevDock: nothing goes over the network.</p>
      ) : null}
      <KeyValue
        items={d.proxies.map((p) => [
          p.service,
          p.origin === null ? (
            <span className="muted">Not set up</span>
          ) : (
            <span>
              <span className="mono">{p.origin}</span>:{' '}
              {p.route === null ? (
                "couldn't be checked"
              ) : p.route === 'DIRECT' ? (
                'direct, no proxy'
              ) : (
                <span className="mono">{p.route}</span>
              )}
            </span>
          ),
        ])}
      />
    </>
  )
}

function TestResult({ result }: { result: Result | undefined }) {
  if (result === undefined) return <span className="muted">Not tested</span>
  if (result === 'skipped') return <span className="muted">Not set up</span>
  if (result === 'testing') {
    return (
      <span className="muted" role="status">
        Testing…
      </span>
    )
  }
  if (result.ok) return <StatusPill tone="success">Connected as {result.who}</StatusPill>
  return (
    <span className="diag-failure">
      <StatusPill tone="danger">
        {result.error instanceof Error ? result.error.message : 'Failed'}
      </StatusPill>
      <ErrorDetails error={result.error} />
    </span>
  )
}
