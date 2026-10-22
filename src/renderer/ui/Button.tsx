import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: read by screen readers and shown as the tooltip. */
  label: string
  icon: ReactNode
  /** Shown in the tooltip, e.g. "⌘K". */
  shortcut?: string
  variant?: Variant
}

export function IconButton({ label, icon, shortcut, variant = 'ghost', ...rest }: IconButtonProps) {
  return (
    <Tooltip text={label} shortcut={shortcut}>
      <button
        type="button"
        className={`btn btn-${variant} btn-icon`}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  )
}
