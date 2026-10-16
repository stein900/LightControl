import { Activity, Bookmark, LayoutDashboard, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { rgbToHex } from '@shared/color'
import { getEffect } from '@shared/effects'
import type { AppSnapshot, DeviceInfo } from '@shared/model'
import { KindIcon } from '@renderer/components/KindIcon'
import { ENGINE_STATE_LABEL, deviceName } from '@renderer/lib/labels'
import { useAppStore, type Route } from '@renderer/store/app-store'
import styles from './shell.module.css'

function NavItem({
  active,
  icon,
  label,
  trailing,
  onClick
}: {
  active: boolean
  icon: ReactNode
  label: string
  trailing?: ReactNode
  onClick(): void
}) {
  return (
    <button
      type="button"
      className={styles.navItem}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span className={styles.navLabel}>{label}</span>
      {trailing}
    </button>
  )
}

/** Small swatch summarising what a device currently shows, when it is a single fixed color. */
function deviceSwatch(snapshot: AppSnapshot, device: DeviceInfo): string | null {
  const { lighting } = snapshot
  if (!lighting.power) return null
  const config = lighting.devices[device.id]
  const synced = lighting.sync && (config?.followSync ?? true)
  const effect = synced ? lighting.syncEffect : null
  if (effect && !getEffect(effect.id).animated && effect.id !== 'off' && effect.colors[0])
    return rgbToHex(effect.colors[0])
  return null
}

export function Sidebar({ snapshot }: { snapshot: AppSnapshot }) {
  const route = useAppStore((state) => state.route)
  const navigate = useAppStore((state) => state.navigate)
  const is = (target: Route['page']): boolean => route.page === target
  const issues =
    (snapshot.diagnostics?.conflicts.length ?? 0) + (snapshot.diagnostics?.unsupported.length ?? 0)
  const { engine } = snapshot

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Navigation principale">
        <div className={styles.navGroup}>
          <NavItem
            active={is('overview')}
            icon={<LayoutDashboard size={16} strokeWidth={1.75} />}
            label="Vue d’ensemble"
            onClick={() => navigate({ page: 'overview' })}
          />
        </div>

        <div className={styles.navGroup}>
          <div className={styles.navHeading}>Appareils</div>
          {snapshot.devices.length === 0 && <div className={styles.navEmpty}>Aucun appareil détecté</div>}
          {snapshot.devices.map((device) => {
            const swatch = deviceSwatch(snapshot, device)
            return (
              <NavItem
                key={device.id}
                active={route.page === 'device' && route.deviceId === device.id}
                icon={<KindIcon kind={device.kind} />}
                label={deviceName(device, snapshot.deviceSettings[device.id])}
                trailing={
                  swatch ? <span className={styles.swatch} style={{ background: swatch }} /> : undefined
                }
                onClick={() => navigate({ page: 'device', deviceId: device.id })}
              />
            )
          })}
        </div>

        <div className={styles.navGroup}>
          <div className={styles.navHeading}>Système</div>
          <NavItem
            active={is('profiles')}
            icon={<Bookmark size={16} strokeWidth={1.75} />}
            label="Profils"
            onClick={() => navigate({ page: 'profiles' })}
          />
          <NavItem
            active={is('diagnostics')}
            icon={<Activity size={16} strokeWidth={1.75} />}
            label="Diagnostic"
            trailing={issues > 0 ? <span className={styles.navCount}>{issues}</span> : undefined}
            onClick={() => navigate({ page: 'diagnostics' })}
          />
          <NavItem
            active={is('settings')}
            icon={<Settings size={16} strokeWidth={1.75} />}
            label="Réglages"
            onClick={() => navigate({ page: 'settings' })}
          />
        </div>
      </nav>

      <div className={styles.footer}>
        <div className={styles.engine}>
          <span className={styles.engineDot} data-state={engine.state} />
          Moteur · {ENGINE_STATE_LABEL[engine.state]}
        </div>
        <div className={styles.engineDetail}>
          {engine.state === 'connected'
            ? `OpenRGB · protocole ${engine.protocolVersion ?? '?'}`
            : (engine.message ?? 'En attente du moteur matériel')}
        </div>
        {snapshot.integrations.map((integration) => (
          <div key={integration.id} className={styles.engineDetail}>
            {integration.name} ·{' '}
            {integration.state === 'connected'
              ? `${integration.deviceCount} appareil${integration.deviceCount > 1 ? 's' : ''}`
              : integration.state === 'connecting'
                ? 'connexion'
                : 'indisponible'}
          </div>
        ))}
      </div>
    </aside>
  )
}
