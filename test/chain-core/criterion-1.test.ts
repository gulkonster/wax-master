/*
 * Release gate: the chain core must produce byte-identical results to eosjs for the
 * transactions the studio builds, decode what eosjs produces, and agree on signatures.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import * as ser from 'eosjs/dist/eosjs-serialize'
import { JsSignatureProvider, Signature as EjsSignature } from 'eosjs/dist/eosjs-jssig'
import { PrivateKey as EjsPrivateKey } from 'eosjs/dist/eosjs-key-conversions'
import {
  abiToBinary,
  bytesToHex,
  decodeActionData,
  decodeType,
  encodeType,
  generatePrivateKey,
  hexToBytes,
  packTransaction,
  parsePrivateKey,
  parsePublicKey,
  parseSignature,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  setabi,
  setcode,
  signDigest,
  isCanonicalSignature,
  signatureToString,
  signingDigest,
  transactionId,
  unpackTransaction,
  transfer,
  updateauth,
  newaccount,
  buyrambytes,
  delegatebw,
  buyram,
  sellram,
  undelegatebw,
  refund,
  voteproducer,
  voterclaim,
  claimgbmvote,
  claimgenesis,
  powerup,
  bidname,
  bidrefund,
  deleteauth,
  linkauth,
  unlinkauth,
  type AbiDef,
  type Action,
  type Transaction
} from '../../src/chain-core'
import { ejsApi, ejsContract, ejsDecode, ejsEncode, normTimes } from './eosjs-helpers'

const fixtures = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'chain', 'system-abis.json'), 'utf8')) as {
  raw: Record<string, string>
  abi: Record<string, AbiDef>
}
const EOSIO = fixtures.abi.eosio
const TOKEN = fixtures.abi['eosio.token']

// Well-known public test vector (never holds funds).
const TEST_WIF = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
const TEST_PUB_LEGACY = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
const keyFromScalar = (n: number, format: 'legacy' | 'new'): string => {
  const d = new Uint8Array(32)
  d[31] = n
  return publicKeyToString(publicFromPrivate({ type: 'K1', data: d }), format)
}
const KEY_B = keyFromScalar(2, 'legacy')
const KEY_C = keyFromScalar(3, 'new')

const CHAIN_ID = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'

/** wasm module with one function, one export and a body. */
const WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x07, 0x05, 0x01, 0x01, 0x61, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b
])

/** A realistic contract ABI: structs, base, alias, optional, array, variant and binary extensions. */
const CONTRACT_ABI: AbiDef = {
  version: 'eosio::abi/1.2',
  types: [{ new_type_name: 'account_name', type: 'name' }],
  structs: [
    { name: 'base_row', base: '', fields: [{ name: 'id', type: 'uint64' }] },
    {
      name: 'item',
      base: 'base_row',
      fields: [
        { name: 'owner', type: 'account_name' },
        { name: 'price', type: 'asset' },
        { name: 'tags', type: 'string[]' },
        { name: 'note', type: 'string?' },
        { name: 'ratio', type: 'float64' },
        { name: 'created', type: 'time_point_sec' },
        { name: 'extra', type: 'uint32$' }
      ]
    },
    { name: 'put', base: '', fields: [{ name: 'item', type: 'item' }] }
  ],
  actions: [{ name: 'put', type: 'put', ricardian_contract: '' }],
  tables: [{ name: 'items', index_type: 'i64', key_names: [], key_types: [], type: 'item' }],
  ricardian_clauses: [],
  error_messages: [],
  abi_extensions: [],
  variants: [{ name: 'either', types: ['uint32', 'string'] }],
  action_results: [{ name: 'put', result_type: 'uint32' }]
}

function ours(a: Action): { account: string; name: string; authorization: Action['authorization']; data: string } {
  return { account: a.account, name: a.name, authorization: a.authorization, data: a.data }
}

/** Checks one action against eosjs in both directions and returns it. */
function crossCheck(action: Action, abi: AbiDef, json: unknown): Action {
  const theirs = ejsEncode(abi, action.account, action.name, json)
  expect(action.data).toBe(theirs)
  expect(normTimes(decodeActionData(abi, action))).toEqual(normTimes(ejsDecode(abi, action.account, action.name, theirs)))
  expect(normTimes(ejsDecode(abi, action.account, action.name, action.data))).toEqual(normTimes(decodeActionData(abi, action)))
  return action
}

describe('criterion 1: action data matches eosjs', () => {
  it('transfer', () => {
    const a = transfer({ from: 'alice', to: 'bob.wam', quantity: '1.00000000 WAX', memo: 'hello é ✓' })
    crossCheck(a, TOKEN, { from: 'alice', to: 'bob.wam', quantity: '1.00000000 WAX', memo: 'hello é ✓' })
    expect(ours(a).authorization).toEqual([{ actor: 'alice', permission: 'active' }])
  })

  it('transfer with extremes: empty memo, zero and negative quantity, precision 0', () => {
    for (const q of ['0.00000000 WAX', '-0.00000001 WAX', '4611686018427387903 TKN', '0.1 A', '4.611686018427387903 ZZZZZZZ']) {
      const a = transfer({ from: 'a', to: 'b', quantity: q, memo: '' })
      crossCheck(a, TOKEN, { from: 'a', to: 'b', quantity: q, memo: '' })
    }
  })

  it('setcode and setabi', () => {
    const c = setcode({ account: 'mycontract', code: WASM })
    crossCheck(c, EOSIO, { account: 'mycontract', vmtype: 0, vmversion: 0, code: bytesToHex(WASM) })
    const abiBytes = abiToBinary(CONTRACT_ABI)
    const s = setabi({ account: 'mycontract', abi: CONTRACT_ABI })
    crossCheck(s, EOSIO, { account: 'mycontract', abi: bytesToHex(abiBytes) })
    // the ABI serialization itself equals eosjs
    const abiTypes = ejsApi().abiTypes
    const buf = new ser.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder() })
    abiTypes.get('abi_def')!.serialize(buf, CONTRACT_ABI)
    expect(bytesToHex(abiBytes)).toBe(bytesToHex(buf.asUint8Array()))
  })

  it('updateauth with keys, accounts and waits', () => {
    const a = updateauth({
      account: 'alice',
      permission: 'mine',
      parent: 'active',
      auth: {
        threshold: 3,
        keys: [
          { key: KEY_C, weight: 1 },
          { key: TEST_PUB_LEGACY, weight: 1 },
          { key: KEY_B, weight: 2 }
        ],
        accounts: [
          { permission: { actor: 'zed', permission: 'active' }, weight: 1 },
          { permission: { actor: 'bob', permission: 'owner' }, weight: 1 },
          { permission: { actor: 'bob', permission: 'active' }, weight: 1 }
        ],
        waits: [
          { wait_sec: 86400, weight: 1 },
          { wait_sec: 3600, weight: 1 }
        ]
      }
    })
    const json = decodeActionData(EOSIO, a) as { auth: { keys: { key: string }[]; accounts: { permission: { actor: string; permission: string } }[]; waits: { wait_sec: number }[] } }
    crossCheck(a, EOSIO, json)
    // chain ordering: keys by bytes, accounts by (actor, permission) numerically, waits ascending
    const keyBytes = json.auth.keys.map((k) => bytesToHex(parsePublicKey(k.key).data))
    expect([...keyBytes].sort()).toEqual(keyBytes)
    expect(json.auth.accounts.map((x) => x.permission.actor + '@' + x.permission.permission)).toEqual(['bob@active', 'bob@owner', 'zed@active'])
    expect(json.auth.waits.map((w) => w.wait_sec)).toEqual([3600, 86400])
  })

  it('newaccount, buyrambytes, delegatebw, deleteauth, linkauth, unlinkauth', () => {
    const owner = { threshold: 1, keys: [{ key: TEST_PUB_LEGACY, weight: 1 }] }
    const active = { threshold: 2, keys: [{ key: KEY_B, weight: 1 }], accounts: [{ permission: { actor: 'alice', permission: 'active' }, weight: 1 }] }
    const na = newaccount({ creator: 'alice', name: 'newacct1.wam', owner, active })
    crossCheck(na, EOSIO, decodeActionData(EOSIO, na))
    const br = buyrambytes({ payer: 'alice', receiver: 'newacct1.wam', bytes: 8192 })
    crossCheck(br, EOSIO, { payer: 'alice', receiver: 'newacct1.wam', bytes: 8192 })
    const dl = delegatebw({ from: 'alice', receiver: 'newacct1.wam', stakeNet: '1.00000000 WAX', stakeCpu: '2.00000000 WAX', transfer: true })
    crossCheck(dl, EOSIO, { from: 'alice', receiver: 'newacct1.wam', stake_net_quantity: '1.00000000 WAX', stake_cpu_quantity: '2.00000000 WAX', transfer: true })
    crossCheck(deleteauth({ account: 'alice', permission: 'mine' }), EOSIO, { account: 'alice', permission: 'mine' })
    crossCheck(linkauth({ account: 'alice', code: 'eosio.token', type: 'transfer', requirement: 'mine' }), EOSIO, {
      account: 'alice',
      code: 'eosio.token',
      type: 'transfer',
      requirement: 'mine'
    })
    crossCheck(unlinkauth({ account: 'alice', code: 'eosio.token', type: 'transfer' }), EOSIO, { account: 'alice', code: 'eosio.token', type: 'transfer' })
  })

  it('buyram, sellram, undelegatebw, refund', () => {
    crossCheck(buyram({ payer: 'alice', receiver: 'bob', quant: '1.50000000 WAX' }), EOSIO, { payer: 'alice', receiver: 'bob', quant: '1.50000000 WAX' })
    crossCheck(sellram({ account: 'alice', bytes: 1024 }), EOSIO, { account: 'alice', bytes: 1024 })
    crossCheck(sellram({ account: 'alice', bytes: 9007199254740993n }), EOSIO, { account: 'alice', bytes: '9007199254740993' })
    const ud = undelegatebw({ from: 'alice', receiver: 'newacct1.wam', unstakeNet: '0.00000000 WAX', unstakeCpu: '2.00000000 WAX' })
    crossCheck(ud, EOSIO, { from: 'alice', receiver: 'newacct1.wam', unstake_net_quantity: '0.00000000 WAX', unstake_cpu_quantity: '2.00000000 WAX' })
    crossCheck(refund({ owner: 'alice' }), EOSIO, { owner: 'alice' })
  })

  it('voteproducer, voterclaim, claimgbmvote, claimgenesis, powerup', () => {
    const v = voteproducer({ voter: 'alice', producers: ['zzz', 'bp.one', 'abc'] })
    crossCheck(v, EOSIO, { voter: 'alice', proxy: '', producers: ['abc', 'bp.one', 'zzz'] })
    crossCheck(voteproducer({ voter: 'alice', proxy: 'proxy.wam' }), EOSIO, { voter: 'alice', proxy: 'proxy.wam', producers: [] })
    crossCheck(voteproducer({ voter: 'alice' }), EOSIO, { voter: 'alice', proxy: '', producers: [] })
    crossCheck(voterclaim({ owner: 'alice' }), EOSIO, { owner: 'alice' })
    crossCheck(claimgbmvote({ owner: 'alice' }), EOSIO, { owner: 'alice' })
    crossCheck(claimgenesis({ claimer: 'alice' }), EOSIO, { claimer: 'alice' })
    const p = powerup({ payer: 'alice', receiver: 'bob', days: 1, netFrac: 0, cpuFrac: '1000000000000', maxPayment: '1.00000000 WAX' })
    crossCheck(p, EOSIO, { payer: 'alice', receiver: 'bob', days: 1, net_frac: 0, cpu_frac: '1000000000000', max_payment: '1.00000000 WAX' })
  })

  it('bidname and bidrefund', () => {
    crossCheck(bidname({ bidder: 'alice', newname: 'short', bid: '1.00000000 WAX' }), EOSIO, { bidder: 'alice', newname: 'short', bid: '1.00000000 WAX' })
    crossCheck(bidname({ bidder: 'bob.wam', newname: 'a', bid: '108.90000001 WAX' }), EOSIO, { bidder: 'bob.wam', newname: 'a', bid: '108.90000001 WAX' })
    crossCheck(bidname({ bidder: 'alice', newname: 'abcde12345z', bid: '0.00000001 WAX' }), EOSIO, { bidder: 'alice', newname: 'abcde12345z', bid: '0.00000001 WAX' })
    crossCheck(bidrefund({ bidder: 'alice', newname: 'short' }), EOSIO, { bidder: 'alice', newname: 'short' })
  })

  it('the embedded system ABIs encode the same as the on-chain ABIs', () => {
    // action data built with the embedded ABI must decode with the real on-chain ABI and re-encode identically
    const a = updateauth({ account: 'alice', permission: 'active', parent: 'owner', auth: { threshold: 1, keys: [{ key: KEY_B, weight: 1 }] } })
    const decoded = decodeActionData(EOSIO, a)
    expect(bytesToHex(encodeType(EOSIO, 'updateauth', decoded))).toBe(a.data)
  })

  it('extension fields: data with and without the binary extension decodes the same as eosjs', () => {
    const base = { account: 'alice', permission: 'active', parent: 'owner', auth: { threshold: 1, keys: [], accounts: [], waits: [] } }
    const withExt = { ...base, authorized_by: 'bob' }
    for (const j of [base, withExt]) {
      const mine = bytesToHex(encodeType(EOSIO, 'updateauth', j))
      expect(mine).toBe(ejsEncode(EOSIO, 'eosio', 'updateauth', j))
      expect(decodeType(EOSIO, 'updateauth', hexToBytes(mine))).toEqual(j)
    }
  })

  it('a contract ABI with base, alias, optional, array, variant and extension matches eosjs', () => {
    const item = { id: '18446744073709551615', owner: 'alice', price: '10.5000 EOS', tags: ['a', '', 'ccc'], note: null, ratio: 1.5, created: '2030-01-02T03:04:05' }
    for (const extra of [undefined, 77]) {
      const json = { item: extra === undefined ? item : { ...item, extra } }
      const mine = bytesToHex(encodeType(CONTRACT_ABI, 'put', json))
      expect(mine).toBe(ejsEncode(CONTRACT_ABI, 'c', 'put', json))
      expect(normTimes(decodeType(CONTRACT_ABI, 'put', hexToBytes(mine)))).toEqual(normTimes(ejsDecode(CONTRACT_ABI, 'c', 'put', mine)))
    }
    // variants (eosjs accepts the same ["type", value] form)
    const ctx = ejsContract(CONTRACT_ABI)
    const v = ser.getType(ctx.types, 'either')
    for (const val of [['uint32', 5], ['string', 'hi']] as const) {
      const buf = new ser.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder() })
      v.serialize(buf, val)
      expect(bytesToHex(encodeType(CONTRACT_ABI, 'either', val))).toBe(bytesToHex(buf.asUint8Array()))
    }
  })
})

describe('criterion 1: transactions match eosjs', () => {
  const owner = { threshold: 1, keys: [{ key: TEST_PUB_LEGACY, weight: 1 }] }
  const actions: Action[] = [
    transfer({ from: 'alice', to: 'bob', quantity: '1.00000000 WAX', memo: 'm' }),
    setcode({ account: 'alice', code: WASM }),
    setabi({ account: 'alice', abi: CONTRACT_ABI }),
    updateauth({ account: 'alice', permission: 'p', parent: 'active', auth: { threshold: 1, keys: [{ key: KEY_B, weight: 1 }, { key: KEY_C, weight: 1 }], waits: [{ wait_sec: 5, weight: 1 }] } }),
    newaccount({ creator: 'alice', name: 'bob', owner, active: owner }),
    buyrambytes({ payer: 'alice', receiver: 'bob', bytes: 4096 }),
    delegatebw({ from: 'alice', receiver: 'bob', stakeNet: '0.10000000 WAX', stakeCpu: '0.10000000 WAX' })
  ]
  const trx: Transaction = {
    expiration: '2030-05-06T07:08:09',
    ref_block_num: 61917,
    ref_block_prefix: 4096121403,
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    actions,
    transaction_extensions: []
  }

  it('packs to the same bytes and unpacks eosjs bytes', () => {
    const mine = packTransaction(trx)
    const api = ejsApi()
    const theirs = api.serializeTransaction(trx as never)
    expect(bytesToHex(mine)).toBe(bytesToHex(theirs))
    const back = api.deserializeTransaction(mine) as unknown as Transaction
    expect(normTimes(back.actions)).toEqual(normTimes(trx.actions.map(ours)))
    expect(normTimes(back.expiration)).toBe(trx.expiration)
    expect(unpackTransaction(theirs)).toEqual(trx)
  })

  it('handles non-zero header fields and context free actions like eosjs', () => {
    const t2: Transaction = {
      ...trx,
      max_net_usage_words: 300,
      max_cpu_usage_ms: 255,
      delay_sec: 100000,
      context_free_actions: [{ account: 'a', name: 'b', authorization: [], data: '00ff' }],
      transaction_extensions: []
    }
    const mine = packTransaction(t2)
    expect(bytesToHex(mine)).toBe(bytesToHex(ejsApi().serializeTransaction(t2 as never)))
    expect(unpackTransaction(mine)).toEqual(t2)
  })

  it('id is the sha256 of the packed bytes', () => {
    const mine = packTransaction(trx)
    expect(transactionId(mine)).toMatch(/^[0-9a-f]{64}$/)
    expect(transactionId(mine)).toBe(bytesToHex(new Uint8Array(require('node:crypto').createHash('sha256').update(mine).digest())))
  })
})

describe('criterion 1: signatures agree with eosjs', () => {
  const packed = packTransaction({
    expiration: '2030-05-06T07:08:09',
    ref_block_num: 1,
    ref_block_prefix: 2,
    actions: [transfer({ from: 'alice', to: 'bob', quantity: '1.0000 WAX', memo: '' })]
  })

  it('the test vector key maps to the known public key', async () => {
    expect(publicKeyToString(publicFromPrivate(parsePrivateKey(TEST_WIF)), 'legacy')).toBe(TEST_PUB_LEGACY)
    const js = new JsSignatureProvider([TEST_WIF])
    expect((await js.getAvailableKeys())[0]).toBe(publicKeyToString(parsePublicKey(TEST_PUB_LEGACY)))
  })

  it('our signatures are valid for eosjs, with the same key', () => {
    for (let i = 0; i < 25; i++) {
      const priv = generatePrivateKey()
      const wif = privateKeyToString(priv, 'wif')
      const pub = publicFromPrivate(priv)
      expect(EjsPrivateKey.fromString(wif).getPublicKey().toString()).toBe(publicKeyToString(pub))
      const digest = signingDigest(CHAIN_ID, packed)
      const sig = signDigest(digest, priv)
      const s = signatureToString(sig)
      const ej = EjsSignature.fromString(s)
      expect(ej.recover(digest, false).toString()).toBe(publicKeyToString(pub))
      expect(ej.verify(digest, EjsPrivateKey.fromString(wif).getPublicKey(), false)).toBe(true)
    }
  })

  it('eosjs signatures are recovered by the core to the signer key', async () => {
    const js = new JsSignatureProvider([TEST_WIF])
    const [pubStr] = await js.getAvailableKeys()
    const chainDigest = signingDigest(CHAIN_ID, packed)
    const res = await js.sign({ chainId: CHAIN_ID, requiredKeys: [pubStr], serializedTransaction: packed, abis: [] })
    expect(res.signatures).toHaveLength(1)
    const sig = parseSignature(res.signatures[0])
    expect(publicKeyToString(recoverPublicKey(chainDigest, sig))).toBe(pubStr)
  })

  it('signing is deterministic, canonical, and uses the same nonce derivation as eosjs', async () => {
    const js = new JsSignatureProvider([TEST_WIF])
    const [pubStr] = await js.getAvailableKeys()
    const sk = parsePrivateKey(TEST_WIF).data
    for (let i = 0; i < 40; i++) {
      const t = packTransaction({ expiration: '2030-05-06T07:08:09', ref_block_num: i, ref_block_prefix: 2, actions: [transfer({ from: 'alice', to: 'bob', quantity: '1.0000 WAX', memo: String(i) })] })
      const digest = signingDigest(CHAIN_ID, t)
      const mine = signDigest(digest, TEST_WIF)
      expect(isCanonicalSignature(mine.data)).toBe(true)
      expect(signatureToString(signDigest(digest, TEST_WIF))).toBe(signatureToString(mine))
      const theirs = (await js.sign({ chainId: CHAIN_ID, requiredKeys: [pubStr], serializedTransaction: t, abis: [] })).signatures[0]
      expect(publicKeyToString(recoverPublicKey(digest, parseSignature(theirs)))).toBe(pubStr)
      expect(publicKeyToString(recoverPublicKey(digest, mine))).toBe(pubStr)
      // eosjs retries with a one byte counter; reproducing that with the curve library gives its exact bytes
      const ej = parseSignature(theirs).data
      let rep: Uint8Array
      for (let n = 1; ; n++) {
        rep = secp256k1.sign(digest, sk, { prehash: false, lowS: true, format: 'recovered', extraEntropy: new Uint8Array([n]) })
        if (isCanonicalSignature(rep)) break
      }
      expect(bytesToHex(rep.subarray(1))).toBe(bytesToHex(ej.subarray(1)))
    }
  })
})

describe('criterion 1: primitives match eosjs', () => {
  const cases: [string, unknown][] = [
    ['bool', true],
    ['int8', -128],
    ['int8', 127],
    ['uint8', 255],
    ['int16', -32768],
    ['uint16', 65535],
    ['int32', -2147483648],
    ['uint32', 4294967295],
    ['int64', '-9223372036854775808'],
    ['int64', '9223372036854775807'],
    ['uint64', '18446744073709551615'],
    ['uint64', '0'],
    ['varuint32', 0],
    ['varuint32', 127],
    ['varuint32', 128],
    ['varuint32', 4294967295],
    ['varint32', -1],
    ['varint32', 2147483647],
    ['varint32', -2147483648],
    ['float32', 0.5],
    ['float64', 3.141592653589793],
    ['float64', -0],
    ['name', ''],
    ['name', 'eosio.token'],
    ['name', 'zzzzzzzzzzzzj'],
    ['name', '.....1'],
    ['bytes', ''],
    ['bytes', '00ff10'],
    ['string', ''],
    ['string', 'x'.repeat(200)],
    ['string', 'é中😀'],
    ['checksum160', '00'.repeat(20)],
    ['checksum256', 'ab'.repeat(32)],
    ['checksum512', '01'.repeat(64)],
    ['time_point_sec', '2030-01-02T03:04:05'],
    ['time_point', '2030-01-02T03:04:05.678'],
    ['block_timestamp_type', '2030-01-02T03:04:05.500'],
    ['symbol', '4,WAX'],
    ['symbol', '0,A'],
    ['symbol_code', 'WAXWAXW'],
    ['asset', '1.00000000 WAX'],
    ['asset', '-1.5 A'],
    ['extended_asset', { quantity: '1.0000 WAX', contract: 'eosio.token' }],
    ['public_key', KEY_C],
    ['public_key', TEST_PUB_LEGACY],
    ['signature', 'SIG_K1_K57PJvncJkx6ja44g59VzdUeMCRtij3A8gvf7L2z5Y4tEoPTY48iMZ73zTpK5rSyxN44hxZGusBvYWuCzTMnkQGGpf8Ez5']
  ]
  const eTypes = ser.createInitialTypes()
  for (const [type, value] of cases) {
    it(`${type} ${JSON.stringify(value).slice(0, 40)}`, () => {
      const buf = new ser.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder() })
      ser.getType(eTypes, type).serialize(buf, value)
      const theirs = buf.asUint8Array()
      const mine = encodeType({ version: 'eosio::abi/1.1', types: [], structs: [], actions: [], tables: [], ricardian_clauses: [], error_messages: [], abi_extensions: [] }, type, value)
      expect(bytesToHex(mine)).toBe(bytesToHex(theirs))
      const rd = new ser.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: theirs })
      const theirJson = ser.getType(eTypes, type).deserialize(rd)
      const myJson = decodeType({ version: 'eosio::abi/1.1', types: [], structs: [], actions: [], tables: [], ricardian_clauses: [], error_messages: [], abi_extensions: [] }, type, theirs)
      expect(normTimes(myJson)).toEqual(normTimes(theirJson))
    })
  }
})
