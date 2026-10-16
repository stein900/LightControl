import { useEffect } from 'react'
import { Toasts } from '@renderer/components/ui/surfaces'
import { DevicePage } from '@renderer/features/device/DevicePage'
import { DiagnosticsPage } from '@renderer/features/diagnostics/DiagnosticsPage'
import { OverviewPage } from '@renderer/features/overview/OverviewPage'
import { ProfilesPage } from '@renderer/features/profiles/ProfilesPage'
import { SettingsPage } from '@renderer/features/settings/SettingsPage'
import { api } from '@renderer/lib/api'
import { deviceName } from '@renderer/lib/labels'
import { useAppStore } from '@renderer/store/app-store'
import { frameStore } from '@renderer/store/frame-store'
import { BrandMark } from './BrandMark'
import { Sidebar } from './Sidebar'
import styles from './shell.module.css'

const PAGE_TITLES = {
  overview: 'Vue d’ensemble',
  profiles: 'Profils',
  settings: 'Réglages',
  diagnostics: 'Diagnostic'
} as const

export function App() {
  const snapshot = useAppStore((state) => state.snapshot)
  const route = useAppStore((state) => state.route)
  const setSnapshot = useAppStore((state) => state.setSnapshot)

  useEffect(() => {
    void api.getSnapshot().then(setSnapshot)
    const offSnapshot = api.onSnapshot(setSnapshot)
    const offFrames = api.onFrames((frames) => frameStore.set(frames))
    return () => {
      offSnapshot()
      offFrames()
    }
  }, [setSnapshot])

  let context: string = route.page === 'device' ? '' : PAGE_TITLES[route.page]
  if (route.page === 'device' && snapshot) {
    const device = snapshot.devices.find((candidate) => candidate.id === route.deviceId)
    context = device ? deviceName(device, snapshot.deviceSettings[device.id]) : ''
  }

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} />
          LightControl
        </div>
        {context && (
          <>
            <span className={styles.titleSeparator}>/</span>
            <span className={styles.titleContext}>{context}</span>
          </>
        )}
      </header>

      {snapshot ? (
        <>
          <Sidebar snapshot={snapshot} />
          <main className={styles.content} key={route.page === 'device' ? route.deviceId : route.page}>
            {route.page === 'overview' && <OverviewPage />}
            {route.page === 'device' && <DevicePage deviceId={route.deviceId} />}
            {route.page === 'profiles' && <ProfilesPage />}
            {route.page === 'settings' && <SettingsPage />}
            {route.page === 'diagnostics' && <DiagnosticsPage />}
          </main>
        </>
      ) : (
        <div className={styles.loading} style={{ gridColumn: '1 / -1' }}>
          Chargement…
        </div>
      )}
      <Toasts />
    </div>
  )
}
