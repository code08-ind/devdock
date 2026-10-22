import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Placeholder until P0-C builds the real command palette.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p>Command palette</p>
  </StrictMode>,
)
