import type { LightControlApi } from '@shared/ipc'

export const api: LightControlApi = window.lightcontrol

/** Strips Electron's "Error invoking remote method" prefix from IPC errors. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}
