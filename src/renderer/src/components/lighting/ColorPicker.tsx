import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  hexToRgb,
  hsvToRgb,
  kelvinToRgb,
  rgbToHex,
  rgbToHsv,
  sameRgb,
  type Hsv,
  type Rgb
} from '@shared/color'
import { Button, TextInput } from '@renderer/components/ui/controls'
import styles from './color.module.css'

const WHITES: { label: string; color: Rgb }[] = [
  { label: 'Blanc pur (255, 255, 255)', color: { r: 255, g: 255, b: 255 } },
  { label: 'Blanc froid (7500 K)', color: kelvinToRgb(7500) },
  { label: 'Blanc neutre (6500 K)', color: kelvinToRgb(6500) },
  { label: 'Blanc chaud (4000 K)', color: kelvinToRgb(4000) },
  { label: 'Blanc très chaud (2700 K)', color: kelvinToRgb(2700) }
]

const COLORS: { label: string; color: Rgb }[] = [
  { label: 'Rouge', color: { r: 255, g: 0, b: 0 } },
  { label: 'Orange', color: { r: 255, g: 96, b: 0 } },
  { label: 'Jaune', color: { r: 255, g: 200, b: 0 } },
  { label: 'Vert', color: { r: 0, g: 255, b: 64 } },
  { label: 'Cyan', color: { r: 0, g: 220, b: 255 } },
  { label: 'Bleu', color: { r: 0, g: 64, b: 255 } },
  { label: 'Violet', color: { r: 140, g: 0, b: 255 } },
  { label: 'Rose', color: { r: 255, g: 0, b: 140 } }
]

function useDrag(onPoint: (x: number, y: number) => void) {
  return (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const update = (clientX: number, clientY: number): void => {
      const rect = element.getBoundingClientRect()
      onPoint(
        Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
      )
    }
    update(event.clientX, event.clientY)
    const move = (e: PointerEvent): void => update(e.clientX, e.clientY)
    const up = (): void => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
  }
}

export interface ColorPickerProps {
  value: Rgb
  onChange(color: Rgb): void
}

/** Saturation/value area, hue strip, numeric inputs and presets including calibrated whites. */
export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(value))
  const [hex, setHex] = useState(rgbToHex(value))
  const emitted = useRef(value)

  // Follow external changes, but keep the hue when the color is grey or black.
  useEffect(() => {
    if (sameRgb(value, emitted.current)) return
    emitted.current = value
    const next = rgbToHsv(value)
    setHsv((previous) => (next.s === 0 || next.v === 0 ? { ...next, h: previous.h } : next))
    setHex(rgbToHex(value))
  }, [value])

  const emit = (next: Hsv): void => {
    setHsv(next)
    const color = hsvToRgb(next)
    setHex(rgbToHex(color))
    emitted.current = color
    onChange(color)
  }

  const emitRgb = (color: Rgb): void => {
    emitted.current = color
    setHsv((previous) => {
      const next = rgbToHsv(color)
      return next.s === 0 || next.v === 0 ? { ...next, h: previous.h } : next
    })
    setHex(rgbToHex(color))
    onChange(color)
  }

  const onArea = useDrag((x, y) => emit({ h: hsv.h, s: x, v: 1 - y }))
  const onHue = useDrag((x) => emit({ ...hsv, h: Math.min(359.9, x * 360) }))
  const current = hsvToRgb(hsv)

  const channel = (key: keyof Rgb, label: string) => (
    <label>
      {label}
      <TextInput
        inputMode="numeric"
        value={current[key]}
        aria-label={`Composante ${label}`}
        onChange={(event) => {
          const parsed = Number(event.target.value.replace(/[^0-9]/g, '') || 0)
          emitRgb({ ...current, [key]: Math.min(255, parsed) })
        }}
      />
    </label>
  )

  return (
    <div className={styles.picker}>
      <div
        className={styles.area}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={onArea}
        role="slider"
        aria-label="Saturation et luminosité"
        aria-valuenow={Math.round(hsv.s * 100)}
      >
        <span
          className={styles.thumb}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: rgbToHex(current) }}
        />
      </div>
      <div
        className={styles.hue}
        onPointerDown={onHue}
        role="slider"
        aria-label="Teinte"
        aria-valuenow={Math.round(hsv.h)}
      >
        <span
          className={styles.thumb}
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>
      <div className={styles.inputs}>
        <label>
          Hex
          <TextInput
            value={hex}
            aria-label="Couleur hexadécimale"
            onChange={(event) => {
              setHex(event.target.value)
              const parsed = hexToRgb(event.target.value)
              if (parsed && event.target.value.replace('#', '').length === 6) emitRgb(parsed)
            }}
            onBlur={() => setHex(rgbToHex(current))}
          />
        </label>
        {channel('r', 'R')}
        {channel('g', 'G')}
        {channel('b', 'B')}
      </div>
      <div className={styles.presets}>
        <div className={styles.presetGroup}>
          <span className={styles.presetLabel}>Blancs</span>
          {WHITES.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={styles.swatch}
              style={{ background: rgbToHex(preset.color) }}
              title={preset.label}
              aria-label={preset.label}
              onClick={() => emitRgb(preset.color)}
            />
          ))}
        </div>
        <div className={styles.presetGroup}>
          <span className={styles.presetLabel}>Couleurs</span>
          {COLORS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={styles.swatch}
              style={{ background: rgbToHex(preset.color) }}
              title={preset.label}
              aria-label={preset.label}
              onClick={() => emitRgb(preset.color)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export interface ColorListProps {
  colors: Rgb[]
  min: number
  max: number
  onChange(colors: Rgb[]): void
}

/** Editable list of colors with a picker for the selected entry. */
export function ColorList({ colors, min, max, onChange }: ColorListProps) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, colors.length - 1)
  const color = colors[index] ?? { r: 255, g: 255, b: 255 }

  return (
    <div className={styles.picker}>
      {max > 1 && (
        <div className={styles.list}>
          {colors.map((entry, i) => (
            <button
              key={i}
              type="button"
              className={styles.listSwatch}
              style={{ background: rgbToHex(entry) }}
              aria-pressed={i === index}
              aria-label={`Couleur ${i + 1}`}
              onClick={() => setSelected(i)}
            />
          ))}
          {colors.length < max && (
            <button
              type="button"
              className={styles.addSwatch}
              aria-label="Ajouter une couleur"
              title="Ajouter une couleur"
              onClick={() => {
                onChange([...colors, colors[colors.length - 1] ?? color])
                setSelected(colors.length)
              }}
            >
              <Plus size={16} />
            </button>
          )}
          {colors.length > min && (
            <Button
              className={styles.listHint}
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={() => {
                onChange(colors.filter((_, i) => i !== index))
                setSelected(Math.max(0, index - 1))
              }}
            >
              Retirer
            </Button>
          )}
        </div>
      )}
      <ColorPicker
        value={color}
        onChange={(next) => onChange(colors.map((entry, i) => (i === index ? next : entry)))}
      />
    </div>
  )
}
