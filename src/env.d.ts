import type { GewuApi } from './shared/ipc'

declare global {
  interface Window {
    gewu: GewuApi
  }
}

export {}
