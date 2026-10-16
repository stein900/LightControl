/** Pure translation between OpenRGB wire structures and the LightControl domain model. */
import { createHash } from 'node:crypto'
import { COLOR_MODES } from '@shared/schemas'
import type { DeviceInfo, HardwareMode, ModeCapabilities, ZoneInfo, ZoneShape } from '@shared/model'
import type { ModeOverrides } from '../backend'
import { packColor, unpackColor, type RawController, type RawMode, type RawZone } from './codec'
import { DEVICE_TYPES, MATRIX_NO_LED, ModeFlag, ZoneFlag, ZoneType } from './protocol'

export function stableDeviceId(raw: RawController): string {
  const identity = [raw.vendor, raw.name, raw.serial || raw.location].join('|')
  return `orgb-${createHash('sha1').update(identity).digest('hex').slice(0, 12)}`
}

export function toPercent(value: number, min: number, max: number): number {
  if (min === max) return 100
  const ratio = (value - min) / (max - min)
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
}

export function fromPercent(percent: number, min: number, max: number): number {
  return Math.round(min + (Math.min(100, Math.max(0, percent)) / 100) * (max - min))
}

function zoneShape(type: number): ZoneShape {
  if (type === ZoneType.Single) return 'single'
  if (type === ZoneType.Matrix) return 'matrix'
  return 'linear'
}

function mapZone(zone: RawZone, index: number, startIndex: number): ZoneInfo {
  const resizable =
    (zone.flags & (ZoneFlag.ConfigurableSize | ZoneFlag.ConfigurableSizeEffectsOnly)) !== 0 ||
    zone.ledsMin !== zone.ledsMax
  return {
    index,
    name: zone.name,
    shape: zoneShape(zone.type),
    startIndex,
    ledCount: zone.ledsCount,
    ledsMin: zone.ledsMin,
    ledsMax: zone.ledsMax,
    resizable,
    matrix: zone.matrix
      ? {
          width: zone.matrix.width,
          height: zone.matrix.height,
          cells: zone.matrix.map.map((value) => (value === MATRIX_NO_LED ? null : value))
        }
      : null
  }
}

function capabilities(flags: number): ModeCapabilities {
  const directionAxis =
    flags & ModeFlag.HasDirectionLR
      ? 'left-right'
      : flags & ModeFlag.HasDirectionUD
        ? 'up-down'
        : flags & ModeFlag.HasDirectionHV
          ? 'horizontal-vertical'
          : null
  return {
    speed: (flags & ModeFlag.HasSpeed) !== 0,
    brightness: (flags & ModeFlag.HasBrightness) !== 0,
    direction: directionAxis !== null,
    directionAxis,
    perLedColor: (flags & ModeFlag.HasPerLedColor) !== 0,
    modeSpecificColor: (flags & ModeFlag.HasModeSpecificColor) !== 0,
    randomColor: (flags & ModeFlag.HasRandomColor) !== 0,
    manualSave: (flags & ModeFlag.ManualSave) !== 0,
    automaticSave: (flags & ModeFlag.AutomaticSave) !== 0
  }
}

function mapMode(mode: RawMode, index: number): HardwareMode {
  const caps = capabilities(mode.flags)
  return {
    index,
    name: mode.name,
    capabilities: caps,
    speed: caps.speed ? toPercent(mode.speed, mode.speedMin, mode.speedMax) : null,
    brightness: caps.brightness ? toPercent(mode.brightness, mode.brightnessMin, mode.brightnessMax) : null,
    direction: mode.direction,
    colorMode: COLOR_MODES[mode.colorMode] ?? 'none',
    colorsMin: mode.colorsMin,
    colorsMax: mode.colorsMax,
    colors: mode.colors.map(unpackColor)
  }
}

export function toDeviceInfo(raw: RawController, id: string): DeviceInfo {
  let offset = 0
  const zones = raw.zones.map((zone, index) => {
    const info = mapZone(zone, index, offset)
    offset += zone.ledsCount
    return info
  })
  const modes = raw.modes.map(mapMode)
  return {
    id,
    name: raw.name,
    vendor: raw.vendor,
    description: raw.description,
    kind: DEVICE_TYPES[raw.type] ?? 'unknown',
    location: raw.location,
    serial: raw.serial,
    version: raw.version,
    ledCount: raw.leds.length,
    zones,
    modes,
    activeModeIndex: raw.activeMode,
    supportsDirect: modes.some((mode) => mode.capabilities.perLedColor),
    delivery: 'live'
  }
}

/** Returns the raw mode with user settings applied, clamped to what the device accepts. */
export function applyModeOverrides(base: RawMode, overrides: ModeOverrides): RawMode {
  const flags = base.flags
  const mode: RawMode = { ...base, colors: [...base.colors] }

  if (overrides.speed !== null && flags & ModeFlag.HasSpeed) {
    mode.speed = fromPercent(overrides.speed, base.speedMin, base.speedMax)
  }
  if (overrides.brightness !== null && flags & ModeFlag.HasBrightness) {
    mode.brightness = fromPercent(overrides.brightness, base.brightnessMin, base.brightnessMax)
  }
  if (
    overrides.direction !== null &&
    flags & (ModeFlag.HasDirectionLR | ModeFlag.HasDirectionUD | ModeFlag.HasDirectionHV)
  ) {
    mode.direction = overrides.direction
  }
  if (overrides.colorMode !== null) {
    const allowed =
      (overrides.colorMode === 'per-led' && flags & ModeFlag.HasPerLedColor) ||
      (overrides.colorMode === 'mode-specific' && flags & ModeFlag.HasModeSpecificColor) ||
      (overrides.colorMode === 'random' && flags & ModeFlag.HasRandomColor) ||
      overrides.colorMode === 'none'
    if (allowed) mode.colorMode = COLOR_MODES.indexOf(overrides.colorMode)
  }
  if (mode.colorMode === COLOR_MODES.indexOf('mode-specific') && overrides.colors.length > 0) {
    const min = Math.max(1, base.colorsMin)
    const max = Math.max(min, base.colorsMax)
    const colors = overrides.colors.slice(0, max).map((c) => packColor(c.r, c.g, c.b))
    while (colors.length < min) colors.push(colors[colors.length - 1] ?? packColor(255, 255, 255))
    mode.colors = colors
  }
  return mode
}
