import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eraser,
  Plus,
  Search,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSettings } from '../../lib/devdock'
import { modLabel } from '../../lib/keyboard'
import { useRepos } from '../../lib/repos'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, ErrorDetails, useToast } from '../../ui/Feedback'
import { Select } from '../../ui/Field'
import { terminalStore, type TerminalTab } from './store'
import './terminal.css'

const HOME = '__home__'
/** The first visit opens a terminal in the home folder; after that, closing all tabs sticks. */
let firstVisit = true

function tabLabel(t: TerminalTab): string {
  if (t.status === 'exited') return `${t.title} (exited)`
  if (t.status === 'failed') return `${t.title} (failed)`
  return t.title
}

/** Find in the active terminal's scrollback (Mod+F). Escape closes it and returns to the shell. */
function FindBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [missing, setMissing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const find = (back: boolean) => {
    const s = terminalStore().activeSession()
    if (!s || !query) return
    const opts = { caseSensitive: false, incremental: false }
    const hit = back ? s.search.findPrevious(query, opts) : s.search.findNext(query, opts)
    setMissing(!hit)
  }
  return (
    <div className="terminal-find" role="search" aria-label="Find in terminal">
      <input
        ref={input}
        className="input"
        aria-label="Find in terminal"
        placeholder="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setMissing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <IconButton label="Previous match" icon={<ArrowUp size={16} />} onClick={() => find(true)} />
      <IconButton label="Next match" icon={<ArrowDown size={16} />} onClick={() => find(false)} />
      <span className="muted" role="status">
        {missing ? 'No matches' : ''}
      </span>
      <IconButton label="Close find" icon={<X size={16} />} onClick={onClose} />
    </div>
  )
}

/**
 * P7-A: terminal tabs on real shells (in main). Tabs and their scrollback live in the store, so
 * they are still there after visiting another view. Inside a terminal, Tab and Escape belong to
 * the shell; F6 / Shift+F6 or ⌘/Ctrl+1–9 and ⌘/Ctrl+K leave it.
 */
export function TerminalPage({ request }: { request?: { n: number; repoId: string | null } }) {
  const store = terminalStore()
  const { tabs, active } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const settings = useSettings().data
  const repos = useRepos()
  const toast = useToast()
  const [where, setWhere] = useState<string>(HOME)
  const [finding, setFinding] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const tabList = useRef<HTMLDivElement>(null)

  const openIn = useCallback(
    (repoId: string | null) => {
      const repo = repoId ? repos.find((r) => r.id === repoId) : undefined
      store.open(repo ? { id: repo.id, name: repo.name } : null)
      requestAnimationFrame(() => store.focusActive())
    },
    [repos, store],
  )

  useEffect(() => {
    store.hooks = {
      onFind: () => setFinding(true),
      onLeave: (back) => {
        if (back) {
          tabList.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
        } else {
          document.querySelector<HTMLElement>('.terminal-toolbar button')?.focus()
        }
      },
      onError: (message, details) => toast(message, 'danger', details),
    }
  }, [store, toast])

  // The screens move into this view's viewport (and out again when it goes away).
  useEffect(() => {
    const el = viewport.current
    store.setViewport(el)
    if (!el) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => store.fitActive())
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      store.setViewport(null)
    }
  }, [store])

  useEffect(() => {
    if (settings) store.setOptions(settings.terminal)
  }, [settings, store])

  // Colours follow the theme: the setting, and the OS scheme for System.
  const theme = settings?.appearance.theme
  useEffect(() => {
    // After the new data-theme is on <html> (appearance.ts applies it in an effect too).
    const frame = requestAnimationFrame(() => store.refreshTheme())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => store.refreshTheme()
    media.addEventListener('change', onScheme)
    return () => {
      cancelAnimationFrame(frame)
      media.removeEventListener('change', onScheme)
    }
  }, [theme, store])

  // A request from the palette, a repo card or the panel: a new tab there.
  const handled = useRef(0)
  useEffect(() => {
    if (request && request.n !== handled.current) {
      handled.current = request.n
      firstVisit = false
      openIn(request.repoId)
    } else if (firstVisit && store.getSnapshot().tabs.length === 0) {
      firstVisit = false
      openIn(null)
    }
  }, [request, openIn, store])

  const closeFind = () => {
    setFinding(false)
    store.activeSession()?.search.clearDecorations()
    store.focusActive()
  }

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else if (e.key === 'Delete') {
      e.preventDefault()
      void store.close(tabs[index]!.key)
      return
    } else return
    e.preventDefault()
    const key = tabs[next]!.key
    store.select(key)
    tabList.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus()
  }

  const whereOptions = [
    { value: HOME, label: 'Home folder' },
    ...repos.map((r) => ({ value: r.id, label: r.name })),
  ]
  const activeTab = tabs.find((t) => t.key === active)

  return (
    <div className="terminal-view">
      <div className="terminal-bar">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals" ref={tabList}>
          {tabs.map((t, i) => (
            <div key={t.key} className="terminal-tab" data-active={t.key === active || undefined}>
              <button
                type="button"
                role="tab"
                id={`terminal-tab-${t.key}`}
                data-key={t.key}
                aria-selected={t.key === active}
                aria-controls="terminal-viewport"
                tabIndex={t.key === active ? 0 : -1}
                title={t.shell ? `${t.title} — ${t.shell}` : t.title}
                onClick={() => {
                  store.select(t.key)
                  store.focusActive()
                }}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <SquareTerminal size={14} aria-hidden="true" />
                <span>{tabLabel(t)}</span>
              </button>
              <IconButton
                label={`Close ${t.title}`}
                icon={<X size={14} />}
                tabIndex={t.key === active ? 0 : -1}
                onClick={() => void store.close(t.key)}
              />
            </div>
          ))}
        </div>
        <div className="terminal-toolbar">
          <Select
            aria-label="Start in"
            options={whereOptions}
            value={whereOptions.some((o) => o.value === where) ? where : HOME}
            onValue={setWhere}
          />
          <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => openIn(where === HOME ? null : where)}>
            New terminal
          </Button>
          <IconButton
            label="Find"
            shortcut={modLabel('F')}
            icon={<Search size={16} />}
            disabled={!activeTab}
            onClick={() => setFinding(true)}
          />
          <IconButton
            label="Copy selection"
            shortcut={modLabel('C')}
            icon={<Copy size={16} />}
            disabled={!activeTab}
            onClick={() => store.activeSession()?.copySelection()}
          />
          <IconButton
            label="Clear"
            icon={<Eraser size={16} />}
            disabled={!activeTab}
            onClick={() => {
              store.activeSession()?.term.clear()
              store.focusActive()
            }}
          />
        </div>
      </div>
      {finding && activeTab ? <FindBar onClose={closeFind} /> : null}
      {activeTab?.error ? (
        <div className="terminal-error" role="alert">
          <p>{activeTab.error.message}</p>
          <ErrorDetails error={activeTab.error} />
        </div>
      ) : null}
      {tabs.length === 0 ? (
        <EmptyState
          icon={<SquareTerminal size={28} />}
          title="No terminals open. Each one runs your own shell, with your own setup."
          action={<Button onClick={() => openIn(null)}>Open a terminal</Button>}
        />
      ) : null}
      <div
        id="terminal-viewport"
        className="terminal-viewport"
        ref={viewport}
        role="tabpanel"
        aria-labelledby={activeTab ? `terminal-tab-${activeTab.key}` : undefined}
        hidden={tabs.length === 0}
      />
      <p className="muted terminal-hint">
        Tab and Escape go to the shell. Leave the terminal with F6 (Shift+F6 for the tabs) or{' '}
        {modLabel('1')}–{modLabel('9')}.
      </p>
    </div>
  )
}
