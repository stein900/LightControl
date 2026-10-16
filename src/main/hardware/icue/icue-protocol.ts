/** Messages exchanged between the main process and the isolated iCUE host process. */

export type IcueHostRequest =
  | { type: 'start'; dllPath: string }
  /** Packed RGB triplets, in the LED order published with the device. */
  | { type: 'frame'; deviceId: string; rgb: Uint8Array }
  | { type: 'stop' }

export type IcueSessionState = 'connecting' | 'connected' | 'unavailable' | 'error'

export interface IcueLed {
  id: number
  x: number
  y: number
}

export interface IcueDevice {
  /** iCUE device identifier. */
  id: string
  /** CorsairDeviceType bit. */
  type: number
  model: string
  serial: string
  /** Sorted in display order (top to bottom, then left to right). */
  leds: IcueLed[]
}

export type IcueHostEvent =
  | { type: 'state'; state: IcueSessionState; message: string | null }
  | { type: 'devices'; devices: IcueDevice[] }
  | { type: 'frame-done'; deviceId: string; ok: boolean }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
