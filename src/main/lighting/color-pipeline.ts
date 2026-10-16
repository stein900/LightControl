/**
 * Final output stage: master power and brightness, then per-device white
 * balance. White balance compensates LEDs whose white leans warm or cold,
 * typically because blue dims first when a long ARGB chain sags in voltage.
 */
import type { Rgb } from '@shared/color'
import { rgb } from '@shared/color'
import type { WhiteBalance } from '@shared/model'

export interface ChannelGains {
  r: number
  g: number
  b: number
}

export const UNITY_GAINS: ChannelGains = Object.freeze({ r: 1, g: 1, b: 1 })

export function channelGains(level: number, whiteBalance: WhiteBalance): ChannelGains {
  const k = Math.min(1, Math.max(0, level))
  return { r: (whiteBalance.r / 100) * k, g: (whiteBalance.g / 100) * k, b: (whiteBalance.b / 100) * k }
}

export function correctColor(color: Rgb, gains: ChannelGains): Rgb {
  return rgb(color.r * gains.r, color.g * gains.g, color.b * gains.b)
}

/**
 * Applies gains and quantises the float frame into `target`.
 * Returns true when at least one byte changed.
 */
export function quantize(source: Float32Array, target: Uint8Array, gains: ChannelGains): boolean {
  let changed = false
  for (let i = 0; i < target.length; i += 3) {
    const r = Math.round(Math.min(255, Math.max(0, source[i]! * gains.r)))
    const g = Math.round(Math.min(255, Math.max(0, source[i + 1]! * gains.g)))
    const b = Math.round(Math.min(255, Math.max(0, source[i + 2]! * gains.b)))
    if (target[i] !== r || target[i + 1] !== g || target[i + 2] !== b) {
      target[i] = r
      target[i + 1] = g
      target[i + 2] = b
      changed = true
    }
  }
  return changed
}
