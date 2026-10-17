import { rgbToHex } from '@shared/color'
import type { EffectId, ProfilePreview } from '@shared/model'
import styles from './color.module.css'

/** Effects that cycle through every hue, whatever colors they store. */
const HUE_CYCLES: ReadonlySet<EffectId> = new Set(['rainbow', 'spectrum'])
const RAINBOW = 'linear-gradient(90deg, #ff3b3b, #ffb000, #3bd16f, #2f8cff, #a04bff, #ff3b9a)'

/** Pill showing a profile's colors: a gradient of its effect colors, a rainbow, or "off". */
export function ProfileSwatch({ preview }: { preview: ProfilePreview }) {
  const { power, effect, colors } = preview
  let background = 'var(--led-off)'
  if (power && effect !== 'off') {
    if (HUE_CYCLES.has(effect)) background = RAINBOW
    else if (colors.length === 1) background = rgbToHex(colors[0]!)
    else if (colors.length > 1) background = `linear-gradient(90deg, ${colors.map(rgbToHex).join(', ')})`
  }
  return <span className={styles.swatch} style={{ background }} aria-hidden />
}
