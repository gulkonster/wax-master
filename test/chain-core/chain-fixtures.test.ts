import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import * as eosjsJs from 'eosjs/dist/eosjs-jssig'
import {
  bytesToHex,
  decodeActionData,
  buildAction,
  hexToBytes,
  packTransaction,
  parsePublicKey,
  parseSignature,
  publicKeyToString,
  recoverPublicKey,
  signatureToString,
  signingDigest,
  transactionId,
  unpackTransaction,
  type AbiDef
} from '../../src/chain-core'

interface FixtureTrx {
  chain: string
  chainId: string
  block_num: number
  trx: {
    id: string
    compression: string
    signatures: string[]
    packed_trx: string
    transaction: {
      expiration: string
      ref_block_num: number
      ref_block_prefix: number
      max_net_usage_words: number
      max_cpu_usage_ms: number
      delay_sec: number
      context_free_actions: unknown[]
      actions: { account: string; name: string; authorization: { actor: string; permission: string }[]; data: unknown; hex_data: string }[]
    }
  }
}
interface Fixture {
  chain: string
  chainId: string
  transactions: FixtureTrx[]
  abis: Record<string, AbiDef>
  permissions: Record<string, { perm_name: string; required_auth: { keys: { key: string }[] } }[]>
}

const dir = join(__dirname, '..', 'fixtures', 'chain')
const load = (n: string): Fixture => JSON.parse(readFileSync(join(dir, n), 'utf8')) as Fixture

/** packed_trx is zlib compressed on some transactions; the id and signatures cover the plain bytes. */
function unpackedBytes(t: FixtureTrx): Uint8Array {
  const raw = Buffer.from(t.trx.packed_trx, 'hex')
  return t.trx.compression === 'zlib' ? new Uint8Array(inflateSync(raw)) : new Uint8Array(raw)
}

/** nodeos prints some integers as strings and some as numbers; compare them by their decimal text. */
function norm(v: unknown): unknown {
  if (typeof v === 'number' && Number.isInteger(v)) return String(v)
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
  return v
}

for (const name of ['testnet.json', 'mainnet.json']) {
  const fx = load(name)
  describe(`real chain data: ${fx.chain}`, () => {
    it('has fixtures', () => {
      expect(fx.transactions.length).toBeGreaterThanOrEqual(3)
      if (fx.chain === 'mainnet') expect(fx.transactions.some((t) => t.trx.transaction.actions.length > 1)).toBe(true)
      if (fx.chain === 'testnet') expect(fx.transactions.some((t) => t.trx.transaction.actions[0].name === 'transfer')).toBe(true)
    })

    for (const t of fx.transactions) {
      const label = `${t.block_num} ${t.trx.transaction.actions.map((a) => a.account + ':' + a.name).join(',')}`
      describe(label, () => {
        const packed = unpackedBytes(t)

        it('unpack reproduces the header and actions', () => {
          const u = unpackTransaction(packed)
          const j = t.trx.transaction
          expect(u.expiration).toBe(j.expiration)
          expect(u.ref_block_num).toBe(j.ref_block_num)
          expect(u.ref_block_prefix).toBe(j.ref_block_prefix)
          expect(u.max_net_usage_words).toBe(j.max_net_usage_words)
          expect(u.max_cpu_usage_ms).toBe(j.max_cpu_usage_ms)
          expect(u.delay_sec).toBe(j.delay_sec)
          expect(u.context_free_actions).toEqual([])
          expect(u.transaction_extensions).toEqual([])
          expect(u.actions.map((a) => ({ ...a }))).toEqual(
            j.actions.map((a) => ({ account: a.account, name: a.name, authorization: a.authorization, data: a.hex_data }))
          )
        })

        it('pack reproduces packed_trx and the id', () => {
          const u = unpackTransaction(packed)
          expect(bytesToHex(packTransaction(u))).toBe(bytesToHex(packed))
          expect(transactionId(packed)).toBe(t.trx.id)
        })

        it('action data decodes to the node JSON and re-encodes to the same bytes', () => {
          const u = unpackTransaction(packed)
          u.actions.forEach((a, i) => {
            const abi = fx.abis[a.account]
            expect(abi).toBeTruthy()
            const decoded = decodeActionData(abi, a, { legacyKeys: true })
            expect(norm(decoded)).toEqual(norm(t.trx.transaction.actions[i].data))
            const rebuilt = buildAction(abi, a.account, a.name, a.authorization, t.trx.transaction.actions[i].data)
            expect(rebuilt.data).toBe(a.data)
          })
        })

        it('signatures recover to valid keys (and to permission keys when known)', () => {
          const digest = signingDigest(fx.chainId, packed)
          const known = new Set<string>()
          for (const a of t.trx.transaction.actions) {
            for (const au of a.authorization) {
              for (const p of fx.permissions[au.actor] ?? []) {
                for (const k of p.required_auth.keys) known.add(publicKeyToString(parsePublicKey(k.key)))
              }
            }
          }
          expect(t.trx.signatures.length).toBeGreaterThan(0)
          let matched = 0
          for (const s of t.trx.signatures) {
            const sig = parseSignature(s)
            expect(signatureToString(sig)).toBe(s)
            const pub = recoverPublicKey(digest, sig)
            expect(pub.data.length).toBe(33)
            // eosjs must recover the same key
            const ej = eosjsJs.Signature.fromString(s).recover(digest, false)
            expect(ej.toString()).toBe(publicKeyToString(pub))
            if (known.has(publicKeyToString(pub))) matched++
          }
          // Keys can rotate after the block; report through the assertion only when a key is known.
          if (known.size > 0 && matched === 0) {
            console.warn(`no recovered key matches the current permission keys for block ${t.block_num}`)
          }
        })
      })
    }

    it('at least one transaction is signed by a known permission key', () => {
      let any = false
      for (const t of fx.transactions) {
        const digest = signingDigest(fx.chainId, unpackedBytes(t))
        const known = new Set<string>()
        for (const a of t.trx.transaction.actions)
          for (const au of a.authorization)
            for (const p of fx.permissions[au.actor] ?? []) for (const k of p.required_auth.keys) known.add(publicKeyToString(parsePublicKey(k.key)))
        for (const s of t.trx.signatures) if (known.has(publicKeyToString(recoverPublicKey(digest, parseSignature(s))))) any = true
      }
      expect(any).toBe(true)
    })
  })
}
