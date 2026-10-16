/**
 * Synchronous session with the Lian Li TX/RX dongles. Runs inside the USB
 * host process; every call may block for a few hundred milliseconds.
 */
import type { LibUsb } from './libusb'
import { sleepSync, type UsbDevice } from './libusb'
import {
  EP_IN,
  EP_OUT,
  HEADER_REPEATS,
  MASTER_CHANNELS,
  RX_IDS,
  TX_IDS,
  USB_PACKET_SIZE,
  discoveryPages,
  discoveryQuery,
  masterQuery,
  parseDiscovery,
  parseMasterReply,
  rgbFrames,
  trafficChannel,
  usbPackets,
  type DiscoveryResult,
  type RgbUpload,
  type WirelessDevice
} from './protocol'

const USB_TIMEOUT_MS = 1000
const MASTER_REPLY_TIMEOUT_MS = 500
const DISCOVERY_FIRST_TIMEOUT_MS = 100
const DISCOVERY_CHUNK_TIMEOUT_MS = 10
const DISCOVERY_PAGE_BYTES = 512
/** Air gap after an RGB frame before addressing another device (vendor timing). */
const GAP_AFTER_RGB_MS = 10
const GAP_BETWEEN_CHUNKS_MS = 1
const GAP_BETWEEN_HEADER_REPEATS_MS = 20

export class WirelessLink {
  private pages = 1
  private lastTarget = ''
  private lastSentAt = 0

  private constructor(
    private readonly tx: UsbDevice,
    private readonly rx: UsbDevice,
    readonly masterMac: Uint8Array,
    readonly masterChannel: number
  ) {}

  /** Opens both dongles and finds the TX address and channel. Throws UsbError when busy or absent. */
  static open(usb: LibUsb): WirelessLink {
    const tx = usb.open(TX_IDS, { out: EP_OUT, in: EP_IN })
    let rx: UsbDevice
    try {
      rx = usb.open(RX_IDS, { out: EP_OUT, in: EP_IN })
    } catch (error) {
      tx.close()
      throw error
    }
    const master = discoverMaster(tx)
    if (!master) {
      tx.close()
      rx.close()
      throw new Error('Le dongle Lian Li ne répond sur aucun canal (1 à 39).')
    }
    return new WirelessLink(tx, rx, master.mac, master.channel)
  }

  close(): void {
    this.tx.close()
    this.rx.close()
  }

  /** Lists devices heard on the air (read-only GetDev query). */
  poll(): DiscoveryResult | null {
    flush(this.rx)
    this.rx.write(discoveryQuery(this.pages), USB_TIMEOUT_MS)
    const reply = readUntilSilence(this.rx, this.pages * DISCOVERY_PAGE_BYTES)
    const result = parseDiscovery(reply, this.pages)
    if (result) this.pages = discoveryPages(reply[1] ?? 0)
    return result
  }

  /**
   * Sends an animation to one device: the header (repeated) then the data chunks.
   * `rxTarget` 0xFF broadcasts on the channel and lets the MAC inside the frame
   * select the recipient, which reaches devices without a valid slot.
   */
  upload(device: WirelessDevice, upload: RgbUpload, rxTarget = device.rxType): void {
    const target = [...device.mac].join('.')
    if (this.lastTarget && this.lastTarget !== target) {
      sleepSync(GAP_AFTER_RGB_MS - (Date.now() - this.lastSentAt))
    }
    const channel = trafficChannel(device.channel, this.masterChannel)
    rgbFrames(upload, device.mac, this.masterMac).forEach((frame, index) => {
      const repeats = index === 0 ? HEADER_REPEATS : 1
      for (let repeat = 0; repeat < repeats; repeat++) {
        for (const packet of usbPackets(frame, channel, rxTarget)) {
          this.tx.write(packet, USB_TIMEOUT_MS)
          sleepSync(GAP_BETWEEN_CHUNKS_MS)
        }
        if (repeat + 1 < repeats) sleepSync(GAP_BETWEEN_HEADER_REPEATS_MS)
      }
    })
    this.lastTarget = target
    this.lastSentAt = Date.now()
  }
}

function flush(device: UsbDevice): void {
  for (let i = 0; i < 16; i++) {
    if (device.read(USB_PACKET_SIZE * 8, 5).length === 0) return
  }
}

function readUntilSilence(device: UsbDevice, capacity: number): Uint8Array {
  const reply = new Uint8Array(capacity)
  let total = 0
  let timeout = DISCOVERY_FIRST_TIMEOUT_MS
  while (total < capacity) {
    const chunk = device.read(USB_PACKET_SIZE, timeout)
    if (chunk.length === 0) break
    const take = Math.min(chunk.length, capacity - total)
    reply.set(chunk.subarray(0, take), total)
    total += take
    timeout = DISCOVERY_CHUNK_TIMEOUT_MS
  }
  return reply.subarray(0, total)
}

function discoverMaster(tx: UsbDevice): { mac: Uint8Array; channel: number } | null {
  for (const channel of MASTER_CHANNELS) {
    const attempts = channel === MASTER_CHANNELS[0] ? 3 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      flush(tx)
      tx.write(masterQuery(channel), USB_TIMEOUT_MS)
      const master = parseMasterReply(tx.read(USB_PACKET_SIZE, MASTER_REPLY_TIMEOUT_MS))
      if (master) return { mac: master.mac, channel }
    }
  }
  return null
}
