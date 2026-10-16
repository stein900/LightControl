/**
 * Lian Li wireless host, run in an Electron utility process. libusb transfers
 * are synchronous and an upload can take a second: isolating them here keeps
 * the main process responsive, and a fault in the native layer cannot take
 * it down.
 *
 * The host polls the receiver for bound devices, uploads the animation each
 * device should play and checks the animation identifier the device reports
 * back: an upload lost on the air, or a device that restarted (power loss)
 * and fell back to its default effect, is sent again.
 */
import type {
  LianliDevice,
  LianliHostEvent,
  LianliHostRequest,
  LianliHostState,
  LianliUnavailableReason
} from './host-protocol'
import { LibUsb, UsbError } from './libusb'
import {
  boundTo,
  effectApplied,
  fitRgbUpload,
  macToString,
  type RgbUpload,
  type WirelessDevice
} from './protocol'
import { WirelessLink } from './wireless-link'

const POLL_MS = 2000
const RETRY_BUSY_MS = 5000
const RETRY_ABSENT_MS = 30_000
const RETRY_ERROR_MS = 15_000
/** Polls without confirmation before an upload is sent again. */
const CONFIRM_POLLS = 3
const MAX_ATTEMPTS = 4
/** After MAX_ATTEMPTS unconfirmed uploads, wait this many polls before another round. */
const BACKOFF_POLLS = 30
/** Polls a device may be missing from discovery (RF loss) before it is considered gone. */
const MISSING_POLLS = 5
/** Uploads are addressed to every slot; the MAC inside the frame selects the recipient. */
const RX_BROADCAST = 0xff

interface Target {
  frames: Uint8Array[]
  intervalMs: number
  /** Built on first delivery, once the device layout is known. */
  upload: RgbUpload | null
  /** Polls since the last send, or -1 when nothing is awaiting confirmation. */
  sentPolls: number
  attempts: number
}

interface Seen {
  device: WirelessDevice
  missing: number
}

const parentPort = process.parentPort

let usb: LibUsb | null = null
let link: WirelessLink | null = null
let timer: NodeJS.Timeout | null = null
let flushQueued = false
let unbound = 0
let published = ''
let state: { state: LianliHostState; message: string | null; reason: LianliUnavailableReason | null } | null =
  null
const seen = new Map<string, Seen>()
const targets = new Map<string, Target>()
/** Animation each device was last reported playing, to announce every change once. */
const announced = new Map<string, string>()

function post(event: LianliHostEvent): void {
  parentPort.postMessage(event)
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  post({ type: 'log', level, message })
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function setState(
  next: LianliHostState,
  message: string | null,
  reason: LianliUnavailableReason | null
): void {
  if (state && state.state === next && state.message === message && state.reason === reason) return
  state = { state: next, message, reason }
  post({ type: 'state', ...state })
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, delayMs)
}

/* -------------------------------- Session -------------------------------- */

/** Opens the dongles; returns the delay before the next attempt when they are not available. */
function connect(): number {
  try {
    link = WirelessLink.open(usb!)
    log('info', `Lian Li dongle opened: master ${macToString(link.masterMac)}, channel ${link.masterChannel}`)
    setState('connected', null, null)
    return 0
  } catch (error) {
    link = null
    if (error instanceof UsbError && error.busy) {
      setState('unavailable', null, 'busy')
      return RETRY_BUSY_MS
    }
    if (error instanceof UsbError && error.gone) {
      setState('unavailable', null, 'absent')
      return RETRY_ABSENT_MS
    }
    setState('error', `Le dongle Lian Li n’a pas pu être ouvert : ${errorText(error)}`, null)
    return RETRY_ERROR_MS
  }
}

function lose(error: unknown): void {
  log('warn', `Lian Li dongle lost: ${errorText(error)}`)
  try {
    link?.close()
  } catch {
    // The handles are already invalid.
  }
  link = null
  seen.clear()
  publish()
  for (const target of targets.values()) Object.assign(target, { sentPolls: -1, attempts: 0 })
  setState('connecting', 'Liaison avec le dongle Lian Li perdue ; nouvelle tentative…', null)
}

function tick(): void {
  timer = null
  if (!usb) return
  if (!link) {
    const retry = connect()
    if (!link) return schedule(retry)
  }
  try {
    poll()
    deliver()
  } catch (error) {
    lose(error)
    return schedule(RETRY_BUSY_MS)
  }
  schedule(POLL_MS)
}

function poll(): void {
  const result = link!.poll()
  if (!result) return
  const ours = boundTo(result.devices, link!.masterMac)
  unbound = result.devices.length - ours.length
  const heard = new Set<string>()
  for (const device of ours) {
    if (device.layout.ledCount === 0) continue
    const mac = macToString(device.mac)
    heard.add(mac)
    if (!seen.has(mac)) {
      // Back on the air: whatever it plays now must be checked again.
      const target = targets.get(mac)
      if (target) Object.assign(target, { sentPolls: -1, attempts: 0 })
    }
    seen.set(mac, { device, missing: 0 })
  }
  for (const [mac, entry] of seen) {
    if (!heard.has(mac) && ++entry.missing > MISSING_POLLS) seen.delete(mac)
  }
  for (const target of targets.values()) if (target.sentPolls >= 0) target.sentPolls += 1
  publish()
}

function publish(): void {
  const devices: LianliDevice[] = [...seen.entries()].map(([mac, { device }]) => ({
    mac,
    deviceType: device.deviceType,
    family: device.layout.family,
    model: device.layout.model,
    ledCount: device.layout.ledCount,
    ledsPerFan: device.layout.ledsPerFan,
    fanCount: device.layout.fanCount
  }))
  const key = JSON.stringify([devices, unbound])
  if (key === published) return
  published = key
  post({ type: 'devices', devices, unbound })
}

/** Sends every animation that the device is not confirmed to play. */
function deliver(): void {
  if (!link) return
  for (const [mac, target] of targets) {
    const device = seen.get(mac)?.device
    if (!device) continue
    if (!target.upload) {
      if (target.frames[0]?.length !== device.layout.ledCount * 3) continue
      try {
        const reverseFansOf = device.layout.reverseFans ? device.layout.ledsPerFan : 0
        target.upload = fitRgbUpload(target.frames, target.intervalMs, reverseFansOf)
      } catch (error) {
        log('error', `Animation for ${mac} rejected: ${errorText(error)}`)
        targets.delete(mac)
        continue
      }
    }

    if (effectApplied(device, target.upload)) {
      const key = target.upload.effectIndex.join('.')
      if (announced.get(mac) !== key) post({ type: 'applied', mac, frames: target.upload.frameCount })
      announced.set(mac, key)
      Object.assign(target, { attempts: 0, sentPolls: -1 })
      continue
    }
    announced.delete(mac)
    const wait = target.attempts >= MAX_ATTEMPTS ? BACKOFF_POLLS : CONFIRM_POLLS
    if (target.sentPolls >= 0 && target.sentPolls < wait) continue
    if (target.attempts >= MAX_ATTEMPTS) {
      log('warn', `${mac} did not confirm its animation after ${MAX_ATTEMPTS} uploads; retrying`)
      target.attempts = 0
    }
    link.upload(device, target.upload, RX_BROADCAST)
    target.attempts += 1
    target.sentPolls = 0
  }
}

/** Delivers new animations right away instead of waiting for the next poll. */
function queueFlush(): void {
  if (flushQueued) return
  flushQueued = true
  setImmediate(() => {
    flushQueued = false
    try {
      deliver()
    } catch (error) {
      lose(error)
      schedule(RETRY_BUSY_MS)
    }
  })
}

function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
  try {
    link?.close()
    usb?.dispose()
  } finally {
    link = null
    usb = null
    process.exit(0)
  }
}

parentPort.on('message', (event: { data: LianliHostRequest }) => {
  const request = event.data
  switch (request.type) {
    case 'start':
      if (usb) return
      try {
        usb = new LibUsb(request.dllPath)
      } catch (error) {
        setState('error', `libusb indisponible : ${errorText(error)}`, null)
        return
      }
      schedule(0)
      return
    case 'upload':
      targets.set(request.mac, {
        frames: request.frames,
        intervalMs: request.intervalMs,
        upload: null,
        sentPolls: -1,
        attempts: 0
      })
      queueFlush()
      return
    case 'retry':
      if (usb && !link) schedule(0)
      return
    case 'stop':
      stop()
  }
})
