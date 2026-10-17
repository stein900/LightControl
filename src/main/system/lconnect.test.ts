import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lconnectPairedDevices } from './lconnect'

describe('L-Connect pairing list', () => {
  const previous = process.env['ProgramData']
  let directory: string | null = null

  afterEach(() => {
    process.env['ProgramData'] = previous
    if (directory) rmSync(directory, { recursive: true, force: true })
    directory = null
  })

  function withBindingSet(content: string | null): void {
    directory = mkdtempSync(join(tmpdir(), 'lconnect-'))
    process.env['ProgramData'] = directory
    if (content === null) return
    const folder = join(directory, 'Lian-Li', 'L-Connect 3', 'slv3', 'config')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'BindingSet.Config'), content)
  }

  it('reads the paired devices in pairing order', async () => {
    withBindingSet(
      '[{"MacStr":"AA:BB:CC:00:00:02","iSort":2,"iType":1},{"MacStr":"aa:bb:cc:00:00:01","iSort":1,"iType":1}]'
    )
    expect(await lconnectPairedDevices()).toEqual(['aa:bb:cc:00:00:01', 'aa:bb:cc:00:00:02'])
  })

  it('returns null when L-Connect has no usable list', async () => {
    withBindingSet(null)
    expect(await lconnectPairedDevices()).toBeNull()
    rmSync(directory!, { recursive: true, force: true })
    withBindingSet('[{"MacStr":"not-a-mac"}]')
    expect(await lconnectPairedDevices()).toBeNull()
  })
})
