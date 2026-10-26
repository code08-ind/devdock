import { StrictMode, useLayoutEffect, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, useMainEvents, useSettings } from '../../lib/devdock'
import { applyAccessibility, applyAppearance } from '../../ui/appearance'
import { ErrorNotice, ToastProvider } from '../../ui/Feedback'

/** Applies theme/font/density and accessibility before paint and keeps them live across windows. */
function AppearanceSync({ children }: { children: ReactNode }) {
  useMainEvents()
  const { data, error } = useSettings()
  const appearance = data?.appearance
  const accessibility = data?.accessibility
  useLayoutEffect(() => {
    if (appearance) applyAppearance(appearance)
  }, [appearance])
  useLayoutEffect(() => {
    if (accessibility) applyAccessibility(accessibility)
  }, [accessibility])
  if (error) {
    return (
      <div className="boot-error">
        <ErrorNotice error={error} />
        <p className="muted">Restart DevDock. If this keeps happening, check the logs folder.</p>
      </div>
    )
  }
  // Render nothing until settings arrive (one local IPC call) so there is no theme flash.
  return appearance ? children : null
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AppearanceSync>{children}</AppearanceSync>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
