import type { AppSnapshot, DeviceInfo, DeviceLighting } from '@shared/model'

export const DEFAULT_DEVICE_LIGHTING: DeviceLighting = {
  control: 'software',
  followSync: true,
  zones: {},
  hardware: null
}

export type DeviceMode = 'sync' | 'software' | 'hardware'

export function deviceLighting(snapshot: AppSnapshot, deviceId: string): DeviceLighting {
  return snapshot.lighting.devices[deviceId] ?? DEFAULT_DEVICE_LIGHTING
}

export function deviceMode(snapshot: AppSnapshot, deviceId: string): DeviceMode {
  const config = deviceLighting(snapshot, deviceId)
  if (snapshot.lighting.sync && config.followSync) return 'sync'
  return config.control === 'hardware' && config.hardware ? 'hardware' : 'software'
}

export function deviceStatus(snapshot: AppSnapshot, device: DeviceInfo): string {
  if (!snapshot.lighting.power) return 'Éteint'
  const mode = deviceMode(snapshot, device.id)
  if (mode === 'sync') return 'Synchronisé'
  if (mode === 'hardware')
    return `Mode matériel · ${deviceLighting(snapshot, device.id).hardware?.modeName ?? ''}`
  return 'Effets personnalisés'
}
