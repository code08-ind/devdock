import type { AgentLaunch } from '@shared/agents'
import { ArrowDown, ArrowUp, Copy, Eraser, Plus, Search, SquareTerminal, X } from 'lucide-react'
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

/** What Tab can reach, in document order (visible and enabled). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * F6 / Shift+F6 in a terminal (where Tab belongs to the shell): focus moves to the next / previous
 * stop outside the terminal, as Tab and Shift+Tab would (wrapping round the window).
 */
function focusBeside(terminal: HTMLElement | null, back: boolean): void {
  if (!terminal) return
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !terminal.contains(el) && el.getClientRects().length > 0,
  )
  if (all.length === 0) return
  const after = all.findIndex(
    (el) => terminal.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
  const next = after < 0 ? 0 : after
  const target = back ? all[(next - 1 + all.length) % all.length] : all[next]
  target?.focus()
}

/**
 * P7-A: terminal tabs on real shells (in main). Tabs and their scrollback live in the store, so
 * they are still there after visiting another view. Inside a terminal, Tab and Escape belong to
 * the shell; F6 / Shift+F6 or ⌘/Ctrl+1–9 and ⌘/Ctrl+K leave it.
 */
/** An "open a terminal" request (palette, repo card, panel); `n` makes each one new. */
export interface TerminalOpenRequest {
  n: number
  repoId: string | null
  /** Start this agent CLI in the new tab instead of the shell (P7-C). */
  agent?: AgentLaunch
}

export function TerminalPage({ request }: { request?: TerminalOpenRequest }) {
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
    (repoId: string | null, agent?: AgentLaunch) => {
      const repo = repoId ? repos.find((r) => r.id === repoId) : undefined
      store.open(repo ? { id: repo.id, name: repo.name } : null, agent)
      requestAnimationFrame(() => store.focusActive())
    },
    [repos, store],
  )

  useEffect(() => {
    store.setHooks({
      onFind: () => setFinding(true),
      onLeave: (back) => focusBeside(viewport.current, back),
      onError: (message, details) => toast(message, 'danger', details),
    })
    return () => store.setHooks(null)
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
    if (settings) {
      store.setOptions({ ...settings.terminal, appFontSize: settings.appearance.fontSize })
    }
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
      openIn(request.repoId, request.agent)
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
            <button
              key={t.key}
              type="button"
              role="tab"
              className="terminal-tab"
              id={`terminal-tab-${t.key}`}
              data-key={t.key}
              aria-selected={t.key === active}
              aria-controls="terminal-viewport"
              aria-keyshortcuts="Delete"
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
              {/* A mouse shortcut only: a tablist may hold nothing but tabs, so keyboard and
                  screen-reader users close a tab with Delete or "Close terminal" in the toolbar. */}
              <span
                className="terminal-tab-close"
                aria-hidden="true"
                title={`Close ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void store.close(t.key)
                }}
              >
                <X size={14} />
              </span>
            </button>
          ))}
        </div>
        <div className="terminal-toolbar">
          <Select
            aria-label="Start in"
            options={whereOptions}
            value={whereOptions.some((o) => o.value === where) ? where : HOME}
            onValue={setWhere}
          />
          <Button
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => openIn(where === HOME ? null : where)}
          >
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
            label="Close terminal"
            icon={<X size={16} />}
            disabled={!activeTab}
            onClick={() => {
              if (activeTab) void store.close(activeTab.key)
            }}
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
        Tab and Escape go to the shell. Leave the terminal with F6 (Shift+F6 to go back) or{' '}
        {modLabel('1')}–{modLabel('9')}.
      </p>
    </div>
  )
}
