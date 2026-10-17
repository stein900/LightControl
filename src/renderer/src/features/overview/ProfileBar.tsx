import { Check, Plus, Save } from 'lucide-react'
import { useState } from 'react'
import { ProfileSwatch } from '@renderer/components/lighting/ProfileSwatch'
import { Button } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { ProfileNameDialog } from '@renderer/features/profiles/ProfilesPage'
import { api } from '@renderer/lib/api'
import { run, useAppStore, useSnapshot } from '@renderer/store/app-store'
import styles from './overview.module.css'

/** One-click switching between saved lighting profiles, right under the 3D model. */
export function ProfileBar() {
  const { profiles, activeProfileId, activeProfileModified } = useSnapshot()
  const navigate = useAppStore((state) => state.navigate)
  const [creating, setCreating] = useState(false)
  const active = profiles.find((profile) => profile.id === activeProfileId)

  return (
    <Section
      title="Profils d’éclairage"
      description="Enregistrez vos configurations (arc-en-ciel, rouge et bleu, violet et blanc…) et passez de l’une à l’autre en un clic. Le modèle 3D suit."
      actions={
        profiles.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'profiles' })}>
            Gérer
          </Button>
        )
      }
    >
      <div className={styles.profiles}>
        {profiles.map((profile) => {
          const current = profile.id === activeProfileId
          return (
            <button
              key={profile.id}
              type="button"
              className={styles.profile}
              aria-pressed={current}
              title={
                current && activeProfileModified
                  ? `Revenir à « ${profile.name} » tel qu’enregistré`
                  : `Appliquer « ${profile.name} »`
              }
              onClick={() => {
                if (!current || activeProfileModified) void run(() => api.applyProfile(profile.id))
              }}
            >
              <ProfileSwatch preview={profile.preview} />
              <span className={styles.profileName}>{profile.name}</span>
              {current && <Check size={14} className={styles.profileCheck} />}
            </button>
          )
        })}
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
          {profiles.length > 0
            ? 'Enregistrer l’éclairage actuel'
            : 'Enregistrer l’éclairage actuel comme premier profil'}
        </Button>
      </div>

      {active && activeProfileModified && (
        <div className={styles.profileModified}>
          <span>L’éclairage a changé depuis « {active.name} ».</span>
          <Button
            size="sm"
            icon={<Save size={14} />}
            onClick={() => void run(() => api.saveProfile(active.id), 'Profil mis à jour')}
          >
            Mettre à jour « {active.name} »
          </Button>
        </div>
      )}

      {creating && (
        <ProfileNameDialog
          title="Enregistrer l’éclairage actuel"
          initial=""
          confirmLabel="Enregistrer"
          onCancel={() => setCreating(false)}
          onConfirm={(name) => {
            setCreating(false)
            void run(() => api.createProfile(name), 'Profil enregistré')
          }}
        />
      )}
    </Section>
  )
}
