import type { LightControlApi } from '../shared/ipc'

declare global {
  interface Window {
    lightcontrol: LightControlApi
  }
}

export {}
