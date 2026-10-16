import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonStore } from '@main/core/json-store'
import { silentLogger } from '@main/core/logger'
import { LightingStateSchema } from '@shared/schemas'
import { LightingStateService } from './lighting-state-service'

function service(): LightingStateService {
  const file = join(mkdtempSync(join(tmpdir(), 'lightcontrol-test-')), 'lighting.json')
  return new LightingStateService(
    new JsonStore(file, LightingStateSchema, () => LightingStateSchema.parse({}), silentLogger)
  )
}

describe('LightingStateService', () => {
  it('brings every device back into the synchronisation when it is turned on', () => {
    const lighting = service()
    lighting.setSync(false)
    lighting.setHardwareMode('board', {
      modeName: 'Static',
      speed: null,
      brightness: 100,
      direction: null,
      colorMode: 'per-led',
      colors: [{ r: 255, g: 255, b: 255 }]
    })
    lighting.setFollowSync('keyboard', false)

    lighting.setSync(true)

    const state = lighting.get()
    expect(state.sync).toBe(true)
    expect(state.devices['board']?.followSync).toBe(true)
    expect(state.devices['keyboard']?.followSync).toBe(true)
    // The device keeps its own settings for when synchronisation is turned off again.
    expect(state.devices['board']?.hardware?.modeName).toBe('Static')
  })

  it('keeps per-device settings when synchronisation is turned off', () => {
    const lighting = service()
    lighting.setFollowSync('keyboard', false)
    lighting.setSync(false)
    expect(lighting.get().devices['keyboard']?.followSync).toBe(false)
  })
})
