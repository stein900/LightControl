import { describe, expect, it, vi } from 'vitest'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { DeviceInfo, IntegrationStatus } from '@shared/model'
import type { HardwareBackend, HardwareBackendEvents } from './backend'
import { HardwareHub } from './hardware-hub'
import { toDeviceInfo } from './icue/icue-backend'
import { toDeviceInfo as toLianliDeviceInfo } from './lianli/lianli-backend'
import type { OpenRgbBackend } from './openrgb/openrgb-backend'

function device(id: string, vendor: string, kind: DeviceInfo['kind']): DeviceInfo {
  return {
    id,
    name: id,
    vendor,
    description: '',
    kind,
    location: '',
    serial: '',
    version: '',
    ledCount: 1,
    zones: [],
    modes: [],
    activeModeIndex: 0,
    supportsDirect: true,
    delivery: 'live'
  }
}

function fakeBackend(devices: DeviceInfo[]) {
  const backend = {
    events: new TypedEmitter<HardwareBackendEvents>(),
    devices,
    integration: {
      id: 'fake',
      name: 'Fake',
      state: 'connected',
      message: null,
      deviceCount: devices.length,
      actions: []
    } as IntegrationStatus,
    status: { state: 'connected', message: null, protocolVersion: 5, ownsServer: true, executablePath: null },
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    rescan: vi.fn(),
    enterDirectMode: vi.fn(),
    writeLeds: vi.fn(() => true),
    writeLoop: vi.fn(() => true),
    applyMode: vi.fn(() => true),
    resizeZone: vi.fn(async () => undefined)
  }
  return backend
}

describe('HardwareHub', () => {
  it('merges devices, routes commands to their owner and prefers vendor SDK devices', () => {
    const openRgb = fakeBackend([
      device('board', 'MSI', 'motherboard'),
      device('ram-orgb', 'Corsair', 'memory')
    ])
    const icue = fakeBackend([device('ram-icue', 'Corsair', 'memory')])
    const hub = new HardwareHub(openRgb as unknown as OpenRgbBackend, [icue as unknown as HardwareBackend])
    const seen: string[][] = []
    hub.events.on('devices', (devices) => seen.push(devices.map((d) => d.id)))

    icue.events.emit('devices', icue.devices)

    expect(hub.devices.map((d) => d.id)).toEqual(['board', 'ram-icue'])
    expect(seen.at(-1)).toEqual(['board', 'ram-icue'])

    const frame = new Uint8Array([1, 2, 3])
    hub.writeLeds('ram-icue', frame)
    hub.writeLeds('board', frame)
    expect(icue.writeLeds).toHaveBeenCalledWith('ram-icue', frame)
    expect(openRgb.writeLeds).toHaveBeenCalledWith('board', frame)
    expect(hub.writeLeds('ram-orgb', frame)).toBe(false)
  })

  it('routes looping animations and integration actions to the owning backend', async () => {
    const openRgb = fakeBackend([device('board', 'MSI', 'motherboard')])
    const lianli = Object.assign(fakeBackend([device('lianli-1', 'Lian Li', 'cable')]), {
      runAction: vi.fn(async () => true)
    })
    lianli.integration = { ...lianli.integration, id: 'lianli', actions: ['take-over'] }
    const hub = new HardwareHub(openRgb as unknown as OpenRgbBackend, [lianli as unknown as HardwareBackend])
    lianli.events.emit('devices', lianli.devices)

    const loop = { frames: [new Uint8Array(3)], intervalMs: 1000 }
    expect(hub.writeLoop('lianli-1', loop)).toBe(true)
    expect(lianli.writeLoop).toHaveBeenCalledWith('lianli-1', loop)
    expect(hub.writeLoop('unknown', loop)).toBe(false)

    expect(await hub.runIntegrationAction('lianli', 'take-over')).toBe(true)
    expect(lianli.runAction).toHaveBeenCalledWith('take-over')
    // Not offered right now: nothing runs.
    expect(await hub.runIntegrationAction('lianli', 'hand-back')).toBeNull()
    expect(await hub.runIntegrationAction('openrgb', 'take-over')).toBeNull()
  })
})

describe('Lian Li device mapping', () => {
  const base = {
    mac: 'aa:bb:cc:00:00:01',
    deviceType: 1,
    family: 'strimer' as const,
    model: 'Strimer Plus Wireless'
  }

  it('exposes a Strimer as one cable zone fed by looping animations', () => {
    const info = toLianliDeviceInfo({ ...base, ledCount: 116, ledsPerFan: 0, fanCount: 0 })
    expect(info.id).toBe('lianli-aabbcc000001')
    expect(info.name).toBe('Strimer Plus 24 broches')
    expect(info.kind).toBe('cable')
    expect(info.delivery).toBe('loop')
    expect(info.zones).toEqual([expect.objectContaining({ startIndex: 0, ledCount: 116, resizable: false })])
  })

  it('splits fans and pump heads into zones in upload order', () => {
    const fans = toLianliDeviceInfo({
      ...base,
      deviceType: 0,
      family: 'sl-v3',
      model: 'UNI FAN SL V3 Wireless',
      ledCount: 120,
      ledsPerFan: 40,
      fanCount: 3
    })
    expect(fans.kind).toBe('fan')
    expect(fans.zones.map((zone) => [zone.name, zone.startIndex, zone.ledCount])).toEqual([
      ['Ventilateur 1', 0, 40],
      ['Ventilateur 2', 40, 40],
      ['Ventilateur 3', 80, 40]
    ])

    const aio = toLianliDeviceInfo({
      ...base,
      deviceType: 10,
      family: 'hydroshift',
      model: 'HydroShift II LCD-C Wireless',
      ledCount: 72,
      ledsPerFan: 24,
      fanCount: 2
    })
    expect(aio.kind).toBe('cooler')
    expect(aio.zones.map((zone) => [zone.name, zone.startIndex, zone.ledCount])).toEqual([
      ['Pompe', 0, 24],
      ['Ventilateur 1', 24, 24],
      ['Ventilateur 2', 48, 24]
    ])
  })
})

describe('iCUE device mapping', () => {
  it('exposes memory as a single direct-only zone and numbers identical models', () => {
    const icueDevice = {
      id: '{abc}',
      type: 0x0080,
      model: 'VENGEANCE RGB DDR5',
      serial: '',
      leds: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, x: 0, y: i }))
    }
    const first = toDeviceInfo(icueDevice, 'icue-1', 0)
    const second = toDeviceInfo(icueDevice, 'icue-2', 1)
    expect(first.kind).toBe('memory')
    expect(first.ledCount).toBe(10)
    expect(first.zones).toHaveLength(1)
    expect(first.supportsDirect).toBe(true)
    expect(first.modes).toEqual([])
    expect(second.name).toBe('VENGEANCE RGB DDR5 #2')
  })
})
