/**
 * Encoding and decoding of OpenRGB SDK payloads. Field order and version gates
 * mirror RGBController::GetDeviceDescriptionData / SetModeDescription from
 * OpenRGB 1.0, for protocol versions 3 to 5.
 */
import { BinaryReader, BinaryWriter, ProtocolError } from './binary'
import { HEADER_SIZE, MAGIC } from './protocol'

/** OpenRGB packs colors as 0x00BBGGRR. */
export type PackedColor = number

export interface RawMode {
  name: string
  value: number
  flags: number
  speedMin: number
  speedMax: number
  brightnessMin: number
  brightnessMax: number
  colorsMin: number
  colorsMax: number
  speed: number
  brightness: number
  direction: number
  colorMode: number
  colors: PackedColor[]
}

export interface RawSegment {
  name: string
  type: number
  startIndex: number
  ledCount: number
}

export interface RawMatrix {
  height: number
  width: number
  map: number[]
}

export interface RawZone {
  name: string
  type: number
  ledsMin: number
  ledsMax: number
  ledsCount: number
  matrix: RawMatrix | null
  segments: RawSegment[]
  flags: number
}

export interface RawLed {
  name: string
  value: number
}

export interface RawController {
  type: number
  name: string
  vendor: string
  description: string
  version: string
  serial: string
  location: string
  activeMode: number
  modes: RawMode[]
  zones: RawZone[]
  leds: RawLed[]
  colors: PackedColor[]
  ledAlternateNames: string[]
  flags: number
}

export interface PacketHeader {
  deviceId: number
  packetId: number
  size: number
}

export function packColor(r: number, g: number, b: number): PackedColor {
  return ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)
}

export function unpackColor(color: PackedColor): { r: number; g: number; b: number } {
  return { r: color & 0xff, g: (color >>> 8) & 0xff, b: (color >>> 16) & 0xff }
}

/* -------------------------------- Header --------------------------------- */

export function encodeHeader(deviceId: number, packetId: number, size: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header, 0)
  header.writeUInt32LE(deviceId >>> 0, 4)
  header.writeUInt32LE(packetId >>> 0, 8)
  header.writeUInt32LE(size >>> 0, 12)
  return header
}

export function decodeHeader(buffer: Buffer, offset = 0): PacketHeader {
  if (buffer.length - offset < HEADER_SIZE) throw new ProtocolError('Incomplete packet header')
  if (buffer.compare(MAGIC, 0, MAGIC.length, offset, offset + MAGIC.length) !== 0) {
    throw new ProtocolError('Invalid packet magic')
  }
  return {
    deviceId: buffer.readUInt32LE(offset + 4),
    packetId: buffer.readUInt32LE(offset + 8),
    size: buffer.readUInt32LE(offset + 12)
  }
}

/* ------------------------------ Controllers ------------------------------ */

function decodeMode(reader: BinaryReader, version: number): RawMode {
  const name = reader.string()
  const value = version < 6 ? reader.i32() : 0
  const flags = reader.u32()
  const speedMin = reader.u32()
  const speedMax = reader.u32()
  const brightnessMin = version >= 3 ? reader.u32() : 0
  const brightnessMax = version >= 3 ? reader.u32() : 0
  const colorsMin = reader.u32()
  const colorsMax = reader.u32()
  const speed = reader.u32()
  const brightness = version >= 3 ? reader.u32() : 0
  const direction = reader.u32()
  const colorMode = reader.u32()
  const count = reader.u16()
  const colors: PackedColor[] = []
  for (let i = 0; i < count; i++) colors.push(reader.u32())
  return {
    name,
    value,
    flags,
    speedMin,
    speedMax,
    brightnessMin,
    brightnessMax,
    colorsMin,
    colorsMax,
    speed,
    brightness,
    direction,
    colorMode,
    colors
  }
}

function decodeZone(reader: BinaryReader, version: number): RawZone {
  const name = reader.string()
  const type = reader.i32()
  const ledsMin = reader.u32()
  const ledsMax = reader.u32()
  const ledsCount = reader.u32()

  let matrix: RawMatrix | null = null
  const matrixSize = reader.u16()
  if (matrixSize > 0) {
    const height = reader.u32()
    const width = reader.u32()
    if (matrixSize !== 8 + height * width * 4) {
      throw new ProtocolError(`Inconsistent matrix map size for zone "${name}"`)
    }
    const map: number[] = []
    for (let i = 0; i < height * width; i++) map.push(reader.u32())
    matrix = { height, width, map }
  }

  const segments: RawSegment[] = []
  if (version >= 4) {
    const count = reader.u16()
    for (let i = 0; i < count; i++) {
      segments.push({
        name: reader.string(),
        type: reader.i32(),
        startIndex: reader.u32(),
        ledCount: reader.u32()
      })
    }
  }

  const flags = version >= 5 ? reader.u32() : 0
  return { name, type, ledsMin, ledsMax, ledsCount, matrix, segments, flags }
}

/** Decodes a REQUEST_CONTROLLER_DATA reply payload (including its leading size field). */
export function decodeController(payload: Buffer, version: number): RawController {
  const reader = new BinaryReader(payload)
  const declared = reader.u32()
  if (declared > payload.length) {
    throw new ProtocolError(`Controller payload truncated: ${payload.length} of ${declared} bytes`)
  }

  const type = reader.i32()
  const name = reader.string()
  const vendor = version >= 1 ? reader.string() : ''
  const description = reader.string()
  const firmware = reader.string()
  const serial = reader.string()
  const location = reader.string()

  const modeCount = reader.u16()
  const activeMode = reader.i32()
  const modes: RawMode[] = []
  for (let i = 0; i < modeCount; i++) modes.push(decodeMode(reader, version))

  const zoneCount = reader.u16()
  const zones: RawZone[] = []
  for (let i = 0; i < zoneCount; i++) zones.push(decodeZone(reader, version))

  const ledCount = reader.u16()
  const leds: RawLed[] = []
  for (let i = 0; i < ledCount; i++) {
    leds.push({ name: reader.string(), value: version < 6 ? reader.u32() : 0 })
  }

  const colorCount = reader.u16()
  const colors: PackedColor[] = []
  for (let i = 0; i < colorCount; i++) colors.push(reader.u32())

  const ledAlternateNames: string[] = []
  let flags = 0
  if (version >= 5) {
    const alternateCount = reader.u16()
    for (let i = 0; i < alternateCount; i++) ledAlternateNames.push(reader.string())
    flags = reader.u32()
  }

  return {
    type,
    name,
    vendor,
    description,
    version: firmware,
    serial,
    location,
    activeMode,
    modes,
    zones,
    leds,
    colors,
    ledAlternateNames,
    flags
  }
}

/* -------------------------------- Requests ------------------------------- */

export function encodeMode(writer: BinaryWriter, mode: RawMode, version: number): void {
  writer.string(mode.name)
  if (version < 6) writer.i32(mode.value)
  writer.u32(mode.flags).u32(mode.speedMin).u32(mode.speedMax)
  if (version >= 3) writer.u32(mode.brightnessMin).u32(mode.brightnessMax)
  writer.u32(mode.colorsMin).u32(mode.colorsMax).u32(mode.speed)
  if (version >= 3) writer.u32(mode.brightness)
  writer.u32(mode.direction).u32(mode.colorMode).u16(mode.colors.length)
  for (const color of mode.colors) writer.u32(color)
}

/** UPDATEMODE / SAVEMODE payload: `uint32 size, int32 mode index, mode description`. */
export function encodeModePayload(modeIndex: number, mode: RawMode, version: number): Buffer {
  const writer = new BinaryWriter(128)
  writer.u32(0).i32(modeIndex)
  encodeMode(writer, mode, version)
  return writer.patchU32(0, writer.size).toBuffer()
}

function writePackedColors(writer: BinaryWriter, rgb: Uint8Array): void {
  const count = Math.floor(rgb.length / 3)
  writer.u16(count)
  for (let i = 0; i < count; i++) {
    writer
      .u8(rgb[i * 3]!)
      .u8(rgb[i * 3 + 1]!)
      .u8(rgb[i * 3 + 2]!)
      .u8(0)
  }
}

/** UPDATELEDS payload from packed RGB triplets: `uint32 size, uint16 count, colors`. */
export function encodeLedsPayload(rgb: Uint8Array): Buffer {
  const count = Math.floor(rgb.length / 3)
  const writer = new BinaryWriter(6 + count * 4)
  writer.u32(0)
  writePackedColors(writer, rgb)
  return writer.patchU32(0, writer.size).toBuffer()
}

/** UPDATEZONELEDS payload: `uint32 size, uint32 zone, uint16 count, colors`. */
export function encodeZoneLedsPayload(zoneIndex: number, rgb: Uint8Array): Buffer {
  const count = Math.floor(rgb.length / 3)
  const writer = new BinaryWriter(10 + count * 4)
  writer.u32(0).u32(zoneIndex)
  writePackedColors(writer, rgb)
  return writer.patchU32(0, writer.size).toBuffer()
}

export function encodeResizeZonePayload(zoneIndex: number, size: number): Buffer {
  return new BinaryWriter(8).i32(zoneIndex).i32(size).toBuffer()
}

export function encodeU32(value: number): Buffer {
  return new BinaryWriter(4).u32(value).toBuffer()
}

/** Null terminated string payload without a length prefix (SET_CLIENT_NAME). */
export function encodeCString(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])])
}
