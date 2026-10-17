/**
 * Domain model shared by the main process and the renderer. Persisted and
 * user-supplied shapes are inferred from their schemas so validation and
 * typing can never drift apart; read-only snapshots are plain interfaces.
 */
import type { z } from 'zod'
import type { Rgb } from './color'
import type {
  AppSettingsSchema,
  COLOR_MODES,
  DeviceLightingSchema,
  DeviceSettingsSchema,
  EFFECT_IDS,
  EffectConfigSchema,
  EngineSettingsSchema,
  HardwareModeConfigSchema,
  INTEGRATION_ACTIONS,
  LightingStateSchema,
  PC_MODEL_BACKDROPS,
  PC_MODEL_PARTS,
  PcModelSettingsSchema,
  ProfileSchema,
  SettingsPatchSchema,
  THEMES,
  WhiteBalanceSchema,
  ZoneTargetSchema
} from './schemas'

export type EffectId = (typeof EFFECT_IDS)[number]
export type ColorMode = (typeof COLOR_MODES)[number]
export type Theme = (typeof THEMES)[number]
export type IntegrationAction = (typeof INTEGRATION_ACTIONS)[number]
export type PcModelPart = (typeof PC_MODEL_PARTS)[number]
export type PcModelBackdrop = (typeof PC_MODEL_BACKDROPS)[number]

export type EffectConfig = z.infer<typeof EffectConfigSchema>
export type HardwareModeConfig = z.infer<typeof HardwareModeConfigSchema>
export type DeviceLighting = z.infer<typeof DeviceLightingSchema>
export type LightingState = z.infer<typeof LightingStateSchema>
export type WhiteBalance = z.infer<typeof WhiteBalanceSchema>
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>
export type EngineSettings = z.infer<typeof EngineSettingsSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
export type PcModelSettings = z.infer<typeof PcModelSettingsSchema>
export type ZoneTarget = z.infer<typeof ZoneTargetSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type ControlMode = DeviceLighting['control']

/* ------------------------------- Hardware -------------------------------- */

export type DeviceKind =
  | 'motherboard'
  | 'memory'
  | 'gpu'
  | 'cooler'
  | 'ledstrip'
  | 'keyboard'
  | 'mouse'
  | 'mousemat'
  | 'headset'
  | 'headset-stand'
  | 'gamepad'
  | 'light'
  | 'speaker'
  | 'virtual'
  | 'storage'
  | 'case'
  | 'microphone'
  | 'accessory'
  | 'keypad'
  | 'laptop'
  | 'monitor'
  | 'cable'
  | 'fan'
  | 'unknown'

/**
 * How software effects reach the device: `live` devices receive every frame,
 * `loop` devices (wireless) receive a pre-rendered animation they play on their own.
 */
export type Delivery = 'live' | 'loop'

export type ZoneShape = 'single' | 'linear' | 'matrix'

export interface ZoneMatrix {
  width: number
  height: number
  /** Row-major LED indices relative to the zone; `null` marks an empty cell. */
  cells: (number | null)[]
}

export interface ZoneInfo {
  index: number
  name: string
  shape: ZoneShape
  /** Offset of the zone's first LED in the device-wide LED array. */
  startIndex: number
  ledCount: number
  ledsMin: number
  ledsMax: number
  resizable: boolean
  matrix: ZoneMatrix | null
}

export interface ModeCapabilities {
  speed: boolean
  brightness: boolean
  direction: boolean
  directionAxis: 'left-right' | 'up-down' | 'horizontal-vertical' | null
  perLedColor: boolean
  modeSpecificColor: boolean
  randomColor: boolean
  manualSave: boolean
  automaticSave: boolean
}

export interface HardwareMode {
  index: number
  name: string
  capabilities: ModeCapabilities
  /** Current speed and brightness, normalised to [0, 100] from the device range. */
  speed: number | null
  brightness: number | null
  direction: number
  colorMode: ColorMode
  colorsMin: number
  colorsMax: number
  colors: Rgb[]
}

export interface DeviceInfo {
  /** Stable identifier derived from the hardware identity, used as persistence key. */
  id: string
  name: string
  vendor: string
  description: string
  kind: DeviceKind
  location: string
  serial: string
  version: string
  ledCount: number
  zones: ZoneInfo[]
  modes: HardwareMode[]
  activeModeIndex: number
  /** Whether software effects can stream per-LED colors to this device. */
  supportsDirect: boolean
  delivery: Delivery
}

/* -------------------------------- Runtime -------------------------------- */

export type EngineState = 'stopped' | 'starting' | 'connecting' | 'connected' | 'error'

export interface EngineStatus {
  state: EngineState
  message: string | null
  protocolVersion: number | null
  /** True when LightControl launched the OpenRGB process itself. */
  ownsServer: boolean
  executablePath: string | null
}

export type IntegrationState = 'stopped' | 'connecting' | 'connected' | 'unavailable' | 'error'

/** Secondary hardware channel, such as the Corsair iCUE SDK or the Lian Li wireless dongle. */
export interface IntegrationStatus {
  id: string
  name: string
  state: IntegrationState
  message: string | null
  deviceCount: number
  /** Operations the user can run now (each may ask for administrator rights). */
  actions: IntegrationAction[]
}

export interface ConflictReport {
  id: string
  product: string
  processes: string[]
  affects: string
  advice: string
}

export interface UnsupportedHardware {
  id: string
  name: string
  detail: string
}

export interface Diagnostics {
  checkedAt: number
  isElevated: boolean
  pawnIoInstalled: boolean
  conflicts: ConflictReport[]
  unsupported: UnsupportedHardware[]
  logDirectory: string
}

export interface ProfileSummary {
  id: string
  name: string
  updatedAt: number
  preview: ProfilePreview
}

/** What a profile looks like at a glance: its main effect and colors. */
export interface ProfilePreview {
  power: boolean
  effect: EffectId
  colors: Rgb[]
}

export interface AppSnapshot {
  version: string
  engine: EngineStatus
  integrations: IntegrationStatus[]
  devices: DeviceInfo[]
  lighting: LightingState
  deviceSettings: Record<string, DeviceSettings>
  profiles: ProfileSummary[]
  activeProfileId: string | null
  /** True when the current lighting differs from the active profile. */
  activeProfileModified: boolean
  settings: AppSettings
  diagnostics: Diagnostics | null
  /** Temporary test pattern currently shown on a device, if any. */
  overlay: OverlayInfo | null
}

export type OverlayKind = 'identify' | 'white-test' | 'led-count'

export interface OverlayInfo {
  kind: OverlayKind
  deviceId: string
  zoneIndex: number | null
}

/** Live preview of the colors sent to one device: packed RGB triplets per LED. */
export interface DeviceFrame {
  deviceId: string
  colors: Uint8Array
}
