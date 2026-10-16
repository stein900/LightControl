import type { JsonStore } from '@main/core/json-store'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { DeviceSettings, WhiteBalance } from '@shared/model'
import type { DeviceSettingsMapSchema } from '@shared/schemas'

export interface DeviceSettingsEvents {
  changed: [deviceId: string]
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = Object.freeze({
  alias: null,
  zoneAliases: {},
  zoneSizes: {},
  whiteBalance: { r: 100, g: 100, b: 100 }
})

/** Per-device hardware configuration that does not change between profiles. */
export class DeviceSettingsService {
  readonly events = new TypedEmitter<DeviceSettingsEvents>()
  private settings: Record<string, DeviceSettings>

  constructor(private readonly store: JsonStore<typeof DeviceSettingsMapSchema>) {
    this.settings = store.load()
  }

  all(): Record<string, DeviceSettings> {
    return this.settings
  }

  get(deviceId: string): DeviceSettings {
    return this.settings[deviceId] ?? DEFAULT_DEVICE_SETTINGS
  }

  setWhiteBalance(deviceId: string, whiteBalance: WhiteBalance): void {
    this.patch(deviceId, { whiteBalance })
  }

  setZoneSize(deviceId: string, zoneIndex: number, size: number): void {
    const current = this.get(deviceId)
    this.patch(deviceId, { zoneSizes: { ...current.zoneSizes, [String(zoneIndex)]: size } })
  }

  setAlias(deviceId: string, zoneIndex: number | null, alias: string): void {
    const value = alias.trim()
    const current = this.get(deviceId)
    if (zoneIndex === null) {
      this.patch(deviceId, { alias: value || null })
      return
    }
    const zoneAliases = { ...current.zoneAliases }
    if (value) zoneAliases[String(zoneIndex)] = value
    else delete zoneAliases[String(zoneIndex)]
    this.patch(deviceId, { zoneAliases })
  }

  flush(): void {
    this.store.flush()
  }

  private patch(deviceId: string, patch: Partial<DeviceSettings>): void {
    this.settings = { ...this.settings, [deviceId]: { ...this.get(deviceId), ...patch } }
    this.store.save(this.settings)
    this.events.emit('changed', deviceId)
  }
}
