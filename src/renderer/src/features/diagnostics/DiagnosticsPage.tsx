import { CircleCheck, ExternalLink, FolderOpen, RefreshCw, RotateCcw, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { IntegrationActions } from '@renderer/components/integrations/IntegrationActions'
import { Button } from '@renderer/components/ui/controls'
import type { IntegrationState } from '@shared/model'
import {
  Badge,
  EmptyState,
  Field,
  Page,
  PageHeader,
  Section,
  type Tone
} from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { ENGINE_STATE_LABEL, plural } from '@renderer/lib/labels'
import { run, useSnapshot } from '@renderer/store/app-store'
import styles from './diagnostics.module.css'

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' })

const INTEGRATION_LABEL: Record<IntegrationState, string> = {
  connected: 'Connecté',
  connecting: 'Connexion',
  unavailable: 'Indisponible',
  error: 'Erreur',
  stopped: 'Arrêté'
}

const INTEGRATION_TONE: Record<IntegrationState, Tone> = {
  connected: 'success',
  connecting: 'warning',
  unavailable: 'neutral',
  error: 'danger',
  stopped: 'neutral'
}

export function DiagnosticsPage() {
  const { engine, integrations, diagnostics, devices } = useSnapshot()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await run(() => api.refreshDiagnostics())
    setRefreshing(false)
  }

  const engineTone =
    engine.state === 'connected' ? 'success' : engine.state === 'error' ? 'danger' : 'warning'

  return (
    <Page>
      <PageHeader
        title="Diagnostic"
        subtitle={
          diagnostics
            ? `Dernière vérification à ${timeFormat.format(diagnostics.checkedAt)}`
            : 'Vérification en cours…'
        }
        actions={
          <Button icon={<RefreshCw size={14} />} disabled={refreshing} onClick={() => void refresh()}>
            Actualiser
          </Button>
        }
      />

      <Section title="Moteur matériel" flush>
        <Field label="État" description={engine.message ?? undefined}>
          <Badge tone={engineTone} dot>
            {ENGINE_STATE_LABEL[engine.state]}
          </Badge>
        </Field>
        <Field label="Protocole OpenRGB" description="Version du protocole SDK négociée avec le moteur.">
          <span className="mono">{engine.protocolVersion ?? '–'}</span>
        </Field>
        <Field label="Appareils détectés">
          <span className="mono">{devices.length}</span>
        </Field>
        <Field label="Actions">
          <Button
            size="sm"
            icon={<ScanSearch size={14} />}
            onClick={() => void run(() => api.rescanDevices())}
          >
            Redétecter
          </Button>
          <Button
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={() => void run(() => api.reconnectEngine())}
          >
            Relancer le moteur
          </Button>
        </Field>
      </Section>

      <Section
        title="Intégrations"
        description="Canaux propres aux fabricants, pour le matériel que le moteur OpenRGB n’atteint pas."
        flush
      >
        {integrations.map((integration) => (
          <Field
            key={integration.id}
            label={integration.name}
            description={
              [
                integration.state === 'connected'
                  ? `${plural(integration.deviceCount, 'appareil')} ${integration.deviceCount > 1 ? 'pilotés' : 'piloté'}.`
                  : null,
                integration.message
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            <IntegrationActions integration={integration} variant="secondary" />
            <Badge tone={INTEGRATION_TONE[integration.state]} dot>
              {INTEGRATION_LABEL[integration.state]}
            </Badge>
          </Field>
        ))}
      </Section>

      <Section title="Système" flush>
        <Field
          label="Droits administrateur"
          description="LightControl lui-même ; le moteur peut être élevé séparément dans les réglages."
        >
          <Badge tone={diagnostics?.isElevated ? 'success' : 'neutral'}>
            {diagnostics?.isElevated ? 'Oui' : 'Non'}
          </Badge>
        </Field>
        <Field
          label="Pilote PawnIO"
          description="Requis par OpenRGB pour la mémoire RGB et certains contrôleurs sur bus SMBus."
        >
          <Badge tone={diagnostics?.pawnIoInstalled ? 'success' : 'warning'}>
            {diagnostics?.pawnIoInstalled ? 'Installé' : 'Absent'}
          </Badge>
          {diagnostics && !diagnostics.pawnIoInstalled && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={14} />}
              onClick={() => void run(() => api.openExternal('https://pawnio.eu'))}
            >
              pawnio.eu
            </Button>
          )}
        </Field>
        <Field label="Journaux" description={diagnostics?.logDirectory}>
          <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void run(() => api.openLogs())}>
            Ouvrir le dossier
          </Button>
        </Field>
      </Section>

      <Section
        title="Logiciels concurrents"
        description="Ces logiciels écrivent sur le même matériel et peuvent remplacer vos couleurs."
        flush
      >
        {diagnostics && diagnostics.conflicts.length === 0 ? (
          <EmptyState icon={<CircleCheck size={20} />} title="Aucun conflit détecté" />
        ) : (
          diagnostics?.conflicts.map((conflict) => (
            <div key={conflict.id} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.itemTitle}>{conflict.product}</span>
                <Badge tone="warning" dot>
                  Actif
                </Badge>
              </div>
              <div className={styles.itemMeta}>
                {conflict.affects} Processus : <span className="mono">{conflict.processes.join(', ')}</span>
              </div>
              <p className={styles.itemText}>{conflict.advice}</p>
            </div>
          ))
        )}
      </Section>

      {diagnostics && diagnostics.unsupported.length > 0 && (
        <Section
          title="Matériel non piloté"
          description="Détecté sur le système, mais pas accessible au moteur en l’état."
          flush
        >
          {diagnostics.unsupported.map((item) => (
            <div key={item.id} className={styles.item}>
              <span className={styles.itemTitle}>{item.name}</span>
              <p className={styles.itemText}>{item.detail}</p>
            </div>
          ))}
        </Section>
      )}
    </Page>
  )
}
