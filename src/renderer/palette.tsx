import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import './ui/components.css'
import './features/shell/shell.css'
import { PaletteWindow } from './features/palette/PaletteWindow'
import { Providers } from './features/shell/Providers'

createRoot(document.getElementById('root')!).render(
  <Providers>
    <PaletteWindow />
  </Providers>,
)
