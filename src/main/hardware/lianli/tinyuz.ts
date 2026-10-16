/**
 * tinyuz stream format (MIT, HouSisong), as decompressed by the firmware of
 * Lian Li wireless devices.
 *
 * Stream: dictionary size (uint32 LE), then codes. Type bits are packed LSB
 * first into "type bytes" interleaved with the payload, a type byte being
 * emitted where its first bit is needed:
 *   - data (bit 1) + 1 literal byte;
 *   - dict (bit 0) + length + [same-position bit] + position: copy from
 *     `position` bytes back (overlapping copies allowed);
 *   - ctrl: a dict code with position 0 (literal line, clip end, stream end).
 *
 * The encoder here is a greedy LZ77 producing that exact format. It is not
 * byte-identical to the reference encoder, which uses optimal parsing; every
 * stream it produces is checked against the decoder ported below.
 */

const MIN_LITERAL_LINE = 15
const MIN_MATCH = 2
const BIG_POS_FOR_LEN = (1 << 11) + (1 << 9) + (1 << 7) - 1
const CTRL_LITERAL_LINE = 1
const CTRL_STREAM_END = 3
const DICT_LEN_PACK_BITS = 1
const DICT_POS_LEN_PACK_BITS = 2

/** Dictionary size used by the Lian Li tooling. */
export const DEFAULT_DICT_SIZE = 4096
/** Longest match tried; long runs are still encoded as one overlapping copy. */
const MAX_MATCH = 4096
const HASH_SIZE = 1 << 12
const MAX_CHAIN = 64

class CodeWriter {
  readonly code: number[] = []
  private typesIndex = 0
  private typeCount = 0
  private haveDataBack = false
  private dictPosBack = 1
  maxDictPos = 1

  private outType(bit: number): void {
    if (this.typeCount === 0) {
      this.typesIndex = this.code.length
      this.code.push(0)
    }
    this.code[this.typesIndex] = this.code[this.typesIndex]! | (bit << this.typeCount)
    this.typeCount = (this.typeCount + 1) % 8
  }

  /** Variable-length integer: groups of `packBits` bits, most significant group first, each followed by a continue bit. */
  private outLen(value: number, packBits: number): void {
    let v = value
    let count = 1
    for (;;) {
      const span = 2 ** (count * packBits)
      if (v < span) break
      v -= span
      count += 1
    }
    while (count--) {
      for (let i = 0; i < packBits; i++) this.outType(Math.floor(v / 2 ** (count * packBits + i)) & 1)
      this.outType(count > 0 ? 1 : 0)
    }
  }

  private outDictPos(pos: number): void {
    const long = pos >= 1 << 7
    const rest = long ? pos - (1 << 7) : pos
    this.code.push((rest & 0x7f) | (long ? 0x80 : 0))
    if (long) this.outLen(rest >>> 7, DICT_POS_LEN_PACK_BITS)
  }

  data(byte: number): void {
    this.outType(1)
    this.code.push(byte)
    this.haveDataBack = true
  }

  literalLine(bytes: ArrayLike<number>): void {
    this.ctrl(CTRL_LITERAL_LINE)
    this.outLen(bytes.length - MIN_LITERAL_LINE, DICT_POS_LEN_PACK_BITS)
    for (let i = 0; i < bytes.length; i++) this.code.push(bytes[i]!)
    this.haveDataBack = true
  }

  /** `distance` is how many bytes back the copy starts (1 = previous byte). */
  dict(length: number, distance: number): void {
    this.outType(0)
    if (distance > this.maxDictPos) this.maxDictPos = distance
    const samePos = this.haveDataBack && this.dictPosBack === distance
    let len = length - MIN_MATCH
    if (!samePos && distance > BIG_POS_FOR_LEN) len -= 1
    this.outLen(len, DICT_LEN_PACK_BITS)
    if (this.haveDataBack) this.outType(samePos ? 1 : 0)
    if (!samePos) this.outDictPos(distance)
    this.haveDataBack = false
    this.dictPosBack = distance
  }

  ctrl(type: number): void {
    this.outType(0)
    this.outLen(type, DICT_LEN_PACK_BITS)
    if (this.haveDataBack) this.outType(0)
    this.outDictPos(0)
  }

  streamEnd(): void {
    this.ctrl(CTRL_STREAM_END)
    this.typeCount = 0
    this.dictPosBack = 1
    this.haveDataBack = false
  }
}

/** Compresses `input` into a complete tinyuz stream (header included). */
export function compress(input: Uint8Array, dictSize = DEFAULT_DICT_SIZE): Uint8Array {
  if (input.length === 0) throw new Error('tinyuz: empty input')
  const writer = new CodeWriter()
  const head = new Int32Array(HASH_SIZE).fill(-1)
  const prev = new Int32Array(input.length).fill(-1)
  const hash = (i: number): number =>
    ((input[i]! << 8) ^ (input[i + 1]! << 4) ^ input[i + 2]!) & (HASH_SIZE - 1)
  const insert = (i: number): void => {
    if (i + 2 >= input.length) return
    const h = hash(i)
    prev[i] = head[h]!
    head[h] = i
  }
  const matchLength = (from: number, at: number): number => {
    let length = 0
    const limit = Math.min(MAX_MATCH, input.length - at)
    while (length < limit && input[from + length] === input[at + length]) length++
    return length
  }

  let literals: number[] = []
  const flushLiterals = (): void => {
    if (literals.length >= MIN_LITERAL_LINE) writer.literalLine(literals)
    else for (const byte of literals) writer.data(byte)
    literals = []
  }

  let lastDistance = 1
  let i = 0
  while (i < input.length) {
    let bestLength = 0
    let bestDistance = 0
    // Repeating the previous distance is cheapest (one bit instead of a position byte).
    if (i >= lastDistance) {
      const length = matchLength(i - lastDistance, i)
      if (length >= MIN_MATCH) {
        bestLength = length
        bestDistance = lastDistance
      }
    }
    if (i + 2 < input.length) {
      let candidate = head[hash(i)]!
      let steps = 0
      while (candidate >= 0 && i - candidate <= dictSize && steps++ < MAX_CHAIN) {
        const length = matchLength(candidate, i)
        if (length > bestLength + 1) {
          bestLength = length
          bestDistance = i - candidate
        }
        candidate = prev[candidate]!
      }
    }

    const worthIt =
      bestLength >= 3 || (bestLength >= MIN_MATCH && bestDistance === lastDistance && literals.length > 0)
    const fitsBigPos = bestDistance <= BIG_POS_FOR_LEN || bestLength >= MIN_MATCH + 1
    if (worthIt && fitsBigPos) {
      flushLiterals()
      writer.dict(bestLength, bestDistance)
      lastDistance = bestDistance
      for (let k = 0; k < bestLength; k++) insert(i + k)
      i += bestLength
    } else {
      literals.push(input[i]!)
      insert(i)
      i += 1
    }
  }
  flushLiterals()
  writer.streamEnd()

  const out = new Uint8Array(4 + writer.code.length)
  new DataView(out.buffer).setUint32(0, writer.maxDictPos, true)
  out.set(writer.code, 4)
  return out
}

/** Reference decoder (port of tuz_decompress_mem), used to validate encoded streams. */
export function decompress(stream: Uint8Array, outputSize: number): Uint8Array {
  const out = new Uint8Array(outputSize)
  let inPos = 4
  let outPos = 0
  let types = 0
  let typeCount = 0
  let dictPosBack = 1
  let haveDataBack = false

  const readByte = (): number => {
    if (inPos >= stream.length) throw new Error('tinyuz: truncated stream')
    return stream[inPos++]!
  }
  const readLowBits = (bitCount: number): number => {
    if (typeCount >= bitCount) {
      const result = types
      typeCount -= bitCount
      types >>>= bitCount
      return result
    }
    const v = readByte()
    const result = types | (v << typeCount)
    const needed = bitCount - typeCount
    typeCount = 8 - needed
    types = v >>> needed
    return result
  }
  const unpackLen = (readBits: number): number => {
    let v = 0
    for (;;) {
      const low = readLowBits(readBits)
      v = v * 2 ** (readBits - 1) + (low & ((1 << (readBits - 1)) - 1))
      if (!(low & (1 << (readBits - 1)))) return v
      v += 1
    }
  }
  const unpackDictPos = (): number => {
    const first = readByte()
    return first < 1 << 7 ? first : ((first & 0x7f) | (unpackLen(3) << 7)) + (1 << 7)
  }

  for (;;) {
    if ((readLowBits(1) & 1) === 0) {
      let length = unpackLen(2)
      let pos: number
      if (haveDataBack && readLowBits(1) & 1) {
        pos = dictPosBack
      } else {
        pos = unpackDictPos()
        if (pos > BIG_POS_FOR_LEN) length += 1
      }
      haveDataBack = false
      if (pos) {
        let count = length + MIN_MATCH
        dictPosBack = pos
        if (pos > outPos || count > outputSize - outPos) throw new Error('tinyuz: invalid copy')
        while (count--) {
          out[outPos] = out[outPos - pos]!
          outPos++
        }
      } else if (length === CTRL_LITERAL_LINE) {
        let count = unpackLen(3) + MIN_LITERAL_LINE
        if (count > outputSize - outPos) throw new Error('tinyuz: literal overflow')
        while (count--) out[outPos++] = readByte()
        haveDataBack = true
      } else {
        dictPosBack = 1
        typeCount = 0
        if (length === CTRL_STREAM_END) return out.subarray(0, outPos)
        if (length !== 2) throw new Error(`tinyuz: unknown control ${length}`)
      }
    } else {
      if (outPos >= outputSize) throw new Error('tinyuz: output overflow')
      haveDataBack = true
      out[outPos++] = readByte()
    }
  }
}
