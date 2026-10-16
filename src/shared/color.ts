/** 8-bit RGB triplet. Components are integers in [0, 255]. */
export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsv {
  /** Hue in degrees, [0, 360). */
  h: number
  /** Saturation, [0, 1]. */
  s: number
  /** Value, [0, 1]. */
  v: number
}

export const BLACK: Rgb = Object.freeze({ r: 0, g: 0, b: 0 })
export const WHITE: Rgb = Object.freeze({ r: 255, g: 255, b: 255 })

export function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value)
}

export function rgb(r: number, g: number, b: number): Rgb {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) }
}

export function sameRgb(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Parses `#RGB` or `#RRGGBB` (the leading hash is optional). Returns null on invalid input. */
export function hexToRgb(input: string): Rgb | null {
  const value = input.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.split('').map((c) => parseInt(c + c, 16)) as [number, number, number]
    return { r, g, b }
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    }
  }
  return null
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = (((h % 360) + 360) % 360) / 60
  const chroma = v * s
  const x = chroma * (1 - Math.abs((hue % 2) - 1))
  const m = v - chroma
  const [r, g, b] =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return rgb((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
}

/** Linear interpolation between two colors, `t` in [0, 1]. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t
  return rgb(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k)
}

export function scaleRgb(color: Rgb, factor: number): Rgb {
  return rgb(color.r * factor, color.g * factor, color.b * factor)
}

/**
 * Approximates the color of a black body at the given temperature
 * (Tanner Helland's fit, valid from 1000 K to 40000 K).
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g =
    t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return rgb(r, g, b)
}

/** Relative luminance (sRGB, WCAG definition) used to pick readable foregrounds. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
