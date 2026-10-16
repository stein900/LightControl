/**
 * Software effects, rendered per LED into a float buffer (0-255 per channel).
 * Rendering is a pure function of the configuration, the LED position and a
 * shared clock, so every zone on every device stays in phase.
 */
import type { Rgb } from '@shared/color'
import type { EffectConfig } from '@shared/model'

export interface RenderContext {
  /** Shared clock in seconds. */
  time: number
  /** Number of LEDs in the zone. */
  count: number
  /** Per-zone seed for effects that use pseudo-randomness. */
  seed: number
  /** Physical column of each LED for matrix zones (keyboards), so effects sweep across rather than along rows. */
  layout?: ZoneLayout
}

export interface ZoneLayout {
  /** Column index of each LED, indexed by LED. */
  columns: Float32Array
  width: number
}

/** Writes `count` RGB triplets starting at `offset` (in LEDs) into `target`. */
export type ZoneRenderer = (context: RenderContext, target: Float32Array, offset: number) => void

const TAU = Math.PI * 2

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const fract = (value: number): number => value - Math.floor(value)

/** Revolutions per second for moving effects, eased so low speeds stay usable. */
const travelRate = (speed: number): number => lerp(0.04, 1.6, Math.pow(speed / 100, 1.4))
/** Seconds per breath. */
const breathingPeriod = (speed: number): number => lerp(7, 0.9, Math.pow(speed / 100, 1.2))
/** Hue rotation of the spectrum effect, in degrees per second. */
const spectrumRate = (speed: number): number => lerp(6, 180, Math.pow(speed / 100, 1.5))
/** Flashes per second. */
const strobeRate = (speed: number): number => lerp(0.5, 10, Math.pow(speed / 100, 1.3))
/** Twinkle has no period; loops of this length are seamless enough to the eye. */
const TWINKLE_LOOP_SECONDS = 8

/**
 * Duration after which the effect repeats exactly, in seconds, or null for a
 * still image. Used to pre-render loops for devices that play animations on their own.
 */
export function effectPeriod(effect: EffectConfig): number | null {
  switch (effect.id) {
    case 'off':
    case 'static':
    case 'gradient':
      return null
    case 'breathing':
      return breathingPeriod(effect.speed) * Math.max(1, effect.colors.length)
    case 'spectrum':
      return 360 / spectrumRate(effect.speed)
    case 'rainbow':
    case 'wave':
    case 'comet':
      return 1 / travelRate(effect.speed)
    case 'strobe':
      return Math.max(1, effect.colors.length) / strobeRate(effect.speed)
    case 'twinkle':
      return TWINKLE_LOOP_SECONDS
  }
}

/** Number of pattern repetitions across a zone; size 50 shows the pattern once. */
const repetitions = (size: number): number => Math.pow(2, (0.5 - size / 100) * 3)

/** Deterministic hash of three integers to [0, 1). */
export function hash3(a: number, b: number, c: number): number {
  let h =
    Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^
    Math.imul(c + 0x27d4eb2f, 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function write(target: Float32Array, led: number, r: number, g: number, b: number): void {
  const i = led * 3
  target[i] = r
  target[i + 1] = g
  target[i + 2] = b
}

function writeColor(target: Float32Array, led: number, color: Rgb, intensity: number): void {
  write(target, led, color.r * intensity, color.g * intensity, color.b * intensity)
}

function hueToRgb(hue: number, intensity: number, target: Float32Array, led: number): void {
  const h = fract(hue / 360) * 6
  const x = 1 - Math.abs((h % 2) - 1)
  const v = 255 * intensity
  const [r, g, b] =
    h < 1
      ? [1, x, 0]
      : h < 2
        ? [x, 1, 0]
        : h < 3
          ? [0, 1, x]
          : h < 4
            ? [0, x, 1]
            : h < 5
              ? [x, 0, 1]
              : [1, 0, x]
  write(target, led, r * v, g * v, b * v)
}

/** Samples a palette at `t` in [0, 1); cyclic palettes wrap from the last color back to the first. */
function samplePalette(
  colors: Rgb[],
  t: number,
  cyclic: boolean,
  intensity: number,
  target: Float32Array,
  led: number
): void {
  const n = colors.length
  if (n === 1) {
    writeColor(target, led, colors[0]!, intensity)
    return
  }
  const segments = cyclic ? n : n - 1
  const position = Math.min(Math.max(t, 0), cyclic ? 0.999999 : 1) * segments
  const index = Math.min(Math.floor(position), segments - 1)
  const local = position - index
  const a = colors[index]!
  const b = colors[(index + 1) % n]!
  write(
    target,
    led,
    lerp(a.r, b.r, local) * intensity,
    lerp(a.g, b.g, local) * intensity,
    lerp(a.b, b.b, local) * intensity
  )
}

export function renderEffect(
  effect: EffectConfig,
  context: RenderContext,
  target: Float32Array,
  offset: number
): void {
  const { time, count, seed, layout } = context
  /** Position in [0, 1) for repeating patterns. */
  const along = (i: number): number => (layout ? layout.columns[i]! / layout.width : i / Math.max(count, 1))
  /** Position in [0, 1] for patterns that span the zone end to end. */
  const span = layout
    ? (i: number): number => (layout.width > 1 ? layout.columns[i]! / (layout.width - 1) : 0)
    : (i: number): number => (count <= 1 ? 0 : i / (count - 1))
  const level = effect.brightness / 100
  const speed = effect.speed / 100
  const direction = effect.reverse ? -1 : 1
  const colors = effect.colors
  const primary = colors[0] ?? { r: 255, g: 255, b: 255 }

  switch (effect.id) {
    case 'off': {
      target.fill(0, offset * 3, (offset + count) * 3)
      return
    }
    case 'static': {
      for (let i = 0; i < count; i++) writeColor(target, offset + i, primary, level)
      return
    }
    case 'gradient': {
      for (let i = 0; i < count; i++) {
        const t = span(i)
        samplePalette(colors, effect.reverse ? 1 - t : t, false, level, target, offset + i)
      }
      return
    }
    case 'breathing': {
      const period = breathingPeriod(effect.speed)
      const phase = time / period
      const color = colors[Math.floor(phase) % colors.length] ?? primary
      const intensity = ((1 - Math.cos(TAU * fract(phase))) / 2) * level
      for (let i = 0; i < count; i++) writeColor(target, offset + i, color, intensity)
      return
    }
    case 'spectrum': {
      const hue = time * spectrumRate(effect.speed) * direction
      for (let i = 0; i < count; i++) hueToRgb(hue, level, target, offset + i)
      return
    }
    case 'rainbow': {
      const repeats = repetitions(effect.size)
      const shift = time * travelRate(effect.speed) * direction
      for (let i = 0; i < count; i++) hueToRgb(360 * (along(i) * repeats - shift), level, target, offset + i)
      return
    }
    case 'wave': {
      const repeats = repetitions(effect.size)
      const shift = time * travelRate(effect.speed) * direction
      for (let i = 0; i < count; i++) {
        samplePalette(colors, fract(along(i) * repeats - shift), true, level, target, offset + i)
      }
      return
    }
    case 'comet': {
      const head = fract(time * travelRate(effect.speed))
      const extent = layout ? layout.width : count
      const tail = (1 + (effect.size / 100) * Math.max(extent - 1, 0) * 0.9) / Math.max(extent, 1)
      const background = colors[1] ?? null
      for (let i = 0; i < count; i++) {
        const distance = effect.reverse ? fract(along(i) - (1 - head)) : fract(head - along(i))
        const intensity = distance < tail ? Math.pow(1 - distance / tail, 2) : 0
        const r = lerp(background?.r ?? 0, primary.r, intensity)
        const g = lerp(background?.g ?? 0, primary.g, intensity)
        const b = lerp(background?.b ?? 0, primary.b, intensity)
        write(target, offset + i, r * level, g * level, b * level)
      }
      return
    }
    case 'twinkle': {
      const density = 0.05 + (effect.size / 100) * 0.9
      const basePeriod = lerp(3, 0.5, speed)
      for (let i = 0; i < count; i++) {
        const period = basePeriod * (0.6 + hash3(seed, i, 1) * 0.8)
        const phase = time / period + hash3(seed, i, 2)
        const cycle = Math.floor(phase)
        const active = hash3(seed, i, cycle * 7 + 3) < density
        if (!active) {
          write(target, offset + i, 0, 0, 0)
          continue
        }
        const color = colors[Math.floor(hash3(seed, i, cycle * 7 + 5) * colors.length)] ?? primary
        writeColor(target, offset + i, color, Math.pow(Math.sin(Math.PI * fract(phase)), 2) * level)
      }
      return
    }
    case 'strobe': {
      const phase = time * strobeRate(effect.speed)
      const on = fract(phase) < 0.25
      const color = colors[Math.floor(phase) % colors.length] ?? primary
      for (let i = 0; i < count; i++) writeColor(target, offset + i, color, on ? level : 0)
      return
    }
  }
}

export function effectRenderer(effect: EffectConfig): ZoneRenderer {
  return (context, target, offset) => renderEffect(effect, context, target, offset)
}
