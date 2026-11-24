import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { PrivateKey as EjsPrivateKey, PublicKey as EjsPublicKey, generateKeyPair } from 'eosjs/dist/eosjs-key-conversions'
import { KeyType } from 'eosjs/dist/eosjs-numeric'
import {
  base58Decode,
  bytesToHex,
  convertPublicKey,
  generatePrivateKey,
  hexToBytes,
  isCanonicalSignature,
  parsePrivateKey,
  parsePublicKey,
  parseSignature,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  signDigest,
  signatureToString,
  verifySignature,
  type PublicKey,
  type Signature
} from '../../src/chain-core'

const WIF = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
const LEGACY = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
const digestOf = (s: string): Uint8Array => sha256(new TextEncoder().encode(s))

describe('key formats', () => {
  it('WIF, PVT_K1 and public key forms for the same key', () => {
    const priv = parsePrivateKey(WIF)
    expect(priv.type).toBe('K1')
    expect(privateKeyToString(priv, 'wif')).toBe(WIF)
    const pvt = privateKeyToString(priv, 'new')
    expect(pvt.startsWith('PVT_K1_')).toBe(true)
    expect(parsePrivateKey(pvt).data).toEqual(priv.data)
    const pub = publicFromPrivate(priv)
    expect(publicKeyToString(pub, 'legacy')).toBe(LEGACY)
    const modern = publicKeyToString(pub)
    expect(modern.startsWith('PUB_K1_')).toBe(true)
    expect(convertPublicKey(LEGACY, 'new')).toBe(modern)
    expect(convertPublicKey(modern, 'legacy')).toBe(LEGACY)
    expect(parsePublicKey(modern)).toEqual(parsePublicKey(LEGACY))
    // eosjs agrees on all conversions
    expect(EjsPrivateKey.fromString(WIF).toString()).toBe(pvt)
    expect(EjsPublicKey.fromString(LEGACY).toString()).toBe(modern)
    expect(EjsPrivateKey.fromString(pvt).getPublicKey().toString()).toBe(modern)
  })

  it('rejects damaged keys', () => {
    const bad = [
      'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CW',
      'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5C',
      'EOS',
      '',
      'PUB_K1_',
      'PUB_X9_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq63',
      'EOS0MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    ]
    for (const k of bad) expect(() => parsePublicKey(k), k).toThrow()
    for (const k of [WIF.slice(0, -1) + '4', WIF.slice(1), '', 'PVT_K1_abc', '5' + '1'.repeat(50)]) {
      expect(() => parsePrivateKey(k), k).toThrow()
    }
  })

  it('rejects points that are not on the curve and out of range scalars', () => {
    const offCurve = privateKeyToString({ type: 'K1', data: new Uint8Array(32).fill(1) }) // valid private key
    expect(offCurve).toMatch(/^PVT_K1_/)
    const fake: PublicKey = { type: 'K1', data: hexToBytes('02' + 'ff'.repeat(32)) }
    expect(() => parsePublicKey(publicKeyToString(fake))).toThrow(/not a valid/)
    expect(() => privateKeyToString({ type: 'K1', data: new Uint8Array(32) })).not.toThrow()
    expect(() => parsePrivateKey(privateKeyToString({ type: 'K1', data: new Uint8Array(32) }))).toThrow(/out of range/)
    expect(() => parsePrivateKey(privateKeyToString({ type: 'K1', data: new Uint8Array(32).fill(255) }))).toThrow(/out of range/)
  })

  it('R1 and WA public keys parse and print, but cannot sign', () => {
    const pair = generateKeyPair(KeyType.r1, { secureEnv: true })
    const r1pvt = pair.privateKey.toString()
    const r1pub = pair.publicKey.toString()
    expect(r1pub.startsWith('PUB_R1_')).toBe(true)
    const parsed = parsePublicKey(r1pub)
    expect(parsed.type).toBe('R1')
    expect(publicKeyToString(parsed)).toBe(r1pub)
    expect(() => publicKeyToString(parsed, 'legacy')).toThrow()
    const rpriv = parsePrivateKey(r1pvt)
    expect(rpriv.type).toBe('R1')
    expect(privateKeyToString(rpriv)).toBe(r1pvt)
    expect(() => signDigest(digestOf('x'), rpriv)).toThrow(/not supported/)
    expect(() => publicFromPrivate(rpriv)).toThrow()
    // webauthn key: 33 byte point, user presence, rpid
    const wa: PublicKey = { type: 'WA', data: hexToBytes('02' + '11'.repeat(32) + '01' + '0b' + Buffer.from('example.com').toString('hex')) }
    const waStr = publicKeyToString(wa)
    expect(waStr.startsWith('PUB_WA_')).toBe(true)
    expect(parsePublicKey(waStr)).toEqual(wa)
  })

  it('generated keys are valid, distinct and sign', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const k = generatePrivateKey()
      const wif = privateKeyToString(k, 'wif')
      expect(wif).toMatch(/^5[1-9A-HJ-NP-Za-km-z]{50}$/)
      expect(parsePrivateKey(wif).data).toEqual(k.data)
      seen.add(wif)
      const pub = publicFromPrivate(k)
      expect(verifySignature(digestOf('m'), signDigest(digestOf('m'), k), pub)).toBe(true)
    }
    expect(seen.size).toBe(20)
  })

  it('base58 of a WIF has the 0x80 version byte', () => {
    expect(base58Decode(WIF)[0]).toBe(0x80)
  })
})

describe('signatures', () => {
  it('known test vector key signs canonically and recovers', () => {
    for (let i = 0; i < 100; i++) {
      const d = digestOf('msg' + i)
      const sig = signDigest(d, WIF)
      expect(sig.type).toBe('K1')
      expect(sig.data).toHaveLength(65)
      expect(sig.data[0]).toBeGreaterThanOrEqual(31)
      expect(sig.data[0]).toBeLessThanOrEqual(34)
      expect(isCanonicalSignature(sig.data)).toBe(true)
      expect(publicKeyToString(recoverPublicKey(d, sig), 'legacy')).toBe(LEGACY)
      expect(verifySignature(d, sig, LEGACY)).toBe(true)
      expect(verifySignature(digestOf('other' + i), sig, LEGACY)).toBe(false)
    }
  })

  it('string form: SIG_K1_ with checksum, parse round trip, damage detection', () => {
    const sig = signDigest(digestOf('a'), WIF)
    const s = signatureToString(sig)
    expect(s.startsWith('SIG_K1_')).toBe(true)
    expect(parseSignature(s)).toEqual(sig)
    const flipped = s.slice(0, -1) + (s.endsWith('1') ? '2' : '1')
    expect(() => parseSignature(flipped)).toThrow(/checksum/)
    expect(() => parseSignature('SIG_K1_abc')).toThrow()
    expect(() => parseSignature('nope')).toThrow(/unrecognized/)
  })

  it('canonical rule', () => {
    const mk = (r0: number, r1: number, s0: number, s1: number): Uint8Array => {
      const d = new Uint8Array(65)
      d[0] = 31
      d[1] = r0
      d[2] = r1
      d[33] = s0
      d[34] = s1
      return d
    }
    expect(isCanonicalSignature(mk(0x7f, 0, 0x7f, 0))).toBe(true)
    expect(isCanonicalSignature(mk(0x80, 0, 0x7f, 0))).toBe(false)
    expect(isCanonicalSignature(mk(0x7f, 0, 0x80, 0))).toBe(false)
    expect(isCanonicalSignature(mk(0, 0x80, 0x7f, 0))).toBe(true)
    expect(isCanonicalSignature(mk(0, 0x7f, 0x7f, 0))).toBe(false)
    expect(isCanonicalSignature(mk(0x7f, 0, 0, 0x7f))).toBe(false)
    expect(isCanonicalSignature(new Uint8Array(64))).toBe(false)
  })

  it('refuses bad inputs', () => {
    expect(() => signDigest(new Uint8Array(31), WIF)).toThrow(/32 bytes/)
    expect(() => recoverPublicKey(new Uint8Array(32), { type: 'K1', data: new Uint8Array(64) })).toThrow()
    const sig = signDigest(digestOf('x'), WIF)
    const badHeader: Signature = { type: 'K1', data: Uint8Array.from(sig.data) }
    badHeader.data[0] = 40
    expect(() => recoverPublicKey(digestOf('x'), badHeader)).toThrow(/recovery byte/)
    expect(() => recoverPublicKey(digestOf('x'), { type: 'R1', data: sig.data })).toThrow(/not supported/)
    expect(verifySignature(digestOf('x'), { type: 'R1', data: sig.data }, LEGACY)).toBe(false)
    const zero: Signature = { type: 'K1', data: new Uint8Array(65) }
    zero.data[0] = 31
    expect(() => recoverPublicKey(digestOf('x'), zero)).toThrow(/recovery failed/)
    expect(bytesToHex(sig.data)).toHaveLength(130)
  })

  it('the same digest and key always give the same signature', () => {
    const d = digestOf('stable')
    expect(signatureToString(signDigest(d, WIF))).toBe(signatureToString(signDigest(d, WIF)))
  })
})
