import { describe, expect, it } from 'vitest'
import { BinaryReader, BinaryWriter } from './binary'
import {
  decodeController,
  decodeHeader,
  encodeHeader,
  encodeLedsPayload,
  encodeMode,
  encodeModePayload,
  encodeZoneLedsPayload,
  packColor,
  unpackColor,
  type RawController,
  type RawMode
} from './codec'
import { applyModeOverrides, fromPercent, toDeviceInfo, toPercent } from './mapper'
import { ModeFlag, ZoneFlag } from './protocol'

/** Server-side encoder written from OpenRGB's GetDeviceDescriptionData, independent of the decoder. */
function encodeController(controller: RawController, version: number): Buffer {
  const w = new BinaryWriter()
  w.u32(0).i32(controller.type).string(controller.name)
  if (version >= 1) w.string(controller.vendor)
  w.string(controller.description)
    .string(controller.version)
    .string(controller.serial)
    .string(controller.location)
  w.u16(controller.modes.length).i32(controller.activeMode)
  for (const mode of controller.modes) encodeMode(w, mode, version)
  w.u16(controller.zones.length)
  for (const zone of controller.zones) {
    w.string(zone.name).i32(zone.type).u32(zone.ledsMin).u32(zone.ledsMax).u32(zone.ledsCount)
    if (zone.matrix) {
      w.u16(8 + zone.matrix.map.length * 4)
        .u32(zone.matrix.height)
        .u32(zone.matrix.width)
      for (const cell of zone.matrix.map) w.u32(cell)
    } else {
      w.u16(0)
    }
    if (version >= 4) {
      w.u16(zone.segments.length)
      for (const segment of zone.segments) {
        w.string(segment.name).i32(segment.type).u32(segment.startIndex).u32(segment.ledCount)
      }
    }
    if (version >= 5) w.u32(zone.flags)
  }
  w.u16(controller.leds.length)
  for (const led of controller.leds) {
    w.string(led.name)
    if (version < 6) w.u32(led.value)
  }
  w.u16(controller.colors.length)
  for (const color of controller.colors) w.u32(color)
  if (version >= 5) {
    w.u16(controller.ledAlternateNames.length)
    for (const name of controller.ledAlternateNames) w.string(name)
    w.u32(controller.flags)
  }
  return w.patchU32(0, w.size).toBuffer()
}

const staticMode: RawMode = {
  name: 'Static',
  value: 1,
  flags: ModeFlag.HasModeSpecificColor | ModeFlag.HasBrightness | ModeFlag.ManualSave,
  speedMin: 0,
  speedMax: 0,
  brightnessMin: 0,
  brightnessMax: 100,
  colorsMin: 1,
  colorsMax: 1,
  speed: 0,
  brightness: 80,
  direction: 0,
  colorMode: 2,
  colors: [packColor(252, 250, 240)]
}

const directMode: RawMode = {
  ...staticMode,
  name: 'Direct',
  value: 0,
  flags: ModeFlag.HasPerLedColor,
  colorsMin: 0,
  colorsMax: 0,
  colorMode: 1,
  colors: []
}

const rainbowMode: RawMode = {
  ...staticMode,
  name: 'Rainbow',
  value: 7,
  flags: ModeFlag.HasSpeed | ModeFlag.HasDirectionLR,
  speedMin: 10,
  speedMax: 1,
  speed: 4,
  colorMode: 0,
  colors: []
}

const controller: RawController = {
  type: 0,
  name: 'MSI X670E GAMING PLUS WIFI (MS-7E16)',
  vendor: 'MSI',
  description: 'MSI Mystic Light Device',
  version: '1.0',
  serial: '',
  location: 'HID: \\\\?\\HID#VID_0DB0&PID_0076',
  activeMode: 0,
  modes: [directMode, staticMode, rainbowMode],
  zones: [
    { name: 'JRGB1', type: 0, ledsMin: 1, ledsMax: 1, ledsCount: 1, matrix: null, segments: [], flags: 0 },
    {
      name: 'JARGB_V2_1',
      type: 1,
      ledsMin: 0,
      ledsMax: 240,
      ledsCount: 3,
      matrix: null,
      segments: [{ name: 'Pompe', type: 1, startIndex: 0, ledCount: 3 }],
      flags: ZoneFlag.ConfigurableSize
    },
    {
      name: 'Keys',
      type: 2,
      ledsMin: 2,
      ledsMax: 2,
      ledsCount: 2,
      matrix: { height: 1, width: 3, map: [0, 0xffffffff, 1] },
      segments: [],
      flags: 0
    }
  ],
  leds: ['JRGB1', 'ARGB 1', 'ARGB 2', 'ARGB 3', 'Key A', 'Key B'].map((name, value) => ({ name, value })),
  colors: [1, 2, 3, 4, 5, 6].map((n) => packColor(n, n * 2, n * 3)),
  ledAlternateNames: [],
  flags: 1
}

describe('OpenRGB codec', () => {
  it.each([3, 4, 5])('round-trips a controller description at protocol %i', (version) => {
    const decoded = decodeController(encodeController(controller, version), version)
    expect(decoded.name).toBe(controller.name)
    expect(decoded.vendor).toBe('MSI')
    expect(decoded.modes.map((m) => m.name)).toEqual(['Direct', 'Static', 'Rainbow'])
    expect(decoded.modes[1]!.brightness).toBe(80)
    expect(decoded.zones[1]!.ledsMax).toBe(240)
    expect(decoded.zones[2]!.matrix).toEqual({ height: 1, width: 3, map: [0, 0xffffffff, 1] })
    expect(decoded.leds).toHaveLength(6)
    expect(decoded.colors[5]).toBe(packColor(6, 12, 18))
    expect(decoded.zones[1]!.segments).toHaveLength(version >= 4 ? 1 : 0)
    expect(decoded.zones[1]!.flags).toBe(version >= 5 ? ZoneFlag.ConfigurableSize : 0)
  })

  it('rejects truncated payloads', () => {
    const full = encodeController(controller, 5)
    expect(() => decodeController(full.subarray(0, full.length - 10), 5)).toThrow()
  })

  it('encodes LED updates with a size prefix and 4-byte colors', () => {
    const payload = encodeLedsPayload(new Uint8Array([255, 128, 0, 1, 2, 3]))
    const reader = new BinaryReader(payload)
    expect(reader.u32()).toBe(payload.length)
    expect(reader.u16()).toBe(2)
    expect(unpackColor(reader.u32())).toEqual({ r: 255, g: 128, b: 0 })
    expect(unpackColor(reader.u32())).toEqual({ r: 1, g: 2, b: 3 })
    expect(reader.remaining).toBe(0)
  })

  it('encodes zone LED updates', () => {
    const payload = encodeZoneLedsPayload(4, new Uint8Array([9, 8, 7]))
    const reader = new BinaryReader(payload)
    expect(reader.u32()).toBe(payload.length)
    expect(reader.u32()).toBe(4)
    expect(reader.u16()).toBe(1)
    expect(unpackColor(reader.u32())).toEqual({ r: 9, g: 8, b: 7 })
  })

  it('encodes mode updates that the server can parse back', () => {
    const payload = encodeModePayload(1, staticMode, 5)
    const reader = new BinaryReader(payload)
    expect(reader.u32()).toBe(payload.length)
    expect(reader.i32()).toBe(1)
    expect(reader.string()).toBe('Static')
    expect(reader.i32()).toBe(1)
  })

  it('round-trips packet headers', () => {
    expect(decodeHeader(encodeHeader(3, 1050, 42))).toEqual({ deviceId: 3, packetId: 1050, size: 42 })
    expect(() => decodeHeader(Buffer.alloc(16))).toThrow('magic')
  })
})

describe('OpenRGB mapper', () => {
  it('maps zones with offsets, resizability and matrix cells', () => {
    const info = toDeviceInfo(controller, 'orgb-test')
    expect(info.kind).toBe('motherboard')
    expect(info.zones.map((z) => z.startIndex)).toEqual([0, 1, 4])
    expect(info.zones[1]!.resizable).toBe(true)
    expect(info.zones[0]!.resizable).toBe(false)
    expect(info.zones[2]!.matrix!.cells).toEqual([0, null, 1])
    expect(info.supportsDirect).toBe(true)
    expect(info.modes[1]!.colors).toEqual([{ r: 252, g: 250, b: 240 }])
  })

  it('normalises inverted speed ranges', () => {
    expect(toPercent(10, 10, 1)).toBe(0)
    expect(toPercent(1, 10, 1)).toBe(100)
    expect(fromPercent(100, 10, 1)).toBe(1)
    expect(fromPercent(0, 10, 1)).toBe(10)
  })

  it('applies overrides within device limits', () => {
    const mode = applyModeOverrides(staticMode, {
      speed: 50,
      brightness: 50,
      direction: 1,
      colorMode: 'mode-specific',
      colors: [
        { r: 255, g: 255, b: 255 },
        { r: 1, g: 1, b: 1 }
      ]
    })
    expect(mode.brightness).toBe(50)
    expect(mode.speed).toBe(0)
    expect(mode.direction).toBe(0)
    expect(mode.colors).toEqual([packColor(255, 255, 255)])
  })
})
