/** Little-endian binary helpers for the OpenRGB wire format. */

export class ProtocolError extends Error {
  override readonly name = 'ProtocolError'
}

export class BinaryReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  get position(): number {
    return this.offset
  }

  get remaining(): number {
    return this.buffer.length - this.offset
  }

  private require(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) {
      throw new ProtocolError(`Unexpected end of packet: need ${bytes} bytes at offset ${this.offset}`)
    }
  }

  u16(): number {
    this.require(2)
    const value = this.buffer.readUInt16LE(this.offset)
    this.offset += 2
    return value
  }

  u32(): number {
    this.require(4)
    const value = this.buffer.readUInt32LE(this.offset)
    this.offset += 4
    return value
  }

  i32(): number {
    this.require(4)
    const value = this.buffer.readInt32LE(this.offset)
    this.offset += 4
    return value
  }

  /** Reads a `uint16 length` prefixed string whose length includes the null terminator. */
  string(): string {
    const length = this.u16()
    this.require(length)
    const end = this.offset + length
    let terminator = this.buffer.indexOf(0, this.offset)
    if (terminator === -1 || terminator > end) terminator = end
    const value = this.buffer.toString('utf8', this.offset, terminator)
    this.offset = end
    return value
  }

  skip(bytes: number): void {
    this.require(bytes)
    this.offset += bytes
  }
}

export class BinaryWriter {
  private buffer: Buffer
  private length = 0

  constructor(initialCapacity = 256) {
    this.buffer = Buffer.alloc(initialCapacity)
  }

  private ensure(bytes: number): void {
    if (this.length + bytes <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + bytes) capacity *= 2
    const next = Buffer.alloc(capacity)
    this.buffer.copy(next, 0, 0, this.length)
    this.buffer = next
  }

  u8(value: number): this {
    this.ensure(1)
    this.buffer.writeUInt8(value & 0xff, this.length)
    this.length += 1
    return this
  }

  u16(value: number): this {
    this.ensure(2)
    this.buffer.writeUInt16LE(value, this.length)
    this.length += 2
    return this
  }

  u32(value: number): this {
    this.ensure(4)
    this.buffer.writeUInt32LE(value >>> 0, this.length)
    this.length += 4
    return this
  }

  i32(value: number): this {
    this.ensure(4)
    this.buffer.writeInt32LE(value | 0, this.length)
    this.length += 4
    return this
  }

  /** Writes a `uint16 length` prefixed, null terminated UTF-8 string. */
  string(value: string): this {
    const bytes = Buffer.from(value, 'utf8')
    this.u16(bytes.length + 1)
    this.ensure(bytes.length + 1)
    bytes.copy(this.buffer, this.length)
    this.length += bytes.length
    this.buffer.writeUInt8(0, this.length)
    this.length += 1
    return this
  }

  bytes(value: Uint8Array): this {
    this.ensure(value.length)
    this.buffer.set(value, this.length)
    this.length += value.length
    return this
  }

  /** Overwrites a previously written uint32, used for size prefixes. */
  patchU32(offset: number, value: number): this {
    this.buffer.writeUInt32LE(value >>> 0, offset)
    return this
  }

  get size(): number {
    return this.length
  }

  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.length)
  }
}
