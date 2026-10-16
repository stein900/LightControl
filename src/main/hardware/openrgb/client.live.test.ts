/**
 * Read-only check against a running OpenRGB server. Skipped unless
 * OPENRGB_LIVE is set, e.g. `OPENRGB_LIVE=127.0.0.1:6742 npx vitest run client.live`.
 */
import { describe, expect, it } from 'vitest'
import { silentLogger } from '@main/core/logger'
import { OpenRgbClient } from './client'
import { stableDeviceId, toDeviceInfo } from './mapper'

const target = process.env['OPENRGB_LIVE']

describe.skipIf(!target)('OpenRGB live server', () => {
  it('negotiates the protocol and decodes every controller', async () => {
    const [host = '127.0.0.1', port = '6742'] = (target ?? '').split(':')
    const client = new OpenRgbClient(silentLogger)
    await client.connect({ host, port: Number(port), clientName: 'LightControl tests' })
    try {
      expect(client.protocolVersion).toBeGreaterThanOrEqual(3)
      const count = await client.controllerCount()
      console.warn(`protocol ${client.protocolVersion}, controllers: ${count}`)
      for (let index = 0; index < count; index++) {
        const raw = await client.controller(index)
        const info = toDeviceInfo(raw, stableDeviceId(raw))
        expect(info.ledCount).toBe(info.zones.reduce((sum, zone) => sum + zone.ledCount, 0))
        console.warn(
          JSON.stringify(
            {
              name: info.name,
              kind: info.kind,
              leds: info.ledCount,
              direct: info.supportsDirect,
              zones: info.zones.map(
                (z) =>
                  `${z.name} [${z.ledCount}, ${z.ledsMin}-${z.ledsMax}${z.resizable ? ', resizable' : ''}]`
              ),
              modes: info.modes.map((m) => m.name)
            },
            null,
            1
          )
        )
      }
    } finally {
      client.close()
    }
  }, 30_000)
})
