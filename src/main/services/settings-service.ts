import type { JsonStore } from '@main/core/json-store'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { AppSettings, SettingsPatch } from '@shared/model'
import { AppSettingsSchema } from '@shared/schemas'

export interface SettingsEvents {
  changed: [settings: AppSettings, previous: AppSettings]
}

export class SettingsService {
  readonly events = new TypedEmitter<SettingsEvents>()
  private settings: AppSettings

  constructor(private readonly store: JsonStore<typeof AppSettingsSchema>) {
    this.settings = store.load()
  }

  get(): AppSettings {
    return this.settings
  }

  update(patch: SettingsPatch): AppSettings {
    const previous = this.settings
    const merged = AppSettingsSchema.parse({
      ...previous,
      ...patch,
      engine: { ...previous.engine, ...patch.engine },
      pcModel: { ...previous.pcModel, ...patch.pcModel }
    })
    this.settings = merged
    this.store.save(merged)
    this.events.emit('changed', merged, previous)
    return merged
  }

  flush(): void {
    this.store.flush()
  }
}
