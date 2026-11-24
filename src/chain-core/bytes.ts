import { ChainCoreError } from './errors'

const HEX = '0123456789abcdef'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

/** Lowercase hex encoding. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += HEX[b >> 4] + HEX[b & 15]
  }
  return out
}

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  if (c >= 65 && c <= 70) return c - 55
  return -1
}

/** Hex decoding; accepts upper and lower case, rejects odd length and non-hex characters. */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new ChainCoreError('', 'expected a hex string')
  if (hex.length % 2 !== 0) throw new ChainCoreError('', 'hex string has odd length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const hi = hexVal(hex.charCodeAt(i * 2))
    const lo = hexVal(hex.charCodeAt(i * 2 + 1))
    if (hi < 0 || lo < 0) throw new ChainCoreError('', 'invalid hex character')
    out[i] = (hi << 4) | lo
  }
  return out
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function utf8Encode(s: string): Uint8Array {
  return textEncoder.encode(s)
}

export function utf8Decode(b: Uint8Array): string {
  return textDecoder.decode(b)
}

/** Converts a bigint to fixed-size little-endian bytes (two's complement for negatives). */
export function bigintToLE(v: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let x = BigInt.asUintN(size * 8, v)
  for (let i = 0; i < size; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

export function leToBigint(bytes: Uint8Array): bigint {
  let x = 0n
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i])
  return x
}

/**
 * Growable byte buffer with a write side (push*) and a read side (get*).
 * Writers append at the end; readers consume from `readPos`.
 */
export class SerialBuffer {
  private buf: Uint8Array
  private len: number
  readPos = 0

  /** Pass bytes to read from; omit to start an empty writer. */
  constructor(bytes?: Uint8Array) {
    if (bytes) {
      this.buf = bytes
      this.len = bytes.length
    } else {
      this.buf = new Uint8Array(256)
      this.len = 0
    }
  }

  get length(): number {
    return this.len
  }

  /** Bytes left to read. */
  get remaining(): number {
    return this.len - this.readPos
  }

  haveReadData(): boolean {
    return this.readPos < this.len
  }

  /** Copy of the written content. */
  asUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len)
  }

  private reserve(n: number): void {
    const need = this.len + n
    if (need <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < need) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  // ---- writing ----
  push(byte: number): void {
    this.reserve(1)
    this.buf[this.len++] = byte & 0xff
  }

  pushBytes(bytes: Uint8Array): void {
    this.reserve(bytes.length)
    this.buf.set(bytes, this.len)
    this.len += bytes.length
  }

  pushVaruint32(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new ChainCoreError('', 'varuint32 out of range')
    let x = v
    for (;;) {
      if (x >>> 7) {
        this.push(0x80 | (x & 0x7f))
        x >>>= 7
      } else {
        this.push(x)
        break
      }
    }
  }

  /** Zig-zag encoded signed 32-bit varint. */
  pushVarint32(v: number): void {
    if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) throw new ChainCoreError('', 'varint32 out of range')
    this.pushVaruint32(((v << 1) ^ (v >> 31)) >>> 0)
  }

  pushUint8(v: number): void {
    this.push(v)
  }
  pushUint16(v: number): void {
    this.push(v)
    this.push(v >> 8)
  }
  pushUint32(v: number): void {
    this.push(v)
    this.push(v >>> 8)
    this.push(v >>> 16)
    this.push(v >>> 24)
  }
  pushInt8(v: number): void {
    this.push(v)
  }
  pushInt16(v: number): void {
    this.pushUint16(v & 0xffff)
  }
  pushInt32(v: number): void {
    this.pushUint32(v >>> 0)
  }

  /** Writes the low `size` bytes of a bigint, little endian. */
  pushBigInt(v: bigint, size: number): void {
    this.pushBytes(bigintToLE(v, size))
  }

  pushFloat32(v: number): void {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, v, true)
    this.pushBytes(b)
  }

  pushFloat64(v: number): void {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    this.pushBytes(b)
  }

  /** Length-prefixed (varuint32) bytes. */
  pushVarBytes(bytes: Uint8Array): void {
    this.pushVaruint32(bytes.length)
    this.pushBytes(bytes)
  }

  pushString(s: string): void {
    this.pushVarBytes(utf8Encode(s))
  }

  // ---- reading ----
  private need(n: number): void {
    if (this.readPos + n > this.len) throw new ChainCoreError('', 'read past end of buffer')
  }

  get(): number {
    this.need(1)
    return this.buf[this.readPos++]
  }

  getBytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) throw new ChainCoreError('', 'invalid length')
    this.need(n)
    const out = this.buf.slice(this.readPos, this.readPos + n)
    this.readPos += n
    return out
  }

  skip(n: number): void {
    this.need(n)
    this.readPos += n
  }

  getVaruint32(): number {
    let v = 0
    let shift = 0
    for (;;) {
      const b = this.get()
      if (shift === 28 && (b & 0xf0) !== 0) throw new ChainCoreError('', 'varuint32 overflow')
      v += (b & 0x7f) * 2 ** shift
      shift += 7
      if (!(b & 0x80)) break
    }
    return v
  }

  getVarint32(): number {
    const u = this.getVaruint32()
    return (u & 1) === 0 ? u >>> 1 : ~(u >>> 1)
  }

  getUint8(): number {
    return this.get()
  }
  getUint16(): number {
    const b = this.getBytes(2)
    return b[0] | (b[1] << 8)
  }
  getUint32(): number {
    const b = this.getBytes(4)
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0
  }
  getInt8(): number {
    return (this.get() << 24) >> 24
  }
  getInt16(): number {
    return (this.getUint16() << 16) >> 16
  }
  getInt32(): number {
    return this.getUint32() | 0
  }

  getBigUint(size: number): bigint {
    return leToBigint(this.getBytes(size))
  }

  getBigInt(size: number): bigint {
    return BigInt.asIntN(size * 8, this.getBigUint(size))
  }

  getFloat32(): number {
    const b = this.getBytes(4)
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true)
  }

  getFloat64(): number {
    const b = this.getBytes(8)
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true)
  }

  getVarBytes(): Uint8Array {
    const n = this.getVaruint32()
    return this.getBytes(n)
  }

  getString(): string {
    return utf8Decode(this.getVarBytes())
  }
}
