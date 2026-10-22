import { useCallback, useState } from 'react'
import { useToast } from '../ui/Feedback'
import { DevDockError } from './devdock'

export type ActionResult<T> = { ok: true; value: T } | { ok: false }

/**
 * Runs an async action: tracks progress, then shows a result toast (UI-THEMES "Copy and
 * feedback"). Failures toast the human-readable message with the details behind "Details".
 */
export function useAction() {
  const toast = useToast()
  const [pending, setPending] = useState(false)
  const run = useCallback(
    async <T>(action: Promise<T>, done?: string): Promise<ActionResult<T>> => {
      setPending(true)
      try {
        const value = await action
        if (done) toast(done)
        return { ok: true, value }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast(message, 'danger', err instanceof DevDockError ? err.details : undefined)
        return { ok: false }
      } finally {
        setPending(false)
      }
    },
    [toast],
  )
  return { run, pending }
}
