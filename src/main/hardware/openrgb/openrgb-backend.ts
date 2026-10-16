import { TypedEmitter } from '@main/core/typed-emitter'
import type { Logger } from '@main/core/logger'
import type { DeviceInfo, EngineSettings, EngineStatus, IntegrationStatus } from '@shared/model'
import type { HardwareBackend, HardwareBackendEvents, ModeOverrides } from '../backend'
import { OpenRgbClient } from './client'
import type { RawController } from './codec'
import { applyModeOverrides, stableDeviceId, toDeviceInfo } from './mapper'
import { ModeFlag } from './protocol'
import { OpenRgbServerProcess, resolveExecutable } from './server-process'

const CLIENT_NAME = 'LightControl'
const PROBE_TIMEOUT_MS = 800
const STARTUP_TIMEOUT_MS = 30_000
const STARTUP_POLL_MS = 500
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000]
const DEVICE_REFRESH_DEBOUNCE_MS = 250
const MAX_RESPAWNS_PER_MINUTE = 3
/** Frames are dropped while this many bytes are still waiting in the socket. */
const MAX_SOCKET_BACKLOG = 256 * 1024

export interface OpenRgbBackendOptions {
  settings: () => EngineSettings
  executableCandidates: () => string[]
  configDirectory: string
  logger: Logger
}

interface Controller {
  index: number
  raw: RawController
  info: DeviceInfo
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class OpenRgbBackend implements HardwareBackend {
  readonly events = new TypedEmitter<HardwareBackendEvents>()
  private readonly server: OpenRgbServerProcess
  private client: OpenRgbClient | null = null
  private controllers: Controller[] = []
  private readonly byId = new Map<string, Controller>()
  private currentStatus: EngineStatus = {
    state: 'stopped',
    message: null,
    protocolVersion: null,
    ownsServer: false,
    executablePath: null
  }
  private running = false
  private connecting = false
  private attempt = 0
  private retryTimer: NodeJS.Timeout | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshing: Promise<void> | null = null
  private refreshQueued = false
  private respawns: number[] = []
  private elevatedLaunchFailed = false

  constructor(private readonly options: OpenRgbBackendOptions) {
    this.server = new OpenRgbServerProcess(options.logger.child('process'))
    this.server.events.on('exited', () => {
      if (this.running) this.scheduleRetry()
    })
  }

  get status(): EngineStatus {
    return this.currentStatus
  }

  get integration(): IntegrationStatus {
    const { state, message } = this.currentStatus
    return {
      id: 'openrgb',
      name: 'OpenRGB',
      state: state === 'starting' ? 'connecting' : state,
      message,
      deviceCount: this.controllers.length,
      actions: []
    }
  }

  get devices(): readonly DeviceInfo[] {
    return this.controllers.map((controller) => controller.info)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.attempt = 0
    void this.connect()
  }

  async stop(): Promise<void> {
    this.running = false
    this.clearTimers()
    this.client?.close()
    this.client = null
    this.server.stop()
    const settings = this.options.settings()
    const executable = resolveExecutable(this.options.executableCandidates())
    if (settings.managed && !settings.elevated && executable) await this.server.stopStrays(executable)
    this.clearDevices()
    this.setStatus({ state: 'stopped', message: null, protocolVersion: null, ownsServer: false })
  }

  async restart(): Promise<void> {
    await this.stop()
    this.respawns = []
    this.elevatedLaunchFailed = false
    this.start()
  }

  rescan(): void {
    this.client?.rescan()
  }

  enterDirectMode(deviceId: string): void {
    const controller = this.byId.get(deviceId)
    if (!controller || !this.client) return
    this.client.setCustomMode(controller.index)
  }

  writeLeds(deviceId: string, rgb: Uint8Array): boolean {
    const controller = this.byId.get(deviceId)
    if (!controller || !this.client) return false
    if (this.client.backlog > MAX_SOCKET_BACKLOG) return false
    this.client.updateLeds(controller.index, rgb)
    return true
  }

  writeLoop(): boolean {
    // OpenRGB devices take live frames only.
    return false
  }

  applyMode(deviceId: string, modeName: string, overrides: ModeOverrides, persist: boolean): boolean {
    const controller = this.byId.get(deviceId)
    if (!controller || !this.client) return false
    const modeIndex = controller.raw.modes.findIndex((mode) => mode.name === modeName)
    const base = controller.raw.modes[modeIndex]
    if (!base) return false

    const mode = applyModeOverrides(base, overrides)
    const canSave = (base.flags & (ModeFlag.ManualSave | ModeFlag.AutomaticSave)) !== 0
    if (persist && canSave) this.client.saveMode(controller.index, modeIndex, mode)
    else this.client.updateMode(controller.index, modeIndex, mode)
    return true
  }

  async resizeZone(deviceId: string, zoneIndex: number, size: number): Promise<void> {
    const controller = this.byId.get(deviceId)
    if (!controller || !this.client) return
    const zone = controller.raw.zones[zoneIndex]
    if (!zone) return
    const clamped = Math.min(zone.ledsMax, Math.max(zone.ledsMin, size))
    if (clamped === zone.ledsCount) return
    this.options.logger.info(`Resizing zone ${zoneIndex} of ${controller.info.name} to ${clamped} LEDs`)
    this.client.resizeZone(controller.index, zoneIndex, clamped)
    await this.refreshDevices()
  }

  /* ---------------------------- Connection loop --------------------------- */

  private async connect(): Promise<void> {
    if (!this.running || this.connecting) return
    this.connecting = true
    const settings = this.options.settings()
    try {
      this.setStatus({ state: 'connecting', message: null })
      let client = await this.tryConnect(settings)

      if (!client && settings.managed) {
        client = await this.launchAndConnect(settings)
      }

      if (!client) {
        if (this.currentStatus.state !== 'error') {
          this.setStatus({
            state: 'error',
            message: settings.managed
              ? 'Le moteur OpenRGB ne répond pas.'
              : `Aucun serveur OpenRGB sur ${settings.host}:${settings.port}.`
          })
        }
        this.scheduleRetry()
        return
      }

      this.attach(client)
      this.attempt = 0
      this.setStatus({ state: 'connected', message: null, protocolVersion: client.protocolVersion })
      await this.refreshDevices()
    } catch (error) {
      this.options.logger.error('Connection attempt failed', error)
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
      this.scheduleRetry()
    } finally {
      this.connecting = false
    }
  }

  private async tryConnect(
    settings: EngineSettings,
    timeoutMs = PROBE_TIMEOUT_MS
  ): Promise<OpenRgbClient | null> {
    const client = new OpenRgbClient(this.options.logger.child('client'))
    try {
      await client.connect({ host: settings.host, port: settings.port, clientName: CLIENT_NAME, timeoutMs })
      return client
    } catch {
      return null
    }
  }

  private async launchAndConnect(settings: EngineSettings): Promise<OpenRgbClient | null> {
    const executable = resolveExecutable(this.options.executableCandidates())
    this.setStatus({ executablePath: executable })
    if (!executable) {
      this.setStatus({
        state: 'error',
        message: 'OpenRGB.exe est introuvable. Indiquez son emplacement dans les réglages.'
      })
      return null
    }
    if (settings.elevated && this.elevatedLaunchFailed) return null

    if (!this.server.owned) {
      const now = Date.now()
      this.respawns = this.respawns.filter((time) => now - time < 60_000)
      if (this.respawns.length >= MAX_RESPAWNS_PER_MINUTE) {
        this.setStatus({
          state: 'error',
          message: 'Le moteur OpenRGB s’arrête de façon répétée. Consultez le diagnostic puis relancez-le.'
        })
        return null
      }
      this.respawns.push(now)
      this.setStatus({ state: 'starting', message: 'Démarrage du moteur et détection du matériel…' })
      try {
        await this.server.launch({
          executable,
          configDirectory: this.options.configDirectory,
          host: settings.host,
          port: settings.port,
          elevated: settings.elevated
        })
      } catch (error) {
        this.elevatedLaunchFailed = settings.elevated
        throw error
      }
    }

    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (this.running && Date.now() < deadline) {
      const client = await this.tryConnect(settings)
      if (client) {
        this.setStatus({ ownsServer: this.server.owned })
        return client
      }
      await sleep(STARTUP_POLL_MS)
    }
    return null
  }

  private attach(client: OpenRgbClient): void {
    this.client = client
    client.events.on('deviceListUpdated', () => this.scheduleRefresh())
    client.events.on('closed', () => {
      if (this.client !== client) return
      this.client = null
      this.clearDevices()
      if (!this.running) return
      this.options.logger.warn('Lost connection to the OpenRGB server')
      this.setStatus({
        state: 'connecting',
        message: 'Connexion au moteur perdue, reconnexion…',
        protocolVersion: null
      })
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)]!
    this.attempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.retryTimer = null
    this.refreshTimer = null
  }

  /* -------------------------------- Devices ------------------------------- */

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshDevices()
    }, DEVICE_REFRESH_DEBOUNCE_MS)
  }

  private async refreshDevices(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true
      return this.refreshing
    }
    this.refreshing = this.loadDevices().finally(() => {
      this.refreshing = null
      if (this.refreshQueued) {
        this.refreshQueued = false
        void this.refreshDevices()
      }
    })
    return this.refreshing
  }

  private async loadDevices(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      const count = await client.controllerCount()
      const raws = await Promise.all(Array.from({ length: count }, (_, index) => client.controller(index)))
      if (client !== this.client) return

      const seen = new Map<string, number>()
      const controllers = raws.map((raw, index) => {
        const base = stableDeviceId(raw)
        const occurrence = seen.get(base) ?? 0
        seen.set(base, occurrence + 1)
        const id = occurrence === 0 ? base : `${base}-${occurrence}`
        return { index, raw, info: toDeviceInfo(raw, id) }
      })
      this.setControllers(controllers)
    } catch (error) {
      this.options.logger.error('Failed to load the device list', error)
    }
  }

  private setControllers(controllers: Controller[]): void {
    this.controllers = controllers
    this.byId.clear()
    for (const controller of controllers) this.byId.set(controller.info.id, controller)
    this.options.logger.info(
      `Devices: ${controllers.map((c) => `${c.info.name} (${c.info.ledCount} LED)`).join(', ') || 'none'}`
    )
    this.events.emit(
      'devices',
      controllers.map((controller) => controller.info)
    )
  }

  private clearDevices(): void {
    if (this.controllers.length > 0) this.setControllers([])
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch }
    this.events.emit('status')
  }
}
