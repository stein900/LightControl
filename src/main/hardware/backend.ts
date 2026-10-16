/**
 * Port between the lighting engine and a hardware access technology. OpenRGB,
 * the Corsair iCUE SDK and the Lian Li wireless dongle each implement it; the
 * hub combines them, so the engine and the services never depend on a
 * specific technology.
 */
import type { TypedEmitter } from '@main/core/typed-emitter'
import type { Rgb } from '@shared/color'
import type { ColorMode, DeviceInfo, IntegrationAction, IntegrationStatus } from '@shared/model'

/** User settings for a hardware mode; speed and brightness are percentages. */
export interface ModeOverrides {
  speed: number | null
  brightness: number | null
  direction: number | null
  colorMode: ColorMode | null
  colors: Rgb[]
}

/** Pre-rendered animation that a `loop` delivery device plays on its own, repeating it seamlessly. */
export interface LedLoop {
  /** Packed RGB triplets, one array per frame; a single frame is a still image. */
  frames: Uint8Array[]
  intervalMs: number
}

export interface HardwareBackendEvents {
  /** The backend status changed; read it from `integration` (or a richer backend-specific getter). */
  status: []
  devices: [devices: DeviceInfo[]]
}

export interface HardwareBackend {
  readonly events: TypedEmitter<HardwareBackendEvents>
  readonly devices: readonly DeviceInfo[]
  readonly integration: IntegrationStatus

  start(): void
  stop(): Promise<void>
  restart(): Promise<void>
  rescan(): void

  /** Switches the device to its per-LED (direct/custom) mode. */
  enterDirectMode(deviceId: string): void
  /** Sends one frame of packed RGB triplets. Returns false when the frame was dropped. */
  writeLeds(deviceId: string, rgb: Uint8Array): boolean
  /** Hands a looping animation to a `loop` delivery device. Returns false when it cannot be queued. */
  writeLoop(deviceId: string, loop: LedLoop): boolean
  /** Activates a hardware mode by name; `persist` stores it in the device memory when supported. */
  applyMode(deviceId: string, modeName: string, overrides: ModeOverrides, persist: boolean): boolean
  resizeZone(deviceId: string, zoneIndex: number, size: number): Promise<void>
  /** Runs one of the actions listed in `integration.actions`; resolves false when it did not complete. */
  runAction?(action: IntegrationAction): Promise<boolean>
}
