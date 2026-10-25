import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CircleCheck, CircleDashed, CircleX, Info, TriangleAlert, X } from 'lucide-react'
import { DevDockError } from '../lib/devdock'
import { IconButton } from './Button'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE_ICON = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  info: Info,
  neutral: CircleDashed,
} as const

/** Status is never colour alone: always icon + text. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone]
  return (
    <span className={`pill pill-${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  )
}

/** One line + one action. */
export function EmptyState({
  icon,
  title,
  action,
}: {
  icon: ReactNode
  title: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p>{title}</p>
      {action}
    </div>
  )
}

/** What failed and what to do, with the technical part behind "Details". */
export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="notice notice-danger" role="alert">
      <CircleX size={16} aria-hidden="true" />
      <div>
        <p>{message}</p>
        <ErrorDetails error={error} />
      </div>
    </div>
  )
}

/** The technical detail behind an error (command output, HTTP body), folded away. */
export function ErrorDetails({ error }: { error: unknown }) {
  const details = error instanceof DevDockError ? error.details : undefined
  if (!details) return null
  return (
    <details className="error-details">
      <summary>Details</summary>
      <pre className="mono wrap">{details}</pre>
    </details>
  )
}

interface ToastItem {
  id: number
  tone: Tone
  text: string
  details?: string
}

type Push = (text: string, tone?: Tone, details?: string) => void
const ToastContext = createContext<Push>(() => undefined)

export function useToast(): Push {
  return useContext(ToastContext)
}

const TOAST_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback<Push>(
    (text, tone = 'success', details) => {
      const id = next.current++
      setItems((list) => [...list.slice(-3), { id, tone, text, details }])
      // Errors stay until dismissed so there is time to read them and open Details.
      if (tone === 'danger') return
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        dismiss(id)
      }, TOAST_MS)
      timers.current.add(timer)
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <div>
              <StatusPill tone={t.tone}>{t.text}</StatusPill>
              {t.details ? (
                <details className="toast-details">
                  <summary>Details</summary>
                  <pre className="mono wrap">{t.details}</pre>
                </details>
              ) : null}
            </div>
            <IconButton
              label="Dismiss"
              icon={<X size={14} aria-hidden="true" />}
              onClick={() => dismiss(t.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
