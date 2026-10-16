import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { utilityProcess, type UtilityProcess } from 'electron'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { Logger } from '@main/core/logger'
import type { DeviceInfo, DeviceKind, IntegrationState, IntegrationStatus } from '@shared/model'
import type { HardwareBackend, HardwareBackendEvents } from '../backend'
import type { IcueDevice, IcueHostEvent, IcueHostRequest } from './icue-protocol'

/** A frame unanswered for this long means the SDK is stuck: the host process is recycled. */
const WATCHDOG_MS = 4000
const RESTART_DELAY_MS = 3000
/** Frames in flight per device before new ones are dropped. */
const MAX_IN_FLIGHT = 2

const DEVICE_KINDS: [number, DeviceKind][] = [
  [0x0001, 'keyboard'],
  [0x0002, 'mouse'],
  [0x0004, 'mousemat'],
  [0x0008, 'headset'],
  [0x0010, 'headset-stand'],
  [0x0020, 'ledstrip'],
  [0x0040, 'ledstrip'],
  [0x0080, 'memory'],
  [0x0100, 'cooler'],
  [0x0200, 'motherboard'],
  [0x0400, 'gpu'],
  [0x0800, 'accessory'],
  [0x1000, 'gamepad']
]

export interface IcueBackendOptions {
  /** Path of the redistributable iCUESDK.x64_2019.dll. */
  dllPath: string
  /** Built host script (out/main/icue-host.js). */
  hostScript: string
  logger: Logger
}

interface Mapped {
  info: DeviceInfo
  icueId: string
  inFlight: number
  lastSentAt: number
}

/** Maps an iCUE device to the domain model: one linear zone in display order, direct control only. */
export function toDeviceInfo(device: IcueDevice, id: string, ordinal: number): DeviceInfo {
  const kind = DEVICE_KINDS.find(([bit]) => (device.type & bit) !== 0)?.[1] ?? 'unknown'
  const name = ordinal > 0 ? `${device.model} #${ordinal + 1}` : device.model
  return {
    id,
    name,
    vendor: 'Corsair',
    description: 'Piloté via le SDK iCUE',
    kind,
    location: 'iCUE',
    serial: device.serial,
    version: '',
    ledCount: device.leds.length,
    zones: [
      {
        index: 0,
        name: kind === 'memory' ? 'Barrette' : 'LED',
        shape: 'linear',
        startIndex: 0,
        ledCount: device.leds.length,
        ledsMin: device.leds.length,
        ledsMax: device.leds.length,
        resizable: false,
        matrix: null
      }
    ],
    modes: [],
    activeModeIndex: 0,
    supportsDirect: true,
    delivery: 'live'
  }
}

/**
 * Drives Corsair devices through iCUE's official SDK. iCUE keeps ownership of
 * the hardware (no driver, no administrator rights, no bus conflicts) and
 * grants LightControl exclusive lighting control while it runs.
 */
export class IcueBackend implements HardwareBackend {
  readonly events = new TypedEmitter<HardwareBackendEvents>()
  private host: UtilityProcess | null = null
  private running = false
  private state: IntegrationState = 'stopped'
  private message: string | null = null
  private mapped = new Map<string, Mapped>()
  private watchdog: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: IcueBackendOptions) {}

  get devices(): readonly DeviceInfo[] {
    return [...this.mapped.values()].map((entry) => entry.info)
  }

  get integration(): IntegrationStatus {
    return {
      id: 'icue',
      name: 'Corsair iCUE',
      state: this.state,
      message:
        this.state === 'connected' && this.message === null && this.mapped.size > 0
          ? 'Contrôle exclusif tant que LightControl est ouvert ; iCUE reprend la main ensuite.'
          : this.message,
      deviceCount: this.mapped.size,
      actions: []
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    if (!existsSync(this.options.dllPath)) {
      this.setState('unavailable', 'Le runtime du SDK iCUE est absent de l’installation.')
      return
    }
    this.spawn()
  }

  async stop(): Promise<void> {
    this.running = false
    this.clearTimers()
    const host = this.host
    this.host = null
    this.setDevices([])
    if (host) {
      // Lets the host release exclusive control so iCUE restores its own lighting.
      const exited = new Promise<void>((resolve) => host.once('exit', () => resolve()))
      this.send(host, { type: 'stop' })
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))])
      host.kill()
    }
    this.setState('stopped', null)
  }

  async restart(): Promise<void> {
    await this.stop()
    this.start()
  }

  rescan(): void {
    // iCUE pushes device changes through its session; a restart re-enumerates when needed.
  }

  enterDirectMode(): void {
    // Exclusive control is requested by the host on the first frame of each session.
  }

  writeLeds(deviceId: string, rgb: Uint8Array): boolean {
    const entry = this.mapped.get(deviceId)
    if (!entry || !this.host || entry.inFlight >= MAX_IN_FLIGHT) return false
    entry.inFlight += 1
    entry.lastSentAt = Date.now()
    this.send(this.host, { type: 'frame', deviceId: entry.icueId, rgb })
    this.armWatchdog()
    return true
  }

  writeLoop(): boolean {
    return false
  }

  applyMode(): boolean {
    return false
  }

  async resizeZone(): Promise<void> {
    // iCUE devices have fixed LED counts.
  }

  /* -------------------------------- Host --------------------------------- */

  private spawn(): void {
    this.setState('connecting', 'Démarrage de l’intégration iCUE…')
    const host = utilityProcess.fork(this.options.hostScript, [], { serviceName: 'LightControl iCUE' })
    this.host = host
    host.on('message', (event: IcueHostEvent) => this.onHostEvent(event))
    host.once('exit', (code) => {
      if (this.host !== host) return
      this.host = null
      this.setDevices([])
      if (!this.running) return
      this.options.logger.warn(`iCUE host exited with code ${code}`)
      this.setState('error', 'L’intégration iCUE s’est arrêtée ; redémarrage…')
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.running) this.spawn()
      }, RESTART_DELAY_MS)
    })
    this.send(host, { type: 'start', dllPath: this.options.dllPath })
  }

  private onHostEvent(event: IcueHostEvent): void {
    switch (event.type) {
      case 'state':
        this.setState(event.state, event.message)
        return
      case 'devices':
        this.setDevices(event.devices)
        return
      case 'frame-done': {
        for (const entry of this.mapped.values()) {
          if (entry.icueId === event.deviceId) entry.inFlight = Math.max(0, entry.inFlight - 1)
        }
        if ([...this.mapped.values()].every((entry) => entry.inFlight === 0)) this.disarmWatchdog()
        return
      }
      case 'log':
        this.options.logger[event.level](event.message)
    }
  }

  private setDevices(devices: IcueDevice[]): void {
    const seen = new Map<string, number>()
    const next = new Map<string, Mapped>()
    for (const device of devices) {
      const ordinal = seen.get(device.model) ?? 0
      seen.set(device.model, ordinal + 1)
      const identity = device.serial || device.id
      const id = `icue-${createHash('sha1').update(`${device.model}|${identity}`).digest('hex').slice(0, 12)}`
      next.set(id, { info: toDeviceInfo(device, id, ordinal), icueId: device.id, inFlight: 0, lastSentAt: 0 })
    }
    const changed = JSON.stringify([...next.keys()]) !== JSON.stringify([...this.mapped.keys()])
    this.mapped = next
    if (devices.length > 0) {
      this.options.logger.info(
        `iCUE devices: ${devices.map((d) => `${d.model} (${d.leds.length} LED)`).join(', ')}`
      )
    }
    if (changed || devices.length > 0) this.events.emit('devices', [...this.devices])
    this.events.emit('status')
  }

  private setState(state: IntegrationState, message: string | null): void {
    if (state === this.state && message === this.message) return
    this.state = state
    this.message = message
    this.options.logger.info(`iCUE ${state}${message ? `: ${message}` : ''}`)
    this.events.emit('status')
  }

  private send(host: UtilityProcess, request: IcueHostRequest): void {
    host.postMessage(request)
  }

  private armWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setTimeout(() => {
      this.watchdog = null
      const stuck = [...this.mapped.values()].some(
        (entry) => entry.inFlight > 0 && Date.now() - entry.lastSentAt >= WATCHDOG_MS
      )
      if (stuck && this.host) {
        this.options.logger.error('iCUE SDK stopped responding; recycling its host process')
        this.host.kill()
      } else if ([...this.mapped.values()].some((entry) => entry.inFlight > 0)) {
        this.armWatchdog()
      }
    }, WATCHDOG_MS)
  }

  private disarmWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
  }

  private clearTimers(): void {
    this.disarmWatchdog()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
  }
}
