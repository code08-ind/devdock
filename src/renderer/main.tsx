import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import './ui/components.css'
import './features/shell/shell.css'
import './ui/surfaces.css'
import { App } from './features/shell/App'
import { Providers } from './features/shell/Providers'

createRoot(document.getElementById('root')!).render(
  <Providers>
    <App />
  </Providers>,
)
