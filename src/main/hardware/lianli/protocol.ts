/**
 * Lian Li 2.4 GHz wireless protocol (UNI FAN SL/TL wireless, Strimer Plus
 * Wireless, HydroShift II…), as documented by the MIT-licensed lian-li-linux
 * project from USB captures of the vendor software. Pure functions only: the
 * USB transport lives in the host process.
 *
 * Topology: the TX dongle transmits 240-byte RF frames (sent as four 64-byte
 * USB packets); the RX dongle reports bound devices. Devices do not take a
 * live stream: they receive a compressed animation (one frame for a fixed
 * color) that they loop on their own.
 */
import { compress } from './tinyuz'

export const TX_IDS = [
  { vid: 0x0416, pid: 0x8040 },
  { vid: 0x1a86, pid: 0xe304 }
] as const
export const RX_IDS = [
  { vid: 0x0416, pid: 0x8041 },
  { vid: 0x1a86, pid: 0xe305 }
] as const

export const EP_OUT = 0x01
export const EP_IN = 0x81
export const USB_PACKET_SIZE = 64

const USB_CMD_SEND_RF = 0x10
const USB_CMD_GET_MAC = 0x11
const RF_SELECT = 0x12
const RF_SET_RGB = 0x20
export const RF_DATA_SIZE = 240
const RF_CHUNK_SIZE = 60
const RF_CHUNKS = RF_DATA_SIZE / RF_CHUNK_SIZE

const RECORD_SIZE = 42
const RECORD_MARKER = 0x1c
const MASTER_DEVICE_TYPE = 0xff
/** Device records per 512-byte discovery page. */
const RECORDS_PER_PAGE = 10
export const MAX_DISCOVERY_PAGES = 26

const RGB_CHUNK_BYTES = 220
export const MAX_COMPRESSED_BYTES = 12_288
export const MAX_ANIMATION_FRAMES = 4096
const MAX_INTERVAL_MS = 40_959
/** Header packets are repeated, as the vendor software does, because RF delivery is lossy. */
export const HEADER_REPEATS = 4
/** RF ticks are 0.625 ms; intervals are expressed in hundredths of a tick. */
const HUNDREDTHS_PER_MS = 160

/** Channel scan order used to find the TX: the default channel first, then even, then odd ones. */
export const MASTER_CHANNELS: readonly number[] = [
  8,
  ...Array.from({ length: 19 }, (_, i) => 2 + i * 2).filter((channel) => channel !== 8),
  ...Array.from({ length: 20 }, (_, i) => 1 + i * 2)
]

export type WirelessFamily =
  | 'sl-v3'
  | 'tl'
  | 'sl-inf'
  | 'cl'
  | 'sl-inf-v3'
  | 'tl-v3'
  | 'sl-v4'
  | 'p28-v2'
  | 'hydroshift'
  | 'strimer'
  | 'lancool-217'
  | 'lancool-v150'
  | 'screen-88'
  | 'unknown'

export interface WirelessLayout {
  family: WirelessFamily
  model: string
  /** LEDs per uploaded frame; 0 when the layout is unknown and the device cannot be driven. */
  ledCount: number
  ledsPerFan: number
  fanCount: number
  /** SL-INF chains bound right-to-left need their fans reversed inside each frame. */
  reverseFans: boolean
}

export interface WirelessDevice {
  mac: Uint8Array
  masterMac: Uint8Array
  channel: number
  rxType: number
  deviceType: number
  fanTypes: number[]
  /** Identifier of the animation the device is currently playing. */
  effectIndex: Uint8Array
  /** True when the device follows a motherboard ARGB signal instead of uploaded animations. */
  syncsMotherboardLight: boolean
  layout: WirelessLayout
}

export interface DiscoveryResult {
  devices: WirelessDevice[]
  /** Other masters (TX dongles) heard on the channel. */
  masters: { mac: Uint8Array; channel: number }[]
}

export const macToString = (mac: Uint8Array): string =>
  [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join(':')

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/* ------------------------------- Commands -------------------------------- */

/** USB_GetMac on the TX for one channel. */
export function masterQuery(channel: number): Uint8Array {
  const command = new Uint8Array(USB_PACKET_SIZE)
  command[0] = USB_CMD_GET_MAC
  command[1] = channel
  return command
}

export function parseMasterReply(reply: Uint8Array): { mac: Uint8Array; firmware: number } | null {
  if (reply.length < 13 || reply[0] !== USB_CMD_GET_MAC) return null
  const mac = reply.slice(1, 7)
  if (mac.every((byte) => byte === 0)) return null
  const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength)
  if (view.getUint32(7, false) <= 1) return null
  return { mac, firmware: view.getUint16(11, false) }
}

/** GetDev on the RX: lists the devices heard on the air, `pages` × 10 records. */
export function discoveryQuery(pages: number): Uint8Array {
  const command = new Uint8Array(USB_PACKET_SIZE)
  command[0] = USB_CMD_SEND_RF
  command[1] = Math.min(MAX_DISCOVERY_PAGES, Math.max(1, pages))
  return command
}

/** Pages needed to read `total` records on the next poll. */
export function discoveryPages(total: number): number {
  return Math.max(1, Math.ceil(total / RECORDS_PER_PAGE))
}

/* ------------------------------- Layouts --------------------------------- */

function fanFamily(fanType: number): { family: WirelessFamily; model: string; ledsPerFan: number } {
  if (fanType >= 20 && fanType <= 22)
    return { family: 'sl-v3', model: 'UNI FAN SL V3 Wireless', ledsPerFan: 40 }
  if (fanType >= 23 && fanType <= 26)
    return { family: 'sl-v3', model: 'UNI FAN SL V3 Wireless LCD', ledsPerFan: 40 }
  if (fanType === 27 || (fanType >= 32 && fanType <= 35))
    return { family: 'tl', model: 'UNI FAN TL Wireless LCD', ledsPerFan: 26 }
  if (fanType >= 28 && fanType <= 31) return { family: 'tl', model: 'UNI FAN TL Wireless', ledsPerFan: 26 }
  if (fanType >= 36 && fanType <= 39)
    return { family: 'sl-inf', model: 'UNI FAN SL-INF Wireless', ledsPerFan: 44 }
  if (fanType >= 40 && fanType <= 42) return { family: 'cl', model: 'UNI FAN CL Wireless', ledsPerFan: 24 }
  if (fanType >= 43 && fanType <= 50)
    return { family: 'sl-inf-v3', model: 'UNI FAN SL-INF V3 Wireless', ledsPerFan: 44 }
  if (fanType >= 51 && fanType <= 58)
    return { family: 'tl-v3', model: 'UNI FAN TL V3 Wireless', ledsPerFan: 26 }
  if (fanType >= 59 && fanType <= 62)
    return { family: 'sl-v4', model: 'UNI FAN SL V4 Wireless', ledsPerFan: 52 }
  if (fanType === 63) return { family: 'p28-v2', model: 'UNI FAN P28 V2 Wireless', ledsPerFan: 9 }
  if (fanType === 126 || fanType === 127)
    return { family: 'cl', model: 'UNI FAN CL V2 Wireless', ledsPerFan: 24 }
  return { family: 'unknown', model: 'Lian Li Wireless', ledsPerFan: 0 }
}

const STRIMER_LEDS: Record<number, { leds: number; model: string }> = {
  1: { leds: 116, model: 'Strimer Plus Wireless' },
  2: { leds: 132, model: 'Strimer Plus Wireless' },
  3: { leds: 174, model: 'Strimer Plus Wireless' },
  4: { leds: 88, model: 'Strimer Plus Wireless' }
}

export function deviceLayout(deviceType: number, fanTypes: number[], rawFanCount: number): WirelessLayout {
  const reverseFans = rawFanCount >= 10
  const fanCount = Math.min(4, reverseFans ? rawFanCount - 10 : rawFanCount)
  const fixed = (family: WirelessFamily, model: string, ledCount: number): WirelessLayout => ({
    family,
    model,
    ledCount,
    ledsPerFan: 0,
    fanCount: 0,
    reverseFans: false
  })

  if (deviceType >= 1 && deviceType <= 9) {
    const strimer = STRIMER_LEDS[deviceType]
    return fixed('strimer', strimer?.model ?? 'Strimer Plus Wireless', strimer?.leds ?? 0)
  }
  if (deviceType === 10 || deviceType === 11) {
    // HydroShift II: 24 LEDs on the pump head followed by the fans.
    return {
      family: 'hydroshift',
      model: deviceType === 10 ? 'HydroShift II LCD-C Wireless' : 'HydroShift II LCD-S Wireless',
      ledCount: 24 + fanCount * 24,
      ledsPerFan: 24,
      fanCount,
      reverseFans: false
    }
  }
  if (deviceType === 65) return fixed('lancool-217', 'Lancool 217 Wireless', 96)
  if (deviceType === 66) return fixed('lancool-v150', 'Lancool V150 Wireless', 88)
  if (deviceType === 88) return fixed('screen-88', 'Universal Screen 8.8" Wireless', 88)

  const family = fanFamily(fanTypes.find((type) => type !== 0) ?? 0)
  const ledCount = family.ledsPerFan * fanCount
  return {
    family: family.family,
    model: family.model,
    ledCount: ledCount <= 255 ? ledCount : 0,
    ledsPerFan: family.ledsPerFan,
    fanCount,
    reverseFans: reverseFans && (family.family === 'sl-inf' || family.family === 'sl-inf-v3')
  }
}

/* ------------------------------- Discovery ------------------------------- */

export function parseDiscovery(reply: Uint8Array, pages: number): DiscoveryResult | null {
  if (reply.length < 4 || reply[0] !== USB_CMD_SEND_RF) return null
  const count = Math.min(reply[1]!, pages * RECORDS_PER_PAGE)
  if (reply.length < 4 + count * RECORD_SIZE) return null

  const devices: WirelessDevice[] = []
  const masters: DiscoveryResult['masters'] = []
  for (let index = 0; index < count; index++) {
    const record = reply.subarray(4 + index * RECORD_SIZE, 4 + (index + 1) * RECORD_SIZE)
    if (record[41] !== RECORD_MARKER) continue
    const mac = record.slice(0, 6)
    if (mac.every((byte) => byte === 0)) continue
    const deviceType = record[18]!
    if (deviceType === MASTER_DEVICE_TYPE) {
      masters.push({ mac, channel: record[12]! })
      continue
    }
    const fanTypes = [...record.subarray(24, 28)]
    devices.push({
      mac,
      masterMac: record.slice(6, 12),
      channel: record[12]!,
      rxType: record[13]!,
      deviceType,
      fanTypes,
      effectIndex: record.slice(20, 24),
      syncsMotherboardLight: (record[28]! & 0x40) !== 0,
      layout: deviceLayout(deviceType, fanTypes, record[19]!)
    })
  }
  return { devices, masters }
}

/** Devices bound to the given master (the TX dongle we drive). */
export function boundTo(devices: WirelessDevice[], master: Uint8Array): WirelessDevice[] {
  return devices.filter((device) => sameBytes(device.masterMac, master))
}

/** Channel used to reach a device: its own when valid, otherwise the master's. */
export function trafficChannel(published: number, master: number): number {
  return published >= 1 && published <= 39 ? published : master
}

/* --------------------------------- RGB ----------------------------------- */

export class AnimationTooLargeError extends Error {
  override readonly name = 'AnimationTooLargeError'
  constructor(readonly compressedSize: number) {
    super(`Animation too large for the device memory (${compressedSize} bytes)`)
  }
}

export interface RgbUpload {
  compressed: Uint8Array
  ledCount: number
  frameCount: number
  intervalTicks: number
  intervalFraction: number
  /** FNV-1a of the payload; the device reports it back once the animation is applied. */
  effectIndex: Uint8Array
}

/**
 * Builds an animation from frames of packed RGB triplets (all the same
 * length). A single frame is a fixed color. `reverseFansOf` reverses the fan
 * order inside each frame for right-attached SL-INF chains.
 */
export function createRgbUpload(frames: Uint8Array[], intervalMs: number, reverseFansOf = 0): RgbUpload {
  if (frames.length === 0 || frames.length > MAX_ANIMATION_FRAMES) throw new Error('Invalid frame count')
  const ledCount = frames[0]!.length / 3
  if (!Number.isInteger(ledCount) || ledCount < 1 || ledCount > 255) throw new Error('Invalid LED count')
  if (frames.some((frame) => frame.length !== ledCount * 3)) throw new Error('Frames must have equal lengths')
  if (intervalMs < 1 || intervalMs > MAX_INTERVAL_MS) throw new Error('Invalid frame interval')

  const raw = new Uint8Array(frames.length * ledCount * 3)
  frames.forEach((frame, index) => {
    const base = index * ledCount * 3
    if (reverseFansOf > 0 && ledCount % reverseFansOf === 0) {
      const fans = ledCount / reverseFansOf
      for (let fan = 0; fan < fans; fan++) {
        raw.set(
          frame.subarray(fan * reverseFansOf * 3, (fan + 1) * reverseFansOf * 3),
          base + (fans - 1 - fan) * reverseFansOf * 3
        )
      }
    } else {
      raw.set(frame, base)
    }
  })

  const compressed = compress(raw)
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new AnimationTooLargeError(compressed.length)

  const hundredths = Math.round(intervalMs * HUNDREDTHS_PER_MS)
  const intervalTicks = Math.floor(hundredths / 100)
  const intervalFraction = hundredths % 100
  const frameCount = frames.length

  // FNV-1a over the payload and its timing, as the vendor software computes it.
  let hash = 0x811c9dc5
  const feed = (byte: number): void => {
    hash = Math.imul(hash ^ (byte & 0xff), 0x01000193) >>> 0
  }
  compressed.forEach(feed)
  ;[
    intervalTicks >> 8,
    intervalTicks,
    intervalFraction,
    frameCount >> 8,
    frameCount,
    ledCount,
    0,
    0,
    0,
    0,
    0
  ].forEach(feed)
  const effectIndex = new Uint8Array([hash >>> 24, (hash >>> 16) & 0xff, (hash >>> 8) & 0xff, hash & 0xff])
  // A device that mistakes leftover bytes for an address reads this byte as a slot: keep it invalid.
  effectIndex[0] = effectIndex[0]! | 0x80

  return { compressed, ledCount, frameCount, intervalTicks, intervalFraction, effectIndex }
}

/** `count` frames picked evenly from `frames`. */
function decimate(frames: Uint8Array[], count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => frames[Math.floor((i * frames.length) / count)]!)
}

/**
 * Builds the richest upload that fits the device memory: frames are dropped
 * evenly, keeping the loop duration, until the compressed animation fits.
 */
export function fitRgbUpload(frames: Uint8Array[], intervalMs: number, reverseFansOf = 0): RgbUpload {
  const durationMs = frames.length * intervalMs
  let picked = frames.length > MAX_ANIMATION_FRAMES ? decimate(frames, MAX_ANIMATION_FRAMES) : frames
  for (;;) {
    const interval = Math.min(MAX_INTERVAL_MS, Math.max(1, durationMs / picked.length))
    try {
      return createRgbUpload(picked, interval, reverseFansOf)
    } catch (error) {
      if (!(error instanceof AnimationTooLargeError) || picked.length === 1) throw error
      // Compressed size grows roughly with the frame count: aim just below the limit.
      const estimate = Math.floor((picked.length * MAX_COMPRESSED_BYTES * 0.92) / error.compressedSize)
      picked = decimate(picked, Math.max(1, Math.min(picked.length - 1, estimate)))
    }
  }
}

/** RF frames for one upload: a header, then 220-byte chunks of the compressed animation. */
export function rgbFrames(upload: RgbUpload, deviceMac: Uint8Array, masterMac: Uint8Array): Uint8Array[] {
  const chunks = Math.ceil(upload.compressed.length / RGB_CHUNK_BYTES)
  const frames: Uint8Array[] = []
  for (let index = 0; index <= chunks; index++) {
    const frame = new Uint8Array(RF_DATA_SIZE)
    const view = new DataView(frame.buffer)
    frame[0] = RF_SELECT
    frame[1] = RF_SET_RGB
    frame.set(deviceMac, 2)
    frame.set(masterMac, 8)
    frame.set(upload.effectIndex, 14)
    frame[18] = index
    frame[19] = chunks + 1
    if (index === 0) {
      view.setUint32(20, upload.compressed.length, false)
      view.setUint16(25, upload.frameCount, false)
      frame[27] = upload.ledCount
      view.setUint16(32, upload.intervalTicks, false)
      frame[34] = upload.intervalFraction
    } else {
      frame.set(upload.compressed.subarray((index - 1) * RGB_CHUNK_BYTES, index * RGB_CHUNK_BYTES), 20)
    }
    frames.push(frame)
  }
  return frames
}

/** Splits one RF frame into the four USB packets the TX expects. */
export function usbPackets(rfFrame: Uint8Array, channel: number, rxTarget: number): Uint8Array[] {
  if (rfFrame.length !== RF_DATA_SIZE) throw new Error('Invalid RF frame length')
  return Array.from({ length: RF_CHUNKS }, (_, chunk) => {
    const packet = new Uint8Array(USB_PACKET_SIZE)
    packet[0] = USB_CMD_SEND_RF
    packet[1] = chunk
    packet[2] = channel
    packet[3] = rxTarget
    packet.set(rfFrame.subarray(chunk * RF_CHUNK_SIZE, (chunk + 1) * RF_CHUNK_SIZE), 4)
    return packet
  })
}

export function effectApplied(device: WirelessDevice, upload: RgbUpload): boolean {
  return sameBytes(device.effectIndex, upload.effectIndex)
}
