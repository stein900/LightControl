import type { JsonStore } from '@main/core/json-store'
import { TypedEmitter } from '@main/core/typed-emitter'
import { DEFAULT_DEVICE_LIGHTING } from '@main/lighting/planner'
import { normalizeEffectConfig } from '@shared/effects'
import type {
  ControlMode,
  DeviceInfo,
  DeviceLighting,
  EffectConfig,
  HardwareModeConfig,
  LightingState
} from '@shared/model'
import type { LightingStateSchema } from '@shared/schemas'

export interface LightingStateEvents {
  changed: [state: LightingState]
}

/** Current lighting configuration, persisted continuously and restored on startup. */
export class LightingStateService {
  readonly events = new TypedEmitter<LightingStateEvents>()
  private state: LightingState

  constructor(private readonly store: JsonStore<typeof LightingStateSchema>) {
    this.state = store.load()
  }

  get(): LightingState {
    return this.state
  }

  replace(state: LightingState): void {
    this.commit(structuredClone(state))
  }

  setPower(power: boolean): void {
    this.commit({ ...this.state, power })
  }

  setBrightness(brightness: number): void {
    this.commit({ ...this.state, brightness })
  }

  /**
   * Turning synchronisation on brings every device back into it: "sync all"
   * must never leave a device silently showing something else. Turning it off
   * keeps each device's own settings.
   */
  setSync(sync: boolean): void {
    if (!sync) {
      this.commit({ ...this.state, sync })
      return
    }
    const devices = Object.fromEntries(
      Object.entries(this.state.devices).map(([id, device]) => [id, { ...device, followSync: true }])
    )
    this.commit({ ...this.state, sync, devices })
  }

  setSyncEffect(effect: EffectConfig): void {
    this.commit({ ...this.state, syncEffect: normalizeEffectConfig(effect) })
  }

  /**
   * Assigns an effect to one zone or to every zone of the device. A device that
   * was following the global sync leaves it, keeping its other zones unchanged.
   */
  setZoneEffect(device: DeviceInfo, zoneIndex: number | null, effect: EffectConfig): void {
    const current = this.device(device.id)
    const synced = this.state.sync && current.followSync
    const zones: Record<string, EffectConfig> = { ...current.zones }
    for (const zone of device.zones) {
      const key = String(zone.index)
      if (synced || !zones[key]) zones[key] = this.state.syncEffect
    }
    const normalized = normalizeEffectConfig(effect)
    if (zoneIndex === null) for (const zone of device.zones) zones[String(zone.index)] = normalized
    else zones[String(zoneIndex)] = normalized

    this.updateDevice(device.id, { zones, control: 'software', followSync: false })
  }

  setDeviceControl(deviceId: string, control: ControlMode, defaultMode: HardwareModeConfig | null): void {
    const current = this.device(deviceId)
    this.updateDevice(deviceId, {
      control,
      followSync: false,
      hardware: current.hardware ?? (control === 'hardware' ? defaultMode : null)
    })
  }

  setFollowSync(deviceId: string, followSync: boolean): void {
    this.updateDevice(deviceId, { followSync })
  }

  setHardwareMode(deviceId: string, mode: HardwareModeConfig): void {
    this.updateDevice(deviceId, { hardware: mode, control: 'hardware', followSync: false })
  }

  flush(): void {
    this.store.flush()
  }

  private device(deviceId: string): DeviceLighting {
    return this.state.devices[deviceId] ?? DEFAULT_DEVICE_LIGHTING
  }

  private updateDevice(deviceId: string, patch: Partial<DeviceLighting>): void {
    const devices = { ...this.state.devices, [deviceId]: { ...this.device(deviceId), ...patch } }
    this.commit({ ...this.state, devices })
  }

  private commit(state: LightingState): void {
    this.state = state
    this.store.save(state)
    this.events.emit('changed', state)
  }
}
