/** Messages exchanged between the main process and the isolated Lian Li USB host process. */
import type { WirelessFamily } from './protocol'

export type LianliHostRequest =
  | { type: 'start'; dllPath: string }
  /** Animation for one device, in the LED order published with it; replaces any pending one. */
  | { type: 'upload'; mac: string; frames: Uint8Array[]; intervalMs: number }
  /** Tries to open the dongle now instead of waiting for the next retry. */
  | { type: 'retry' }
  | { type: 'stop' }

export type LianliHostState = 'connecting' | 'connected' | 'unavailable' | 'error'

/** Why the dongle could not be opened: held by another program, or not plugged in. */
export type LianliUnavailableReason = 'busy' | 'absent'

export interface LianliDevice {
  mac: string
  deviceType: number
  family: WirelessFamily
  model: string
  ledCount: number
  ledsPerFan: number
  fanCount: number
}

export type LianliHostEvent =
  | { type: 'state'; state: LianliHostState; message: string | null; reason: LianliUnavailableReason | null }
  /** Devices bound to the dongle, and the number of devices heard that are paired elsewhere or not at all. */
  | { type: 'devices'; devices: LianliDevice[]; unbound: number }
  | { type: 'applied'; mac: string; frames: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
