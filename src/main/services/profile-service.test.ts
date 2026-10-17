import { describe, expect, it } from 'vitest'
import { LightingStateSchema } from '@shared/schemas'
import { profilePreview } from './profile-service'

const red = { r: 255, g: 0, b: 0 }
const blue = { r: 0, g: 0, b: 255 }

function effect(id: 'static' | 'wave' | 'rainbow', colors = [red]) {
  return { id, colors, speed: 50, brightness: 100, size: 50, reverse: false }
}

describe('profilePreview', () => {
  it('shows the synchronised effect', () => {
    const lighting = LightingStateSchema.parse({ syncEffect: effect('wave', [red, blue]) })
    expect(profilePreview(lighting)).toEqual({ power: true, effect: 'wave', colors: [red, blue] })
  })

  it('falls back on the first zone set up on its own when nothing is synchronised', () => {
    const lighting = LightingStateSchema.parse({
      sync: false,
      power: false,
      syncEffect: effect('static'),
      devices: {
        board: { control: 'hardware', followSync: false, zones: { '0': effect('static', [blue]) } },
        strip: { control: 'software', followSync: false, zones: { '0': effect('rainbow') } }
      }
    })
    expect(profilePreview(lighting)).toMatchObject({ power: false, effect: 'rainbow' })
  })
})
