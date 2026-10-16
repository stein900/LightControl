import { Minus, Plus } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react'
import styles from './controls.module.css'

const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ')

/* --------------------------------- Button --------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: ReactNode
  /** Renders a square icon button; `aria-label` becomes mandatory. */
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        size === 'sm' && styles.sm,
        iconOnly && styles.iconOnly,
        className
      )}
      title={iconOnly ? rest['aria-label'] : undefined}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  )
})

/* --------------------------------- Switch --------------------------------- */

export interface SwitchProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  label: string
}

export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    />
  )
}

/* --------------------------------- Slider --------------------------------- */

export interface SliderProps {
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  label: string
  format?: (value: number) => string
}

/** Range input that keeps its own value while dragging, so throttled commits never make it jump. */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  label,
  format
}: SliderProps) {
  const [local, setLocal] = useState(value)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) setLocal(value)
  }, [value, dragging])

  const fill = max === min ? 0 : ((local - min) / (max - min)) * 100
  return (
    <div className={styles.slider}>
      <input
        type="range"
        className={styles.range}
        style={{ ['--fill' as string]: `${fill}%` }}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        onChange={(event) => {
          const next = Number(event.target.value)
          setLocal(next)
          onChange(next)
        }}
      />
      <span className={cx(styles.sliderValue, 'mono')}>
        {format ? format(local) : `${Math.round(local)}`}
      </span>
    </div>
  )
}

/* ---------------------------- Segmented control ---------------------------- */

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange(value: T): void
  label: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------- Inputs --------------------------------- */

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(styles.input, className)} spellCheck={false} {...rest} />
  }
)

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(styles.input, styles.select, className)} {...rest}>
      {children}
    </select>
  )
}

export interface StepperProps {
  value: number
  min: number
  max: number
  onChange(value: number): void
  label: string
}

/** Integer input with increment buttons; typed values are committed on blur or Enter. */
export function Stepper({ value, min, max, onChange, label }: StepperProps) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (next: number): void => {
    const clamped = Math.min(max, Math.max(min, Math.round(next)))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className={styles.stepper}>
      <button
        type="button"
        aria-label={`${label} : diminuer`}
        disabled={value <= min}
        onClick={() => commit(value - 1)}
      >
        <Minus size={14} />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(Number(draft || min))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(Number(draft || min))
          if (event.key === 'ArrowUp') commit(value + 1)
          if (event.key === 'ArrowDown') commit(value - 1)
        }}
      />
      <button
        type="button"
        aria-label={`${label} : augmenter`}
        disabled={value >= max}
        onClick={() => commit(value + 1)}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
