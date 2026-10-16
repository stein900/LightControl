import {
  Box,
  CircuitBoard,
  Fan,
  Gamepad2,
  Gpu,
  Grid3x3,
  HardDrive,
  Headphones,
  Keyboard,
  Laptop,
  Lightbulb,
  MemoryStick,
  Mic,
  Monitor,
  Mouse,
  PcCase,
  Puzzle,
  Speaker,
  Spline,
  Square,
  Cable,
  type LucideIcon
} from 'lucide-react'
import type { DeviceInfo, DeviceKind, DeviceSettings, EngineState, ZoneInfo } from '@shared/model'

export const KINDS: Record<DeviceKind, { label: string; icon: LucideIcon }> = {
  motherboard: { label: 'Carte mère', icon: CircuitBoard },
  memory: { label: 'Mémoire', icon: MemoryStick },
  gpu: { label: 'Carte graphique', icon: Gpu },
  cooler: { label: 'Refroidissement', icon: Fan },
  ledstrip: { label: 'Bandeau LED', icon: Spline },
  keyboard: { label: 'Clavier', icon: Keyboard },
  mouse: { label: 'Souris', icon: Mouse },
  mousemat: { label: 'Tapis de souris', icon: Square },
  headset: { label: 'Casque', icon: Headphones },
  'headset-stand': { label: 'Support de casque', icon: Headphones },
  gamepad: { label: 'Manette', icon: Gamepad2 },
  light: { label: 'Éclairage', icon: Lightbulb },
  speaker: { label: 'Enceinte', icon: Speaker },
  virtual: { label: 'Appareil virtuel', icon: Box },
  storage: { label: 'Stockage', icon: HardDrive },
  case: { label: 'Boîtier', icon: PcCase },
  microphone: { label: 'Microphone', icon: Mic },
  accessory: { label: 'Accessoire', icon: Puzzle },
  keypad: { label: 'Pavé', icon: Grid3x3 },
  laptop: { label: 'Ordinateur portable', icon: Laptop },
  monitor: { label: 'Écran', icon: Monitor },
  cable: { label: 'Câble RGB', icon: Cable },
  fan: { label: 'Ventilateurs', icon: Fan },
  unknown: { label: 'Appareil', icon: Box }
}

export function kindLabel(kind: DeviceKind): string {
  return KINDS[kind].label
}

export function deviceName(device: DeviceInfo, settings: DeviceSettings | undefined): string {
  return settings?.alias || device.name
}

export function zoneName(zone: ZoneInfo, settings: DeviceSettings | undefined): string {
  return settings?.zoneAliases[String(zone.index)] || zone.name
}

/** Explains motherboard header names in plain language. */
export function zoneHint(zone: ZoneInfo): string | null {
  const name = zone.name.toUpperCase()
  if (name.startsWith('JRAINBOW') || name.startsWith('JARGB') || name.includes('ARGB')) {
    return 'Header ARGB 5 V (3 broches) : AIO, ventilateurs, bandeaux adressables'
  }
  if (name.startsWith('JRGB') || name.includes('12V')) return 'Header RGB 12 V (4 broches)'
  if (name.startsWith('JCORSAIR')) return 'Header Corsair'
  return null
}

export const ENGINE_STATE_LABEL: Record<EngineState, string> = {
  stopped: 'Arrêté',
  starting: 'Démarrage',
  connecting: 'Connexion',
  connected: 'Connecté',
  error: 'Erreur'
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}
