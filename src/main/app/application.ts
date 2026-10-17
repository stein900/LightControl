/**
 * Composition root and application façade. Owns every service, keeps the
 * engine in sync with state changes and exposes the commands used by IPC.
 * Electron-specific concerns are injected through `SystemIntegration`.
 */
import { JsonStore } from '@main/core/json-store'
import type { FileLogger, Logger } from '@main/core/logger'
import { TypedEmitter } from '@main/core/typed-emitter'
import { HardwareHub } from '@main/hardware/hardware-hub'
import { IcueBackend } from '@main/hardware/icue/icue-backend'
import { LianliBackend } from '@main/hardware/lianli/lianli-backend'
import { OpenRgbBackend } from '@main/hardware/openrgb/openrgb-backend'
import { executableCandidates } from '@main/hardware/openrgb/server-process'
import { LightingEngine } from '@main/lighting/lighting-engine'
import { planDevice, type DevicePlan, type Overlay } from '@main/lighting/planner'
import { DeviceSettingsService } from '@main/services/device-settings-service'
import { DiagnosticsService } from '@main/services/diagnostics-service'
import { LightingStateService } from '@main/services/lighting-state-service'
import { ProfileService } from '@main/services/profile-service'
import { SettingsService } from '@main/services/settings-service'
import {
  handBackToLConnect,
  lconnectPairedDevices,
  lconnectState,
  takeOverFromLConnect
} from '@main/system/lconnect'
import { WHITE } from '@shared/color'
import { DEFAULT_HEADER_LEDS } from '@shared/hardware'
import type {
  AppSettings,
  AppSnapshot,
  ControlMode,
  DeviceFrame,
  DeviceInfo,
  EffectConfig,
  HardwareModeConfig,
  IntegrationAction,
  OverlayInfo,
  SettingsPatch,
  Theme,
  WhiteBalance
} from '@shared/model'
import {
  AppSettingsSchema,
  DeviceSettingsMapSchema,
  LianliPairingSchema,
  LightingStateSchema,
  ProfileStoreSchema
} from '@shared/schemas'
import { join } from 'node:path'

export interface AppPaths {
  userData: string
  logs: string
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  /** Directory of the built main-process scripts (out/main). */
  mainDirectory: string
}

export interface SystemIntegration {
  setTheme(theme: Theme): void
  setLaunchAtLogin(enabled: boolean): void
}

export interface ApplicationEvents {
  snapshot: [snapshot: AppSnapshot]
}

export class UserFacingError extends Error {
  override readonly name = 'UserFacingError'
}

const SNAPSHOT_DEBOUNCE_MS = 16
const IDENTIFY_DURATION_MS = 4000
const LED_COUNT_DURATION_MS = 8000
const WHITE_TEST_DURATION_MS = 120_000
const DIAGNOSTICS_DELAY_MS = 2500

export class Application {
  readonly events = new TypedEmitter<ApplicationEvents>()
  readonly settings: SettingsService
  private readonly deviceSettings: DeviceSettingsService
  private readonly lighting: LightingStateService
  private readonly profiles: ProfileService
  private readonly diagnostics: DiagnosticsService
  private readonly hub: HardwareHub
  private readonly engine: LightingEngine
  private readonly logger: Logger
  private overlay: { info: OverlayInfo; timer: NodeJS.Timeout } | null = null
  private snapshotTimer: NodeJS.Timeout | null = null
  private diagnosticsTimer: NodeJS.Timeout | null = null
  private readonly resizeAttempts = new Map<string, number>()

  constructor(
    private readonly version: string,
    paths: AppPaths,
    fileLogger: FileLogger,
    private readonly system: SystemIntegration
  ) {
    this.logger = fileLogger.scope('app')
    const store = (name: string) => join(paths.userData, name)
    const storeLogger = fileLogger.scope('store')

    this.settings = new SettingsService(
      new JsonStore(store('settings.json'), AppSettingsSchema, () => AppSettingsSchema.parse({}), storeLogger)
    )
    this.deviceSettings = new DeviceSettingsService(
      new JsonStore(store('devices.json'), DeviceSettingsMapSchema, () => ({}), storeLogger)
    )
    this.lighting = new LightingStateService(
      new JsonStore(
        store('lighting.json'),
        LightingStateSchema,
        () => LightingStateSchema.parse({}),
        storeLogger
      )
    )
    this.profiles = new ProfileService(
      new JsonStore(
        store('profiles.json'),
        ProfileStoreSchema,
        () => ProfileStoreSchema.parse({}),
        storeLogger
      )
    )
    this.diagnostics = new DiagnosticsService(paths.logs, fileLogger.scope('diagnostics'))

    const openRgb = new OpenRgbBackend({
      settings: () => this.settings.get().engine,
      executableCandidates: () =>
        executableCandidates({
          customPath: this.settings.get().engine.executablePath,
          isPackaged: paths.isPackaged,
          resourcesPath: paths.resourcesPath,
          appPath: paths.appPath
        }),
      configDirectory: join(paths.userData, 'openrgb'),
      logger: fileLogger.scope('openrgb')
    })
    const icue = new IcueBackend({
      dllPath: paths.isPackaged
        ? join(paths.resourcesPath, 'icuesdk', 'iCUESDK.x64_2019.dll')
        : join(paths.appPath, 'vendor', 'icuesdk', 'iCUESDK.x64_2019.dll'),
      hostScript: join(paths.mainDirectory, 'icue-host.js'),
      logger: fileLogger.scope('icue')
    })
    const pairingStore = new JsonStore(
      store('lianli.json'),
      LianliPairingSchema,
      () => LianliPairingSchema.parse({}),
      storeLogger
    )
    const lianli = new LianliBackend({
      // The OpenRGB engine ships libusb; the Lian Li dongles use the WinUSB driver it talks to.
      dllPath: paths.isPackaged
        ? join(paths.resourcesPath, 'openrgb', 'libusb-1.0.dll')
        : join(paths.appPath, 'vendor', 'openrgb', 'libusb-1.0.dll'),
      hostScript: join(paths.mainDirectory, 'lianli-host.js'),
      owner: {
        name: 'L-Connect 3',
        state: lconnectState,
        pairedDevices: lconnectPairedDevices,
        takeOver: takeOverFromLConnect,
        handBack: handBackToLConnect
      },
      pairing: {
        load: () => pairingStore.load().paired,
        save: (paired) => pairingStore.save({ paired })
      },
      logger: fileLogger.scope('lianli')
    })
    this.hub = new HardwareHub(openRgb, [icue, lianli])
    this.engine = new LightingEngine(
      this.hub,
      () => this.settings.get().frameRate,
      fileLogger.scope('engine')
    )
  }

  start(): void {
    const settings = this.settings.get()
    this.system.setTheme(settings.theme)
    // Re-applied at every start, so an installed copy registers itself even if the option was set elsewhere.
    this.system.setLaunchAtLogin(settings.launchAtLogin)

    this.hub.events.on('status', () => this.scheduleSnapshot())
    this.hub.events.on('devices', (devices) => {
      this.ensureZoneSizes(devices)
      // A refreshed device list may come from re-created controllers (rescan, reconnection) that
      // are back in their default mode: re-initialise every device instead of trusting old state.
      this.engine.reset()
      this.replan()
      this.scheduleDiagnostics()
    })
    this.lighting.events.on('changed', () => this.replan())
    this.deviceSettings.events.on('changed', () => this.replan())
    this.profiles.events.on('changed', () => this.scheduleSnapshot())
    this.settings.events.on('changed', (next, previous) => this.onSettingsChanged(next, previous))

    this.hub.start()
    this.scheduleDiagnostics()
  }

  async shutdown(): Promise<void> {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
    if (this.diagnosticsTimer) clearTimeout(this.diagnosticsTimer)
    if (this.overlay) clearTimeout(this.overlay.timer)
    this.settings.flush()
    this.deviceSettings.flush()
    this.lighting.flush()
    this.profiles.flush()
    this.engine.dispose()
    await this.hub.stop()
  }

  snapshot(): AppSnapshot {
    const activeProfileId = this.profiles.activeProfileId
    let activeProfileModified = false
    if (activeProfileId) {
      try {
        activeProfileModified =
          JSON.stringify(this.profiles.get(activeProfileId).lighting) !== JSON.stringify(this.lighting.get())
      } catch {
        activeProfileModified = false
      }
    }
    return {
      version: this.version,
      engine: this.hub.engineStatus,
      integrations: this.hub.integrations,
      devices: [...this.hub.devices],
      lighting: this.lighting.get(),
      deviceSettings: this.deviceSettings.all(),
      profiles: this.profiles.summaries(),
      activeProfileId,
      activeProfileModified,
      settings: this.settings.get(),
      diagnostics: this.diagnostics.current,
      overlay: this.overlay?.info ?? null
    }
  }

  frames(): DeviceFrame[] {
    return this.engine.frames()
  }

  /* ------------------------------- Lighting ------------------------------- */

  setPower(on: boolean): void {
    this.lighting.setPower(on)
  }

  setBrightness(value: number): void {
    this.lighting.setBrightness(value)
  }

  setSync(enabled: boolean): void {
    this.lighting.setSync(enabled)
  }

  setSyncEffect(effect: EffectConfig): void {
    this.lighting.setSyncEffect(effect)
  }

  setZoneEffect(deviceId: string, zoneIndex: number | null, effect: EffectConfig): void {
    const device = this.requireDevice(deviceId)
    if (zoneIndex !== null && !device.zones[zoneIndex]) throw new UserFacingError('Cette zone n’existe plus.')
    this.lighting.setZoneEffect(device, zoneIndex, effect)
  }

  setDeviceControl(deviceId: string, control: ControlMode): void {
    const device = this.requireDevice(deviceId)
    if (control === 'hardware' && !device.modes.some((mode) => mode.name.toLowerCase() !== 'direct')) {
      throw new UserFacingError('Cet appareil ne propose pas de mode matériel.')
    }
    this.lighting.setDeviceControl(deviceId, control, defaultHardwareMode(device))
  }

  setFollowSync(deviceId: string, followSync: boolean): void {
    this.requireDevice(deviceId)
    this.lighting.setFollowSync(deviceId, followSync)
  }

  setHardwareMode(deviceId: string, mode: HardwareModeConfig, persist: boolean): void {
    const device = this.requireDevice(deviceId)
    if (!device.modes.some((candidate) => candidate.name === mode.modeName)) {
      throw new UserFacingError(`Le mode « ${mode.modeName} » n’existe pas sur cet appareil.`)
    }
    this.lighting.setHardwareMode(deviceId, mode)
    if (persist && !this.engine.persistHardwareMode(deviceId)) {
      throw new UserFacingError('Le mode n’a pas pu être enregistré dans l’appareil.')
    }
  }

  identify(deviceId: string, zoneIndex: number | null): void {
    this.requireDevice(deviceId)
    this.setOverlay({ kind: 'identify', deviceId, zoneIndex }, IDENTIFY_DURATION_MS)
  }

  /* -------------------------------- Devices ------------------------------- */

  setWhiteBalance(deviceId: string, whiteBalance: WhiteBalance): void {
    this.deviceSettings.setWhiteBalance(deviceId, whiteBalance)
  }

  setWhiteTest(deviceId: string, enabled: boolean): void {
    this.requireDevice(deviceId)
    if (enabled) this.setOverlay({ kind: 'white-test', deviceId, zoneIndex: null }, WHITE_TEST_DURATION_MS)
    else if (this.overlay?.info.kind === 'white-test' && this.overlay.info.deviceId === deviceId)
      this.clearOverlay()
  }

  async setZoneSize(deviceId: string, zoneIndex: number, size: number): Promise<void> {
    const device = this.requireDevice(deviceId)
    const zone = device.zones[zoneIndex]
    if (!zone?.resizable) throw new UserFacingError('Cette zone n’a pas de taille configurable.')
    // At least one LED: a header sized to 0 receives no data, use the "Éteint" effect instead.
    const clamped = Math.min(zone.ledsMax, Math.max(1, zone.ledsMin, size))
    this.deviceSettings.setZoneSize(deviceId, zoneIndex, clamped)
    await this.hub.resizeZone(deviceId, zoneIndex, clamped)
    if (clamped > 0) this.setOverlay({ kind: 'led-count', deviceId, zoneIndex }, LED_COUNT_DURATION_MS)
  }

  setAlias(deviceId: string, zoneIndex: number | null, alias: string): void {
    this.deviceSettings.setAlias(deviceId, zoneIndex, alias)
  }

  /* ------------------------------- Profiles ------------------------------- */

  createProfile(name: string): string {
    return this.profiles.create(name, this.lighting.get())
  }

  saveProfile(id: string): void {
    this.profiles.overwrite(id, this.lighting.get())
  }

  applyProfile(id: string): void {
    const profile = this.profiles.get(id)
    this.lighting.replace(profile.lighting)
    this.profiles.markActive(id)
  }

  renameProfile(id: string, name: string): void {
    this.profiles.rename(id, name)
  }

  deleteProfile(id: string): void {
    this.profiles.remove(id)
  }

  /* ----------------------------- Engine & system ----------------------------- */

  updateSettings(patch: SettingsPatch): void {
    this.settings.update(patch)
  }

  async reconnectEngine(): Promise<void> {
    this.resizeAttempts.clear()
    await this.hub.restart()
  }

  rescanDevices(): void {
    this.hub.rescan()
  }

  /** Runs an integration action, such as taking the Lian Li dongle over from L-Connect 3. */
  async runIntegrationAction(id: string, action: IntegrationAction): Promise<void> {
    const done = await this.hub.runIntegrationAction(id, action)
    if (done === null) throw new UserFacingError('Cette action n’est plus disponible.')
    if (!done)
      throw new UserFacingError('Opération annulée : l’autorisation administrateur n’a pas été accordée.')
    this.scheduleDiagnostics()
  }

  async refreshDiagnostics(): Promise<void> {
    await this.diagnostics.refresh(this.hub.devices)
    this.scheduleSnapshot()
  }

  /* -------------------------------- Internals ------------------------------- */

  private requireDevice(deviceId: string): DeviceInfo {
    const device = this.hub.devices.find((candidate) => candidate.id === deviceId)
    if (!device) throw new UserFacingError('Cet appareil n’est plus connecté.')
    return device
  }

  private replan(): void {
    const lighting = this.lighting.get()
    const plans = new Map<string, DevicePlan>()
    for (const device of this.hub.devices) {
      const plan = planDevice(
        device,
        lighting,
        this.deviceSettings.all()[device.id],
        this.overlayFor(device.id)
      )
      if (plan) plans.set(device.id, plan)
    }
    this.engine.apply(plans)
    this.scheduleSnapshot()
  }

  private overlayFor(deviceId: string): Overlay | undefined {
    const info = this.overlay?.info
    if (!info || info.deviceId !== deviceId) return undefined
    switch (info.kind) {
      case 'identify':
        return { kind: 'identify', deviceId, zoneIndex: info.zoneIndex }
      case 'white-test':
        return { kind: 'white-test', deviceId }
      case 'led-count':
        return { kind: 'led-count', deviceId, zoneIndex: info.zoneIndex ?? 0 }
    }
  }

  private setOverlay(info: OverlayInfo, durationMs: number): void {
    if (this.overlay) clearTimeout(this.overlay.timer)
    this.overlay = { info, timer: setTimeout(() => this.clearOverlay(), durationMs) }
    this.replan()
  }

  private clearOverlay(): void {
    if (!this.overlay) return
    clearTimeout(this.overlay.timer)
    this.overlay = null
    this.replan()
  }

  /**
   * Gives every addressable header a usable size: the size chosen by the user,
   * or a default that covers a typical AIO with its fans (extra addresses are
   * ignored by the LEDs). A zone left at 0 LEDs receives no data at all, in
   * any mode. The default stays within MSI's single-packet per-LED protocol
   * (40 LEDs per header), which is faster and more widely supported than the
   * per-header protocol used for longer chains.
   */
  private ensureZoneSizes(devices: DeviceInfo[]): void {
    for (const device of devices) {
      const saved = this.deviceSettings.all()[device.id]?.zoneSizes ?? {}
      for (const zone of device.zones) {
        if (!zone.resizable) continue
        const chosen = saved[String(zone.index)]
        const size = chosen !== undefined && chosen > 0 ? chosen : Math.min(DEFAULT_HEADER_LEDS, zone.ledsMax)
        if (size === zone.ledCount) continue
        const key = `${device.id}:${zone.index}:${size}`
        const attempts = this.resizeAttempts.get(key) ?? 0
        if (attempts >= 2) continue
        this.resizeAttempts.set(key, attempts + 1)
        void this.hub.resizeZone(device.id, zone.index, size)
      }
    }
  }

  private onSettingsChanged(next: AppSettings, previous: AppSettings): void {
    if (next.theme !== previous.theme) this.system.setTheme(next.theme)
    if (next.launchAtLogin !== previous.launchAtLogin) this.system.setLaunchAtLogin(next.launchAtLogin)
    if (next.frameRate !== previous.frameRate) this.replan()
    if (JSON.stringify(next.engine) !== JSON.stringify(previous.engine)) {
      this.logger.info('Engine settings changed, restarting OpenRGB')
      this.resizeAttempts.clear()
      void this.hub.restartEngine()
    }
    this.scheduleSnapshot()
  }

  private scheduleDiagnostics(): void {
    if (this.diagnosticsTimer) clearTimeout(this.diagnosticsTimer)
    this.diagnosticsTimer = setTimeout(() => {
      this.diagnosticsTimer = null
      void this.refreshDiagnostics().catch((error: unknown) => this.logger.error('Diagnostics failed', error))
    }, DIAGNOSTICS_DELAY_MS)
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      this.events.emit('snapshot', this.snapshot())
    }, SNAPSHOT_DEBOUNCE_MS)
  }
}

/** Hardware mode proposed when a device is switched to hardware control. */
export function defaultHardwareMode(device: DeviceInfo): HardwareModeConfig | null {
  const candidates = device.modes.filter((mode) => mode.name.toLowerCase() !== 'direct')
  const active = candidates.find((mode) => mode.index === device.activeModeIndex)
  const mode =
    active ?? candidates.find((candidate) => candidate.name.toLowerCase() === 'static') ?? candidates[0]
  if (!mode) return null
  return {
    modeName: mode.name,
    speed: mode.speed,
    brightness: mode.brightness,
    direction: mode.capabilities.direction ? mode.direction : null,
    colorMode: mode.colorMode,
    colors: mode.colors.length > 0 ? mode.colors : [WHITE]
  }
}
