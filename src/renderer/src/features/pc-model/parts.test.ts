import { describe, expect, it } from 'vitest'
import type { DeviceInfo, ZoneInfo } from '@shared/model'
import { automaticTargets, resolveParts } from './parts'

function zone(
  index: number,
  name: string,
  startIndex: number,
  ledCount: number,
  resizable = false
): ZoneInfo {
  return {
    index,
    name,
    shape: ledCount > 1 || resizable ? 'linear' : 'single',
    startIndex,
    ledCount,
    ledsMin: resizable ? 0 : ledCount,
    ledsMax: resizable ? 200 : ledCount,
    resizable,
    matrix: null
  }
}

function device(id: string, kind: DeviceInfo['kind'], zones: ZoneInfo[], name = id): DeviceInfo {
  return {
    id,
    name,
    vendor: '',
    description: '',
    kind,
    location: '',
    serial: '',
    version: '',
    ledCount: zones.reduce((sum, z) => sum + z.ledCount, 0),
    zones,
    modes: [],
    activeModeIndex: 0,
    supportsDirect: true,
    delivery: 'live'
  }
}

// The reference build: MSI board with two ARGB headers, Corsair memory, two Strimer cables.
const board = device('board', 'motherboard', [
  zone(0, 'JRGB1', 0, 1),
  zone(1, 'JRGB2', 1, 1),
  zone(2, 'JRAINBOW1', 2, 40, true),
  zone(3, 'JRAINBOW2', 42, 40, true)
])
const memory = device('ram', 'memory', [zone(0, 'Barrette', 0, 20)])
const gpuCable = device('strimer-gpu', 'cable', [zone(0, 'Câble', 0, 132)], 'Strimer Plus GPU')
const atxCable = device('strimer-atx', 'cable', [zone(0, 'Câble', 0, 116)], 'Strimer Plus 24 broches')
const mouse = device('mouse', 'mouse', [zone(0, 'Logo', 0, 1)])
const devices = [mouse, board, memory, gpuCable, atxCable]

describe('automaticTargets', () => {
  it('puts the AIO on the first ARGB header, case fans on the second and cables by name', () => {
    const targets = automaticTargets(devices)
    expect(targets.pump).toEqual({ deviceId: 'board', zoneIndex: 2 })
    expect(targets['top-fans']).toEqual({ deviceId: 'board', zoneIndex: 2 })
    expect(targets['side-fans']).toEqual({ deviceId: 'board', zoneIndex: 3 })
    expect(targets['rear-fan']).toEqual({ deviceId: 'board', zoneIndex: 3 })
    expect(targets.memory).toEqual({ deviceId: 'ram', zoneIndex: null })
    expect(targets['atx-cable']).toEqual({ deviceId: 'strimer-atx', zoneIndex: null })
    expect(targets['gpu-cable']).toEqual({ deviceId: 'strimer-gpu', zoneIndex: null })
  })

  it('prefers a dedicated cooler and wireless fans over motherboard headers', () => {
    const cooler = device('aio', 'cooler', [zone(0, 'Pompe', 0, 24), zone(1, 'Ventilateur 1', 24, 24)])
    const fans = device('fans', 'fan', [zone(0, 'Ventilateur 1', 0, 24)])
    const targets = automaticTargets([board, cooler, fans])
    expect(targets.pump).toEqual({ deviceId: 'aio', zoneIndex: 0 })
    expect(targets['top-fans']).toEqual({ deviceId: 'aio', zoneIndex: null })
    expect(targets['side-fans']).toEqual({ deviceId: 'fans', zoneIndex: null })
  })

  it('leaves parts unlit when nothing can feed them', () => {
    const targets = automaticTargets([mouse])
    expect(Object.values(targets).every((target) => target === null)).toBe(true)
  })
})

describe('resolveParts', () => {
  it('maps targets to LED ranges and honours explicit choices', () => {
    const parts = resolveParts(devices, {
      'rear-fan': { deviceId: 'board', zoneIndex: 2 },
      'case-strip': null
    })
    expect(parts['side-fans']).toMatchObject({ automatic: true, source: { start: 42, count: 40 } })
    expect(parts['rear-fan']).toMatchObject({ automatic: false, source: { start: 2, count: 40 } })
    expect(parts['case-strip']).toMatchObject({ automatic: false, target: null, source: null })
    expect(parts['gpu-cable'].source).toMatchObject({ start: 0, count: 132 })
  })

  it('keeps a choice whose device is disconnected, without a source', () => {
    const parts = resolveParts(devices, { memory: { deviceId: 'gone', zoneIndex: null } })
    expect(parts.memory).toMatchObject({ automatic: false, target: { deviceId: 'gone' }, source: null })
  })
})
