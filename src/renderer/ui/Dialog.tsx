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
 * Modal built on <dialog>: showModal() makes the rest of the page inert (focus trap) and
 * Escape closes it.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  actions: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useModal(ref, open)

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
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
