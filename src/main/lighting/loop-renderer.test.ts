import { describe, expect, it } from 'vitest'
import { EFFECTS } from '@shared/effects'
import type { DeviceInfo, EffectConfig, LightingState } from '@shared/model'
import { LightingStateSchema } from '@shared/schemas'
import { fitRgbUpload, MAX_COMPRESSED_BYTES } from '@main/hardware/lianli/protocol'
import { decompress } from '@main/hardware/lianli/tinyuz'
import { loopFrameAt, renderLoop } from './loop-renderer'
import { planDevice } from './planner'

const strimer: DeviceInfo = {
  id: 'lianli-aabbcc000001',
  name: 'Strimer Plus 24 broches',
  vendor: 'Lian Li',
  description: '',
  kind: 'cable',
  location: '',
  serial: '',
  version: '',
  ledCount: 116,
  zones: [
    {
      index: 0,
      name: 'Câble',
      shape: 'linear',
      startIndex: 0,
      ledCount: 116,
      ledsMin: 116,
      ledsMax: 116,
      resizable: false,
      matrix: null
    }
  ],
  modes: [],
  activeModeIndex: 0,
  supportsDirect: true,
  delivery: 'loop'
}

const state = (effect: Partial<EffectConfig>): LightingState => {
  const base = LightingStateSchema.parse({})
  return { ...base, syncEffect: { ...base.syncEffect, ...effect } }
}

function loopFor(effect: Partial<EffectConfig>) {
  const plan = planDevice(strimer, state(effect), undefined, undefined)
  if (plan?.kind !== 'software') throw new Error('expected a software plan')
  return renderLoop(plan)
}

describe('loop renderer', () => {
  it('renders still effects as a single frame', () => {
    const loop = loopFor({ id: 'static', colors: [{ r: 200, g: 0, b: 0 }], brightness: 100 })
    expect(loop.frames).toHaveLength(1)
    expect(loop.frames[0]!.length).toBe(116 * 3)
    expect(loopFrameAt(loop, 123_456)).toBe(loop.frames[0])
  })

  it('renders animated effects over one full period, so the loop is seamless', () => {
    const loop = loopFor({ id: 'breathing', speed: 50, colors: [{ r: 255, g: 255, b: 255 }] })
    expect(loop.frames.length).toBeGreaterThan(10)
    // The frame after the last one is the first one again: both are the darkest point of the breath.
    const first = loop.frames[0]!
    const last = loop.frames.at(-1)!
    expect(Math.abs(first[0]! - last[0]!)).toBeLessThan(8)
    expect(loopFrameAt(loop, loop.intervalMs * loop.frames.length)).toBe(first)
  })

  it('fits every effect, at every speed, in the memory of a wireless device', () => {
    for (const definition of EFFECTS) {
      for (const speed of [0, 50, 100]) {
        const loop = loopFor({
          id: definition.id,
          speed,
          colors: [
            { r: 255, g: 0, b: 0 },
            { r: 0, g: 80, b: 255 }
          ]
        })
        const upload = fitRgbUpload(loop.frames, loop.intervalMs)
        expect(upload.compressed.length).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES)
        expect(upload.ledCount).toBe(116)
        const raw = decompress(upload.compressed, upload.frameCount * 116 * 3)
        expect(raw.length).toBe(upload.frameCount * 116 * 3)
      }
    }
  }, 60_000)
})
