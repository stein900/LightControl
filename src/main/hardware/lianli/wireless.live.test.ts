/**
 * Read-only check against the real Lian Li dongles (L-Connect 3 must be stopped).
 * Run with: LIANLI_LIVE=1 npx vitest run wireless.live --silent=false
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LibUsb } from './libusb'
import { boundTo, macToString } from './protocol'
import { WirelessLink } from './wireless-link'

describe.skipIf(!process.env['LIANLI_LIVE'])('Lian Li wireless dongle (live, read-only)', () => {
  it('finds the master and lists bound devices', () => {
    const usb = new LibUsb(join(process.cwd(), 'vendor', 'openrgb', 'libusb-1.0.dll'))
    const link = WirelessLink.open(usb)
    try {
      console.warn(`Master ${macToString(link.masterMac)} on channel ${link.masterChannel}`)
      let result = link.poll()
      for (let i = 0; i < 3 && result; i++) result = link.poll() ?? result
      expect(result).not.toBeNull()
      for (const device of result!.devices) {
        console.warn(`  master=${macToString(device.masterMac)}`)
        const ours = boundTo([device], link.masterMac).length > 0
        console.warn(
          `${ours ? 'BOUND  ' : 'foreign'} ${macToString(device.mac)} type=${device.deviceType} ch=${device.channel} rx=${device.rxType} ` +
            `fanTypes=[${device.fanTypes.join(',')}] ${device.layout.model} leds=${device.layout.ledCount} ` +
            `effect=${[...device.effectIndex].map((b) => b.toString(16).padStart(2, '0')).join('')} mbSync=${device.syncsMotherboardLight}`
        )
      }
      for (const master of result!.masters)
        console.warn(`other master ${macToString(master.mac)} ch=${master.channel}`)
    } finally {
      link.close()
      usb.dispose()
    }
  }, 60_000)
})
