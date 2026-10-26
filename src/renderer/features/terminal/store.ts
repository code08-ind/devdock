/**
 * The window's terminal tabs, kept outside React so they survive switching views: each tab owns
 * an xterm.js Terminal and the element it draws into; the Terminal view only moves those
 * elements in and out of its viewport. The PTY behind each tab lives in main (P7-A).
 */
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  MAX_WRITE,
  TERMINAL_FONT_STACK,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  type TerminalSettings,
} from '@shared/terminal'
import { bridge, DevDockError, unwrap } from '../../lib/devdock'
import { hasMod, isMac } from '../../lib/keyboard'
import { installStyleShim } from './styleShim'
import { currentPalette } from './theme'

export interface TerminalTab {
  /** Local key (stable from the moment the tab appears, before main has a session id). */
  key: string
  /** Main's session id, once the shell has started. */
  id: string | null
  title: string
  repoId: string | null
  shell: string
  status: 'starting' | 'running' | 'exited' | 'failed'
  exitCode: number | null
  error: DevDockError | null
}

export interface TerminalHooks {
  /** Mod+F in a terminal: show the find bar. */
  onFind: () => void
  /** F6 / Shift+F6 in a terminal: move focus out (the terminal keeps Tab for the shell). */
  onLeave: (back: boolean) => void
  /** A link the allowlist refused, or a copy that failed. */
  onError: (message: string, details?: string) => void
}

type Listener = () => void

/** Leaves these to DevDock even while the terminal has focus: views, palette, Settings. */
function isAppShortcut(e: KeyboardEvent): boolean {
  if (!hasMod(e) || e.altKey) return false
  const k = e.key.toLowerCase()
  return !e.shiftKey && (k === 'k' || k === ',' || /^[1-9]$/.test(k))
}

class TerminalSession {
  readonly term: Terminal
  readonly fit = new FitAddon()
  readonly search = new SearchAddon()
  readonly element: HTMLDivElement
  private opened = false
  private disposed = false
  private pending: string[] = []

  constructor(
    readonly tab: TerminalTab,
    private readonly store: TerminalStore,
    options: TerminalSettings,
  ) {
    this.element = document.createElement('div')
    this.element.className = 'terminal-screen'
    this.element.dataset.terminal = tab.key
    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: TERMINAL_FONT_STACK,
      fontSize: options.fontSize,
      cursorStyle: options.cursorStyle,
      cursorBlink: options.cursorBlink,
      scrollback: options.scrollback,
      theme: currentPalette() as ITheme,
      // ⌥ types special characters on macOS keyboards (like Terminal.app's default).
      macOptionIsMeta: false,
      rightClickSelectsWord: isMac,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    // Links open in the browser through main, which checks the link allowlist (SPEC 5).
    this.term.loadAddon(
      new WebLinksAddon((_event, url) => {
        unwrap(bridge.app.openExternal({ url })).catch((err: unknown) =>
          store.hooks?.onError(
            err instanceof Error ? err.message : "DevDock couldn't open that link.",
          ),
        )
      }),
    )
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e))
    this.term.onData((data) => this.send(data))
    this.term.onBinary((data) => this.send(data))
    this.term.onResize(({ cols, rows }) => {
      if (this.tab.id && this.tab.status === 'running') {
        void bridge.terminal.resize({ id: this.tab.id, cols, rows })
      }
    })
  }

  /** Puts the terminal on screen; the shell starts the first time (it needs the size). */
  mount(parent: HTMLElement): void {
    if (this.element.parentElement !== parent) parent.appendChild(this.element)
    if (!this.opened) {
      this.opened = true
      this.term.open(this.element)
      try {
        const webgl = new WebglAddon()
        // A lost GPU context falls back to xterm's DOM renderer.
        webgl.onContextLoss(() => webgl.dispose())
        this.term.loadAddon(webgl)
      } catch {
        // No WebGL here: the DOM renderer draws instead.
      }
      this.fitNow()
      void this.start()
    }
  }

  /** Fits the terminal to its element (only when shown: a hidden one measures 0×0). */
  fitNow(): void {
    if (!this.opened || this.element.hidden || this.element.clientWidth === 0) return
    try {
      this.fit.fit()
    } catch {
      // Not measurable yet.
    }
  }

  private async start(): Promise<void> {
    const { cols, rows } = this.term
    try {
      const session = await unwrap(bridge.terminal.create({ repoId: this.tab.repoId, cols, rows }))
      if (this.disposed) {
        void bridge.terminal.kill({ id: session.id })
        return
      }
      this.store.update(this.tab.key, {
        id: session.id,
        title: session.title,
        shell: session.shell,
        status: 'running',
      })
      this.store.bind(session.id, this)
      // Keys typed while the shell was starting.
      const typed = this.pending.join('')
      this.pending = []
      if (typed) this.send(typed)
      // The size may have changed while it started.
      this.fitNow()
      if (this.term.cols !== cols || this.term.rows !== rows) {
        void bridge.terminal.resize({ id: session.id, cols: this.term.cols, rows: this.term.rows })
      }
    } catch (err) {
      const error =
        err instanceof DevDockError
          ? err
          : new DevDockError('INTERNAL', "DevDock couldn't start the terminal.", String(err))
      this.store.update(this.tab.key, { status: 'failed', error })
      this.term.write(`\x1b[31m${error.message}\x1b[0m\r\n`)
    }
  }

  private send(data: string): void {
    const { id, status } = this.tab
    if (status === 'starting') {
      this.pending.push(data)
      return
    }
    if (!id || status !== 'running') return
    // Large pastes go in chunks the IPC contract accepts, in order.
    for (let i = 0; i < data.length; i += MAX_WRITE) {
      void bridge.terminal.write({ id, data: data.slice(i, i + MAX_WRITE) })
    }
  }

  private onKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true
    if (isAppShortcut(e)) return false
    const k = e.key.toLowerCase()
    if (k === 'f6' && !hasMod(e) && !e.altKey) {
      e.preventDefault()
      this.store.hooks?.onLeave(e.shiftKey)
      return false
    }
    if (hasMod(e) && !e.altKey && !e.shiftKey && k === 'f') {
      e.preventDefault()
      this.store.hooks?.onFind()
      return false
    }
    // Copy when something is selected; with nothing selected, Ctrl+C (Windows) is SIGINT.
    if (hasMod(e) && !e.altKey && k === 'c' && this.term.hasSelection()) {
      this.copySelection()
      e.preventDefault()
      return false
    }
    // Paste: let the browser fire its paste event, which xterm turns into (bracketed) input.
    if (hasMod(e) && !e.altKey && k === 'v') return false
    return true
  }

  copySelection(): void {
    const text = this.term.getSelection()
    if (!text) return
    navigator.clipboard
      .writeText(text)
      .catch(() => this.store.hooks?.onError("DevDock couldn't copy to the clipboard."))
  }

  output(data: string): void {
    this.term.write(data)
  }

  exited(e: TerminalExitEvent): void {
    this.store.update(this.tab.key, { status: 'exited', exitCode: e.exitCode })
    this.term.write(
      `\r\n\x1b[2m[Process exited with code ${e.exitCode}. Close this tab or open a new one.]\x1b[0m\r\n`,
    )
  }

  setOptions(o: TerminalSettings): void {
    this.term.options.fontSize = o.fontSize
    this.term.options.cursorStyle = o.cursorStyle
    this.term.options.cursorBlink = o.cursorBlink
    this.term.options.scrollback = o.scrollback
    this.fitNow()
  }

  setTheme(theme: ITheme): void {
    this.term.options.theme = theme
  }

  dispose(): void {
    this.disposed = true
    this.term.dispose()
    this.element.remove()
  }
}

/** All terminal tabs of this window. */
export class TerminalStore {
  private tabs: TerminalTab[] = []
  private active: string | null = null
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly byId = new Map<string, TerminalSession>()
  /** Output for a session id that isn't bound yet (it raced the create reply). */
  private readonly early = new Map<string, string[]>()
  private readonly listeners = new Set<Listener>()
  private viewport: HTMLElement | null = null
  private next = 1
  private options: TerminalSettings | null = null
  hooks: TerminalHooks | null = null
  private snapshot: { tabs: TerminalTab[]; active: string | null } = { tabs: [], active: null }

  constructor() {
    bridge.on('terminal:output', (e) => this.onOutput(e as TerminalOutputEvent))
    bridge.on('terminal:exit', (e) => this.onExit(e as TerminalExitEvent))
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snapshot

  private changed(): void {
    this.snapshot = { tabs: this.tabs.map((t) => ({ ...t })), active: this.active }
    for (const l of this.listeners) l()
  }

  update(key: string, patch: Partial<TerminalTab>): void {
    const tab = this.tabs.find((t) => t.key === key)
    if (!tab) return
    Object.assign(tab, patch)
    this.changed()
  }

  bind(id: string, s: TerminalSession): void {
    this.byId.set(id, s)
    const early = this.early.get(id)
    this.early.delete(id)
    if (early) for (const d of early) s.output(d)
  }

  private onOutput(e: TerminalOutputEvent): void {
    const s = this.byId.get(e.id)
    if (s) {
      s.output(e.data)
      return
    }
    const list = this.early.get(e.id) ?? []
    list.push(e.data)
    this.early.set(e.id, list)
  }

  private onExit(e: TerminalExitEvent): void {
    this.byId.get(e.id)?.exited(e)
  }

  /** The Terminal view's callbacks (find bar, leaving with F6, errors); null when it goes away. */
  setHooks(hooks: TerminalHooks | null): void {
    this.hooks = hooks
  }

  /** Opens a tab (in a registered repo, or the home folder) and shows it. */
  open(repo: { id: string; name: string } | null): string {
    installStyleShim()
    const key = `k${this.next++}`
    const tab: TerminalTab = {
      key,
      id: null,
      title: repo?.name ?? 'Home',
      repoId: repo?.id ?? null,
      shell: '',
      status: 'starting',
      exitCode: null,
      error: null,
    }
    this.tabs.push(tab)
    const session = new TerminalSession(tab, this, this.options ?? DEFAULT_OPTIONS)
    this.sessions.set(key, session)
    this.select(key)
    return key
  }

  select(key: string): void {
    if (!this.sessions.has(key)) return
    this.active = key
    this.layout()
    this.changed()
  }

  /** Closes a tab: main stops its shell (and what it started). */
  async close(key: string): Promise<void> {
    const s = this.sessions.get(key)
    if (!s) return
    const index = this.tabs.findIndex((t) => t.key === key)
    this.tabs.splice(index, 1)
    this.sessions.delete(key)
    const id = s.tab.id
    if (id) this.byId.delete(id)
    s.dispose()
    if (this.active === key) {
      const neighbour = this.tabs[Math.min(index, this.tabs.length - 1)]
      this.active = neighbour?.key ?? null
    }
    this.layout()
    this.changed()
    if (id) await unwrap(bridge.terminal.kill({ id })).catch(() => undefined)
  }

  /** The Terminal view's viewport (null when the view goes away; the tabs stay). */
  setViewport(el: HTMLElement | null): void {
    this.viewport = el
    if (!el) {
      for (const s of this.sessions.values()) s.element.remove()
      return
    }
    this.layout()
  }

  /** Shows the active tab's screen, hides the rest, and fits it. */
  layout(): void {
    const viewport = this.viewport
    if (!viewport) return
    for (const [key, s] of this.sessions) {
      s.element.hidden = key !== this.active
      s.mount(viewport)
    }
    this.fitActive()
  }

  fitActive(): void {
    if (this.active) this.sessions.get(this.active)?.fitNow()
  }

  focusActive(): void {
    if (this.active) this.sessions.get(this.active)?.term.focus()
  }

  activeSession(): TerminalSession | undefined {
    return this.active ? this.sessions.get(this.active) : undefined
  }

  /** Settings → Terminal changed. */
  setOptions(o: TerminalSettings): void {
    this.options = o
    for (const s of this.sessions.values()) s.setOptions(o)
  }

  /** The DevDock theme changed (or the OS scheme, for System). */
  refreshTheme(): void {
    const theme = currentPalette() as ITheme
    for (const s of this.sessions.values()) s.setTheme(theme)
  }

  /** e2e hook: the visible text of a tab's buffer (scrollback included), trimmed lines. */
  text(key?: string): string {
    const s = this.sessions.get(key ?? this.active ?? '')
    if (!s) return ''
    const buffer = s.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    }
    return lines.join('\n').trimEnd()
  }
}

const DEFAULT_OPTIONS: TerminalSettings = {
  shell: '',
  fontSize: 13,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  devdockPrompt: false,
}

let store: TerminalStore | null = null

/** The window's one store, made on first use (the main window only). */
export function terminalStore(): TerminalStore {
  if (!store) {
    store = new TerminalStore()
    if (new URLSearchParams(location.search).get('e2e') === '1') {
      Object.assign(window, { __devdockTerminal: { text: (key?: string) => store?.text(key) } })
    }
  }
  return store
}
