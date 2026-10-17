import { Bookmark, Pencil, Play, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProfileSummary } from '@shared/model'
import { ProfileSwatch } from '@renderer/components/lighting/ProfileSwatch'
import { Button, TextInput } from '@renderer/components/ui/controls'
import {
  Badge,
  Dialog,
  DialogText,
  EmptyState,
  Page,
  PageHeader,
  Section
} from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { run, useSnapshot } from '@renderer/store/app-store'
import styles from './profiles.module.css'

type DialogState =
  | { kind: 'create' }
  | { kind: 'rename'; profile: ProfileSummary }
  | { kind: 'delete'; profile: ProfileSummary }
  | null

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

export function ProfileNameDialog({
  title,
  initial,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string
  initial: string
  confirmLabel: string
  onConfirm(name: string): void
  onCancel(): void
}) {
  const [name, setName] = useState(initial)
  return (
    <Dialog
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={!name.trim()}
      onConfirm={() => onConfirm(name.trim())}
      onCancel={onCancel}
    >
      <TextInput
        value={name}
        maxLength={64}
        placeholder="Ex. Arc-en-ciel, Rouge et bleu, Violet et blanc"
        aria-label="Nom du profil"
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  )
}

export function ProfilesPage() {
  const { profiles, activeProfileId, activeProfileModified } = useSnapshot()
  const [dialog, setDialog] = useState<DialogState>(null)
  const close = (): void => setDialog(null)

  return (
    <Page>
      <PageHeader
        title="Profils"
        subtitle="Un profil mémorise l’éclairage complet : synchronisation, effets, modes matériels et luminosité."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'create' })}>
            Nouveau profil
          </Button>
        }
      />

      <Section flush>
        {profiles.length === 0 ? (
          <EmptyState
            icon={<Bookmark size={20} />}
            title="Aucun profil"
            actions={
              <Button icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'create' })}>
                Créer depuis l’éclairage actuel
              </Button>
            }
          >
            Enregistrez l’éclairage actuel pour le retrouver en un clic, ici ou depuis la zone de
            notification.
          </EmptyState>
        ) : (
          profiles.map((profile) => {
            const active = profile.id === activeProfileId
            return (
              <div key={profile.id} className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.name}>
                    <ProfileSwatch preview={profile.preview} />
                    {profile.name}
                    {active && (
                      <Badge tone="success" dot>
                        {activeProfileModified ? 'Actif · modifié' : 'Actif'}
                      </Badge>
                    )}
                  </div>
                  <div className={styles.meta}>Mis à jour le {dateFormat.format(profile.updatedAt)}</div>
                </div>
                <div className={styles.actions}>
                  {active && activeProfileModified && (
                    <Button
                      size="sm"
                      icon={<Save size={14} />}
                      onClick={() => void run(() => api.saveProfile(profile.id), 'Profil mis à jour')}
                    >
                      Enregistrer les modifications
                    </Button>
                  )}
                  {!active && (
                    <Button
                      size="sm"
                      icon={<Play size={14} />}
                      onClick={() => void run(() => api.applyProfile(profile.id))}
                    >
                      Appliquer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Renommer"
                    icon={<Pencil size={14} />}
                    onClick={() => setDialog({ kind: 'rename', profile })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Supprimer"
                    icon={<Trash2 size={14} />}
                    onClick={() => setDialog({ kind: 'delete', profile })}
                  />
                </div>
              </div>
            )
          })
        )}
      </Section>

      {dialog?.kind === 'create' && (
        <ProfileNameDialog
          title="Nouveau profil"
          initial=""
          confirmLabel="Créer"
          onCancel={close}
          onConfirm={(name) => {
            close()
            void run(() => api.createProfile(name), 'Profil créé')
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <ProfileNameDialog
          title="Renommer le profil"
          initial={dialog.profile.name}
          confirmLabel="Renommer"
          onCancel={close}
          onConfirm={(name) => {
            close()
            void run(() => api.renameProfile(dialog.profile.id, name))
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Dialog
          title="Supprimer le profil"
          confirmLabel="Supprimer"
          confirmVariant="danger"
          onCancel={close}
          onConfirm={() => {
            close()
            void run(() => api.deleteProfile(dialog.profile.id))
          }}
        >
          <DialogText>
            Le profil « {dialog.profile.name} » sera supprimé. L’éclairage actuel n’est pas modifié.
          </DialogText>
        </Dialog>
      )}
    </Page>
  )
}
