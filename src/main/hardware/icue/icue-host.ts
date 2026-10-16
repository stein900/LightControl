/**
 * iCUE SDK host, run in an Electron utility process. The Corsair runtime is a
 * native DLL that calls back from its own thread; isolating it here means a
 * hang or crash inside the DLL can never block or take down the main process.
 *
 * Structure layouts follow iCUESDK.h (SDK 4.0.84, x64).
 */
import koffi from 'koffi'
import type { IcueDevice, IcueHostEvent, IcueHostRequest, IcueLed, IcueSessionState } from './icue-protocol'

const CE_SUCCESS = 0
const CE_NO_CONTROL = 2

const CSS_CLOSED = 1
const CSS_CONNECTING = 2
const CSS_TIMEOUT = 3
const CSS_CONNECTION_REFUSED = 4
const CSS_CONNECTION_LOST = 5
const CSS_CONNECTED = 6

const CAL_EXCLUSIVE_LIGHTING_CONTROL = 1
const CDT_ALL = -1

const STRING_SIZE_M = 128
const DEVICE_COUNT_MAX = 64
const LED_COUNT_MAX = 512
/** CorsairDeviceInfo: int type; char id[128]; char serial[128]; char model[128]; int ledCount; int channelCount. */
const DEVICE_INFO_SIZE = 4 + STRING_SIZE_M * 3 + 4 + 4
/** CorsairLedPosition: uint32 id; (4 bytes padding); double cx; double cy. */
const LED_POSITION_SIZE = 24
/** CorsairLedColor: uint32 id; uint8 r, g, b, a. */
const LED_COLOR_SIZE = 8

interface SdkBinding {
  connect(): number
  disconnect(): number
  getDevices(): IcueDevice[]
  setLedColors(deviceId: string, buffer: Buffer, count: number): number
  requestControl(deviceId: string): number
  releaseControl(deviceId: string): number
}

const parentPort = process.parentPort

function post(event: IcueHostEvent): void {
  parentPort.postMessage(event)
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const end = buffer.indexOf(0, offset)
  return buffer.toString('utf8', offset, end === -1 || end > offset + length ? offset + length : end)
}

function bind(dllPath: string, onState: (state: number) => void): SdkBinding {
  const lib = koffi.load(dllPath)

  const Version = koffi.struct('CorsairVersion', { major: 'int', minor: 'int', patch: 'int' })
  const Details = koffi.struct('CorsairSessionDetails', {
    clientVersion: Version,
    serverVersion: Version,
    serverHostVersion: Version
  })
  koffi.struct('CorsairSessionStateChanged', { state: 'int', details: Details })
  koffi.struct('CorsairDeviceFilter', { deviceTypeMask: 'int' })
  const Handler = koffi.proto(
    'void CorsairSessionStateChangedHandler(void *context, const CorsairSessionStateChanged *eventData)'
  )

  const CorsairConnect = lib.func(
    'int CorsairConnect(CorsairSessionStateChangedHandler *onStateChanged, void *context)'
  )
  const CorsairDisconnect = lib.func('int CorsairDisconnect()')
  const CorsairGetDevices = lib.func(
    'int CorsairGetDevices(const CorsairDeviceFilter *filter, int sizeMax, _Out_ uint8_t *devices, _Out_ int *size)'
  )
  const CorsairGetLedPositions = lib.func(
    'int CorsairGetLedPositions(const char *deviceId, int sizeMax, _Out_ uint8_t *ledPositions, _Out_ int *size)'
  )
  const CorsairSetLedColors = lib.func(
    'int CorsairSetLedColors(const char *deviceId, int size, const uint8_t *ledColors)'
  )
  const CorsairRequestControl = lib.func('int CorsairRequestControl(const char *deviceId, int accessLevel)')
  const CorsairReleaseControl = lib.func('int CorsairReleaseControl(const char *deviceId)')

  // The SDK invokes this from its own thread with a pointer only valid during the call: read the
  // state (first struct member) right away, then return and continue on the event loop.
  const handler = koffi.register((_context: unknown, event: bigint | null) => {
    const state = event === null ? CSS_CLOSED : (koffi.decode(event, 'int') as number)
    setImmediate(() => onState(state))
  }, koffi.pointer(Handler))

  const ledPositions = (deviceId: string): IcueLed[] => {
    const buffer = Buffer.alloc(LED_COUNT_MAX * LED_POSITION_SIZE)
    const size = new Int32Array(1)
    if (CorsairGetLedPositions(deviceId, LED_COUNT_MAX, buffer, size) !== CE_SUCCESS) return []
    const leds: IcueLed[] = []
    for (let i = 0; i < Math.min(size[0]!, LED_COUNT_MAX); i++) {
      const base = i * LED_POSITION_SIZE
      leds.push({
        id: buffer.readUInt32LE(base),
        x: buffer.readDoubleLE(base + 8),
        y: buffer.readDoubleLE(base + 16)
      })
    }
    // Display order: top to bottom, then left to right (memory modules are vertical bars).
    return leds.sort((a, b) => a.y - b.y || a.x - b.x)
  }

  return {
    connect: () => CorsairConnect(handler, null) as number,
    disconnect: () => {
      const result = CorsairDisconnect() as number
      koffi.unregister(handler)
      return result
    },
    getDevices: () => {
      const buffer = Buffer.alloc(DEVICE_COUNT_MAX * DEVICE_INFO_SIZE)
      const size = new Int32Array(1)
      const result = CorsairGetDevices({ deviceTypeMask: CDT_ALL }, DEVICE_COUNT_MAX, buffer, size) as number
      if (result !== CE_SUCCESS) throw new Error(`CorsairGetDevices failed with error ${result}`)
      const devices: IcueDevice[] = []
      for (let i = 0; i < Math.min(size[0]!, DEVICE_COUNT_MAX); i++) {
        const base = i * DEVICE_INFO_SIZE
        const id = readString(buffer, base + 4, STRING_SIZE_M)
        devices.push({
          id,
          type: buffer.readInt32LE(base),
          serial: readString(buffer, base + 4 + STRING_SIZE_M, STRING_SIZE_M),
          model: readString(buffer, base + 4 + STRING_SIZE_M * 2, STRING_SIZE_M),
          leds: ledPositions(id)
        })
      }
      return devices
    },
    setLedColors: (deviceId, buffer, count) => CorsairSetLedColors(deviceId, count, buffer) as number,
    requestControl: (deviceId) => CorsairRequestControl(deviceId, CAL_EXCLUSIVE_LIGHTING_CONTROL) as number,
    releaseControl: (deviceId) => CorsairReleaseControl(deviceId) as number
  }
}

/* --------------------------------- Session -------------------------------- */

let sdk: SdkBinding | null = null
let connected = false
const devices = new Map<string, IcueDevice>()
const controlled = new Set<string>()

function publishState(state: IcueSessionState, message: string | null): void {
  post({ type: 'state', state, message })
}

function onSessionState(state: number): void {
  connected = state === CSS_CONNECTED
  if (!connected) {
    controlled.clear()
    if (devices.size > 0) {
      devices.clear()
      post({ type: 'devices', devices: [] })
    }
  }

  switch (state) {
    case CSS_CONNECTED:
      publishState('connected', null)
      refreshDevices()
      return
    case CSS_CONNECTING:
    case CSS_CONNECTION_LOST:
      publishState('connecting', 'Connexion à iCUE…')
      return
    case CSS_TIMEOUT:
      publishState('connecting', 'iCUE ne répond pas ; nouvelle tentative en cours.')
      return
    case CSS_CONNECTION_REFUSED:
      publishState('unavailable', 'iCUE refuse la connexion : activez le SDK dans les réglages d’iCUE.')
      return
    default:
      publishState('unavailable', 'iCUE n’est pas lancé.')
  }
}

function refreshDevices(): void {
  if (!sdk) return
  try {
    const list = sdk.getDevices().filter((device) => device.leds.length > 0)
    devices.clear()
    for (const device of list) devices.set(device.id, device)
    post({ type: 'devices', devices: list })
  } catch (error) {
    post({ type: 'log', level: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

function writeFrame(deviceId: string, rgb: Uint8Array): boolean {
  const device = devices.get(deviceId)
  if (!sdk || !connected || !device) return false

  if (!controlled.has(deviceId)) {
    const result = sdk.requestControl(deviceId)
    if (result !== CE_SUCCESS) {
      post({
        type: 'log',
        level: 'warn',
        message: `Exclusive control of ${device.model} refused (error ${result})`
      })
      return false
    }
    controlled.add(deviceId)
  }

  const count = Math.min(device.leds.length, Math.floor(rgb.length / 3))
  const buffer = Buffer.alloc(count * LED_COLOR_SIZE)
  for (let i = 0; i < count; i++) {
    const base = i * LED_COLOR_SIZE
    buffer.writeUInt32LE(device.leds[i]!.id, base)
    buffer[base + 4] = rgb[i * 3]!
    buffer[base + 5] = rgb[i * 3 + 1]!
    buffer[base + 6] = rgb[i * 3 + 2]!
    buffer[base + 7] = 255
  }
  const result = sdk.setLedColors(deviceId, buffer, count)
  // Another client took exclusive control: ask again on the next frame.
  if (result === CE_NO_CONTROL) controlled.delete(deviceId)
  return result === CE_SUCCESS
}

function stop(): void {
  if (sdk) {
    for (const deviceId of controlled) sdk.releaseControl(deviceId)
    sdk.disconnect()
  }
  sdk = null
  process.exit(0)
}

parentPort.on('message', (event: { data: IcueHostRequest }) => {
  const request = event.data
  switch (request.type) {
    case 'start':
      if (sdk) return
      try {
        sdk = bind(request.dllPath, onSessionState)
        const result = sdk.connect()
        if (result !== CE_SUCCESS) publishState('error', `CorsairConnect a échoué (code ${result}).`)
        else publishState('connecting', 'Connexion à iCUE…')
      } catch (error) {
        publishState(
          'error',
          `SDK iCUE indisponible : ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return
    case 'frame':
      post({ type: 'frame-done', deviceId: request.deviceId, ok: writeFrame(request.deviceId, request.rgb) })
      return
    case 'stop':
      stop()
  }
})
