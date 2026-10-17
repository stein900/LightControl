import { FolderOpen, Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SettingsPatch, Theme } from '@shared/model'
import { Button, SegmentedControl, Slider, Switch, TextInput } from '@renderer/components/ui/controls'
import { Field, Page, PageHeader, Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { useThrottled } from '@renderer/lib/use-throttled'
import { run, useSnapshot } from '@renderer/store/app-store'

const update = (patch: SettingsPatch): void => void run(() => api.updateSettings(patch))

function PortInput({ value }: { value: number }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const port = Number(draft)
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== value) update({ engine: { port } })
    else setDraft(String(value))
  }
  return (
    <TextInput
      className="mono"
      style={{ width: 96, textAlign: 'right' }}
      inputMode="numeric"
      aria-label="Port du serveur"
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
    />
  )
}

export function SettingsPage() {
  const { settings, version, engine } = useSnapshot()
  const setFrameRate = useThrottled((frameRate: number) => update({ frameRate }), 150)

  return (
    <Page>
      <PageHeader title="Réglages" subtitle={`LightControl ${version}`} />

      <Section title="Général" flush>
        <Field label="Apparence">
          <SegmentedControl<Theme>
            label="Apparence"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'system', label: 'Système', icon: <Monitor size={14} /> },
              { value: 'dark', label: 'Sombre', icon: <Moon size={14} /> },
              { value: 'light', label: 'Clair', icon: <Sun size={14} /> }
            ]}
          />
        </Field>
        <Field
          label="Lancer au démarrage de Windows"
          description="Recommandé : l’éclairage est réappliqué dès l’ouverture de session."
        >
          <Switch
            label="Lancer au démarrage"
            checked={settings.launchAtLogin}
            onChange={(launchAtLogin) => update({ launchAtLogin })}
          />
        </Field>
        <Field
          label="Démarrer en arrière-plan"
          description="La fenêtre reste masquée ; l’icône de notification donne accès à l’application."
        >
          <Switch
            label="Démarrer en arrière-plan"
            checked={settings.startMinimized}
            onChange={(startMinimized) => update({ startMinimized })}
          />
        </Field>
        <Field
          label="Fermer dans la zone de notification"
          description="Fermer la fenêtre laisse les effets animés tourner."
        >
          <Switch
            label="Fermer dans la zone de notification"
            checked={settings.closeToTray}
            onChange={(closeToTray) => update({ closeToTray })}
          />
        </Field>
      </Section>

      <Section title="Rendu" flush>
        <Field
          label="Images par seconde"
          description="Fréquence des effets animés. 30 suffit pour des animations fluides sur l’ARGB."
        >
          <Slider
            label="Images par seconde"
            min={10}
            max={60}
            step={5}
            value={settings.frameRate}
            onChange={setFrameRate}
            format={(v) => `${v} i/s`}
          />
        </Field>
        <Field
          label="Modèle 3D du PC"
          description="Affiche l’aperçu 3D de l’éclairage sur la vue d’ensemble. Il ne consomme rien quand il n’est pas à l’écran."
        >
          <Switch
            label="Modèle 3D du PC"
            checked={settings.pcModel.visible}
            onChange={(visible) => update({ pcModel: { visible } })}
          />
        </Field>
      </Section>

      <Section
        title="Moteur matériel"
        description="LightControl pilote le matériel via OpenRGB, lancé et arrêté automatiquement en arrière-plan."
        flush
      >
        <Field
          label="Gérer le moteur automatiquement"
          description="Désactivez pour vous connecter à un serveur OpenRGB que vous lancez vous-même."
        >
          <Switch
            label="Gérer le moteur"
            checked={settings.engine.managed}
            onChange={(managed) => update({ engine: { managed } })}
          />
        </Field>
        <Field
          label="Mode administrateur"
          description="Nécessaire pour la mémoire RGB (bus SMBus, pilote PawnIO). Windows demande une confirmation au lancement du moteur."
        >
          <Switch
            label="Mode administrateur"
            checked={settings.engine.elevated}
            onChange={(elevated) => update({ engine: { elevated } })}
          />
        </Field>
        <Field
          label="Exécutable OpenRGB"
          description={
            settings.engine.executablePath ?? engine.executablePath ?? 'Version intégrée à LightControl'
          }
        >
          {settings.engine.executablePath && (
            <Button size="sm" variant="ghost" onClick={() => update({ engine: { executablePath: null } })}>
              Version intégrée
            </Button>
          )}
          <Button
            size="sm"
            icon={<FolderOpen size={14} />}
            onClick={() =>
              void run(async () => {
                const path = await api.chooseExecutable()
                if (path) await api.updateSettings({ engine: { executablePath: path } })
              })
            }
          >
            Parcourir
          </Button>
        </Field>
        <Field label="Port du serveur" description="Port local du SDK OpenRGB (6742 par défaut).">
          <PortInput value={settings.engine.port} />
        </Field>
        <Field label="Relancer le moteur" description="Redémarre OpenRGB et redétecte tout le matériel.">
          <Button
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={() => void run(() => api.reconnectEngine())}
          >
            Relancer
          </Button>
        </Field>
      </Section>

      <Section title="À propos" flush>
        <Field
          label="OpenRGB"
          description="Moteur matériel open source distribué sous licence GPL-2.0, exécuté comme programme séparé. Licence et lien vers les sources dans le dossier d’installation (openrgb)."
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run(() => api.openExternal('https://openrgb.org'))}
          >
            openrgb.org
          </Button>
        </Field>
      </Section>
    </Page>
  )
}
