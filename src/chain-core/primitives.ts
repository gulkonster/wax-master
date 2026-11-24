import { SerialBuffer, bytesToHex, hexToBytes } from './bytes'
import { ChainCoreError } from './errors'
import { nameToUint64, uint64ToName } from './name'
import {
  parsePrivateKey,
  parsePublicKey,
  parseSignature,
  privateKeyToString,
  publicKeyToString,
  readPrivateKey,
  readPublicKey,
  readSignature,
  signatureToString,
  writePrivateKey,
  writePublicKey,
  writeSignature
} from './keys'

/**
 * JSON conventions (the same as eosjs, which is what nodeos clients expect):
 *  - int8/16/32, uint8/16/32, varint32, varuint32: JSON numbers.
 *  - int64, uint64, int128, uint128: decimal strings on output; numbers, bigints or decimal strings on input.
 *  - float32/float64: JSON numbers (float32 uses the shortest decimal that round-trips as a float32);
 *    non-finite values are the strings "NaN", "Infinity", "-Infinity".
 *  - float128: 32 hex characters, the raw 16 bytes.
 *  - time_point: "YYYY-MM-DDTHH:MM:SS.mmm" (6 fractional digits only when microseconds are present).
 *  - time_point_sec: "YYYY-MM-DDTHH:MM:SS"; block_timestamp_type: "YYYY-MM-DDTHH:MM:SS.mmm".
 *    Input may carry a trailing "Z" and any fraction; block_timestamp_type rounds down to a half second.
 *  - public keys decode to "PUB_K1_..." (or "EOS..." when `legacyKeys` is set); input accepts both.
 *  - bytes and checksums: lowercase hex on output, any case on input.
 */
export interface CodecOptions {
  /** Print K1 public keys in the legacy `EOS...` form when decoding. */
  legacyKeys?: boolean
}

export interface BuiltinCodec {
  encode(buf: SerialBuffer, value: unknown): void
  decode(buf: SerialBuffer, opts: CodecOptions): unknown
}

const err = (m: string): never => {
  throw new ChainCoreError('', m)
}

// ---------------------------------------------------------------- integers

export function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) return err('expected a safe integer; pass large values as strings')
    return BigInt(v)
  }
  if (typeof v === 'string') {
    if (!/^-?\d+$/.test(v)) return err('expected a decimal integer')
    return BigInt(v)
  }
  return err('expected an integer')
}

function intCodec(bits: number, signed: boolean): BuiltinCodec {
  const size = bits / 8
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n
  const asString = bits > 32
  return {
    encode(buf, value) {
      const v = toBigInt(value)
      if (v < min || v > max) err(`value out of range for ${signed ? 'int' : 'uint'}${bits}`)
      buf.pushBigInt(v, size)
    },
    decode(buf) {
      const v = signed ? buf.getBigInt(size) : buf.getBigUint(size)
      return asString ? v.toString() : Number(v)
    }
  }
}

// ---------------------------------------------------------------- floats

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'nan') return NaN
    if (s === 'inf' || s === 'infinity' || s === '+inf') return Infinity
    if (s === '-inf' || s === '-infinity') return -Infinity
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) return Number(s)
  }
  return err('expected a number')
}

function nonFinite(x: number): string | null {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return 'Infinity'
  if (x === -Infinity) return '-Infinity'
  return null
}

function shortestFloat32(x: number): number {
  for (let p = 1; p <= 9; p++) {
    const n = Number(x.toPrecision(p))
    if (Math.fround(n) === x) return n
  }
  return x
}

// ---------------------------------------------------------------- time

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$/

interface ParsedTime {
  ms: number
  /** Microseconds below the millisecond, 0..999. */
  micros: number
}

function parseIso(s: unknown): ParsedTime {
  if (typeof s !== 'string') return err('expected an ISO date string')
  const m = ISO_RE.exec(s)
  if (!m) return err('invalid time format')
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number)
  if (y < 1970) return err('time before 1970 is not supported')
  const ms0 = Date.UTC(y, mo - 1, d, h, mi, sec)
  const dt = new Date(ms0)
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi ||
    dt.getUTCSeconds() !== sec
  ) {
    return err('invalid date or time value')
  }
  const frac = (m[7] ?? '').padEnd(6, '0')
  const micro = Number(frac)
  return { ms: ms0 + Math.floor(micro / 1000), micros: micro % 1000 }
}

function isoOf(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 23)
  } catch {
    return err('time out of range')
  }
}

const TIME_POINT_MAX = (1n << 63n) - 1n

// ---------------------------------------------------------------- symbol / asset

const SYMBOL_CODE_RE = /^[A-Z]{1,7}$/
const MAX_PRECISION = 18
const MAX_ASSET_AMOUNT = (1n << 62n) - 1n

function symbolCodeToUint64(code: string): bigint {
  if (!SYMBOL_CODE_RE.test(code)) return err('invalid symbol code (1-7 uppercase letters)')
  let v = 0n
  for (let i = 0; i < code.length; i++) v |= BigInt(code.charCodeAt(i)) << BigInt(8 * i)
  return v
}

function uint64ToSymbolCode(v: bigint): string {
  let out = ''
  let x = v
  while (x > 0n) {
    const c = Number(x & 0xffn)
    if (c < 65 || c > 90) return err('invalid symbol code in binary data')
    out += String.fromCharCode(c)
    x >>= 8n
  }
  if (out.length > 7) return err('symbol code longer than 7 characters')
  if (out.length === 0) return err('empty symbol code')
  return out
}

export interface SymbolParts {
  precision: number
  code: string
}

export function parseSymbol(s: string): SymbolParts {
  if (typeof s !== 'string') return err('expected a symbol string like "4,WAX"')
  const m = /^(\d{1,2}),([A-Z]{1,7})$/.exec(s)
  if (!m) return err('invalid symbol, expected "<precision>,<CODE>"')
  const precision = Number(m[1])
  if (precision > MAX_PRECISION) return err(`symbol precision above ${MAX_PRECISION}`)
  return { precision, code: m[2] }
}

export function formatSymbol(p: SymbolParts): string {
  return `${p.precision},${p.code}`
}

function symbolToUint64(p: SymbolParts): bigint {
  return (symbolCodeToUint64(p.code) << 8n) | BigInt(p.precision)
}

function uint64ToSymbol(v: bigint): SymbolParts {
  const precision = Number(v & 0xffn)
  if (precision > MAX_PRECISION) return err(`symbol precision above ${MAX_PRECISION}`)
  return { precision, code: uint64ToSymbolCode(v >> 8n) }
}

export interface AssetParts {
  /** Integer amount in units of 10^-precision. */
  amount: bigint
  symbol: SymbolParts
}

export function parseAsset(s: string): AssetParts {
  if (typeof s !== 'string') return err('expected an asset string like "1.0000 WAX"')
  const m = /^(-?)(\d+)(?:\.(\d+))?\s([A-Z]{1,7})$/.exec(s)
  if (!m) return err('invalid asset, expected "<amount> <SYMBOL>"')
  const frac = m[3] ?? ''
  if (frac.length > MAX_PRECISION) return err(`asset precision above ${MAX_PRECISION}`)
  let amount = BigInt(m[2] + frac)
  if (m[1]) amount = -amount
  if (amount > MAX_ASSET_AMOUNT || amount < -MAX_ASSET_AMOUNT) return err('asset amount out of range')
  return { amount, symbol: { precision: frac.length, code: m[4] } }
}

export function formatAsset(a: AssetParts): string {
  const neg = a.amount < 0n
  let digits = (neg ? -a.amount : a.amount).toString()
  const p = a.symbol.precision
  if (p > 0) {
    digits = digits.padStart(p + 1, '0')
    digits = digits.slice(0, digits.length - p) + '.' + digits.slice(digits.length - p)
  }
  return `${neg ? '-' : ''}${digits} ${a.symbol.code}`
}

// ---------------------------------------------------------------- hex helpers

function fixedHex(v: unknown, size: number): Uint8Array {
  if (typeof v !== 'string') return err('expected a hex string')
  const b = hexToBytes(v)
  if (b.length !== size) return err(`expected ${size} bytes (${size * 2} hex characters)`)
  return b
}

function checksumCodec(size: number): BuiltinCodec {
  return {
    encode: (buf, v) => buf.pushBytes(fixedHex(v, size)),
    decode: (buf) => bytesToHex(buf.getBytes(size))
  }
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 0 || v === 1) return v === 1
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return err('expected a boolean')
}

// ---------------------------------------------------------------- codec table

export const BUILTIN_CODECS: Record<string, BuiltinCodec> = {
  bool: {
    encode: (buf, v) => buf.push(toBool(v) ? 1 : 0),
    decode: (buf) => {
      const b = buf.get()
      if (b > 1) err('invalid bool byte')
      return b === 1
    }
  },
  int8: intCodec(8, true),
  uint8: intCodec(8, false),
  int16: intCodec(16, true),
  uint16: intCodec(16, false),
  int32: intCodec(32, true),
  uint32: intCodec(32, false),
  int64: intCodec(64, true),
  uint64: intCodec(64, false),
  int128: intCodec(128, true),
  uint128: intCodec(128, false),
  varuint32: {
    encode(buf, v) {
      const n = toBigInt(v)
      if (n < 0n || n > 0xffffffffn) err('value out of range for varuint32')
      buf.pushVaruint32(Number(n))
    },
    decode: (buf) => buf.getVaruint32()
  },
  varint32: {
    encode(buf, v) {
      const n = toBigInt(v)
      if (n < -0x80000000n || n > 0x7fffffffn) err('value out of range for varint32')
      buf.pushVarint32(Number(n))
    },
    decode: (buf) => buf.getVarint32()
  },
  float32: {
    encode(buf, v) {
      const x = toNumber(v)
      const f = Math.fround(x)
      if (Number.isFinite(x) && !Number.isFinite(f)) err('value out of range for float32')
      buf.pushFloat32(f)
    },
    decode(buf) {
      const x = buf.getFloat32()
      return nonFinite(x) ?? shortestFloat32(x)
    }
  },
  float64: {
    encode: (buf, v) => buf.pushFloat64(toNumber(v)),
    decode(buf) {
      const x = buf.getFloat64()
      return nonFinite(x) ?? x
    }
  },
  float128: checksumCodec(16),
  time_point: {
    encode(buf, v) {
      const t = parseIso(v)
      const us = BigInt(t.ms) * 1000n + BigInt(t.micros)
      if (us > TIME_POINT_MAX) err('time out of range')
      buf.pushBigInt(us, 8)
    },
    decode(buf) {
      const us = buf.getBigInt(8)
      let ms = us / 1000n
      let rem = us % 1000n
      if (rem < 0n) {
        rem += 1000n
        ms -= 1n
      }
      const base = isoOf(Number(ms))
      return rem === 0n ? base : base + String(rem).padStart(3, '0')
    }
  },
  time_point_sec: {
    encode(buf, v) {
      const t = parseIso(v)
      const sec = Math.floor(t.ms / 1000)
      if (sec > 0xffffffff) err('time out of range for time_point_sec')
      buf.pushUint32(sec)
    },
    decode: (buf) => isoOf(buf.getUint32() * 1000).slice(0, 19)
  },
  block_timestamp_type: {
    encode(buf, v) {
      const t = parseIso(v)
      const slot = Math.floor((t.ms - 946684800000) / 500)
      if (slot < 0 || slot > 0xffffffff) err('time out of range for block_timestamp_type')
      buf.pushUint32(slot)
    },
    decode: (buf) => isoOf(buf.getUint32() * 500 + 946684800000)
  },
  name: {
    encode(buf, v) {
      if (typeof v !== 'string') err('expected a name string')
      buf.pushBigInt(nameToUint64(v as string), 8)
    },
    decode: (buf) => uint64ToName(buf.getBigUint(8))
  },
  bytes: {
    encode(buf, v) {
      if (v instanceof Uint8Array) buf.pushVarBytes(v)
      else if (typeof v === 'string') buf.pushVarBytes(hexToBytes(v))
      else err('expected a hex string')
    },
    decode: (buf) => bytesToHex(buf.getVarBytes())
  },
  string: {
    encode(buf, v) {
      if (typeof v !== 'string') err('expected a string')
      buf.pushString(v as string)
    },
    decode: (buf) => buf.getString()
  },
  checksum160: checksumCodec(20),
  checksum256: checksumCodec(32),
  checksum512: checksumCodec(64),
  public_key: {
    encode(buf, v) {
      writePublicKey(buf, parsePublicKey(v as string))
    },
    decode(buf, opts) {
      const k = readPublicKey(buf)
      return publicKeyToString(k, opts.legacyKeys && k.type === 'K1' ? 'legacy' : 'new')
    }
  },
  private_key: {
    encode(buf, v) {
      writePrivateKey(buf, parsePrivateKey(v as string))
    },
    decode: (buf) => privateKeyToString(readPrivateKey(buf))
  },
  signature: {
    encode(buf, v) {
      writeSignature(buf, parseSignature(v as string))
    },
    decode: (buf) => signatureToString(readSignature(buf))
  },
  symbol: {
    encode(buf, v) {
      buf.pushBigInt(symbolToUint64(parseSymbol(v as string)), 8)
    },
    decode: (buf) => formatSymbol(uint64ToSymbol(buf.getBigUint(8)))
  },
  symbol_code: {
    encode(buf, v) {
      if (typeof v !== 'string') err('expected a symbol code string')
      buf.pushBigInt(symbolCodeToUint64(v as string), 8)
    },
    decode: (buf) => uint64ToSymbolCode(buf.getBigUint(8))
  },
  asset: {
    encode(buf, v) {
      const a = parseAsset(v as string)
      buf.pushBigInt(a.amount, 8)
      buf.pushBigInt(symbolToUint64(a.symbol), 8)
    },
    decode(buf) {
      const amount = buf.getBigInt(8)
      const symbol = uint64ToSymbol(buf.getBigUint(8))
      return formatAsset({ amount, symbol })
    }
  }
}

/** Names of the built-in primitive types. */
export const PRIMITIVE_TYPE_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILTIN_CODECS))
