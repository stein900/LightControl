import { ChevronRight, RefreshCw, ScanSearch } from 'lucide-react'
import { DEFAULT_HEADER_LEDS } from '@shared/hardware'
import type { AppSnapshot, DeviceInfo } from '@shared/model'
import { LedPreview } from '@renderer/components/lighting/LedPreview'
import { EffectEditor } from '@renderer/components/lighting/EffectEditor'
import { Button, Slider, Switch } from '@renderer/components/ui/controls'
import { Banner, EmptyState, Field, Page, PageHeader, Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { KindIcon } from '@renderer/components/KindIcon'
import { IntegrationActions } from '@renderer/components/integrations/IntegrationActions'
import { deviceName, kindLabel, plural } from '@renderer/lib/labels'
import { deviceMode, deviceStatus } from '@renderer/lib/status'
import { useThrottled } from '@renderer/lib/use-throttled'
import { run, useAppStore, useSnapshot } from '@renderer/store/app-store'
import { EngineBanner } from './EngineBanner'
import styles from './overview.module.css'

function DeviceRow({ snapshot, device }: { snapshot: AppSnapshot; device: DeviceInfo }) {
  const navigate = useAppStore((state) => state.navigate)
  const settings = snapshot.deviceSettings[device.id]
  return (
    <button
      type="button"
      className={styles.device}
      onClick={() => navigate({ page: 'device', deviceId: device.id })}
    >
      <span className={styles.deviceIcon}>
        <KindIcon kind={device.kind} size={18} />
      </span>
      <span style={{ minWidth: 0 }}>
        <div className={styles.deviceName}>{deviceName(device, settings)}</div>
        <div className={styles.deviceMeta}>
          {kindLabel(device.kind)} · {plural(device.ledCount, 'LED', 'LED')} ·{' '}
          {deviceStatus(snapshot, device)}
        </div>
      </span>
      {device.ledCount > 0 ? (
        <LedPreview deviceId={device.id} startIndex={0} count={device.ledCount} height={12} />
      ) : (
        <span className={styles.previewEmpty}>Aucune LED configurée</span>
      )}
      <ChevronRight size={16} className={styles.chevron} />
    </button>
  )
}

export function OverviewPage() {
  const snapshot = useSnapshot()
  const navigate = useAppStore((state) => state.navigate)
  const { lighting, devices, engine, diagnostics, integrations } = snapshot
  const setBrightness = useThrottled((value: number) => void run(() => api.setBrightness(value)), 60)

  const totalLeds = devices.reduce((sum, device) => sum + device.ledCount, 0)
  const outOfSync = lighting.sync
    ? devices.filter((device) => deviceMode(snapshot, device.id) !== 'sync')
    : []
  // Headers the user has not sized yet run at a default length: colors work, animations may be off.
  const unconfigured = devices.flatMap((device) =>
    device.zones
      .filter(
        (zone) => zone.resizable && !(snapshot.deviceSettings[device.id]?.zoneSizes[String(zone.index)] ?? 0)
      )
      .map((zone) => ({ device, zone }))
  )
  // Hardware held by its vendor software that LightControl can take over (Lian Li dongle).
  const takeOver = integrations.filter((integration) => integration.actions.includes('take-over'))
  const conflicts = (diagnostics?.conflicts ?? []).filter(
    (conflict) => !(conflict.id === 'lian-li-lconnect' && takeOver.some((i) => i.id === 'lianli'))
  )

  return (
    <Page>
      <PageHeader
        title="Vue d’ensemble"
        subtitle={`${plural(devices.length, 'appareil')} · ${plural(totalLeds, 'LED', 'LED')} pilotées`}
      />

      <EngineBanner />

      {takeOver.map((integration) => (
        <Banner
          key={integration.id}
          tone="warning"
          title={`${integration.name} : contrôle détenu par un autre logiciel`}
          actions={<IntegrationActions integration={{ ...integration, actions: ['take-over'] }} />}
        >
          {integration.message}
        </Banner>
      ))}

      {conflicts.length > 0 && (
        <Banner
          tone="warning"
          title={`${conflicts.map((conflict) => conflict.product).join(', ')} ${conflicts.length > 1 ? 'sont actifs' : 'est actif'}`}
          actions={
            <Button size="sm" onClick={() => navigate({ page: 'diagnostics' })}>
              Voir le diagnostic
            </Button>
          }
        >
          Ces logiciels pilotent le même matériel et peuvent remplacer vos couleurs.
        </Banner>
      )}

      {unconfigured.length > 0 && (
        <Banner
          tone="info"
          title="Longueur des headers ARGB à affiner"
          actions={
            <Button
              size="sm"
              onClick={() => navigate({ page: 'device', deviceId: unconfigured[0]!.device.id })}
            >
              Affiner
            </Button>
          }
        >
          {unconfigured.map(({ zone }) => zone.name).join(', ')} pilotent {DEFAULT_HEADER_LEDS} LED par
          défaut. Si une partie de la chaîne reste éteinte ou si les animations semblent étirées, indiquez le
          nombre exact.
        </Banner>
      )}

      {outOfSync.length > 0 && (
        <Banner
          tone="info"
          title={`${outOfSync.length > 1 ? 'Ces appareils ne suivent' : 'Cet appareil ne suit'} pas l’effet synchronisé`}
          actions={
            <Button size="sm" variant="primary" onClick={() => void run(() => api.setSync(true))}>
              Tout synchroniser
            </Button>
          }
        >
          {outOfSync
            .map(
              (device) =>
                `${deviceName(device, snapshot.deviceSettings[device.id])} (${deviceStatus(snapshot, device)})`
            )
            .join(', ')}
        </Banner>
      )}

      <Section title="Contrôle global" flush>
        <Field label="Éclairage" description="Allume ou éteint toutes les LED pilotées par LightControl.">
          <Switch
            label="Éclairage"
            checked={lighting.power}
            onChange={(on) => void run(() => api.setPower(on))}
          />
        </Field>
        <Field
          label="Luminosité générale"
          description="S’applique à tous les appareils. Vers 70 à 80 %, le blanc reste plus neutre sur les longues chaînes ARGB."
        >
          <Slider
            label="Luminosité générale"
            value={lighting.brightness}
            onChange={setBrightness}
            format={(v) => `${Math.round(v)} %`}
          />
        </Field>
        <Field
          label="Synchroniser tous les appareils"
          description="Un seul effet pour tout le PC. Un appareil que vous personnalisez quitte la synchronisation."
        >
          <Switch
            label="Synchroniser tous les appareils"
            checked={lighting.sync}
            onChange={(on) => void run(() => api.setSync(on))}
          />
        </Field>
      </Section>

      {lighting.sync && (
        <Section
          title="Effet synchronisé"
          description="Appliqué à chaque zone des appareils synchronisés, en phase."
        >
          <EffectEditor
            value={lighting.syncEffect}
            onChange={(effect) => void run(() => api.setSyncEffect(effect))}
          />
        </Section>
      )}

      <Section
        title="Appareils"
        flush
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} />}
            onClick={() => void run(() => api.rescanDevices())}
          >
            Redétecter
          </Button>
        }
      >
        {devices.length > 0 ? (
          <div className={styles.devices}>
            {devices.map((device) => (
              <DeviceRow key={device.id} snapshot={snapshot} device={device} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ScanSearch size={20} />}
            title={engine.state === 'connected' ? 'Aucun appareil détecté' : 'En attente du moteur matériel'}
            actions={
              engine.state === 'connected' && (
                <Button icon={<RefreshCw size={14} />} onClick={() => void run(() => api.rescanDevices())}>
                  Relancer la détection
                </Button>
              )
            }
          >
            {engine.state === 'connected'
              ? 'Consultez le diagnostic : un pilote ou des droits administrateur peuvent être nécessaires.'
              : 'La détection du matériel prend quelques secondes au démarrage.'}
          </EmptyState>
        )}
      </Section>
    </Page>
  )
}
