/**
 * OpenRGB SDK network protocol constants, transcribed from OpenRGB 1.0
 * (NetworkProtocol.h, RGBControllerInterface.h).
 *
 * LightControl negotiates protocol version 5: it carries zone flags (needed to
 * resize ARGB headers) while keeping index-based device addressing and a
 * request/response flow without acknowledgements, which version 6 introduces.
 */

export const MAGIC = Buffer.from('ORGB', 'ascii')
export const HEADER_SIZE = 16
export const MAX_PACKET_SIZE = 8 * 1024 * 1024
export const CLIENT_PROTOCOL_VERSION = 5
export const MIN_PROTOCOL_VERSION = 3
export const DEFAULT_PORT = 6742

export const PacketId = {
  RequestControllerCount: 0,
  RequestControllerData: 1,
  RequestProtocolVersion: 40,
  SetClientName: 50,
  DeviceListUpdated: 100,
  RequestRescanDevices: 140,
  ResizeZone: 1000,
  UpdateLeds: 1050,
  UpdateZoneLeds: 1051,
  SetCustomMode: 1100,
  UpdateMode: 1101,
  SaveMode: 1102
} as const

export const ModeFlag = {
  HasSpeed: 1 << 0,
  HasDirectionLR: 1 << 1,
  HasDirectionUD: 1 << 2,
  HasDirectionHV: 1 << 3,
  HasBrightness: 1 << 4,
  HasPerLedColor: 1 << 5,
  HasModeSpecificColor: 1 << 6,
  HasRandomColor: 1 << 7,
  ManualSave: 1 << 8,
  AutomaticSave: 1 << 9
} as const

export const ModeColors = {
  None: 0,
  PerLed: 1,
  ModeSpecific: 2,
  Random: 3
} as const

export const ZoneType = {
  Single: 0,
  Linear: 1,
  Matrix: 2
} as const

export const ZoneFlag = {
  ConfigurableSizeEffectsOnly: 1 << 0,
  ConfigurableSize: 1 << 1
} as const

/** Device type enumeration, in declaration order. */
export const DEVICE_TYPES = [
  'motherboard',
  'memory',
  'gpu',
  'cooler',
  'ledstrip',
  'keyboard',
  'mouse',
  'mousemat',
  'headset',
  'headset-stand',
  'gamepad',
  'light',
  'speaker',
  'virtual',
  'storage',
  'case',
  'microphone',
  'accessory',
  'keypad',
  'laptop',
  'monitor',
  'unknown'
] as const

export const MATRIX_NO_LED = 0xffffffff
