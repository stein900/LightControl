import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypedEmitter } from '@main/core/typed-emitter'
import { silentLogger } from '@main/core/logger'
import type { HardwareBackend, HardwareBackendEvents, LedLoop } from '@main/hardware/backend'
import type { DeviceInfo, EffectConfig, LightingState } from '@shared/model'
import { LightingStateSchema } from '@shared/schemas'
import { LightingEngine } from './lighting-engine'
import { planDevice, type DevicePlan } from './planner'

const wireless: DeviceInfo = {
  id: 'lianli-1',
  name: 'Strimer',
  vendor: 'Lian Li',
  description: '',
  kind: 'cable',
  location: '',
  serial: '',
  version: '',
  ledCount: 10,
  zones: [
    {
      index: 0,
      name: 'Câble',
      shape: 'linear',
      startIndex: 0,
      ledCount: 10,
      ledsMin: 10,
      ledsMax: 10,
      resizable: false,
      matrix: null
    }
  ],
  modes: [],
  activeModeIndex: 0,
  supportsDirect: true,
  delivery: 'loop'
}

function backendWith(devices: DeviceInfo[], accept = true) {
  return {
    events: new TypedEmitter<HardwareBackendEvents>(),
    devices,
    integration: { id: 'fake', name: 'Fake', state: 'connected', message: null, deviceCount: 1, actions: [] },
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    rescan: vi.fn(),
    enterDirectMode: vi.fn(),
    writeLeds: vi.fn(() => true),
    writeLoop: vi.fn((_deviceId: string, _loop: LedLoop) => accept),
    applyMode: vi.fn(() => true),
    resizeZone: vi.fn(async () => undefined)
  } satisfies HardwareBackend
}

const lighting = (effect: Partial<EffectConfig>): LightingState => {
  const base = LightingStateSchema.parse({})
  return { ...base, syncEffect: { ...base.syncEffect, ...effect } }
}

function plans(state: LightingState): Map<string, DevicePlan> {
  return new Map([[wireless.id, planDevice(wireless, state, undefined, undefined)!]])
}

describe('lighting engine with looping devices', () => {
  let engine: LightingEngine | null = null
  afterEach(() => {
    engine?.dispose()
    vi.useRealTimers()
  })

  it('uploads one loop per change instead of streaming frames', () => {
    const backend = backendWith([wireless])
    engine = new LightingEngine(backend, () => 30, silentLogger)

    engine.apply(plans(lighting({ id: 'static', colors: [{ r: 255, g: 0, b: 0 }] })))
    expect(backend.writeLoop).toHaveBeenCalledTimes(1)
    expect(backend.writeLeds).not.toHaveBeenCalled()
    expect(backend.enterDirectMode).not.toHaveBeenCalled()
    const [, loop] = backend.writeLoop.mock.calls[0]!
    expect(loop.frames).toHaveLength(1)
    const [r, g, b] = loop.frames[0]!
    expect([r! > 100, g, b]).toEqual([true, 0, 0])

    // Same plan: nothing is sent again.
    engine.apply(plans(lighting({ id: 'static', colors: [{ r: 255, g: 0, b: 0 }] })))
    expect(backend.writeLoop).toHaveBeenCalledTimes(1)

    engine.apply(plans(lighting({ id: 'breathing', speed: 50 })))
    expect(backend.writeLoop).toHaveBeenCalledTimes(2)
    expect(backend.writeLoop.mock.calls[1]![1].frames.length).toBeGreaterThan(1)
    expect(engine.frames()[0]?.colors.length).toBe(30)
  })

  it('retries a loop the backend could not take yet', () => {
    vi.useFakeTimers()
    const backend = backendWith([wireless], false)
    engine = new LightingEngine(backend, () => 30, silentLogger)
    engine.apply(plans(lighting({ id: 'static' })))
    expect(backend.writeLoop).toHaveBeenCalledTimes(1)

    backend.writeLoop.mockReturnValue(true)
    vi.advanceTimersByTime(2500)
    expect(backend.writeLoop).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10_000)
    expect(backend.writeLoop).toHaveBeenCalledTimes(2)
  })
})
