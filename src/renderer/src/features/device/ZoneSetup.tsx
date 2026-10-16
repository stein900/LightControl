import { Crosshair } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSnapshot, DeviceInfo, ZoneInfo } from '@shared/model'
import { Button, Stepper, TextInput } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { plural, zoneHint } from '@renderer/lib/labels'
import { run } from '@renderer/store/app-store'
import styles from './device.module.css'

function ZoneAlias({ deviceId, zone, alias }: { deviceId: string; zone: ZoneInfo; alias: string }) {
  const [draft, setDraft] = useState(alias)
  useEffect(() => setDraft(alias), [alias])
  const save = (): void => {
    if (draft.trim() !== alias) void run(() => api.setAlias(deviceId, zone.index, draft))
  }
  return (
    <TextInput
      value={draft}
      placeholder="Nom personnalisé (ex. Pompe AIO)"
      maxLength={64}
      aria-label={`Nom de la zone ${zone.name}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
    />
  )
}

/** Names every zone and sets the LED count of addressable (ARGB) headers. */
export function ZoneSetup({ snapshot, device }: { snapshot: AppSnapshot; device: DeviceInfo }) {
  const settings = snapshot.deviceSettings[device.id]
  const hasResizable = device.zones.some((zone) => zone.resizable)

  return (
    <Section
      title="Zones et headers"
      description={
        hasResizable
          ? 'Indiquez combien de LED sont branchées sur chaque header ARGB, chaînage compris (pompe + ventilateurs).'
          : 'Donnez un nom parlant à chaque zone.'
      }
      flush
    >
      {device.zones.map((zone) => (
        <div key={zone.index} className={styles.setupRow}>
          <div>
            <div className={styles.setupName}>{zone.name}</div>
            <div className={styles.setupHint}>{zoneHint(zone) ?? plural(zone.ledCount, 'LED', 'LED')}</div>
          </div>
          <ZoneAlias
            deviceId={device.id}
            zone={zone}
            alias={settings?.zoneAliases[String(zone.index)] ?? ''}
          />
          {zone.resizable ? (
            <div className={styles.setupSize}>
              <Stepper
                label={`Nombre de LED sur ${zone.name}`}
                value={zone.ledCount}
                min={Math.max(1, zone.ledsMin)}
                max={zone.ledsMax}
                onChange={(size) => void run(() => api.setZoneSize(device.id, zone.index, size))}
              />
              LED
            </div>
          ) : (
            <span className={styles.fixedSize}>{plural(zone.ledCount, 'LED', 'LED')}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={`Identifier ${zone.name}`}
            icon={<Crosshair size={14} />}
            disabled={zone.ledCount === 0}
            onClick={() => void run(() => api.identify(device.id, zone.index))}
          />
        </div>
      ))}
      {hasResizable && (
        <div className={styles.setupHelp}>
          Pendant le réglage, les LED de la zone s’allument en blanc et la dernière en rouge. Augmentez la
          valeur jusqu’à ce que la LED rouge soit la toute dernière de la chaîne, puis arrêtez-vous : une
          valeur trop grande étire les animations.
        </div>
      )}
    </Section>
  )
}
