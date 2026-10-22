/// <reference types="vite/client" />
import type { DevDockBridge } from '@shared/api'

declare global {
  interface Window {
    readonly devdock: DevDockBridge
  }
}

export {}
