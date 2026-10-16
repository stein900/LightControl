import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAppStore } from '@renderer/store/app-store'
import { Button } from './controls'
import styles from './surfaces.module.css'

const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ')

export function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  )
}

export interface SectionProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  flush?: boolean
  children: ReactNode
}

export function Section({ title, description, actions, flush, children }: SectionProps) {
  return (
    <section className={styles.section}>
      {(title || actions) && (
        <div className={styles.sectionHeader}>
          <div>
            {title && <h2 className={styles.sectionTitle}>{title}</h2>}
            {description && <p className={styles.sectionDescription}>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? styles.sectionBodyFlush : styles.sectionBody}>{children}</div>
    </section>
  )
}

export interface FieldProps {
  label: ReactNode
  description?: ReactNode
  stacked?: boolean
  children: ReactNode
}

export function Field({ label, description, stacked, children }: FieldProps) {
  return (
    <div className={cx(styles.field, stacked && styles.fieldStacked)}>
      <div>
        <div className={styles.fieldLabel}>{label}</div>
        {description && <div className={styles.fieldDescription}>{description}</div>}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  )
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger'

export function Badge({
  tone = 'neutral',
  dot,
  children
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={cx(styles.badge, tone !== 'neutral' && styles[tone])}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  )
}

export interface BannerProps {
  tone: 'info' | 'warning' | 'danger'
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

export function Banner({ tone, title, children, actions }: BannerProps) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? TriangleAlert : CircleAlert
  return (
    <div className={cx(styles.banner, styles[tone])} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon size={18} />
      <div>
        <div className={styles.bannerTitle}>{title}</div>
        {children && <div className={styles.bannerText}>{children}</div>}
      </div>
      {actions ? <div className={styles.bannerActions}>{actions}</div> : <span />}
    </div>
  )
}

export interface DialogProps {
  title: string
  children?: ReactNode
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  confirmDisabled?: boolean
  onConfirm(): void
  onCancel(): void
}

export function Dialog({
  title,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  confirmDisabled,
  onConfirm,
  onCancel
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onCancel])

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!confirmDisabled) onConfirm()
          }}
        >
          <div className={styles.dialogBody}>
            <h2 className={styles.dialogTitle}>{title}</h2>
            {children}
          </div>
          <div className={styles.dialogFooter}>
            <Button variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
            <Button type="submit" variant={confirmVariant} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function DialogText({ children }: { children: ReactNode }) {
  return <p className={styles.dialogText}>{children}</p>
}

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismiss)
  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'error' ? CircleAlert : toast.tone === 'success' ? CircleCheck : Info
        return (
          <div key={toast.id} className={cx(styles.toast, styles[toast.tone])} role="status">
            <Icon size={16} />
            <span>{toast.message}</span>
            <button
              type="button"
              className={styles.toastClose}
              aria-label="Fermer"
              onClick={() => dismiss(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export interface EmptyStateProps {
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

export function EmptyState({ icon, title, children, actions }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon}</div>
      <div className={styles.emptyTitle}>{title}</div>
      {children && <div>{children}</div>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  )
}
