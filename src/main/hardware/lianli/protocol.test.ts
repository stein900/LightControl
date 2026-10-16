import { describe, expect, it } from 'vitest'
import {
  MASTER_CHANNELS,
  createRgbUpload,
  deviceLayout,
  discoveryQuery,
  masterQuery,
  parseDiscovery,
  parseMasterReply,
  rgbFrames,
  trafficChannel,
  usbPackets
} from './protocol'
import { decompress } from './tinyuz'

const solid = (leds: number, color: [number, number, number]): Uint8Array =>
  Uint8Array.from(Array.from({ length: leds }, () => color).flat())

function record(fields: {
  mac: number
  master: number
  channel: number
  rx: number
  type: number
  fans: number
  fanType: number
}): number[] {
  const bytes = new Array<number>(42).fill(0)
  bytes.splice(0, 6, ...new Array<number>(6).fill(fields.mac))
  bytes.splice(6, 6, ...new Array<number>(6).fill(fields.master))
  bytes[12] = fields.channel
  bytes[13] = fields.rx
  bytes[18] = fields.type
  bytes[19] = fields.fans
  bytes.splice(20, 4, 0x81, 2, 3, 4)
  bytes[24] = fields.fanType
  bytes[41] = 0x1c
  return bytes
}

describe('Lian Li wireless protocol', () => {
  it('scans every channel once, the default channel first', () => {
    expect(MASTER_CHANNELS[0]).toBe(8)
    expect(new Set(MASTER_CHANNELS).size).toBe(39)
    expect(Math.min(...MASTER_CHANNELS)).toBe(1)
    expect(Math.max(...MASTER_CHANNELS)).toBe(39)
  })

  it('builds the master and discovery queries', () => {
    expect([...masterQuery(8).subarray(0, 3)]).toEqual([0x11, 8, 0])
    expect([...discoveryQuery(3).subarray(0, 2)]).toEqual([0x10, 3])
    expect(discoveryQuery(99)[1]).toBe(26)
  })

  it('accepts only plausible master replies', () => {
    const reply = new Uint8Array(64)
    reply.set([0x11, 1, 2, 3, 4, 5, 6, 0, 0, 0, 2, 0x01, 0x06])
    expect(parseMasterReply(reply)).toEqual({ mac: Uint8Array.from([1, 2, 3, 4, 5, 6]), firmware: 0x0106 })
    reply[10] = 1
    expect(parseMasterReply(reply)).toBeNull()
  })

  it('parses discovery pages, separating devices from other masters', () => {
    const reply = Uint8Array.from([
      0x10,
      3,
      0x80,
      0,
      ...record({ mac: 0xaa, master: 0x11, channel: 8, rx: 1, type: 3, fans: 0, fanType: 0 }),
      ...record({ mac: 0xbb, master: 0x11, channel: 8, rx: 2, type: 0, fans: 3, fanType: 21 }),
      ...record({ mac: 0xcc, master: 0, channel: 8, rx: 0, type: 0xff, fans: 0, fanType: 0 })
    ])
    const result = parseDiscovery(reply, 1)!
    expect(result.devices).toHaveLength(2)
    expect(result.masters).toHaveLength(1)
    const [strimer, fans] = result.devices
    expect(strimer!.layout).toMatchObject({ family: 'strimer', ledCount: 174 })
    expect(fans!.layout).toMatchObject({ family: 'sl-v3', ledCount: 120, fanCount: 3 })
    expect([...strimer!.effectIndex]).toEqual([0x81, 2, 3, 4])
    expect(parseDiscovery(reply.subarray(0, 50), 1)).toBeNull()
  })

  it('knows the physical layouts', () => {
    expect(deviceLayout(1, [0, 0, 0, 0], 0).ledCount).toBe(116)
    expect(deviceLayout(2, [0, 0, 0, 0], 0).ledCount).toBe(132)
    expect(deviceLayout(9, [0, 0, 0, 0], 0).ledCount).toBe(0)
    expect(deviceLayout(10, [0, 0, 0, 0], 3).ledCount).toBe(96)
    expect(deviceLayout(0, [29, 0, 0, 0], 4)).toMatchObject({ family: 'tl', ledCount: 104 })
    expect(deviceLayout(0, [37, 0, 0, 0], 13)).toMatchObject({
      family: 'sl-inf',
      fanCount: 3,
      reverseFans: true
    })
  })

  it('uses the device channel when valid, the master channel otherwise', () => {
    expect(trafficChannel(12, 8)).toBe(12)
    expect(trafficChannel(0, 8)).toBe(8)
    expect(trafficChannel(77, 8)).toBe(8)
  })

  it('encodes upload headers and chunks exactly like the vendor uploader', () => {
    const frames = Array.from({ length: 120 }, () => solid(174, [17, 38, 59]))
    const upload = createRgbUpload(frames, 50)
    const packets = rgbFrames(upload, new Uint8Array(6).fill(1), new Uint8Array(6).fill(2))
    const header = packets[0]!
    expect([...header.subarray(0, 14)]).toEqual([0x12, 0x20, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
    expect([...header.subarray(25, 28)]).toEqual([0, 120, 174])
    expect([...header.subarray(32, 35)]).toEqual([0, 80, 0])
    expect(header[19]).toBe(packets.length)
    expect(new DataView(header.buffer).getUint32(20, false)).toBe(upload.compressed.length)

    const payload = packets.slice(1).flatMap((packet, i) => {
      expect(packet[18]).toBe(i + 1)
      return [...packet.subarray(20)]
    })
    const compressed = Uint8Array.from(payload.slice(0, upload.compressed.length))
    expect([...decompress(compressed, 120 * 174 * 3)]).toEqual([...frames.flatMap((frame) => [...frame])])
  })

  it('derives a stable effect index that never looks like a valid slot', () => {
    for (const red of [0, 1, 127, 255]) {
      const a = createRgbUpload([solid(9, [red, 0, 0])], 50)
      expect(a.effectIndex[0]! & 0x80).toBe(0x80)
      expect([...a.effectIndex]).toEqual([...createRgbUpload([solid(9, [red, 0, 0])], 50).effectIndex])
    }
    expect([...createRgbUpload([solid(9, [0, 0, 0])], 50).effectIndex]).not.toEqual([
      ...createRgbUpload([solid(9, [0, 0, 0])], 100).effectIndex
    ])
  })

  it('reverses fan order inside frames for right-attached chains', () => {
    const frame = Uint8Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])
    const reversed = createRgbUpload([frame], 50, 2)
    const expected = createRgbUpload([Uint8Array.from([3, 3, 3, 4, 4, 4, 1, 1, 1, 2, 2, 2])], 50)
    expect([...reversed.compressed]).toEqual([...expected.compressed])
  })

  it('splits RF frames into addressed USB packets', () => {
    const rf = Uint8Array.from({ length: 240 }, (_, i) => i)
    const packets = usbPackets(rf, 8, 3)
    expect(packets).toHaveLength(4)
    packets.forEach((packet, chunk) => {
      expect([...packet.subarray(0, 4)]).toEqual([0x10, chunk, 8, 3])
      expect([...packet.subarray(4)]).toEqual([...rf.subarray(chunk * 60, chunk * 60 + 60)])
    })
  })

  it('rejects uploads the device cannot hold', () => {
    expect(() => createRgbUpload([], 50)).toThrow()
    expect(() => createRgbUpload([new Uint8Array(256 * 3)], 50)).toThrow()
    expect(() => createRgbUpload([solid(9, [0, 0, 0]), solid(10, [0, 0, 0])], 50)).toThrow()
  })
})
