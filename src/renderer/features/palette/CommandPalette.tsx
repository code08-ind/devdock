import { useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Kbd } from '../../ui/Text'
import { filterCommands, type Command } from './commands'

/** No commands from the query (the default). */
const NONE = () => []

/**
 * Searchable command list (combobox + listbox). Used as an overlay in the main window
 * (Cmd/Ctrl+K) and as the whole page of the palette window (global shortcut).
 */
export function CommandPalette({
  commands,
  forQuery = NONE,
  onClose,
}: {
  commands: readonly Command[]
  /** Commands built from the typed text, listed first (e.g. `watch <link>`). */
  forQuery?: (query: string) => Command[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const deferred = useDeferredValue(query)
  const results = [...forQuery(deferred), ...filterCommands(commands, deferred)]
  const current = Math.min(active, Math.max(results.length - 1, 0))

  // Callers remount (via `key`) to reset; focus the search box on every mount.
  useEffect(() => {
    input.current?.focus()
  }, [])

  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    void c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((current + 1) % Math.max(results.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((current - 1 + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const optionId = (i: number) => `${listId}-${i}`

  return (
    <div className="palette" data-testid="command-palette">
      <div className="palette-search">
        <Search size={16} aria-hidden="true" className="muted" />
        <input
          ref={input}
          className="palette-input"
          placeholder="Type a command"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Commands" className="palette-list">
        {results.length === 0 ? (
          <li className="palette-empty muted" role="presentation">
            No command matches “{deferred}”.
          </li>
        ) : (
          results.map((c, i) => (
            // Keyboard interaction lives on the combobox input (aria-activedescendant).
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={`palette-item${i === current ? ' is-active' : ''}`}
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => run(c)}
            >
              <span>{c.title}</span>
              <span className="palette-meta">
                {c.shortcut ? <Kbd>{c.shortcut}</Kbd> : null}
                {c.group === 'Go to' ? null : <span className="muted">{c.group}</span>}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
