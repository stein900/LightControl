import { describe, expect, it } from 'vitest'
import { EFFECTS } from '@shared/effects'
import type { DeviceInfo, EffectConfig, LightingState } from '@shared/model'
import { LightingStateSchema } from '@shared/schemas'
import { channelGains, quantize } from './color-pipeline'
import { renderEffect } from './effect-renderer'
import { planDevice } from './planner'

const effect = (patch: Partial<EffectConfig>): EffectConfig => ({
  id: 'static',
  colors: [{ r: 255, g: 255, b: 255 }],
  speed: 50,
  brightness: 100,
  size: 50,
  reverse: false,
  ...patch
})

const device: DeviceInfo = {
  id: 'orgb-board',
  name: 'Board',
  vendor: 'MSI',
  description: '',
  kind: 'motherboard',
  location: '',
  serial: '',
  version: '',
  ledCount: 25,
  zones: [
    {
      index: 0,
      name: 'JRGB1',
      shape: 'single',
      startIndex: 0,
      ledCount: 1,
      ledsMin: 1,
      ledsMax: 1,
      resizable: false,
      matrix: null
    },
    {
      index: 1,
      name: 'JRAINBOW1',
      shape: 'linear',
      startIndex: 1,
      ledCount: 24,
      ledsMin: 0,
      ledsMax: 200,
      resizable: true,
      matrix: null
    },
    {
      index: 2,
      name: 'JRAINBOW2',
      shape: 'linear',
      startIndex: 25,
      ledCount: 0,
      ledsMin: 0,
      ledsMax: 240,
      resizable: true,
      matrix: null
    }
  ],
  modes: [
    {
      index: 0,
      name: 'Direct',
      capabilities: {
        speed: false,
        brightness: false,
        direction: false,
        directionAxis: null,
        perLedColor: true,
        modeSpecificColor: false,
        randomColor: false,
        manualSave: false,
        automaticSave: false
      },
      speed: null,
      brightness: null,
      direction: 0,
      colorMode: 'per-led',
      colorsMin: 0,
      colorsMax: 0,
      colors: []
    },
    {
      index: 1,
      name: 'Static',
      capabilities: {
        speed: false,
        brightness: true,
        direction: false,
        directionAxis: null,
        perLedColor: false,
        modeSpecificColor: true,
        randomColor: false,
        manualSave: true,
        automaticSave: false
      },
      speed: null,
      brightness: 100,
      direction: 0,
      colorMode: 'mode-specific',
      colorsMin: 1,
      colorsMax: 1,
      colors: [{ r: 255, g: 255, b: 255 }]
    }
  ],
  activeModeIndex: 0,
  supportsDirect: true,
  delivery: 'live'
}

const baseState = (patch: Partial<LightingState> = {}): LightingState => ({
  ...LightingStateSchema.parse({}),
  ...patch
})

function renderPlan(state: LightingState, time = 0): Uint8Array {
  const plan = planDevice(device, state, undefined, undefined)
  if (plan?.kind !== 'software') throw new Error('expected a software plan')
  const float = new Float32Array(plan.ledCount * 3)
  const bytes = new Uint8Array(plan.ledCount * 3)
  for (const zone of plan.zones)
    zone.render({ time, count: zone.ledCount, seed: zone.seed }, float, zone.startIndex)
  quantize(float, bytes, plan.gains)
  return bytes
}

describe('effect renderer', () => {
  it.each(EFFECTS.map((descriptor) => descriptor.id))(
    '%s writes only inside its zone and stays in range',
    (id) => {
      const target = new Float32Array(12 * 3).fill(-1)
      renderEffect(
        effect({
          id,
          colors: [
            { r: 255, g: 0, b: 0 },
            { r: 0, g: 0, b: 255 }
          ]
        }),
        { time: 1.37, count: 10, seed: 7 },
        target,
        1
      )
      expect(target[0]).toBe(-1)
      expect(target[target.length - 1]).toBe(-1)
      for (let i = 3; i < 33; i++) {
        expect(target[i]).toBeGreaterThanOrEqual(0)
        expect(target[i]).toBeLessThanOrEqual(255.0001)
      }
    }
  )

  it('renders static colors with the effect brightness', () => {
    const target = new Float32Array(3)
    renderEffect(
      effect({ colors: [{ r: 200, g: 100, b: 50 }], brightness: 50 }),
      { time: 0, count: 1, seed: 0 },
      target,
      0
    )
    expect([...target]).toEqual([100, 50, 25])
  })
})

describe('color pipeline', () => {
  it('applies brightness and white balance per channel', () => {
    const bytes = new Uint8Array(3)
    const changed = quantize(
      new Float32Array([255, 255, 255]),
      bytes,
      channelGains(0.5, { r: 90, g: 94, b: 100 })
    )
    expect(changed).toBe(true)
    expect([...bytes]).toEqual([115, 120, 128])
    expect(
      quantize(new Float32Array([255, 255, 255]), bytes, channelGains(0.5, { r: 90, g: 94, b: 100 }))
    ).toBe(false)
  })
})

describe('planner', () => {
  it('applies the sync effect to every non-empty zone', () => {
    const plan = planDevice(device, baseState(), undefined, undefined)
    expect(plan?.kind).toBe('software')
    if (plan?.kind !== 'software') return
    expect(plan.zones.map((zone) => zone.zoneIndex)).toEqual([0, 1])
    expect([...renderPlan(baseState()).slice(0, 6)]).toEqual([255, 255, 255, 255, 255, 255])
  })

  it('turns every LED off when power is off', () => {
    expect(renderPlan(baseState({ power: false })).every((value) => value === 0)).toBe(true)
  })

  it('uses per-zone effects once the device leaves the sync', () => {
    const state = baseState({
      devices: {
        [device.id]: {
          control: 'software',
          followSync: false,
          zones: { '1': effect({ colors: [{ r: 0, g: 0, b: 255 }] }) },
          hardware: null
        }
      }
    })
    const bytes = renderPlan(state)
    expect([...bytes.slice(0, 3)]).toEqual([255, 255, 255])
    expect([...bytes.slice(3, 6)]).toEqual([0, 0, 255])
  })

  it('builds hardware plans with white-balanced colors and device-side brightness', () => {
    const state = baseState({
      sync: false,
      brightness: 50,
      devices: {
        [device.id]: {
          control: 'hardware',
          followSync: false,
          zones: {},
          hardware: {
            modeName: 'Static',
            speed: null,
            brightness: 100,
            direction: null,
            colorMode: 'mode-specific',
            colors: [{ r: 255, g: 255, b: 255 }]
          }
        }
      }
    })
    const plan = planDevice(
      device,
      state,
      { alias: null, zoneAliases: {}, zoneSizes: {}, whiteBalance: { r: 90, g: 100, b: 100 } },
      undefined
    )
    expect(plan?.kind).toBe('hardware')
    if (plan?.kind !== 'hardware') return
    expect(plan.overrides.brightness).toBe(50)
    expect(plan.overrides.colors).toEqual([{ r: 230, g: 255, b: 255 }])
  })

  it('lets overlays take over the device', () => {
    const plan = planDevice(device, baseState({ power: false }), undefined, {
      kind: 'led-count',
      deviceId: device.id,
      zoneIndex: 1
    })
    expect(plan?.kind).toBe('software')
    if (plan?.kind !== 'software') return
    const float = new Float32Array(plan.ledCount * 3)
    for (const zone of plan.zones)
      zone.render({ time: 0, count: zone.ledCount, seed: 0 }, float, zone.startIndex)
    expect([...float.slice(72, 75)]).toEqual([255, 0, 0])
    expect([...float.slice(0, 3)]).toEqual([0, 0, 0])
  })
})

describe('matrix layouts', () => {
  it('sweeps spatial effects across columns instead of LED order', () => {
    const keyboard: DeviceInfo = {
      ...device,
      id: 'orgb-keyboard',
      ledCount: 4,
      zones: [
        {
          index: 0,
          name: 'Keyboard',
          shape: 'matrix',
          startIndex: 0,
          ledCount: 4,
          ledsMin: 4,
          ledsMax: 4,
          resizable: false,
          // Row-major: LEDs 0 and 1 on the first row, 2 and 3 below them.
          matrix: { width: 2, height: 2, cells: [0, 1, 2, 3] }
        }
      ]
    }
    const state = baseState({
      syncEffect: effect({
        id: 'gradient',
        colors: [
          { r: 255, g: 0, b: 0 },
          { r: 0, g: 0, b: 255 }
        ]
      })
    })
    const plan = planDevice(keyboard, state, undefined, undefined)
    if (plan?.kind !== 'software') throw new Error('expected a software plan')
    const float = new Float32Array(12)
    const zone = plan.zones[0]!
    zone.render({ time: 0, count: 4, seed: 0, layout: zone.layout }, float, 0)
    expect([...float.slice(0, 3)]).toEqual([...float.slice(6, 9)])
    expect([...float.slice(3, 6)]).toEqual([...float.slice(9, 12)])
    expect([...float.slice(0, 3)]).toEqual([255, 0, 0])
    expect([...float.slice(3, 6)]).toEqual([0, 0, 255])
  })
})

describe('hardware modes with per-LED colors', () => {
  it('fills the LEDs with the white-balanced color after the mode (MSI style)', () => {
    const perLedDevice: DeviceInfo = {
      ...device,
      modes: device.modes.map((mode) =>
        mode.name === 'Static'
          ? {
              ...mode,
              colorMode: 'per-led',
              capabilities: { ...mode.capabilities, perLedColor: true, modeSpecificColor: false }
            }
          : mode
      )
    }
    const state = baseState({
      sync: false,
      devices: {
        [device.id]: {
          control: 'hardware',
          followSync: false,
          zones: {},
          hardware: {
            modeName: 'Static',
            speed: null,
            brightness: 100,
            direction: null,
            colorMode: 'per-led',
            colors: [{ r: 255, g: 255, b: 255 }]
          }
        }
      }
    })
    const plan = planDevice(
      perLedDevice,
      state,
      { alias: null, zoneAliases: {}, zoneSizes: {}, whiteBalance: { r: 84, g: 90, b: 100 } },
      undefined
    )
    if (plan?.kind !== 'hardware') throw new Error('expected a hardware plan')
    expect(plan.ledFill).toEqual({ r: 214, g: 230, b: 255 })
    expect(plan.preview).toEqual(plan.ledFill)
  })
})
