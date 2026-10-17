import { existsSync } from 'node:fs'
import { utilityProcess, type UtilityProcess } from 'electron'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { Logger } from '@main/core/logger'
import type {
  DeviceInfo,
  DeviceKind,
  IntegrationAction,
  IntegrationState,
  IntegrationStatus,
  ZoneInfo
} from '@shared/model'
import type { HardwareBackend, HardwareBackendEvents, LedLoop } from '../backend'
import type {
  LianliDevice,
  LianliHostEvent,
  LianliHostRequest,
  LianliHostState,
  LianliUnavailableReason
} from './host-protocol'

const RESTART_DELAY_MS = 3000
const STOP_TIMEOUT_MS = 1500

/**
 * State of the vendor software that normally owns the dongle. `active`: it
 * holds the dongle. `autostart`: stopped, but it starts again with Windows.
 */
export type DongleOwnerState = 'active' | 'autostart' | 'stopped' | 'absent'

/** The vendor software (L-Connect 3) that LightControl takes the dongle from and gives it back to. */
export interface DongleOwner {
  name: string
  state(): Promise<DongleOwnerState>
  /** Devices the user paired with the vendor software, in pairing order; null when it has no list. */
  pairedDevices(): Promise<string[] | null>
  /** Stops the vendor software (administrator prompt); resolves false when refused. */
  takeOver(): Promise<boolean>
  /** Restores and restarts the vendor software (administrator prompt); resolves false when refused. */
  handBack(): Promise<boolean>
}

/** LightControl's own copy of the pairing list, used when the vendor software's is unavailable. */
export interface PairingStore {
  load(): string[]
  save(paired: string[]): void
}

export interface LianliBackendOptions {
  /** libusb-1.0.dll shipped with the OpenRGB engine. */
  dllPath: string
  /** Built host script (out/main/lianli-host.js). */
  hostScript: string
  owner: DongleOwner
  pairing: PairingStore
  logger: Logger
}

const STRIMER_NAMES: Record<number, string> = {
  1: 'Strimer Plus 24 broches',
  2: 'Strimer Plus GPU',
  3: 'Strimer Plus 24 broches',
  4: 'Strimer Plus GPU'
}

function kindOf(device: LianliDevice): DeviceKind {
  switch (device.family) {
    case 'strimer':
      return 'cable'
    case 'hydroshift':
      return 'cooler'
    case 'lancool-217':
    case 'lancool-v150':
      return 'case'
    case 'screen-88':
      return 'accessory'
    default:
      return 'fan'
  }
}

function linearZone(index: number, name: string, startIndex: number, ledCount: number): ZoneInfo {
  return {
    index,
    name,
    shape: 'linear',
    startIndex,
    ledCount,
    ledsMin: ledCount,
    ledsMax: ledCount,
    resizable: false,
    matrix: null
  }
}

/** Zones in upload order: the pump head of a HydroShift first, then one zone per fan. */
function zonesOf(device: LianliDevice): ZoneInfo[] {
  if (device.family === 'strimer') return [linearZone(0, 'Câble', 0, device.ledCount)]
  const head = device.family === 'hydroshift' ? device.ledCount - device.fanCount * device.ledsPerFan : 0
  const zones = head > 0 ? [linearZone(0, 'Pompe', 0, head)] : []
  if (device.fanCount === 0 || device.ledsPerFan === 0) {
    return zones.length > 0 ? zones : [linearZone(0, 'LED', 0, device.ledCount)]
  }
  for (let fan = 0; fan < device.fanCount; fan++) {
    zones.push(
      linearZone(zones.length, `Ventilateur ${fan + 1}`, head + fan * device.ledsPerFan, device.ledsPerFan)
    )
  }
  return zones
}

/** Maps a wireless device to the domain model; it receives looping animations, not live frames. */
export function toDeviceInfo(device: LianliDevice): DeviceInfo {
  const name =
    device.family === 'strimer'
      ? (STRIMER_NAMES[device.deviceType] ?? device.model)
      : device.fanCount > 1
        ? `${device.model} ×${device.fanCount}`
        : device.model
  return {
    id: `lianli-${device.mac.replaceAll(':', '')}`,
    name,
    vendor: 'Lian Li',
    description: 'Sans fil, via le dongle Lian Li',
    kind: kindOf(device),
    location: 'Sans fil 2,4 GHz',
    serial: device.mac,
    version: '',
    ledCount: device.ledCount,
    zones: zonesOf(device),
    modes: [],
    activeModeIndex: 0,
    supportsDirect: true,
    delivery: 'loop'
  }
}

/**
 * Drives Lian Li 2.4 GHz devices (Strimer Plus Wireless, UNI FAN wireless…)
 * through their USB dongle. The dongle is opened exclusively, so it is shared
 * with L-Connect 3 by handing it over explicitly: LightControl stops L-Connect
 * to take over, and restores it on hand-back.
 *
 * Pairing stays the vendor software's job. Devices forget their master when
 * they lose power, so the host re-pairs, at each start, the devices listed in
 * L-Connect's pairing list (or LightControl's copy of it), as L-Connect does.
 */
export class LianliBackend implements HardwareBackend {
  readonly events = new TypedEmitter<HardwareBackendEvents>()
  private host: UtilityProcess | null = null
  private running = false
  /** Handed back to the vendor software: the dongle stays closed until the next take-over. */
  private released = false
  private pendingAction: IntegrationAction | null = null
  private hostState: {
    state: LianliHostState
    message: string | null
    reason: LianliUnavailableReason | null
  } = {
    state: 'connecting',
    message: null,
    reason: null
  }
  private ownerState: DongleOwnerState = 'absent'
  private unbound = 0
  private mapped = new Map<string, { info: DeviceInfo; mac: string }>()
  private restartTimer: NodeJS.Timeout | null = null
  private missingDll = false
  private paired: string[]
  /** False when the vendor software has no pairing list: LightControl's own copy is authoritative. */
  private vendorPairing = false

  constructor(private readonly options: LianliBackendOptions) {
    this.paired = options.pairing.load()
  }

  get devices(): readonly DeviceInfo[] {
    return [...this.mapped.values()].map((entry) => entry.info)
  }

  get integration(): IntegrationStatus {
    const { state, message, actions } = this.describe()
    return { id: 'lianli', name: 'Lian Li sans fil', state, message, deviceCount: this.mapped.size, actions }
  }

  start(): void {
    if (this.running) return
    this.running = true
    if (!existsSync(this.options.dllPath)) {
      this.missingDll = true
      this.events.emit('status')
      return
    }
    void this.refreshOwner()
    void this.refreshPairing()
    if (!this.released) this.spawn()
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    await this.stopHost()
    this.events.emit('status')
  }

  async restart(): Promise<void> {
    await this.stop()
    this.start()
  }

  rescan(): void {
    this.send({ type: 'retry' })
    void this.refreshOwner()
    void this.refreshPairing()
  }

  enterDirectMode(): void {
    // Wireless devices play uploaded loops; there is no mode to switch.
  }

  writeLeds(): boolean {
    return false
  }

  writeLoop(deviceId: string, loop: LedLoop): boolean {
    const entry = this.mapped.get(deviceId)
    if (!entry || !this.host || this.hostState.state !== 'connected') return false
    this.send({ type: 'upload', mac: entry.mac, frames: loop.frames, intervalMs: loop.intervalMs })
    return true
  }

  applyMode(): boolean {
    return false
  }

  async resizeZone(): Promise<void> {
    // LED counts are fixed by the device type.
  }

  async runAction(action: IntegrationAction): Promise<boolean> {
    if (this.pendingAction) return false
    this.pendingAction = action
    this.events.emit('status')
    try {
      return action === 'take-over' ? await this.takeOver() : await this.handBack()
    } finally {
      this.pendingAction = null
      await this.refreshOwner()
    }
  }

  /* ------------------------------- Hand-over ------------------------------- */

  private async takeOver(): Promise<boolean> {
    if (!(await this.options.owner.takeOver())) return false
    this.options.logger.info(`Took the Lian Li dongle over from ${this.options.owner.name}`)
    this.released = false
    // Devices may have been paired in the vendor software in the meantime.
    await this.refreshPairing()
    if (!this.running) return true
    if (this.host) this.send({ type: 'retry' })
    else this.spawn()
    return true
  }

  private async handBack(): Promise<boolean> {
    // Close the dongle first, so the vendor service can open it when it starts.
    this.released = true
    await this.stopHost()
    if (await this.options.owner.handBack()) {
      this.options.logger.info(`Handed the Lian Li dongle back to ${this.options.owner.name}`)
      return true
    }
    this.released = false
    if (this.running) this.spawn()
    return false
  }

  private async refreshPairing(): Promise<void> {
    const vendor = await this.options.owner.pairedDevices().catch(() => null)
    this.vendorPairing = vendor !== null
    const paired = vendor ?? this.options.pairing.load()
    if (vendor) this.options.pairing.save(vendor)
    this.setPairing(paired)
  }

  private setPairing(paired: string[]): void {
    if (JSON.stringify(paired) === JSON.stringify(this.paired)) return
    this.paired = paired
    this.options.logger.info(`Lian Li pairing list: ${paired.join(', ') || 'empty'}`)
    this.send({ type: 'pairing', paired })
  }

  private async refreshOwner(): Promise<void> {
    const state = await this.options.owner.state().catch((): DongleOwnerState => 'absent')
    if (state === this.ownerState) return
    this.ownerState = state
    this.events.emit('status')
  }

  /* ---------------------------------- Host --------------------------------- */

  private spawn(): void {
    this.hostState = { state: 'connecting', message: null, reason: null }
    const host = utilityProcess.fork(this.options.hostScript, [], { serviceName: 'LightControl Lian Li' })
    this.host = host
    host.on('message', (event: LianliHostEvent) => this.onHostEvent(event))
    host.once('exit', (code) => {
      if (this.host !== host) return
      this.host = null
      this.setDevices([], 0)
      if (!this.running || this.released) return
      this.options.logger.warn(`Lian Li host exited with code ${code}`)
      this.hostState = {
        state: 'error',
        message: 'L’intégration Lian Li s’est arrêtée ; redémarrage…',
        reason: null
      }
      this.events.emit('status')
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.running && !this.released) this.spawn()
      }, RESTART_DELAY_MS)
    })
    this.send({ type: 'start', dllPath: this.options.dllPath, paired: this.paired })
    this.events.emit('status')
  }

  private async stopHost(): Promise<void> {
    const host = this.host
    this.host = null
    this.setDevices([], 0)
    if (!host) return
    const exited = new Promise<void>((resolve) => host.once('exit', () => resolve()))
    host.postMessage({ type: 'stop' } satisfies LianliHostRequest)
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
    host.kill()
  }

  private onHostEvent(event: LianliHostEvent): void {
    switch (event.type) {
      case 'state':
        this.hostState = { state: event.state, message: event.message, reason: event.reason }
        this.options.logger.info(
          `Lian Li ${event.state}${event.reason ? ` (${event.reason})` : ''}${event.message ? `: ${event.message}` : ''}`
        )
        // The vendor software is the usual reason for a busy dongle: show whether it runs.
        if (event.reason === 'busy' || event.state === 'connected') void this.refreshOwner()
        this.events.emit('status')
        return
      case 'devices':
        this.setDevices(event.devices, event.unbound)
        return
      case 'applied':
        this.options.logger.info(`Lian Li ${event.mac} plays the new animation (${event.frames} frame(s))`)
        return
      case 'log':
        this.options.logger[event.level](event.message)
    }
  }

  private setDevices(heard: LianliDevice[], unbound: number): void {
    // Pairing order, not radio order, so the list stays stable from one start to the next.
    const rank = (device: LianliDevice): number => {
      const index = this.paired.indexOf(device.mac)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }
    const devices = [...heard].sort((a, b) => rank(a) - rank(b) || a.mac.localeCompare(b.mac))
    const next = new Map(
      devices.map((device) => [
        `lianli-${device.mac.replaceAll(':', '')}`,
        { info: toDeviceInfo(device), mac: device.mac }
      ])
    )
    const changed =
      JSON.stringify([...next.values()].map((entry) => entry.info)) !==
      JSON.stringify([...this.mapped.values()].map((entry) => entry.info))
    this.mapped = next
    this.unbound = unbound
    // Without a vendor list, devices found paired with this dongle are remembered for the next start.
    const extra = devices.map((device) => device.mac).filter((mac) => !this.paired.includes(mac))
    if (!this.vendorPairing && extra.length > 0) {
      const paired = [...this.paired, ...extra]
      this.options.pairing.save(paired)
      this.setPairing(paired)
    }
    if (changed) {
      if (devices.length > 0) {
        this.options.logger.info(
          `Lian Li devices: ${devices.map((d) => `${d.model} ${d.mac} (${d.ledCount} LED)`).join(', ')}`
        )
      }
      this.events.emit('devices', [...this.devices])
    }
    this.events.emit('status')
  }

  private send(request: LianliHostRequest): void {
    this.host?.postMessage(request)
  }

  /** User-facing status, derived from the host session and the vendor software. */
  private describe(): { state: IntegrationState; message: string | null; actions: IntegrationAction[] } {
    const owner = this.options.owner.name
    const ownerInstalled = this.ownerState !== 'absent'
    if (this.missingDll) {
      return {
        state: 'unavailable',
        message: 'La bibliothèque USB est absente de l’installation.',
        actions: []
      }
    }
    if (this.pendingAction) {
      return {
        state: 'connecting',
        message: 'En attente de l’autorisation administrateur de Windows…',
        actions: []
      }
    }
    if (this.released) {
      return {
        state: 'stopped',
        message: `Rendu à ${owner} : il pilote de nouveau les appareils Lian Li.`,
        actions: ['take-over']
      }
    }
    if (!this.running) return { state: 'stopped', message: null, actions: [] }

    const { state, message, reason } = this.hostState
    if (reason === 'busy') {
      return {
        state: 'unavailable',
        message: ownerInstalled
          ? `Le dongle Lian Li est utilisé par ${owner}. Prenez le contrôle pour piloter vos appareils Lian Li depuis LightControl.`
          : 'Le dongle Lian Li est utilisé par un autre programme.',
        actions: ownerInstalled ? ['take-over'] : []
      }
    }
    if (reason === 'absent') {
      return { state: 'unavailable', message: 'Aucun dongle Lian Li sans fil n’est branché.', actions: [] }
    }
    if (state === 'connected') {
      const unpaired =
        this.unbound > 0
          ? `${this.unbound} appareil${this.unbound > 1 ? 's' : ''} à proximité ${this.unbound > 1 ? 'ne sont' : 'n’est'} pas appairé${this.unbound > 1 ? 's' : ''} à ce dongle.`
          : null
      if (this.ownerState === 'autostart') {
        return {
          state,
          message: `${owner} se relance encore au démarrage de Windows et reprendrait le dongle. Terminez la prise de contrôle pour l’en empêcher.`,
          actions: ['take-over', 'hand-back']
        }
      }
      return {
        state,
        message:
          this.mapped.size === 0
            ? (unpaired ?? 'Aucun appareil n’est appairé à ce dongle.')
            : 'Chaque appareil reçoit son animation et la joue en boucle, même LightControl fermé.',
        actions: ownerInstalled ? ['hand-back'] : []
      }
    }
    return { state, message: message ?? 'Connexion au dongle Lian Li…', actions: [] }
  }
}
