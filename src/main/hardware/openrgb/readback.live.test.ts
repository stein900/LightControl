/** Temporary diagnostic: reads the MSI board state back from a running OpenRGB server. */
import { describe, it } from 'vitest'
import { silentLogger } from '@main/core/logger'
import { OpenRgbClient } from './client'
import { unpackColor } from './codec'

const target = process.env['OPENRGB_READBACK']

describe.skipIf(!target)('MSI readback', () => {
  it('prints mode and zone colors', async () => {
    const client = new OpenRgbClient(silentLogger)
    await client.connect({ host: '127.0.0.1', port: 6742, clientName: 'LightControl readback' })
    const dump = async (label: string): Promise<void> => {
      const count = await client.controllerCount()
      for (let index = 0; index < count; index++) {
        const raw = await client.controller(index)
        if (!raw.name.startsWith('MSI')) continue
        let offset = 0
        const zones = raw.zones.map((zone) => {
          const first = raw.colors[offset]
          const last = raw.colors[offset + zone.ledsCount - 1]
          offset += zone.ledsCount
          return `${zone.name}[${zone.ledsCount}] first=${JSON.stringify(first === undefined ? null : unpackColor(first))} last=${JSON.stringify(last === undefined ? null : unpackColor(last))}`
        })
        console.warn(
          `${label}: activeMode=${raw.modes[raw.activeMode]?.name} (${raw.activeMode})\n  ${zones.join('\n  ')}`
        )
      }
    }
    await dump('current')
    if (target === 'rescan') {
      client.rescan()
      await new Promise((resolve) => setTimeout(resolve, 7000))
      await dump('after rescan (read from hardware)')
    }
    client.close()
  }, 30_000)
})
