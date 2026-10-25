import { ChevronDown } from 'lucide-react'
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

/** Label + control + hint/error. The control receives the generated id via render prop. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <p id={hintId} className="field-hint muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input${props.className ? ` ${props.className}` : ''}`} />
}

export function Textarea({
  mono,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return <textarea {...props} className={`input textarea${mono ? ' mono' : ''}`} />
}

export function Select<T extends string | number>({
  options,
  value,
  onValue,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  options: readonly { value: T; label: string }[]
  value: T
  onValue: (v: T) => void
}) {
  return (
    // The native arrow sits flush against the border on macOS; draw our own inside the field.
    <span className="select-wrap">
      <select
        {...props}
        className="input select"
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value)
          if (picked) onValue(picked.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="select-chevron" size={16} aria-hidden="true" />
    </span>
  )
}

export function Checkbox({
  label,
  checked,
  onChecked,
  disabled,
}: {
  label: string
  checked: boolean
  onChecked: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChecked(e.target.checked)}
      />
      {label}
    </label>
  )
}

/** On/off switch for settings that apply immediately. */
export function Toggle({
  label,
  description,
  checked,
  onChecked,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChecked: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="toggle-row">
      <div>
        <span id={`${id}-label`} className="toggle-label">
          {label}
        </span>
        {description ? (
          <p id={`${id}-desc`} className="muted field-hint">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="toggle"
        disabled={disabled}
        onClick={() => onChecked(!checked)}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-text">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  )
}

/** Radio group styled as segments; arrow keys move between options natively. */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onValue,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onValue: (v: T) => void
}) {
  const name = useId()
  return (
    <fieldset className="segmented">
      <legend className="field-label">{label}</legend>
      <div className="segmented-options">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`segment${o.value === value ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name={name}
              className="visually-hidden"
              checked={o.value === value}
              onChange={() => onValue(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
