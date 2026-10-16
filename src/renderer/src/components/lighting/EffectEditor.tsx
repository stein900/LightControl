import {
  Blend,
  Circle,
  Orbit,
  Palette,
  PowerOff,
  Rainbow,
  Sparkles,
  Waves,
  Wind,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EFFECTS, getEffect, normalizeEffectConfig } from '@shared/effects'
import type { EffectConfig, EffectId } from '@shared/model'
import { Slider, Switch } from '@renderer/components/ui/controls'
import { useThrottled } from '@renderer/lib/use-throttled'
import { ColorList } from './ColorPicker'
import styles from './effect.module.css'

const ICONS: Record<EffectId, LucideIcon> = {
  static: Circle,
  gradient: Blend,
  breathing: Wind,
  spectrum: Palette,
  rainbow: Rainbow,
  wave: Waves,
  comet: Orbit,
  twinkle: Sparkles,
  strobe: Zap,
  off: PowerOff
}

/** Incoming values are ignored this long after a local edit, so late snapshots never rewind a drag. */
const LOCAL_EDIT_GRACE_MS = 400

export interface EffectEditorProps {
  value: EffectConfig
  onChange(effect: EffectConfig): void
}

export function EffectEditor({ value, onChange }: EffectEditorProps) {
  const [draft, setDraft] = useState(value)
  const lastEdit = useRef(0)
  const commit = useThrottled(onChange, 60)

  useEffect(() => {
    if (performance.now() - lastEdit.current > LOCAL_EDIT_GRACE_MS) setDraft(value)
  }, [value])

  const update = (patch: Partial<EffectConfig>, immediate = false): void => {
    const next = normalizeEffectConfig({ ...draft, ...patch })
    lastEdit.current = performance.now()
    setDraft(next)
    if (immediate) onChange(next)
    else commit(next)
  }

  const descriptor = getEffect(draft.id)

  return (
    <div className={styles.editor}>
      <div className={styles.tiles} role="radiogroup" aria-label="Effet">
        {EFFECTS.map((effect) => {
          const Icon = ICONS[effect.id]
          return (
            <button
              key={effect.id}
              type="button"
              role="radio"
              aria-checked={effect.id === draft.id}
              className={styles.tile}
              title={effect.description}
              onClick={() => update({ id: effect.id }, true)}
            >
              <Icon size={18} strokeWidth={1.75} />
              {effect.label}
            </button>
          )
        })}
      </div>
      <p className={styles.description}>{descriptor.description}</p>

      {descriptor.id !== 'off' && (
        <div className={styles.params}>
          {descriptor.speed && (
            <div className={styles.param}>
              <span className={styles.paramLabel}>Vitesse</span>
              <Slider label="Vitesse" value={draft.speed} onChange={(speed) => update({ speed })} />
            </div>
          )}
          {descriptor.size && (
            <div className={styles.param}>
              <span className={styles.paramLabel}>{descriptor.size}</span>
              <Slider label={descriptor.size} value={draft.size} onChange={(size) => update({ size })} />
            </div>
          )}
          <div className={styles.param}>
            <span className={styles.paramLabel}>Intensité</span>
            <Slider
              label="Intensité"
              value={draft.brightness}
              onChange={(brightness) => update({ brightness })}
              format={(v) => `${Math.round(v)} %`}
            />
          </div>
          {descriptor.reverse && (
            <div className={styles.param}>
              <span className={styles.paramLabel}>Sens inverse</span>
              <div>
                <Switch
                  label="Sens inverse"
                  checked={draft.reverse}
                  onChange={(reverse) => update({ reverse }, true)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {descriptor.colors && (
        <div className={styles.group}>
          <span className={styles.groupLabel}>{descriptor.colors.max > 1 ? 'Couleurs' : 'Couleur'}</span>
          <ColorList
            colors={draft.colors}
            min={descriptor.colors.min}
            max={descriptor.colors.max}
            onChange={(colors) => update({ colors })}
          />
        </div>
      )}
    </div>
  )
}
