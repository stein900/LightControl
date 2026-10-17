/**
 * Which LEDs feed each lit part of the 3D model. Parts follow an automatic
 * assignment guessed from the detected hardware until the user picks a
 * device or zone for them; the choice is stored in `settings.pcModel.bindings`.
 */
import { PC_MODEL_PARTS } from '@shared/schemas'
import type { DeviceInfo, PcModelPart, ZoneTarget } from '@shared/model'

export const PART_LABELS: Record<PcModelPart, string> = {
  'top-fans': 'Ventilateurs du haut',
  'side-fans': 'Ventilateurs latéraux',
  'bottom-fans': 'Ventilateurs du bas',
  'rear-fan': 'Ventilateur arrière',
  pump: 'Pompe du watercooling',
  memory: 'Mémoire',
  'atx-cable': 'Câble 24 broches',
  'gpu-cable': 'Câble de la carte graphique',
  'case-strip': 'Bandeau du boîtier'
}

/** LED range of a device frame that feeds a part. */
export interface PartSource extends ZoneTarget {
  start: number
  count: number
}

export interface ResolvedPart {
  part: PcModelPart
  /** What the part listens to: the user's choice, or the automatic one. */
  target: ZoneTarget | null
  /** Null when unlit, or when the target device is not connected. */
  source: PartSource | null
  automatic: boolean
}

export function sameTarget(a: ZoneTarget | null, b: ZoneTarget | null): boolean {
  return a === b || (!!a && !!b && a.deviceId === b.deviceId && a.zoneIndex === b.zoneIndex)
}

function sourceOf(devices: readonly DeviceInfo[], target: ZoneTarget | null): PartSource | null {
  if (!target) return null
  const device = devices.find((candidate) => candidate.id === target.deviceId)
  if (!device) return null
  if (target.zoneIndex === null) {
    return device.ledCount > 0 ? { ...target, start: 0, count: device.ledCount } : null
  }
  const zone = device.zones.find((candidate) => candidate.index === target.zoneIndex)
  return zone && zone.ledCount > 0 ? { ...target, start: zone.startIndex, count: zone.ledCount } : null
}

const whole = (device: DeviceInfo): ZoneTarget => ({ deviceId: device.id, zoneIndex: null })

/**
 * Best guess for a typical build: AIO pump and radiator fans on the first
 * addressable header, case fans on the second, Strimer cables by name.
 * Dedicated devices (a cooler, wireless fans, memory) always win over headers.
 */
export function automaticTargets(devices: readonly DeviceInfo[]): Record<PcModelPart, ZoneTarget | null> {
  const lit = devices.filter((device) => device.ledCount > 0)
  const ofKind = (...kinds: DeviceInfo['kind'][]): DeviceInfo[] =>
    lit.filter((device) => kinds.includes(device.kind))

  // Addressable headers of the motherboard and of standalone ARGB controllers.
  const headers: ZoneTarget[] = ofKind('motherboard', 'ledstrip').flatMap((device) =>
    device.zones
      .filter(
        (zone) => zone.ledCount > 0 && (zone.resizable || (zone.shape === 'linear' && zone.ledCount > 1))
      )
      .map((zone) => ({ deviceId: device.id, zoneIndex: zone.index }))
  )
  const firstHeader = headers[0] ?? null
  const otherHeader = headers[1] ?? firstHeader

  const cooler = ofKind('cooler')[0]
  const pumpZone = cooler?.zones.find((zone) => /pomp|pump/i.test(zone.name))
  const fans = ofKind('fan').map(whole)

  const cables = ofKind('cable')
  const atx = cables.find((device) => /24|atx/i.test(device.name))
  const gpu = cables.find((device) => device !== atx && /gpu|pcie|12v/i.test(device.name))
  const spare = cables.filter((device) => device !== atx && device !== gpu)
  const atxCable = atx ?? spare.shift()
  const gpuCable = gpu ?? spare.shift()

  const caseLights = ofKind('case', 'light')[0]

  return {
    'top-fans': cooler ? whole(cooler) : firstHeader,
    'side-fans': fans[0] ?? otherHeader,
    'bottom-fans': fans[1] ?? fans[0] ?? otherHeader,
    'rear-fan': fans[2] ?? fans[0] ?? otherHeader,
    pump: cooler
      ? pumpZone
        ? { deviceId: cooler.id, zoneIndex: pumpZone.index }
        : whole(cooler)
      : firstHeader,
    memory: ofKind('memory').map(whole)[0] ?? null,
    'atx-cable': atxCable ? whole(atxCable) : null,
    'gpu-cable': gpuCable ? whole(gpuCable) : null,
    'case-strip': caseLights ? whole(caseLights) : (fans[0] ?? otherHeader)
  }
}

export function resolveParts(
  devices: readonly DeviceInfo[],
  bindings: Readonly<Record<string, ZoneTarget | null>>
): Record<PcModelPart, ResolvedPart> {
  const automatic = automaticTargets(devices)
  return Object.fromEntries(
    PC_MODEL_PARTS.map((part) => {
      const chosen = Object.hasOwn(bindings, part)
      const target = chosen ? (bindings[part] ?? null) : automatic[part]
      return [part, { part, target, source: sourceOf(devices, target), automatic: !chosen }]
    })
  ) as Record<PcModelPart, ResolvedPart>
}
