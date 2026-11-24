import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { ChainCoreError } from './errors'
import { bytesEqual, concatBytes, utf8Encode, type SerialBuffer } from './bytes'

export type KeyType = 'K1' | 'R1' | 'WA'

/** Binary type tags used by the Antelope key variants. */
const TYPE_TAG: Record<KeyType, number> = { K1: 0, R1: 1, WA: 2 }
const TAG_TYPE: KeyType[] = ['K1', 'R1', 'WA']

/**
 * Public key. For K1 and R1 `data` is the 33-byte compressed point. For WA it is the serialized
 * webauthn key: 33-byte point, 1 byte user presence, then the length-prefixed rpid.
 */
export interface PublicKey {
  type: KeyType
  data: Uint8Array
}

/** Private key: 32-byte big-endian scalar. Only K1 can sign. */
export interface PrivateKey {
  type: 'K1' | 'R1'
  data: Uint8Array
}

/**
 * Signature. For K1 and R1 `data` is 65 bytes: header byte (recovery id + 31), r, s.
 * For WA it is the serialized webauthn signature.
 */
export interface Signature {
  type: KeyType
  data: Uint8Array
}

// ---------------------------------------------------------------- base58

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B58_INDEX = new Map<string, number>()
for (let i = 0; i < B58.length; i++) B58_INDEX.set(B58[i], i)

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  // little-endian base-58 digits
  const digits: number[] = []
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256
      digits[j] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let out = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]]
  return out
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0
  while (zeros < s.length && s[zeros] === '1') zeros++
  const bytes: number[] = []
  for (let i = zeros; i < s.length; i++) {
    const v = B58_INDEX.get(s[i])
    if (v === undefined) throw new ChainCoreError('', `invalid base58 character "${s[i]}"`)
    let carry = v
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  const out = new Uint8Array(zeros + bytes.length)
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]
  return out
}

// ---------------------------------------------------------------- checksums

function ripemdChecksum(data: Uint8Array, suffix: string): Uint8Array {
  return ripemd160(suffix ? concatBytes(data, utf8Encode(suffix)) : data).slice(0, 4)
}

/** base58(data + checksum4) where checksum = ripemd160(data + suffix)[0..4]. */
function encodeWithChecksum(data: Uint8Array, suffix: string): string {
  return base58Encode(concatBytes(data, ripemdChecksum(data, suffix)))
}

/** Decodes base58 and verifies the ripemd160 checksum. `size` of 0 means variable length. */
function decodeWithChecksum(s: string, suffix: string, size: number, what: string): Uint8Array {
  const whole = base58Decode(s)
  if (whole.length < 5 || (size > 0 && whole.length !== size + 4)) throw new ChainCoreError('', `invalid ${what} length`)
  const data = whole.slice(0, whole.length - 4)
  const check = whole.slice(whole.length - 4)
  if (!bytesEqual(check, ripemdChecksum(data, suffix))) throw new ChainCoreError('', `${what} checksum mismatch`)
  return data
}

// ---------------------------------------------------------------- public keys

const WA_PREFIX = 'PUB_WA_'

function checkK1Point(data: Uint8Array): void {
  try {
    secp256k1.Point.fromBytes(data)
  } catch {
    throw new ChainCoreError('', 'public key is not a valid secp256k1 point')
  }
}

export function parsePublicKey(s: string): PublicKey {
  if (typeof s !== 'string') throw new ChainCoreError('', 'public key must be a string')
  if (s.startsWith('PUB_K1_')) {
    const data = decodeWithChecksum(s.slice(7), 'K1', 33, 'public key')
    checkK1Point(data)
    return { type: 'K1', data }
  }
  if (s.startsWith('PUB_R1_')) {
    return { type: 'R1', data: decodeWithChecksum(s.slice(7), 'R1', 33, 'public key') }
  }
  if (s.startsWith(WA_PREFIX)) {
    const data = decodeWithChecksum(s.slice(WA_PREFIX.length), 'WA', 0, 'public key')
    if (data.length < 35) throw new ChainCoreError('', 'invalid webauthn public key')
    return { type: 'WA', data }
  }
  if (s.startsWith('EOS')) {
    const data = decodeWithChecksum(s.slice(3), '', 33, 'public key')
    checkK1Point(data)
    return { type: 'K1', data }
  }
  throw new ChainCoreError('', 'unrecognized public key format')
}

/** `format` 'legacy' gives `EOS...` (K1 only); 'new' gives `PUB_<type>_...`. */
export function publicKeyToString(key: PublicKey, format: 'new' | 'legacy' = 'new'): string {
  if (format === 'legacy') {
    if (key.type !== 'K1') throw new ChainCoreError('', 'only K1 public keys have a legacy format')
    return 'EOS' + encodeWithChecksum(key.data, '')
  }
  return `PUB_${key.type}_` + encodeWithChecksum(key.data, key.type)
}

/** Converts `EOS...` or `PUB_K1_...` to the requested format; other types are returned in the new format. */
export function convertPublicKey(s: string, format: 'new' | 'legacy'): string {
  const key = parsePublicKey(s)
  return publicKeyToString(key, key.type === 'K1' ? format : 'new')
}

/** Binary form: type tag followed by the key data. */
export function writePublicKey(buf: SerialBuffer, key: PublicKey): void {
  buf.push(TYPE_TAG[key.type])
  buf.pushBytes(key.data)
}

export function readPublicKey(buf: SerialBuffer): PublicKey {
  const tag = buf.get()
  const type = TAG_TYPE[tag]
  if (!type) throw new ChainCoreError('', `unknown public key type ${tag}`)
  if (type === 'WA') {
    const start = buf.readPos
    buf.skip(34)
    buf.skip(buf.getVaruint32())
    const len = buf.readPos - start
    buf.readPos = start
    return { type, data: buf.getBytes(len) }
  }
  return { type, data: buf.getBytes(33) }
}

// ---------------------------------------------------------------- private keys

const N = secp256k1.Point.Fn.ORDER

function checkScalar(data: Uint8Array): void {
  let x = 0n
  for (const b of data) x = (x << 8n) | BigInt(b)
  if (x <= 0n || x >= N) throw new ChainCoreError('', 'private key is out of range')
}

function sha256d(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

export function parsePrivateKey(s: string): PrivateKey {
  if (typeof s !== 'string') throw new ChainCoreError('', 'private key must be a string')
  if (s.startsWith('PVT_K1_')) {
    const data = decodeWithChecksum(s.slice(7), 'K1', 32, 'private key')
    checkScalar(data)
    return { type: 'K1', data }
  }
  if (s.startsWith('PVT_R1_')) {
    const data = decodeWithChecksum(s.slice(7), 'R1', 32, 'private key')
    checkScalar(data)
    return { type: 'R1', data }
  }
  // WIF: version 0x80 + 32 bytes + sha256d checksum
  const whole = base58Decode(s)
  if (whole.length !== 37 || whole[0] !== 0x80) throw new ChainCoreError('', 'unrecognized private key format')
  const body = whole.slice(0, 33)
  if (!bytesEqual(whole.slice(33), sha256d(body).slice(0, 4))) throw new ChainCoreError('', 'private key checksum mismatch')
  const data = body.slice(1)
  checkScalar(data)
  return { type: 'K1', data }
}

/** `format` 'wif' gives the legacy `5...` form (K1 only); 'new' gives `PVT_<type>_...`. */
export function privateKeyToString(key: PrivateKey, format: 'new' | 'wif' = 'new'): string {
  if (format === 'wif') {
    if (key.type !== 'K1') throw new ChainCoreError('', 'only K1 private keys have a WIF form')
    const body = concatBytes(new Uint8Array([0x80]), key.data)
    return base58Encode(concatBytes(body, sha256d(body).slice(0, 4)))
  }
  return `PVT_${key.type}_` + encodeWithChecksum(key.data, key.type)
}

export function writePrivateKey(buf: SerialBuffer, key: PrivateKey): void {
  buf.push(TYPE_TAG[key.type])
  buf.pushBytes(key.data)
}

export function readPrivateKey(buf: SerialBuffer): PrivateKey {
  const tag = buf.get()
  if (tag !== 0 && tag !== 1) throw new ChainCoreError('', `unknown private key type ${tag}`)
  return { type: TAG_TYPE[tag] as 'K1' | 'R1', data: buf.getBytes(32) }
}

/** Generates a K1 private key from the platform secure random source. */
export function generatePrivateKey(): PrivateKey {
  for (;;) {
    const data = new Uint8Array(32)
    crypto.getRandomValues(data)
    let x = 0n
    for (const b of data) x = (x << 8n) | BigInt(b)
    if (x > 0n && x < N) return { type: 'K1', data }
  }
}

export function publicFromPrivate(key: PrivateKey): PublicKey {
  if (key.type !== 'K1') throw new ChainCoreError('', 'only K1 keys are supported')
  return { type: 'K1', data: secp256k1.getPublicKey(key.data, true) }
}

// ---------------------------------------------------------------- signatures

export function parseSignature(s: string): Signature {
  if (typeof s !== 'string') throw new ChainCoreError('', 'signature must be a string')
  if (s.startsWith('SIG_K1_')) return { type: 'K1', data: decodeWithChecksum(s.slice(7), 'K1', 65, 'signature') }
  if (s.startsWith('SIG_R1_')) return { type: 'R1', data: decodeWithChecksum(s.slice(7), 'R1', 65, 'signature') }
  if (s.startsWith('SIG_WA_')) {
    const data = decodeWithChecksum(s.slice(7), 'WA', 0, 'signature')
    if (data.length < 67) throw new ChainCoreError('', 'invalid webauthn signature')
    return { type: 'WA', data }
  }
  throw new ChainCoreError('', 'unrecognized signature format')
}

export function signatureToString(sig: Signature): string {
  return `SIG_${sig.type}_` + encodeWithChecksum(sig.data, sig.type)
}

export function writeSignature(buf: SerialBuffer, sig: Signature): void {
  buf.push(TYPE_TAG[sig.type])
  buf.pushBytes(sig.data)
}

export function readSignature(buf: SerialBuffer): Signature {
  const tag = buf.get()
  const type = TAG_TYPE[tag]
  if (!type) throw new ChainCoreError('', `unknown signature type ${tag}`)
  if (type === 'WA') {
    const start = buf.readPos
    buf.skip(65)
    buf.skip(buf.getVaruint32())
    buf.skip(buf.getVaruint32())
    const len = buf.readPos - start
    buf.readPos = start
    return { type, data: buf.getBytes(len) }
  }
  return { type, data: buf.getBytes(65) }
}
