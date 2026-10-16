import { Copy, Crosshair } from 'lucide-react'
import { useState } from 'react'
import { getEffect } from '@shared/effects'
import type { AppSnapshot, DeviceInfo, EffectConfig } from '@shared/model'
import { EffectEditor } from '@renderer/components/lighting/EffectEditor'
import { LedPreview } from '@renderer/components/lighting/LedPreview'
import { Button } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { plural, zoneName } from '@renderer/lib/labels'
import { deviceLighting, deviceMode } from '@renderer/lib/status'
import { run } from '@renderer/store/app-store'
import styles from './device.module.css'

export interface ZoneEffectsProps {
  snapshot: AppSnapshot
  device: DeviceInfo
}

/** Zone list with live previews and the effect editor of the selected zone. */
export function ZoneEffects({ snapshot, device }: ZoneEffectsProps) {
  const settings = snapshot.deviceSettings[device.id]
  const config = deviceLighting(snapshot, device.id)
  const synced = deviceMode(snapshot, device.id) === 'sync'
  const [selected, setSelected] = useState(() => device.zones.find((zone) => zone.ledCount > 0)?.index ?? 0)
  const zone = device.zones[selected] ?? device.zones[0]

  const effectFor = (zoneIndex: number): EffectConfig =>
    synced ? snapshot.lighting.syncEffect : (config.zones[String(zoneIndex)] ?? snapshot.lighting.syncEffect)

  if (!zone) return null
  const current = effectFor(zone.index)

  return (
    <Section
      title="Effets par zone"
      description={
        synced
          ? 'Cet appareil suit l’effet synchronisé. Modifier une zone le personnalise, les autres zones gardent leur rendu actuel.'
          : 'Chaque zone peut avoir son propre effet ; les animations restent en phase entre les zones et les appareils.'
      }
      flush
    >
      <div className={styles.workspace}>
        <div className={styles.zoneList} role="list">
          {device.zones.map((entry) => (
            <button
              key={entry.index}
              type="button"
              role="listitem"
              className={styles.zone}
              aria-pressed={entry.index === zone.index}
              onClick={() => setSelected(entry.index)}
            >
              <div className={styles.zoneHead}>
                <span className={styles.zoneName}>{zoneName(entry, settings)}</span>
                <span className={styles.zoneMeta}>{plural(entry.ledCount, 'LED', 'LED')}</span>
              </div>
              {entry.ledCount > 0 ? (
                <>
                  <LedPreview
                    deviceId={device.id}
                    startIndex={entry.startIndex}
                    count={entry.ledCount}
                    matrix={entry.matrix}
                    height={entry.matrix ? 40 : 10}
                  />
                  <span className={styles.zoneEffect}>{getEffect(effectFor(entry.index).id).label}</span>
                </>
              ) : (
                <span className={styles.zoneUnconfigured}>Nombre de LED à configurer ci-dessous</span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.editorPane}>
          <div className={styles.editorHeader}>
            <span className={styles.editorTitle}>{zoneName(zone, settings)}</span>
            <div className={styles.editorActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={<Crosshair size={14} />}
                disabled={zone.ledCount === 0}
                onClick={() => void run(() => api.identify(device.id, zone.index))}
              >
                Identifier
              </Button>
              {device.zones.length > 1 && (
                <Button
                  size="sm"
                  icon={<Copy size={14} />}
                  onClick={() =>
                    void run(
                      () => api.setZoneEffect(device.id, null, current),
                      'Effet appliqué à toutes les zones'
                    )
                  }
                >
                  Appliquer à toutes les zones
                </Button>
              )}
            </div>
          </div>
          {zone.ledCount === 0 ? (
            <p className={styles.editorNote}>
              Cette zone n’a encore aucune LED. Indiquez le nombre de LED branchées dans la section « Zones et
              headers ».
            </p>
          ) : (
            <EffectEditor
              key={`${device.id}:${zone.index}`}
              value={current}
              onChange={(effect) => void run(() => api.setZoneEffect(device.id, zone.index, effect))}
            />
          )}
        </div>
      </div>
    </Section>
  )
}
