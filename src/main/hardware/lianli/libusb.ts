/**
 * Minimal synchronous libusb-1.0 binding (koffi), for use in an isolated
 * utility process only: transfers block the calling thread.
 */
import koffi from 'koffi'

const LIBUSB_ERROR_TIMEOUT = -7
const DEVICE_DESCRIPTOR_SIZE = 18

export class UsbError extends Error {
  override readonly name = 'UsbError'
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }

  /** The device is opened by another program (exclusive WinUSB access). */
  get busy(): boolean {
    return this.code === -3 || this.code === -6
  }

  get gone(): boolean {
    return this.code === -4 || this.code === -5
  }
}

type Pointer = bigint

export interface UsbEndpoints {
  out: number
  in: number
}

export interface UsbDevice {
  write(data: Uint8Array, timeoutMs: number): void
  /** Reads up to `length` bytes; returns an empty array on timeout. */
  read(length: number, timeoutMs: number): Uint8Array
  close(): void
}

export class LibUsb {
  private readonly context: Pointer
  private readonly fn

  constructor(dllPath: string) {
    const lib = koffi.load(dllPath)
    this.fn = {
      init: lib.func('int libusb_init(_Out_ void **ctx)'),
      exit: lib.func('void libusb_exit(void *ctx)'),
      getDeviceList: lib.func('intptr_t libusb_get_device_list(void *ctx, _Out_ void **list)'),
      freeDeviceList: lib.func('void libusb_free_device_list(void *list, int unref)'),
      getDeviceDescriptor: lib.func('int libusb_get_device_descriptor(void *dev, _Out_ uint8_t *desc)'),
      open: lib.func('int libusb_open(void *dev, _Out_ void **handle)'),
      close: lib.func('void libusb_close(void *handle)'),
      setConfiguration: lib.func('int libusb_set_configuration(void *handle, int configuration)'),
      claimInterface: lib.func('int libusb_claim_interface(void *handle, int iface)'),
      releaseInterface: lib.func('int libusb_release_interface(void *handle, int iface)'),
      bulkTransfer: lib.func(
        'int libusb_bulk_transfer(void *handle, uint8_t endpoint, uint8_t *data, int length, _Out_ int *transferred, uint32_t timeout)'
      ),
      errorName: lib.func('const char *libusb_error_name(int code)')
    }
    const context: Pointer[] = [0n]
    this.check(this.fn.init(context) as number, 'libusb_init')
    this.context = context[0]!
  }

  dispose(): void {
    this.fn.exit(this.context)
  }

  /** Opens the first device matching one of `ids`, selects configuration 1 and claims interface 0. */
  open(ids: readonly { vid: number; pid: number }[], endpoints: UsbEndpoints): UsbDevice {
    const listOut: Pointer[] = [0n]
    const count = Number(this.fn.getDeviceList(this.context, listOut))
    if (count < 0) this.check(count, 'libusb_get_device_list')
    const list = listOut[0]!
    try {
      const devices = count > 0 ? (koffi.decode(list, 'void *', count) as Pointer[]) : []
      const descriptor = Buffer.alloc(DEVICE_DESCRIPTOR_SIZE)
      for (const device of devices) {
        if (this.fn.getDeviceDescriptor(device, descriptor) !== 0) continue
        const vid = descriptor.readUInt16LE(8)
        const pid = descriptor.readUInt16LE(10)
        if (!ids.some((id) => id.vid === vid && id.pid === pid)) continue
        return this.claim(device, endpoints)
      }
    } finally {
      this.fn.freeDeviceList(list, 1)
    }
    throw new UsbError(
      -5,
      `No USB device matching ${ids.map((id) => `${hex(id.vid)}:${hex(id.pid)}`).join(' or ')}`
    )
  }

  private claim(device: Pointer, endpoints: UsbEndpoints): UsbDevice {
    const handleOut: Pointer[] = [0n]
    this.check(this.fn.open(device, handleOut) as number, 'libusb_open')
    const handle = handleOut[0]!
    // Already configured devices may refuse SET_CONFIGURATION on Windows; claiming is what matters.
    this.fn.setConfiguration(handle, 1)
    const claimed = this.fn.claimInterface(handle, 0) as number
    if (claimed !== 0) {
      this.fn.close(handle)
      this.check(claimed, 'libusb_claim_interface')
    }

    const transferred = new Int32Array(1)
    return {
      write: (data, timeoutMs) => {
        const buffer = Buffer.from(data)
        const result = this.fn.bulkTransfer(
          handle,
          endpoints.out,
          buffer,
          buffer.length,
          transferred,
          timeoutMs
        ) as number
        this.check(result, 'write')
        if (transferred[0] !== buffer.length)
          throw new UsbError(-1, `Short write: ${transferred[0]}/${buffer.length}`)
      },
      read: (length, timeoutMs) => {
        const buffer = Buffer.alloc(length)
        const result = this.fn.bulkTransfer(
          handle,
          endpoints.in,
          buffer,
          length,
          transferred,
          timeoutMs
        ) as number
        if (result === LIBUSB_ERROR_TIMEOUT) return new Uint8Array(0)
        this.check(result, 'read')
        return new Uint8Array(buffer.subarray(0, transferred[0]!))
      },
      close: () => {
        this.fn.releaseInterface(handle, 0)
        this.fn.close(handle)
      }
    }
  }

  private check(code: number, operation: string): void {
    if (code >= 0) return
    throw new UsbError(code, `${operation} failed: ${this.fn.errorName(code) as string}`)
  }
}

const hex = (value: number): string => value.toString(16).padStart(4, '0')

/** Blocks the current thread; only used inside the USB host process. */
export function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
