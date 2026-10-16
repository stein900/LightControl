/**
 * Live LED colors, kept outside React state: previews subscribe imperatively
 * and repaint their canvas without re-rendering the component tree.
 */
import type { DeviceFrame } from '@shared/model'

type Listener = () => void

const frames = new Map<string, Uint8Array>()
const listeners = new Set<Listener>()

export const frameStore = {
  get(deviceId: string): Uint8Array | undefined {
    return frames.get(deviceId)
  },
  set(next: DeviceFrame[]): void {
    frames.clear()
    for (const frame of next) frames.set(frame.deviceId, frame.colors)
    for (const listener of listeners) listener()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
