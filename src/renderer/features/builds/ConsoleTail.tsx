import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import type { BuildRef } from '@shared/jenkins'
import { DevDockError, bridge, unwrap } from '../../lib/devdock'
import { Button } from '../../ui/Button'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Input } from '../../ui/Field'
import { MAX_CONSOLE_CHARS, appendConsole, matchingLines } from './console'

/** Next read while the build is running. */
const POLL_MS = 2_000
/** "At the bottom" within this many pixels: new output keeps it there. */
const STICK_PX = 24

/**
 * SPEC 6.4 console tail: progressive text from the main process (byte offsets), polled while
 * Jenkins says more is coming. Follows new output unless you scroll up; Search filters to the
 * matching lines; Copy copies what is loaded.
 */
export function ConsoleTail({ build: { job, number } }: { build: BuildRef }) {
  const [text, setText] = useState('')
  const [more, setMore] = useState(true)
  /** Some of the start isn't shown (a huge log); line numbers then count from what is. */
  const [trimmed, setTrimmed] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  const toast = useToast()
  const searchId = useId()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let start = 0
    /** Characters received since the last reset (the view keeps at most the limit). */
    let loaded = 0
    const read = async () => {
      try {
        const chunk = await unwrap(bridge.jenkins.console({ job, number, start }))
        if (cancelled) return
        if (chunk.reset) {
          loaded = 0
          setText('')
          setTrimmed(false)
        } else if (chunk.text) {
          loaded += chunk.text.length
          if (chunk.truncated || loaded > MAX_CONSOLE_CHARS) setTrimmed(true)
          setText((t) => appendConsole(t, chunk.text))
        }
        start = chunk.nextStart
        setMore(chunk.more)
        setError(null)
        if (chunk.more) timer = setTimeout(() => void read(), chunk.reset ? 0 : POLL_MS)
      } catch (err) {
        if (cancelled) return
        setError(err)
        // A deleted build won't come back; anything else (network, auth) may: keep trying.
        if (err instanceof DevDockError && err.code === 'NOT_FOUND') setMore(false)
        else timer = setTimeout(() => void read(), POLL_MS * 5)
      }
    }
    void read()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [job, number])

  useEffect(() => {
    const el = pre.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text, query])

  const matches = useMemo(() => matchingLines(text, query), [text, query])
  const searching = query.trim() !== ''

  return (
    <div className="console stack">
      <div className="console-bar">
        <label className="visually-hidden" htmlFor={searchId}>
          Search the console
        </label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search the console"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted" role="status">
          {searching
            ? `${matches.length} matching line${matches.length === 1 ? '' : 's'}`
            : more
              ? 'Following the build…'
              : 'Build finished.'}
        </span>
        <Button
          size="sm"
          icon={<Copy size={14} aria-hidden="true" />}
          disabled={!text}
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast('Console copied'),
              () => toast('Could not copy the console'),
            )
          }
        >
          Copy
        </Button>
      </div>
      <pre
        ref={pre}
        className="activity-log console-log mono"
        role="log"
        aria-live="off"
        aria-label="Console output"
        // A scrollable region must be reachable by keyboard (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
        }}
      >
        {searching
          ? matches.map((m) => `${String(m.n).padStart(5)}  ${m.line}`).join('\n') ||
            'No matching lines.'
          : text || (more ? 'Waiting for output…' : 'No output.')}
      </pre>
      {trimmed ? (
        <p className="muted">
          This log is long: only its last {MAX_CONSOLE_CHARS / 1024 / 1024} MB is shown, and line
          numbers count from there. Open the build in Jenkins for the whole log.
        </p>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  )
}
