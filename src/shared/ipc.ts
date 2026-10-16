/**
 * IPC contract between the renderer and the main process. Every request
 * channel is validated in the main process against the matching schema in
 * `schemas.ts`; the renderer only ever sees the `LightControlApi` surface.
 */
import type {
  AppSnapshot,
  ControlMode,
  DeviceFrame,
  EffectConfig,
  HardwareModeConfig,
  IntegrationAction,
  SettingsPatch,
  WhiteBalance
} from './model'

export const IpcChannel = {
  getSnapshot: 'app:get-snapshot',

  setPower: 'lighting:set-power',
  setBrightness: 'lighting:set-brightness',
  setSync: 'lighting:set-sync',
  setSyncEffect: 'lighting:set-sync-effect',
  setZoneEffect: 'lighting:set-zone-effect',
  setDeviceControl: 'lighting:set-device-control',
  setFollowSync: 'lighting:set-follow-sync',
  setHardwareMode: 'lighting:set-hardware-mode',
  identify: 'lighting:identify',

  setWhiteBalance: 'device:set-white-balance',
  setWhiteTest: 'device:set-white-test',
  setZoneSize: 'device:set-zone-size',
  setAlias: 'device:set-alias',

  createProfile: 'profiles:create',
  saveProfile: 'profiles:save',
  applyProfile: 'profiles:apply',
  renameProfile: 'profiles:rename',
  deleteProfile: 'profiles:delete',

  updateSettings: 'settings:update',

  reconnectEngine: 'engine:reconnect',
  rescanDevices: 'engine:rescan',
  refreshDiagnostics: 'diagnostics:refresh',
  runIntegrationAction: 'integrations:run-action',

  openExternal: 'shell:open-external',
  openLogs: 'shell:open-logs',
  chooseExecutable: 'shell:choose-executable'
} as const

export const IpcEvent = {
  snapshot: 'app:snapshot',
  frames: 'lighting:frames'
} as const

export type Unsubscribe = () => void

export interface LightControlApi {
  getSnapshot(): Promise<AppSnapshot>

  setPower(on: boolean): Promise<void>
  setBrightness(value: number): Promise<void>
  setSync(enabled: boolean): Promise<void>
  setSyncEffect(effect: EffectConfig): Promise<void>
  setZoneEffect(deviceId: string, zoneIndex: number | null, effect: EffectConfig): Promise<void>
  setDeviceControl(deviceId: string, control: ControlMode): Promise<void>
  setFollowSync(deviceId: string, followSync: boolean): Promise<void>
  setHardwareMode(deviceId: string, mode: HardwareModeConfig, persist: boolean): Promise<void>
  identify(deviceId: string, zoneIndex: number | null): Promise<void>

  setWhiteBalance(deviceId: string, whiteBalance: WhiteBalance): Promise<void>
  /** Shows calibrated full white on the device until disabled (or a timeout). */
  setWhiteTest(deviceId: string, enabled: boolean): Promise<void>
  setZoneSize(deviceId: string, zoneIndex: number, size: number): Promise<void>
  setAlias(deviceId: string, zoneIndex: number | null, alias: string): Promise<void>

  createProfile(name: string): Promise<string>
  saveProfile(id: string): Promise<void>
  applyProfile(id: string): Promise<void>
  renameProfile(id: string, name: string): Promise<void>
  deleteProfile(id: string): Promise<void>

  updateSettings(patch: SettingsPatch): Promise<void>

  reconnectEngine(): Promise<void>
  rescanDevices(): Promise<void>
  refreshDiagnostics(): Promise<void>
  /** Runs an action offered by an integration; may show a Windows administrator prompt. */
  runIntegrationAction(id: string, action: IntegrationAction): Promise<void>

  openExternal(url: string): Promise<void>
  openLogs(): Promise<void>
  /** Opens a file dialog to pick OpenRGB.exe; resolves to the chosen path or null. */
  chooseExecutable(): Promise<string | null>

  onSnapshot(listener: (snapshot: AppSnapshot) => void): Unsubscribe
  onFrames(listener: (frames: DeviceFrame[]) => void): Unsubscribe
}
