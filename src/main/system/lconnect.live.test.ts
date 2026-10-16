/**
 * Manual operation: hands the Lian Li dongle over (UAC prompt).
 * LCONNECT_ACTION=take-over|hand-back npx vitest run lconnect.live
 */
import { describe, expect, it } from 'vitest'
import { handBackToLConnect, lconnectState, takeOverFromLConnect } from './lconnect'

const action = process.env['LCONNECT_ACTION']

describe.skipIf(!action)('L-Connect hand-over (live)', () => {
  it(`performs ${action}`, async () => {
    const ok = action === 'hand-back' ? await handBackToLConnect() : await takeOverFromLConnect()
    expect(ok).toBe(true)
    console.warn(`L-Connect service is now ${await lconnectState()}`)
  }, 120_000)
})
