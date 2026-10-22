import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, TextWrap } from 'lucide-react'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function KeyValue({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt className="muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Mono block with a wrap toggle and a copy button. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }
  return (
    <figure className="code">
      <figcaption className="code-bar">
        <span className="muted">{label}</span>
        <span className="code-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
          >
            <TextWrap size={14} aria-hidden="true" />
            Wrap
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </figcaption>
      <pre className={`code-body mono${wrap ? ' wrap' : ''}`}>{code}</pre>
    </figure>
  )
}
