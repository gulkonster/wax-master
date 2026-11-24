import { secp256k1 } from '@noble/curves/secp256k1.js'
import { ChainCoreError } from './errors'
import { bytesEqual } from './bytes'
import { parsePrivateKey, parsePublicKey, publicFromPrivate, type PrivateKey, type PublicKey, type Signature } from './keys'

const MAX_SIGN_ATTEMPTS = 1000

function isCanonicalHalf(x: Uint8Array, offset: number): boolean {
  const a = x[offset]
  const b = x[offset + 1]
  return !(a & 0x80) && !(a === 0 && !(b & 0x80))
}

/** Antelope canonical rule for a 65-byte compact signature (header, r, s). */
export function isCanonicalSignature(data: Uint8Array): boolean {
  return data.length === 65 && isCanonicalHalf(data, 1) && isCanonicalHalf(data, 33)
}

function toPrivateKey(key: PrivateKey | string): PrivateKey {
  return typeof key === 'string' ? parsePrivateKey(key) : key
}

function checkDigest(digest: Uint8Array): void {
  if (!(digest instanceof Uint8Array) || digest.length !== 32) throw new ChainCoreError('', 'digest must be 32 bytes')
}

/**
 * Signs a 32-byte digest with a K1 key. Output is canonical (low-S and the Antelope r/s rule);
 * when the deterministic signature is not canonical the signing is retried with a counter as
 * extra entropy. The public key is recovered from the result and compared before returning.
 */
export function signDigest(digest: Uint8Array, privateKey: PrivateKey | string): Signature {
  checkDigest(digest)
  const key = toPrivateKey(privateKey)
  if (key.type !== 'K1') throw new ChainCoreError('', `signing with ${key.type} keys is not supported`)
  const expected = publicFromPrivate(key)
  for (let counter = 0; counter <= MAX_SIGN_ATTEMPTS; counter++) {
    let extra: Uint8Array | boolean = false
    if (counter > 0) {
      extra = new Uint8Array(32)
      new DataView(extra.buffer).setUint32(0, counter, true)
    }
    const raw = secp256k1.sign(digest, key.data, { prehash: false, lowS: true, format: 'recovered', extraEntropy: extra })
    // noble returns [recovery, r, s]; Antelope stores recovery + 31 in the header byte.
    const data = new Uint8Array(65)
    data.set(raw)
    data[0] = raw[0] + 31
    if (!isCanonicalSignature(data)) continue
    const sig: Signature = { type: 'K1', data }
    const recovered = recoverPublicKey(digest, sig)
    if (!bytesEqual(recovered.data, expected.data)) throw new ChainCoreError('', 'signature self-check failed')
    return sig
  }
  throw new ChainCoreError('', 'could not produce a canonical signature')
}

/** Recovers the public key that signed `digest`. Only K1 signatures can be recovered. */
export function recoverPublicKey(digest: Uint8Array, signature: Signature): PublicKey {
  checkDigest(digest)
  if (signature.type !== 'K1') throw new ChainCoreError('', `recovering ${signature.type} signatures is not supported`)
  if (signature.data.length !== 65) throw new ChainCoreError('', 'invalid signature length')
  const header = signature.data[0]
  if (header < 27 || header > 34) throw new ChainCoreError('', 'invalid signature recovery byte')
  const raw = new Uint8Array(65)
  raw.set(signature.data)
  raw[0] = (header - 27) & 3
  try {
    return { type: 'K1', data: secp256k1.recoverPublicKey(raw, digest, { prehash: false }) }
  } catch {
    throw new ChainCoreError('', 'signature recovery failed')
  }
}

/** True when `signature` over `digest` was made by `publicKey` (K1 only). */
export function verifySignature(digest: Uint8Array, signature: Signature, publicKey: PublicKey | string): boolean {
  const pub = typeof publicKey === 'string' ? parsePublicKey(publicKey) : publicKey
  if (pub.type !== 'K1' || signature.type !== 'K1') return false
  try {
    return bytesEqual(recoverPublicKey(digest, signature).data, pub.data)
  } catch {
    return false
  }
}
