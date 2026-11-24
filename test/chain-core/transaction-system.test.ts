import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildAction,
  bytesToHex,
  decodeActionData,
  delegatebw,
  buyram,
  sellram,
  undelegatebw,
  refund,
  voteproducer,
  claimgenesis,
  powerup,
  generatePrivateKey,
  headerFromChainInfo,
  hexToBytes,
  newaccount,
  normalizeAuthority,
  packContextFreeData,
  packTransaction,
  publicFromPrivate,
  publicKeyToString,
  setabi,
  setcode,
  signingDigest,
  transactionId,
  transfer,
  unpackTransaction,
  updateauth,
  EOSIO_ABI,
  EOSIO_TOKEN_ABI,
  type AbiDef
} from '../../src/chain-core'

const sys = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'chain', 'system-abis.json'), 'utf8')) as { abi: Record<string, AbiDef> }
const key = (n: number): string => {
  const d = new Uint8Array(32)
  d[31] = n
  return publicKeyToString(publicFromPrivate({ type: 'K1', data: d }), 'legacy')
}

describe('transaction header from chain info', () => {
  const info = {
    chain_id: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
    head_block_time: '2026-11-23T23:48:41.500',
    last_irreversible_block_id: '1a2bf3bd8fb836eb38cd16ae89a767399012764c4c4a1d482dea000421a9a695',
    head_block_id: '1a2bf44ccc3d722c27eae31a90e7422688f72b3802894d9f52432f4afe8f9e3c'
  }
  it('uses the last irreversible block by default', () => {
    const h = headerFromChainInfo(info, 120)
    const id = Buffer.from(info.last_irreversible_block_id, 'hex')
    expect(h.ref_block_num).toBe(id.readUInt32BE(0) & 0xffff)
    expect(h.ref_block_num).toBe(0xf3bd)
    expect(h.ref_block_prefix).toBe(id.readUInt32LE(8))
    expect(h.expiration).toBe('2026-11-23T23:50:41')
    expect(h.max_net_usage_words).toBe(0)
    expect(h.delay_sec).toBe(0)
  })
  it('can use the head block, and accepts a block as input', () => {
    const h = headerFromChainInfo(info, 60, true)
    expect(h.ref_block_num).toBe(0xf44c)
    expect(h.ref_block_prefix).toBe(Buffer.from(info.head_block_id, 'hex').readUInt32LE(8))
    const blk = headerFromChainInfo({ id: '1a2bf263928ff38d0ee1848359260335bf35247bdee612ebdb3989b2ceb0b2f7', timestamp: '2026-11-23T23:45:06.000' }, 30)
    expect(blk.ref_block_num).toBe(0xf263)
    expect(blk.ref_block_prefix).toBe(0x8384e10e)
    expect(blk.expiration).toBe('2026-11-23T23:45:36')
  })
  it('rejects bad input', () => {
    expect(() => headerFromChainInfo(info, 0)).toThrow()
    expect(() => headerFromChainInfo({}, 10)).toThrow(/missing/)
    expect(() => headerFromChainInfo({ id: 'abcd', timestamp: '2026-01-01T00:00:00' }, 10)).toThrow(/32 bytes/)
    expect(() => headerFromChainInfo({ ...info, head_block_time: 'yesterday' }, 10)).toThrow(/invalid time/)
  })
  it('a header plus actions packs and unpacks', () => {
    const h = headerFromChainInfo(info, 120)
    const trx = { ...h, actions: [transfer({ from: 'alice', to: 'bob', quantity: '1.00000000 WAX' })] }
    const packed = packTransaction(trx)
    const back = unpackTransaction(bytesToHex(packed))
    expect(back).toEqual({ ...trx, context_free_actions: [], transaction_extensions: [] })
    expect(transactionId(packed)).toHaveLength(64)
  })
})

describe('signing digest', () => {
  const chainId = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'
  const packed = new Uint8Array([1, 2, 3])
  it('has 32 zero bytes where context free data would be', () => {
    const d = signingDigest(chainId, packed)
    expect(d).toHaveLength(32)
    const withZero = signingDigest(chainId, packed, new Uint8Array(0))
    expect(bytesToHex(withZero)).toBe(bytesToHex(d))
  })
  it('hashes context free data in', () => {
    const cfd = packContextFreeData([new Uint8Array([9, 9])])
    expect(bytesToHex(cfd)).toBe('010209' + '09')
    expect(bytesToHex(signingDigest(chainId, packed, cfd))).not.toBe(bytesToHex(signingDigest(chainId, packed)))
  })
  it('rejects a chain id that is not 32 bytes', () => {
    expect(() => signingDigest('abcd', packed)).toThrow(/32 bytes/)
  })
})

describe('system action helpers', () => {
  it('transfer defaults authorization to the sender active permission and validates the asset', () => {
    const a = transfer({ from: 'alice', to: 'bob', quantity: '1.0000 WAX' })
    expect(a.account).toBe('eosio.token')
    expect(a.authorization).toEqual([{ actor: 'alice', permission: 'active' }])
    expect(decodeActionData(EOSIO_TOKEN_ABI, a)).toEqual({ from: 'alice', to: 'bob', quantity: '1.0000 WAX', memo: '' })
    expect(() => transfer({ from: 'alice', to: 'bob', quantity: '1 wax' })).toThrow()
    expect(() => transfer({ from: 'Alice', to: 'bob', quantity: '1.0000 WAX' })).toThrow(/invalid character/)
    const custom = transfer({ from: 'a', to: 'b', quantity: '1.00 X', contract: 'mytoken', authorization: [{ actor: 'a', permission: 'owner' }] })
    expect(custom.account).toBe('mytoken')
    expect(custom.authorization[0].permission).toBe('owner')
  })

  it('setcode and setabi carry the raw bytes', () => {
    const code = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
    const c = setcode({ account: 'alice', code })
    expect(c.data.endsWith('08' + bytesToHex(code))).toBe(true)
    const abi = sys.abi['eosio.token']
    const s = setabi({ account: 'alice', abi })
    const decoded = decodeActionData(sys.abi.eosio, s) as { abi: string }
    expect(decoded.abi.length).toBeGreaterThan(100)
    const same = setabi({ account: 'alice', abi: hexToBytes(decoded.abi) })
    expect(same.data).toBe(s.data)
  })

  it('embedded ABIs describe the same structs as the on-chain ones', () => {
    const real = sys.abi.eosio
    for (const st of EOSIO_ABI.structs) {
      const r = real.structs.find((x) => x.name === st.name)
      expect(r, st.name).toBeTruthy()
      expect(st.fields).toEqual(r!.fields)
    }
    for (const st of EOSIO_TOKEN_ABI.structs) {
      expect(st.fields).toEqual(sys.abi['eosio.token'].structs.find((x) => x.name === st.name)!.fields)
    }
  })

  it('newaccount and delegatebw', () => {
    const owner = { threshold: 1, keys: [{ key: key(5), weight: 1 }] }
    const a = newaccount({ creator: 'alice', name: 'bobbob', owner, active: owner })
    expect(a.authorization[0].actor).toBe('alice')
    const d = delegatebw({ from: 'alice', receiver: 'bobbob', stakeNet: '1.00000000 WAX', stakeCpu: '1.00000000 WAX' })
    expect((decodeActionData(EOSIO_ABI, d) as { transfer: boolean }).transfer).toBe(false)
  })

  it('RAM, unstake, refund, vote and claim helpers default authorization and validate input', () => {
    expect(buyram({ payer: 'alice', receiver: 'bob', quant: '1.00000000 WAX' }).authorization).toEqual([{ actor: 'alice', permission: 'active' }])
    expect(() => buyram({ payer: 'alice', receiver: 'bob', quant: '1 wax' })).toThrow()
    expect(decodeActionData(EOSIO_ABI, sellram({ account: 'alice', bytes: 1024 }))).toEqual({ account: 'alice', bytes: '1024' })
    expect(() => sellram({ account: 'alice', bytes: 0 })).toThrow(/positive/)
    expect(() => sellram({ account: 'alice', bytes: 1.5 })).toThrow(/positive/)
    expect(() => undelegatebw({ from: 'alice', receiver: 'bob', unstakeNet: 'x', unstakeCpu: '1.00000000 WAX' })).toThrow()
    expect(refund({ owner: 'alice' }).authorization[0].actor).toBe('alice')
    const v = voteproducer({ voter: 'alice', producers: ['zzz', 'abc'] })
    expect((decodeActionData(EOSIO_ABI, v) as { producers: string[] }).producers).toEqual(['abc', 'zzz'])
    expect(() => voteproducer({ voter: 'alice', producers: ['abc', 'abc'] })).toThrow(/duplicate/)
    expect(() => voteproducer({ voter: 'alice', proxy: 'p', producers: ['abc'] })).toThrow(/not both/)
    expect(() => voteproducer({ voter: 'alice', producers: ['Bad'] })).toThrow()
    expect(claimgenesis({ claimer: 'alice' }).authorization[0].actor).toBe('alice')
    expect(() => powerup({ payer: 'a', receiver: 'b', days: 1, netFrac: 0, cpuFrac: 0, maxPayment: 'x' })).toThrow()
  })
})

describe('authority normalization', () => {
  it('sorts keys by bytes, accounts numerically, waits ascending', () => {
    const k = [key(9), key(2), key(7)]
    const a = normalizeAuthority({
      threshold: 2,
      keys: k.map((x) => ({ key: x, weight: 1 })),
      accounts: [
        { permission: { actor: 'b', permission: 'active' }, weight: 1 },
        { permission: { actor: 'a', permission: 'owner' }, weight: 1 },
        { permission: { actor: 'a', permission: 'active' }, weight: 1 }
      ],
      waits: [
        { wait_sec: 10, weight: 1 },
        { wait_sec: 2, weight: 1 }
      ]
    })
    expect(a.keys).toHaveLength(3)
    const order = a.keys.map((x) => x.key)
    const sortedByData = [...k].map((x) => publicKeyToString(parsePub(x))).sort((x, y) => (bytesOf(x) < bytesOf(y) ? -1 : 1))
    expect(order).toEqual(sortedByData)
    expect(a.accounts.map((x) => x.permission.actor + '@' + x.permission.permission)).toEqual(['a@active', 'a@owner', 'b@active'])
    expect(a.waits.map((w) => w.wait_sec)).toEqual([2, 10])
  })

  it('sorts accounts by the numeric name value, not by text', () => {
    // 'a1' < 'a.' as text is false but as numbers the dot sorts first
    const a = normalizeAuthority({
      threshold: 1,
      accounts: [
        { permission: { actor: 'a1', permission: 'active' }, weight: 1 },
        { permission: { actor: 'a.b', permission: 'active' }, weight: 1 }
      ]
    })
    expect(a.accounts.map((x) => x.permission.actor)).toEqual(['a.b', 'a1'])
  })

  it('rejects duplicates, unreachable thresholds and bad weights', () => {
    const k = key(3)
    expect(() => normalizeAuthority({ threshold: 1, keys: [{ key: k, weight: 1 }, { key: k, weight: 1 }] })).toThrow(/duplicate key/)
    expect(() => normalizeAuthority({ threshold: 3, keys: [{ key: k, weight: 1 }] })).toThrow(/less than the threshold/)
    expect(() => normalizeAuthority({ threshold: 1, keys: [{ key: k, weight: 70000 }] })).toThrow(/weight/)
    expect(() => normalizeAuthority({ threshold: -1 })).toThrow(/threshold/)
    expect(() => normalizeAuthority({ threshold: 1, accounts: [{ permission: { actor: 'a', permission: 'x' }, weight: 1 }, { permission: { actor: 'a', permission: 'x' }, weight: 1 }] })).toThrow(/duplicate/)
    expect(() => normalizeAuthority({ threshold: 1, waits: [{ wait_sec: 1, weight: 1 }, { wait_sec: 1, weight: 1 }] })).toThrow(/duplicate wait/)
    expect(() => normalizeAuthority({ threshold: 1, accounts: [{ permission: { actor: 'BAD', permission: 'active' }, weight: 1 }] })).toThrow()
  })

  it('an empty authority with threshold 0 is allowed; with threshold 1 it is not', () => {
    expect(normalizeAuthority({ threshold: 0 })).toEqual({ threshold: 0, keys: [], accounts: [], waits: [] })
    expect(() => normalizeAuthority({ threshold: 1 })).toThrow()
  })

  it('updateauth rejects a non reachable authority before building the action', () => {
    const priv = generatePrivateKey()
    const pub = publicKeyToString(publicFromPrivate(priv))
    expect(() => updateauth({ account: 'a', permission: 'p', parent: 'active', auth: { threshold: 2, keys: [{ key: pub, weight: 1 }] } })).toThrow()
    expect(buildAction(EOSIO_TOKEN_ABI, 'eosio.token', 'transfer', [], { from: 'a', to: 'b', quantity: '1 X', memo: '' }).data).toHaveLength(2 * (8 + 8 + 16 + 1))
  })
})

function parsePub(s: string): { type: 'K1'; data: Uint8Array } {
  // helper: key strings in this file are legacy K1 keys
  return { type: 'K1', data: hexToBytes(hexOf(s)) }
}
function hexOf(legacy: string): string {
  // base58 payload of EOS keys is 33 bytes of key data followed by a 4 byte checksum
  return Buffer.from(base58(legacy.slice(3)).subarray(0, 33)).toString('hex')
}
function bytesOf(newForm: string): string {
  return hexOf2(newForm)
}
function hexOf2(newForm: string): string {
  return Buffer.from(base58(newForm.slice(7)).subarray(0, 33)).toString('hex')
}
function base58(s: string): Uint8Array {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let x = 0n
  for (const c of s) x = x * 58n + BigInt(A.indexOf(c))
  const out: number[] = []
  while (x > 0n) {
    out.unshift(Number(x & 0xffn))
    x >>= 8n
  }
  return Uint8Array.from(out)
}
