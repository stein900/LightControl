import { createConnection, type Socket } from 'node:net'
import { TypedEmitter } from '@main/core/typed-emitter'
import type { Logger } from '@main/core/logger'
import { ProtocolError } from './binary'
import {
  decodeController,
  decodeHeader,
  encodeCString,
  encodeHeader,
  encodeLedsPayload,
  encodeModePayload,
  encodeResizeZonePayload,
  encodeU32,
  encodeZoneLedsPayload,
  type RawController,
  type RawMode
} from './codec'
import {
  CLIENT_PROTOCOL_VERSION,
  HEADER_SIZE,
  MAGIC,
  MAX_PACKET_SIZE,
  MIN_PROTOCOL_VERSION,
  PacketId
} from './protocol'

const EMPTY = Buffer.alloc(0)
const REQUEST_TIMEOUT_MS = 5000
const HANDSHAKE_TIMEOUT_MS = 1500

interface PendingRequest {
  resolve: (payload: Buffer) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface OpenRgbClientEvents {
  deviceListUpdated: []
  closed: [error: Error | null]
}

export interface ConnectOptions {
  host: string
  port: number
  clientName: string
  timeoutMs?: number
}

/**
 * Connection to an OpenRGB SDK server. Replies carry no request identifier, so
 * outstanding requests are matched first-in first-out per (packet, device) pair,
 * which is the order in which the server answers a single client.
 */
export class OpenRgbClient {
  readonly events = new TypedEmitter<OpenRgbClientEvents>()
  private socket: Socket | null = null
  private inbound: Buffer = EMPTY
  private readonly pending = new Map<string, PendingRequest[]>()
  private negotiated = 0
  private closed = false

  constructor(private readonly logger: Logger) {}

  get protocolVersion(): number {
    return this.negotiated
  }

  /** Bytes queued in the socket but not yet handed to the OS; used for frame dropping. */
  get backlog(): number {
    return this.socket?.writableLength ?? 0
  }

  async connect(options: ConnectOptions): Promise<void> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = createConnection({ host: options.host, port: options.port })
      const timer = setTimeout(() => {
        candidate.destroy()
        reject(new Error(`Connection to ${options.host}:${options.port} timed out`))
      }, options.timeoutMs ?? 2000)
      candidate.once('connect', () => {
        clearTimeout(timer)
        resolve(candidate)
      })
      candidate.once('error', (error) => {
        clearTimeout(timer)
        candidate.destroy()
        reject(error)
      })
    })

    socket.setNoDelay(true)
    socket.on('data', (chunk) => this.receive(chunk))
    socket.on('error', (error) => this.logger.debug('Socket error', error.message))
    socket.on('close', () => this.teardown(new Error('Connection closed by server')))
    this.socket = socket

    try {
      const reply = await this.request(
        PacketId.RequestProtocolVersion,
        0,
        encodeU32(CLIENT_PROTOCOL_VERSION),
        HANDSHAKE_TIMEOUT_MS
      )
      const server = reply.length >= 4 ? reply.readUInt32LE(0) : 0
      this.negotiated = Math.min(CLIENT_PROTOCOL_VERSION, server)
      if (this.negotiated < MIN_PROTOCOL_VERSION) {
        throw new ProtocolError(
          `OpenRGB server protocol ${server} is too old (minimum ${MIN_PROTOCOL_VERSION})`
        )
      }
      this.send(PacketId.SetClientName, 0, encodeCString(options.clientName))
    } catch (error) {
      this.close()
      throw error
    }
  }

  close(): void {
    this.teardown(null)
  }

  async controllerCount(): Promise<number> {
    const reply = await this.request(PacketId.RequestControllerCount, 0, EMPTY)
    if (reply.length < 4) throw new ProtocolError('Invalid controller count reply')
    return reply.readUInt32LE(0)
  }

  async controller(index: number): Promise<RawController> {
    const reply = await this.request(PacketId.RequestControllerData, index, encodeU32(this.negotiated))
    return decodeController(reply, this.negotiated)
  }

  updateLeds(index: number, rgb: Uint8Array): void {
    this.send(PacketId.UpdateLeds, index, encodeLedsPayload(rgb))
  }

  updateZoneLeds(index: number, zoneIndex: number, rgb: Uint8Array): void {
    this.send(PacketId.UpdateZoneLeds, index, encodeZoneLedsPayload(zoneIndex, rgb))
  }

  setCustomMode(index: number): void {
    this.send(PacketId.SetCustomMode, index, EMPTY)
  }

  updateMode(index: number, modeIndex: number, mode: RawMode): void {
    this.send(PacketId.UpdateMode, index, encodeModePayload(modeIndex, mode, this.negotiated))
  }

  saveMode(index: number, modeIndex: number, mode: RawMode): void {
    this.send(PacketId.SaveMode, index, encodeModePayload(modeIndex, mode, this.negotiated))
  }

  resizeZone(index: number, zoneIndex: number, size: number): void {
    this.send(PacketId.ResizeZone, index, encodeResizeZonePayload(zoneIndex, size))
  }

  rescan(): void {
    this.send(PacketId.RequestRescanDevices, 0, EMPTY)
  }

  /* ------------------------------ Transport ------------------------------ */

  private send(packetId: number, deviceId: number, payload: Buffer): void {
    if (!this.socket || this.closed) return
    this.socket.write(Buffer.concat([encodeHeader(deviceId, packetId, payload.length), payload]))
  }

  private request(
    packetId: number,
    deviceId: number,
    payload: Buffer,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<Buffer> {
    if (!this.socket || this.closed) return Promise.reject(new Error('Not connected'))
    const key = `${packetId}:${deviceId}`
    return new Promise<Buffer>((resolve, reject) => {
      const entry: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const queue = this.pending.get(key)
          const position = queue?.indexOf(entry) ?? -1
          if (queue && position >= 0) queue.splice(position, 1)
          reject(new Error(`Request ${packetId} for device ${deviceId} timed out`))
        }, timeoutMs)
      }
      const queue = this.pending.get(key)
      if (queue) queue.push(entry)
      else this.pending.set(key, [entry])
      this.send(packetId, deviceId, payload)
    })
  }

  private receive(chunk: Buffer): void {
    this.inbound = this.inbound.length === 0 ? chunk : Buffer.concat([this.inbound, chunk])

    while (this.inbound.length >= HEADER_SIZE) {
      if (this.inbound.compare(MAGIC, 0, MAGIC.length, 0, MAGIC.length) !== 0) {
        // Resynchronise on the next magic marker instead of failing the connection.
        const next = this.inbound.indexOf(MAGIC, 1)
        this.logger.warn('Discarding bytes before packet magic')
        this.inbound =
          next === -1
            ? this.inbound.subarray(this.inbound.length - (MAGIC.length - 1))
            : this.inbound.subarray(next)
        continue
      }

      const header = decodeHeader(this.inbound)
      if (header.size > MAX_PACKET_SIZE) {
        this.logger.error(`Packet of ${header.size} bytes exceeds the protocol limit`)
        this.socket?.destroy()
        return
      }
      if (this.inbound.length < HEADER_SIZE + header.size) return

      const payload = Buffer.from(this.inbound.subarray(HEADER_SIZE, HEADER_SIZE + header.size))
      this.inbound = this.inbound.subarray(HEADER_SIZE + header.size)
      this.dispatch(header.packetId, header.deviceId, payload)
    }
  }

  private dispatch(packetId: number, deviceId: number, payload: Buffer): void {
    if (packetId === PacketId.DeviceListUpdated) {
      this.events.emit('deviceListUpdated')
      return
    }
    const key = `${packetId}:${deviceId}`
    const queue = this.pending.get(key)
    const entry = queue?.shift()
    if (!entry) return
    if (queue && queue.length === 0) this.pending.delete(key)
    clearTimeout(entry.timer)
    entry.resolve(payload)
  }

  private teardown(error: Error | null): void {
    if (this.closed) return
    this.closed = true
    this.socket?.removeAllListeners('data')
    this.socket?.destroy()
    this.socket = null
    this.inbound = EMPTY
    for (const queue of this.pending.values()) {
      for (const entry of queue) {
        clearTimeout(entry.timer)
        entry.reject(error ?? new Error('Connection closed'))
      }
    }
    this.pending.clear()
    this.events.emit('closed', error)
  }
}
