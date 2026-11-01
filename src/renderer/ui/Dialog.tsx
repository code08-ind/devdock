import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { Button } from './Button'

/** Opens/closes a <dialog> as a modal to match `open`. */
export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean): void {
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [ref, open])
}

/**
 * T12: if the focused element inside an open dialog is removed (a step's content replaced),
 * focus would fall to the page behind it and a screen reader would go silent. Put it on the
 * dialog's first enabled button instead.
 */
function useKeepFocusInside(ref: RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onFocusOut = (e: FocusEvent) => {
      // Moving to another element (or out of the window) is fine; only a vanished one isn't.
      if (e.relatedTarget) return
      const lost = e.target as Node
      queueMicrotask(() => {
        if (!d.open || d.contains(lost) || document.activeElement !== document.body) return
        d.querySelector<HTMLElement>('button:not([disabled])')?.focus()
      })
    }
    d.addEventListener('focusout', onFocusOut)
    return () => d.removeEventListener('focusout', onFocusOut)
  }, [ref])
}

/**
 * Modal built on <dialog>: showModal() makes the rest of the page inert (focus trap) and
 * Escape closes it.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  wide = false,
  dismissible = true,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  actions: ReactNode
  /** For dialogs with logs or code (activity log, command lists). */
  wide?: boolean
  /** False while work is in progress: Escape then does nothing. */
  dismissible?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useModal(ref, open)
  useKeepFocusInside(ref)

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault()
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  )
}

/** Confirmation that states exactly what will happen. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
