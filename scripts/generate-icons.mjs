/**
 * Renders the LightControl mark (a ring of twelve LEDs whose intensity decays
 * like a comet tail) with signed distance fields, then writes the installer and
 * window icons plus a simplified tray icon that stays legible at 16 px.
 * Dependency free: PNG and ICO containers are encoded by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKGROUND = [10, 10, 11]
const FOREGROUND = [245, 245, 247]

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

function roundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - half + radius
  const qy = Math.abs(py) - half + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

const LEDS = 12

/** Returns the mark's opacity at a point of the 24 unit viewBox. */
function markCoverage(x, y, unitsPerPixel, simplified) {
  const cx = 12
  const cy = 12
  const coverage = (distance) => Math.min(1, Math.max(0, 0.5 - distance / unitsPerPixel))

  if (simplified) {
    const ring = Math.abs(Math.hypot(x - cx, y - cy) - 7) - 1.6
    const head = Math.hypot(x - (cx + 7 * Math.cos(-Math.PI / 4)), y - (cy + 7 * Math.sin(-Math.PI / 4))) - 2.6
    return Math.max(coverage(ring) * 0.55, coverage(head))
  }

  let best = 0
  for (let i = 0; i < LEDS; i++) {
    const angle = -Math.PI / 4 - (i / LEDS) * Math.PI * 2
    const dot = Math.hypot(x - (cx + 7.6 * Math.cos(angle)), y - (cy + 7.6 * Math.sin(angle))) - 1.35
    const intensity = Math.max(0.16, Math.pow(1 - i / LEDS, 1.6))
    best = Math.max(best, coverage(dot) * intensity)
  }
  const core = Math.abs(Math.hypot(x - cx, y - cy) - 3) - 0.9
  return Math.max(best, coverage(core) * 0.9)
}

function render(size, simplified = false) {
  const rgba = Buffer.alloc(size * size * 4)
  const half = size / 2
  const boxHalf = size * (simplified ? 0.5 : 0.42)
  const boxRadius = size * (simplified ? 0.24 : 0.2)
  const unitsPerPixel = 24 / (size * (simplified ? 0.8 : 0.7))

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sx = px + 0.5 - half
      const sy = py + 0.5 - half
      const box = Math.min(1, Math.max(0, 0.5 - roundedBox(sx, sy, boxHalf, boxRadius)))
      const mark = markCoverage(sx * unitsPerPixel + 12, sy * unitsPerPixel + 12, unitsPerPixel, simplified)
      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel++) {
        rgba[offset + channel] = Math.round(BACKGROUND[channel] + (FOREGROUND[channel] - BACKGROUND[channel]) * mark)
      }
      rgba[offset + 3] = Math.round(box * 255)
    }
  }
  return encodePng(size, rgba)
}

const buildDir = join(root, 'build')
const iconsDir = join(root, 'resources', 'icons')
mkdirSync(buildDir, { recursive: true })
mkdirSync(iconsDir, { recursive: true })

const appIco = encodeIco([256, 128, 64, 48, 32, 24, 16].map((size) => ({ size, png: render(size) })))
writeFileSync(join(buildDir, 'icon.png'), render(1024))
writeFileSync(join(buildDir, 'icon.ico'), appIco)
writeFileSync(join(iconsDir, 'icon.ico'), appIco)
writeFileSync(join(iconsDir, 'icon.png'), render(256))
writeFileSync(
  join(iconsDir, 'tray.ico'),
  encodeIco([48, 32, 24, 20, 16].map((size) => ({ size, png: render(size, size <= 24) })))
)
console.log('Icons written to build/ and resources/icons/')
