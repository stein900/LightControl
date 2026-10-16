import { Crosshair, Cpu, Layers, Link } from 'lucide-react'
import { Button, SegmentedControl, type SegmentOption } from '@renderer/components/ui/controls'
import { Badge, Banner, Field, Page, PageHeader, Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { KindIcon } from '@renderer/components/KindIcon'
import { deviceName, kindLabel, plural } from '@renderer/lib/labels'
import { deviceMode, type DeviceMode } from '@renderer/lib/status'
import { run, useSnapshot } from '@renderer/store/app-store'
import { EditableName } from './EditableName'
import { HardwareModePanel } from './HardwareModePanel'
import { WhiteBalancePanel } from './WhiteBalancePanel'
import { ZoneEffects } from './ZoneEffects'
import { ZoneSetup } from './ZoneSetup'
import styles from './device.module.css'

const OVERLAY_TEXT = {
  identify: 'Identification en cours : la zone clignote en blanc.',
  'white-test': 'Test du blanc en cours sur cet appareil.',
  'led-count': 'Comptage des LED : la dernière LED de la zone est rouge.'
} as const

export function DevicePage({ deviceId }: { deviceId: string }) {
  const snapshot = useSnapshot()
  const device = snapshot.devices.find((candidate) => candidate.id === deviceId)
  if (!device) return null

  const settings = snapshot.deviceSettings[device.id]
  const mode = deviceMode(snapshot, device.id)
  const hasHardwareModes = device.modes.some((candidate) => candidate.name.toLowerCase() !== 'direct')
  const overlay = snapshot.overlay?.deviceId === device.id ? snapshot.overlay : null
  const mysticLight =
    snapshot.diagnostics?.conflicts.some((conflict) => conflict.id === 'msi-mystic-light') ?? false

  const options: SegmentOption<DeviceMode>[] = [
    ...(snapshot.lighting.sync
      ? [{ value: 'sync' as const, label: 'Synchronisé', icon: <Link size={14} /> }]
      : []),
    {
      value: 'software',
      label: 'Effets personnalisés',
      icon: <Layers size={14} />,
      disabled: !device.supportsDirect
    },
    { value: 'hardware', label: 'Mode matériel', icon: <Cpu size={14} />, disabled: !hasHardwareModes }
  ]

  const changeMode = (next: DeviceMode): void => {
    if (next === 'sync') void run(() => api.setFollowSync(device.id, true))
    else void run(() => api.setDeviceControl(device.id, next))
  }

  return (
    <Page>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <KindIcon kind={device.kind} size={20} />
            </span>
            <EditableName
              value={deviceName(device, settings)}
              placeholder={device.name}
              onSave={(alias) => void run(() => api.setAlias(device.id, null, alias))}
            />
          </span>
        }
        subtitle={[
          device.vendor,
          kindLabel(device.kind),
          plural(device.ledCount, 'LED', 'LED'),
          plural(device.zones.length, 'zone')
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Button
            icon={<Crosshair size={14} />}
            disabled={device.ledCount === 0}
            onClick={() => void run(() => api.identify(device.id, null))}
          >
            Identifier
          </Button>
        }
      />

      {overlay && <Banner tone="info" title={OVERLAY_TEXT[overlay.kind]} />}

      {mysticLight && device.vendor === 'MSI' && (
        <Banner tone="warning" title="MSI Center (Mystic Light) est actif">
          Son service garde la main sur les headers de la carte mère et peut réimposer ses propres couleurs.
          Dans MSI Center, onglet Fonctionnalités, désinstallez Mystic Light (ou MSI Center entier), puis
          redémarrez le PC.
        </Banner>
      )}

      {snapshot.lighting.sync && mode !== 'sync' && (
        <Banner
          tone="info"
          title="Cet appareil n’affiche pas l’effet synchronisé"
          actions={
            <Button size="sm" variant="primary" onClick={() => changeMode('sync')}>
              Suivre la synchronisation
            </Button>
          }
        >
          {mode === 'hardware'
            ? 'Il exécute un mode matériel choisi pour lui seul.'
            : 'Il affiche ses propres effets, définis zone par zone ci-dessous.'}
        </Banner>
      )}

      {!snapshot.lighting.power && (
        <Banner
          tone="info"
          title="L’éclairage général est éteint"
          actions={
            <Button size="sm" variant="primary" onClick={() => void run(() => api.setPower(true))}>
              Allumer
            </Button>
          }
        />
      )}

      <Section flush>
        <Field
          label="Pilotage"
          description={
            mode === 'sync'
              ? 'L’appareil affiche l’effet synchronisé défini dans la vue d’ensemble.'
              : mode === 'software'
                ? 'LightControl calcule chaque image et l’envoie aux LED, zone par zone.'
                : 'L’appareil exécute lui-même un de ses effets intégrés.'
          }
        >
          <SegmentedControl label="Pilotage" value={mode} options={options} onChange={changeMode} />
        </Field>
        {device.delivery === 'loop' && (
          <Field
            label="Liaison sans fil"
            description="Chaque réglage est transmis à l’appareil sous forme d’animation, qu’il rejoue en boucle de lui-même, même LightControl fermé. Un changement met environ une seconde à s’afficher."
          >
            <Badge>2,4 GHz</Badge>
          </Field>
        )}
      </Section>

      {mode === 'hardware' ? (
        <HardwareModePanel snapshot={snapshot} device={device} />
      ) : (
        <ZoneEffects snapshot={snapshot} device={device} />
      )}

      <ZoneSetup snapshot={snapshot} device={device} />
      <WhiteBalancePanel snapshot={snapshot} device={device} />
    </Page>
  )
}
