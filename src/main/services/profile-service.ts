import { randomUUID } from 'node:crypto'
import type { JsonStore } from '@main/core/json-store'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { LightingState, Profile, ProfilePreview, ProfileSummary } from '@shared/model'
import type { ProfileStoreSchema } from '@shared/schemas'
import type { z } from 'zod'

type ProfileStore = z.output<typeof ProfileStoreSchema>

export interface ProfileEvents {
  changed: []
}

/**
 * Main look of a lighting state: the synchronised effect, or else the effect of
 * the first zone set up on its own.
 */
export function profilePreview(lighting: LightingState): ProfilePreview {
  const own = Object.values(lighting.devices)
    .filter((device) => device.control === 'software' && !device.followSync)
    .flatMap((device) => Object.values(device.zones))[0]
  const effect = lighting.sync || !own ? lighting.syncEffect : own
  return { power: lighting.power, effect: effect.id, colors: effect.colors }
}

export class ProfileNotFoundError extends Error {
  override readonly name = 'ProfileNotFoundError'
}

/** Named snapshots of the lighting state that can be re-applied at any time. */
export class ProfileService {
  readonly events = new TypedEmitter<ProfileEvents>()
  private data: ProfileStore

  constructor(private readonly store: JsonStore<typeof ProfileStoreSchema>) {
    this.data = store.load()
  }

  get activeProfileId(): string | null {
    return this.data.activeProfileId
  }

  summaries(): ProfileSummary[] {
    return this.data.profiles.map(({ id, name, updatedAt, lighting }) => ({
      id,
      name,
      updatedAt,
      preview: profilePreview(lighting)
    }))
  }

  get(id: string): Profile {
    const profile = this.data.profiles.find((candidate) => candidate.id === id)
    if (!profile) throw new ProfileNotFoundError(`Profile ${id} does not exist`)
    return profile
  }

  create(name: string, lighting: LightingState): string {
    const now = Date.now()
    const profile: Profile = {
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      lighting: structuredClone(lighting)
    }
    this.commit({ activeProfileId: profile.id, profiles: [...this.data.profiles, profile] })
    return profile.id
  }

  overwrite(id: string, lighting: LightingState): void {
    this.get(id)
    this.commit({
      activeProfileId: id,
      profiles: this.data.profiles.map((profile) =>
        profile.id === id
          ? { ...profile, lighting: structuredClone(lighting), updatedAt: Date.now() }
          : profile
      )
    })
  }

  rename(id: string, name: string): void {
    this.get(id)
    this.commit({
      ...this.data,
      profiles: this.data.profiles.map((profile) =>
        profile.id === id ? { ...profile, name, updatedAt: Date.now() } : profile
      )
    })
  }

  remove(id: string): void {
    this.get(id)
    this.commit({
      activeProfileId: this.data.activeProfileId === id ? null : this.data.activeProfileId,
      profiles: this.data.profiles.filter((profile) => profile.id !== id)
    })
  }

  markActive(id: string | null): void {
    if (this.data.activeProfileId === id) return
    this.commit({ ...this.data, activeProfileId: id })
  }

  flush(): void {
    this.store.flush()
  }

  private commit(data: ProfileStore): void {
    this.data = data
    this.store.save(data)
    this.events.emit('changed')
  }
}
