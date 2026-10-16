/**
 * Live RGB test: sends one fixed color to every Strimer heard on the air and
 * checks the effect index they report back (L-Connect 3 must be stopped).
 * LIANLI_UPLOAD=r,g,b npx vitest run wireless-upload.live --silent=false
 */
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { LibUsb, sleepSync } from './libusb'
import { createRgbUpload, effectApplied, macToString } from './protocol'
import { WirelessLink } from './wireless-link'

const color = process.env['LIANLI_UPLOAD']

describe.skipIf(!color)('Lian Li wireless upload (live)', () => {
  it('applies a fixed color', () => {
    const [r = 0, g = 0, b = 0] = color!.split(',').map(Number)
    const usb = new LibUsb(join(process.cwd(), 'vendor', 'openrgb', 'libusb-1.0.dll'))
    const link = WirelessLink.open(usb)
    try {
      const devices = link.poll()?.devices.filter((device) => device.layout.ledCount > 0) ?? []
      for (const device of devices) {
        const frame = Uint8Array.from(Array.from({ length: device.layout.ledCount }, () => [r, g, b]).flat())
        const upload = createRgbUpload([frame], 5000)
        for (const target of [0xff, device.rxType]) {
          link.upload(device, upload, target)
          let applied = false
          for (let i = 0; i < 10 && !applied; i++) {
            sleepSync(300)
            const seen = link.poll()?.devices.find((d) => macToString(d.mac) === macToString(device.mac))
            applied = !!seen && effectApplied(seen, upload)
          }
          console.warn(
            `${device.layout.model} ${macToString(device.mac)} rx=0x${target.toString(16)}: ${applied ? 'APPLIED' : 'not applied'}`
          )
          if (applied) break
        }
      }
    } finally {
      link.close()
      usb.dispose()
    }
  }, 120_000)
})
