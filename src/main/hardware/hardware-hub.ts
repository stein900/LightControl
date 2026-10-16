/**
 * Combines several hardware backends behind the single HardwareBackend port
 * used by the engine: devices are merged, commands are routed to the backend
 * that owns the device, and statuses are aggregated.
 */
import { TypedEmitter } from '@main/core/typed-emitter'
import type { DeviceInfo, EngineStatus, IntegrationAction, IntegrationStatus } from '@shared/model'
import type { HardwareBackend, HardwareBackendEvents, LedLoop, ModeOverrides } from './backend'
import type { OpenRgbBackend } from './openrgb/openrgb-backend'

export class HardwareHub implements HardwareBackend {
  readonly events = new TypedEmitter<HardwareBackendEvents>()
  private merged: DeviceInfo[] = []
  private readonly owners = new Map<string, HardwareBackend>()
  private readonly backends: HardwareBackend[]

  constructor(
    private readonly primary: OpenRgbBackend,
    private readonly extras: HardwareBackend[]
  ) {
    this.backends = [primary, ...extras]
    for (const backend of this.backends) {
      backend.events.on('devices', () => this.merge())
      backend.events.on('status', () => this.events.emit('status'))
    }
  }

  /** Status of the main OpenRGB engine. */
  get engineStatus(): EngineStatus {
    return this.primary.status
  }

  /** Status of the secondary channels (iCUE, Lian Li…). */
  get integrations(): IntegrationStatus[] {
    return this.extras.map((backend) => backend.integration)
  }

  get integration(): IntegrationStatus {
    return this.primary.integration
  }

  get devices(): readonly DeviceInfo[] {
    return this.merged
  }

  start(): void {
    for (const backend of this.backends) backend.start()
  }

  async stop(): Promise<void> {
    await Promise.all(this.backends.map((backend) => backend.stop()))
  }

  async restart(): Promise<void> {
    await Promise.all(this.backends.map((backend) => backend.restart()))
  }

  /** Restarts the main engine only; secondary channels keep their sessions. */
  async restartEngine(): Promise<void> {
    await this.primary.restart()
  }

  rescan(): void {
    for (const backend of this.backends) backend.rescan()
  }

  /** Runs an action offered by an integration; resolves null when it is not offered (any more). */
  async runIntegrationAction(id: string, action: IntegrationAction): Promise<boolean | null> {
    const backend = this.backends.find((candidate) => candidate.integration.id === id)
    if (!backend?.runAction || !backend.integration.actions.includes(action)) return null
    return backend.runAction(action)
  }

  enterDirectMode(deviceId: string): void {
    this.owners.get(deviceId)?.enterDirectMode(deviceId)
  }

  writeLeds(deviceId: string, rgb: Uint8Array): boolean {
    return this.owners.get(deviceId)?.writeLeds(deviceId, rgb) ?? false
  }

  writeLoop(deviceId: string, loop: LedLoop): boolean {
    return this.owners.get(deviceId)?.writeLoop(deviceId, loop) ?? false
  }

  applyMode(deviceId: string, modeName: string, overrides: ModeOverrides, persist: boolean): boolean {
    return this.owners.get(deviceId)?.applyMode(deviceId, modeName, overrides, persist) ?? false
  }

  async resizeZone(deviceId: string, zoneIndex: number, size: number): Promise<void> {
    await this.owners.get(deviceId)?.resizeZone(deviceId, zoneIndex, size)
  }

  private merge(): void {
    // A device reachable through a vendor SDK is not duplicated from OpenRGB (e.g. Corsair memory).
    const vendorKinds = new Set(
      this.extras.flatMap((backend) => backend.devices.map((d) => `${d.vendor}|${d.kind}`))
    )
    this.owners.clear()
    this.merged = []
    for (const backend of this.backends) {
      for (const device of backend.devices) {
        if (backend === this.primary && vendorKinds.has(`${device.vendor}|${device.kind}`)) continue
        this.owners.set(device.id, backend)
        this.merged.push(device)
      }
    }
    this.events.emit('devices', this.merged)
  }
}
