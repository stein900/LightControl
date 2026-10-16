/**
 * Resolves the user's lighting state into a concrete plan per device: either
 * software rendering streamed in direct mode, or a hardware mode executed by
 * the device itself. Pure and deterministic; the engine only executes plans.
 */
import { WHITE, type Rgb } from '@shared/color'
import { getEffect } from '@shared/effects'
import type {
  DeviceInfo,
  DeviceLighting,
  DeviceSettings,
  EffectConfig,
  LightingState,
  ZoneInfo
} from '@shared/model'
import type { ModeOverrides } from '@main/hardware/backend'
import { channelGains, correctColor, UNITY_GAINS, type ChannelGains } from './color-pipeline'
import { effectPeriod, effectRenderer, hash3, type ZoneLayout, type ZoneRenderer } from './effect-renderer'

export type Overlay =
  | { kind: 'identify'; deviceId: string; zoneIndex: number | null }
  | { kind: 'white-test'; deviceId: string }
  | { kind: 'led-count'; deviceId: string; zoneIndex: number }

export interface ZonePlan {
  zoneIndex: number
  startIndex: number
  ledCount: number
  seed: number
  layout: ZoneLayout | undefined
  animated: boolean
  /** Seconds after which the zone repeats exactly; null for a still image. */
  period: number | null
  render: ZoneRenderer
}

export interface SoftwarePlan {
  kind: 'software'
  deviceId: string
  ledCount: number
  zones: ZonePlan[]
  gains: ChannelGains
  /** Changes whenever the rendered output could change outside of the clock. */
  signature: string
}

export interface HardwarePlan {
  kind: 'hardware'
  deviceId: string
  modeName: string
  overrides: ModeOverrides
  /** Color written to every LED after the mode is set, for modes that take per-LED colors. */
  ledFill: Rgb | null
  /** Approximate color for the preview, when the mode shows a fixed color. */
  preview: Rgb | null
  signature: string
}

export type DevicePlan = SoftwarePlan | HardwarePlan

export const DEFAULT_DEVICE_LIGHTING: DeviceLighting = {
  control: 'software',
  followSync: true,
  zones: {},
  hardware: null
}

const DEFAULT_WHITE_BALANCE = { r: 100, g: 100, b: 100 }

const IDENTIFY_EFFECT: EffectConfig = {
  id: 'strobe',
  colors: [WHITE],
  speed: 20,
  brightness: 100,
  size: 50,
  reverse: false
}

const OFF_EFFECT: EffectConfig = { ...IDENTIFY_EFFECT, id: 'off' }
const WHITE_EFFECT: EffectConfig = { ...IDENTIFY_EFFECT, id: 'static' }

/** Lights every LED dimly and the last one in red, to count LEDs on an ARGB header. */
const ledCountRenderer: ZoneRenderer = ({ count }, target, offset) => {
  for (let i = 0; i < count; i++) {
    const last = i === count - 1
    const base = (offset + i) * 3
    target[base] = last ? 255 : 90
    target[base + 1] = last ? 0 : 90
    target[base + 2] = last ? 0 : 90
  }
}

function zoneSeed(deviceId: string, zoneIndex: number): number {
  let h = zoneIndex
  for (let i = 0; i < deviceId.length; i++) h = Math.imul(h ^ deviceId.charCodeAt(i), 16777619)
  return Math.floor(hash3(h, zoneIndex, 11) * 0x7fffffff)
}

/** Column of every LED of a matrix zone, so spatial effects follow the physical layout. */
function zoneLayout(zone: ZoneInfo): ZoneLayout | undefined {
  const matrix = zone.matrix
  if (!matrix || matrix.width === 0) return undefined
  const columns = new Float32Array(zone.ledCount)
  matrix.cells.forEach((led, cell) => {
    if (led !== null && led < zone.ledCount) columns[led] = cell % matrix.width
  })
  return { columns, width: matrix.width }
}

function softwarePlan(
  device: DeviceInfo,
  gains: ChannelGains,
  effectFor: (zoneIndex: number) => { effect: EffectConfig; render?: ZoneRenderer; key: string }
): SoftwarePlan {
  const zones: ZonePlan[] = []
  const keys: string[] = []
  for (const zone of device.zones) {
    if (zone.ledCount === 0) continue
    const { effect, render, key } = effectFor(zone.index)
    keys.push(`${zone.index}:${zone.ledCount}:${key}`)
    zones.push({
      zoneIndex: zone.index,
      startIndex: zone.startIndex,
      ledCount: zone.ledCount,
      seed: zoneSeed(device.id, zone.index),
      layout: zoneLayout(zone),
      animated: render ? false : getEffect(effect.id).animated,
      period: render ? null : effectPeriod(effect),
      render: render ?? effectRenderer(effect)
    })
  }
  return {
    kind: 'software',
    deviceId: device.id,
    ledCount: device.ledCount,
    zones,
    gains,
    signature: `${keys.join('|')}#${gains.r.toFixed(4)},${gains.g.toFixed(4)},${gains.b.toFixed(4)}`
  }
}

function overlayPlan(
  device: DeviceInfo,
  overlay: Overlay,
  lighting: LightingState,
  settings: DeviceSettings | undefined
): SoftwarePlan {
  switch (overlay.kind) {
    case 'identify':
      return softwarePlan(device, UNITY_GAINS, (zoneIndex) =>
        overlay.zoneIndex === null || overlay.zoneIndex === zoneIndex
          ? { effect: IDENTIFY_EFFECT, key: 'identify' }
          : { effect: OFF_EFFECT, key: 'off' }
      )
    case 'white-test':
      return softwarePlan(
        device,
        channelGains(lighting.brightness / 100, settings?.whiteBalance ?? DEFAULT_WHITE_BALANCE),
        () => ({
          effect: WHITE_EFFECT,
          key: 'white'
        })
      )
    case 'led-count':
      return softwarePlan(device, UNITY_GAINS, (zoneIndex) =>
        overlay.zoneIndex === zoneIndex
          ? { effect: WHITE_EFFECT, render: ledCountRenderer, key: 'count' }
          : { effect: OFF_EFFECT, key: 'off' }
      )
  }
}

/** Builds the hardware plan; returns null when the mode no longer exists on the device. */
function hardwarePlan(
  device: DeviceInfo,
  lighting: DeviceLighting,
  level: number,
  whiteBalance: DeviceSettings['whiteBalance']
): HardwarePlan | null {
  const config = lighting.hardware
  if (!config) return null
  const mode = device.modes.find((candidate) => candidate.name === config.modeName)
  if (!mode) return null

  // Brightness is applied by the device when it can; otherwise it is folded into the colors.
  const colorGains = channelGains(mode.capabilities.brightness ? 1 : level, whiteBalance)
  const colors = config.colors.map((color) => correctColor(color, colorGains))
  const overrides: ModeOverrides = {
    speed: config.speed,
    brightness: mode.capabilities.brightness ? Math.round((config.brightness ?? 100) * level) : null,
    direction: config.direction,
    colorMode: config.colorMode,
    colors
  }
  // Modes whose colors live in the LEDs (most motherboard modes) take them from a per-LED write.
  const perLed = config.colorMode === 'per-led' || (config.colorMode === null && mode.colorMode === 'per-led')
  const ledFill = perLed ? (colors[0] ?? null) : null
  const preview = ledFill ?? (config.colorMode === 'mode-specific' ? (colors[0] ?? null) : null)
  return {
    kind: 'hardware',
    deviceId: device.id,
    modeName: mode.name,
    overrides,
    ledFill,
    preview,
    signature: JSON.stringify({ overrides, ledFill }) + mode.name
  }
}

export function planDevice(
  device: DeviceInfo,
  lighting: LightingState,
  settings: DeviceSettings | undefined,
  overlay: Overlay | undefined
): DevicePlan | null {
  if (overlay) return device.supportsDirect ? overlayPlan(device, overlay, lighting, settings) : null

  const deviceLighting = lighting.devices[device.id] ?? DEFAULT_DEVICE_LIGHTING
  const whiteBalance = settings?.whiteBalance ?? DEFAULT_WHITE_BALANCE
  const level = lighting.power ? lighting.brightness / 100 : 0
  const gains = channelGains(level, whiteBalance)
  const synced = lighting.sync && deviceLighting.followSync

  if (lighting.power && !synced && deviceLighting.control === 'hardware') {
    const plan = hardwarePlan(device, deviceLighting, level, whiteBalance)
    if (plan) return plan
  }

  if (!device.supportsDirect) return null

  if (!lighting.power) {
    return softwarePlan(device, gains, () => ({ effect: OFF_EFFECT, key: 'off' }))
  }
  return softwarePlan(device, gains, (zoneIndex) => {
    const effect = synced
      ? lighting.syncEffect
      : (deviceLighting.zones[String(zoneIndex)] ?? lighting.syncEffect)
    return { effect, key: JSON.stringify(effect) }
  })
}
