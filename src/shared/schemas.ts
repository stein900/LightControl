/**
 * Runtime schemas for every value that crosses a trust boundary: IPC payloads
 * coming from the renderer and JSON documents read back from disk. Persisted
 * shapes use defaults so older or partially written files still load.
 */
import { z } from 'zod'

export const EFFECT_IDS = [
  'off',
  'static',
  'gradient',
  'breathing',
  'spectrum',
  'rainbow',
  'wave',
  'comet',
  'twinkle',
  'strobe'
] as const

export const COLOR_MODES = ['none', 'per-led', 'mode-specific', 'random'] as const
export const THEMES = ['system', 'dark', 'light'] as const
/** Operations an integration can offer, such as taking a dongle over from the vendor software. */
export const INTEGRATION_ACTIONS = ['take-over', 'hand-back'] as const

const byte = z.number().int().min(0).max(255)
const percent = z.number().min(0).max(100)
const identifier = z.string().min(1).max(256)

export const RgbSchema = z.object({ r: byte, g: byte, b: byte })

export const EffectConfigSchema = z.object({
  id: z.enum(EFFECT_IDS),
  colors: z.array(RgbSchema).min(1).max(8),
  speed: percent,
  brightness: percent,
  size: percent,
  reverse: z.boolean()
})

export const HardwareModeConfigSchema = z.object({
  modeName: z.string().min(1).max(128),
  speed: percent.nullable(),
  brightness: percent.nullable(),
  direction: z.number().int().min(0).max(9).nullable(),
  colorMode: z.enum(COLOR_MODES).nullable(),
  colors: z.array(RgbSchema).max(64)
})

export const DeviceLightingSchema = z.object({
  control: z.enum(['software', 'hardware']).default('software'),
  followSync: z.boolean().default(true),
  zones: z.record(z.string(), EffectConfigSchema).default({}),
  hardware: HardwareModeConfigSchema.nullable().default(null)
})

export const DEFAULT_EFFECT: z.infer<typeof EffectConfigSchema> = {
  id: 'static',
  colors: [{ r: 255, g: 255, b: 255 }],
  speed: 50,
  brightness: 100,
  size: 50,
  reverse: false
}

export const LightingStateSchema = z.object({
  power: z.boolean().default(true),
  brightness: percent.default(100),
  sync: z.boolean().default(true),
  syncEffect: EffectConfigSchema.default(DEFAULT_EFFECT),
  devices: z.record(z.string(), DeviceLightingSchema).default({})
})

export const WhiteBalanceSchema = z.object({ r: percent, g: percent, b: percent })

export const DeviceSettingsSchema = z.object({
  alias: z.string().max(64).nullable().default(null),
  zoneAliases: z.record(z.string(), z.string().max(64)).default({}),
  zoneSizes: z.record(z.string(), z.number().int().min(0).max(1024)).default({}),
  whiteBalance: WhiteBalanceSchema.default({ r: 100, g: 100, b: 100 })
})

export const DeviceSettingsMapSchema = z.record(z.string(), DeviceSettingsSchema)

export const EngineSettingsSchema = z.object({
  managed: z.boolean().default(true),
  executablePath: z.string().max(1024).nullable().default(null),
  host: z.string().min(1).max(255).default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(6742),
  elevated: z.boolean().default(false)
})

export const AppSettingsSchema = z.object({
  theme: z.enum(THEMES).default('system'),
  launchAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  closeToTray: z.boolean().default(true),
  frameRate: z.number().int().min(10).max(60).default(30),
  engine: EngineSettingsSchema.default({
    managed: true,
    executablePath: null,
    host: '127.0.0.1',
    port: 6742,
    elevated: false
  })
})

export const ProfileSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(64),
  createdAt: z.number(),
  updatedAt: z.number(),
  lighting: LightingStateSchema
})

export const ProfileStoreSchema = z.object({
  activeProfileId: identifier.nullable().default(null),
  profiles: z.array(ProfileSchema).default([])
})

/* ------------------------------ IPC payloads ------------------------------ */

/**
 * Written field by field instead of `AppSettingsSchema.partial()`: Zod 4 applies
 * inner defaults to omitted optional keys, which would turn a patch into a reset.
 */
export const SettingsPatchSchema = z
  .object({
    theme: z.enum(THEMES).optional(),
    launchAtLogin: z.boolean().optional(),
    startMinimized: z.boolean().optional(),
    closeToTray: z.boolean().optional(),
    frameRate: z.number().int().min(10).max(60).optional(),
    engine: z
      .object({
        managed: z.boolean().optional(),
        executablePath: z.string().max(1024).nullable().optional(),
        host: z.string().min(1).max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        elevated: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const ZoneTargetSchema = z.object({
  deviceId: identifier,
  /** Zone index, or null to address every zone of the device. */
  zoneIndex: z.number().int().min(0).max(4096).nullable()
})

export const SetZoneEffectSchema = ZoneTargetSchema.extend({ effect: EffectConfigSchema })

export const SetDeviceControlSchema = z.object({
  deviceId: identifier,
  control: z.enum(['software', 'hardware'])
})

export const SetFollowSyncSchema = z.object({ deviceId: identifier, followSync: z.boolean() })

export const SetHardwareModeSchema = z.object({
  deviceId: identifier,
  mode: HardwareModeConfigSchema,
  persist: z.boolean()
})

export const SetWhiteBalanceSchema = z.object({ deviceId: identifier, whiteBalance: WhiteBalanceSchema })

export const SetWhiteTestSchema = z.object({ deviceId: identifier, enabled: z.boolean() })

export const SetZoneSizeSchema = z.object({
  deviceId: identifier,
  zoneIndex: z.number().int().min(0).max(4096),
  size: z.number().int().min(0).max(1024)
})

export const SetAliasSchema = z.object({
  deviceId: identifier,
  zoneIndex: z.number().int().min(0).max(4096).nullable(),
  alias: z.string().max(64)
})

export const IdentifySchema = ZoneTargetSchema

export const IntegrationActionSchema = z.object({ id: identifier, action: z.enum(INTEGRATION_ACTIONS) })

export const ProfileNameSchema = z.string().trim().min(1).max(64)
export const ProfileRenameSchema = z.object({ id: identifier, name: ProfileNameSchema })
export const ProfileIdSchema = identifier

export const ExternalUrlSchema = z.url().refine((value) => value.startsWith('https://'), 'HTTPS only')
