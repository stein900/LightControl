import type { EffectConfig, EffectId } from './model'

export interface EffectDescriptor {
  id: EffectId
  label: string
  description: string
  /** Animated effects are re-rendered every frame; the others are sent once. */
  animated: boolean
  colors: { min: number; max: number } | null
  speed: boolean
  /** Label of the size parameter when the effect uses it. */
  size: string | null
  reverse: boolean
}

export const EFFECTS: readonly EffectDescriptor[] = [
  {
    id: 'static',
    label: 'Statique',
    description: 'Une couleur fixe sur toutes les LED.',
    animated: false,
    colors: { min: 1, max: 1 },
    speed: false,
    size: null,
    reverse: false
  },
  {
    id: 'gradient',
    label: 'Dégradé',
    description: 'Transition fixe entre plusieurs couleurs le long de la zone.',
    animated: false,
    colors: { min: 2, max: 6 },
    speed: false,
    size: null,
    reverse: true
  },
  {
    id: 'breathing',
    label: 'Respiration',
    description: 'Fondu progressif, en alternant entre les couleurs choisies.',
    animated: true,
    colors: { min: 1, max: 6 },
    speed: true,
    size: null,
    reverse: false
  },
  {
    id: 'spectrum',
    label: 'Spectre',
    description: 'Toute la zone parcourt le cercle chromatique.',
    animated: true,
    colors: null,
    speed: true,
    size: null,
    reverse: true
  },
  {
    id: 'rainbow',
    label: 'Arc-en-ciel',
    description: 'Un arc-en-ciel qui défile le long des LED.',
    animated: true,
    colors: null,
    speed: true,
    size: 'Longueur',
    reverse: true
  },
  {
    id: 'wave',
    label: 'Vague',
    description: 'Les couleurs choisies défilent en vague continue.',
    animated: true,
    colors: { min: 2, max: 6 },
    speed: true,
    size: 'Longueur',
    reverse: true
  },
  {
    id: 'comet',
    label: 'Comète',
    description: 'Un point lumineux avec traînée qui tourne autour de la zone.',
    animated: true,
    colors: { min: 1, max: 2 },
    speed: true,
    size: 'Traînée',
    reverse: true
  },
  {
    id: 'twinkle',
    label: 'Scintillement',
    description: 'Des LED s’allument et s’éteignent aléatoirement.',
    animated: true,
    colors: { min: 1, max: 6 },
    speed: true,
    size: 'Densité',
    reverse: false
  },
  {
    id: 'strobe',
    label: 'Stroboscope',
    description: 'Clignotement net entre la couleur et le noir.',
    animated: true,
    colors: { min: 1, max: 6 },
    speed: true,
    size: null,
    reverse: false
  },
  {
    id: 'off',
    label: 'Éteint',
    description: 'Les LED de la zone restent éteintes.',
    animated: false,
    colors: null,
    speed: false,
    size: null,
    reverse: false
  }
]

const BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]))

export function getEffect(id: EffectId): EffectDescriptor {
  const effect = BY_ID.get(id)
  if (!effect) throw new Error(`Unknown effect: ${id}`)
  return effect
}

/** Returns a copy of `config` whose color list satisfies the effect's bounds. */
export function normalizeEffectConfig(config: EffectConfig): EffectConfig {
  const descriptor = getEffect(config.id)
  if (!descriptor.colors) return config
  const { min, max } = descriptor.colors
  const colors = config.colors.slice(0, max)
  const fallback = [
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 112, b: 243 },
    { r: 255, g: 0, b: 128 },
    { r: 0, g: 200, b: 120 },
    { r: 255, g: 170, b: 0 },
    { r: 140, g: 80, b: 255 }
  ]
  while (colors.length < min) colors.push(fallback[colors.length % fallback.length]!)
  return { ...config, colors }
}
