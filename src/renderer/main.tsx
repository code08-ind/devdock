import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

// Placeholder shell until P0-C: proves the preload bridge and IPC round trip work.
function App() {
  const [info, setInfo] = useState<string>('Loading…')
  useEffect(() => {
    void window.devdock.app.info().then((r) => {
      setInfo(r.ok ? JSON.stringify(r.data, null, 2) : r.error.message)
    })
  }, [])
  return (
    <main>
      <h1>DevDock</h1>
      <pre data-testid="app-info">{info}</pre>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
