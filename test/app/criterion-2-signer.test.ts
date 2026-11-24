// Release criterion 2 (approval integrity), signer part.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { Signer, type SignerDeps } from '../../src/main/signer'
import { Vault } from '../../src/main/vault'
import type { NetworkInfo } from '../../src/shared/chain-types'
import abis from '../fixtures/chain/system-abis.json'
import {
  generatePrivateKey,
  parseAbi,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  parseSignature,
  signingDigest,
  hexToBytes,
  unpackTransaction
} from '../../src/chain-core'

const CHAIN = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'
const PW = 'correct horse battery'

function net(kind: NetworkInfo['kind'], endpoint = 'https://node-a.example'): NetworkInfo {
  return {
    id: 'n1',
    name: kind === 'mainnet' ? 'Main' : 'Test',
    kind,
    chainId: CHAIN,
    symbol: 'WAX',
    precision: 8,
    endpoints: [endpoint, 'https://node-b.example'],
    preset: false,
    currentEndpoint: 0
  }
}

const fixture = abis as unknown as { abi: Record<string, unknown> }
const tokenAbi = parseAbi(fixture.abi['eosio.token'])
const eosioAbi = parseAbi(fixture.abi['eosio'])

let vault: Vault
let pub: string
let sent: { ep: string; body: { signatures: string[]; packed_trx: string } }[]
let network: NetworkInfo
let now: number

function deps(over: Partial<SignerDeps> = {}): SignerDeps {
  return {
    vault,
    getInfo: async () => ({
      chain_id: CHAIN,
      head_block_id: '1a2b3c4d' + '00'.repeat(28),
      head_block_time: new Date(now).toISOString().slice(0, 19),
      last_irreversible_block_id: '1a2b3c40' + '11'.repeat(28)
    }),
    getAbi: async (_ep, account) => (account === 'eosio.token' ? tokenAbi : eosioAbi),
    getAccount: async () => ({
      permissions: [{ perm_name: 'active', parent: 'owner', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }] } }]
    }),
    send: async (ep, body) => {
      sent.push({ ep, body: body as never })
      return { transaction_id: 'x', processed: {} }
    },
    getCodeHash: async () => '0'.repeat(64),
    network: () => network,
    now: () => now,
    mainnetSigning: false,
    ...over
  }
}

const transfer = {
  account: 'eosio.token',
  name: 'transfer',
  authorization: [{ actor: 'alice', permission: 'active' }],
  data: { from: 'alice', to: 'bob', quantity: '1.00000000 WAX', memo: 'hi' }
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-signer-'))
  vault = new Vault(join(dir, 'vault.json'), { N: 2 ** 10, r: 8, p: 1 })
  await vault.create(PW)
  const k = generatePrivateKey()
  pub = publicKeyToString(publicFromPrivate(k), 'new')
  vault.addKey(privateKeyToString(k, 'wif'), 'alice')
  sent = []
  network = net('testnet')
  now = Date.now()
})

describe('signer approval integrity', () => {
  it('signs exactly the prepared bytes and sends them to the stored endpoint', async () => {
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    expect(record.actions[0].data).toEqual(transfer.data)
    // The network's current endpoint changes after prepare.
    network = { ...network, currentEndpoint: 1 }
    await s.approve(record.id, secret)
    expect(sent).toHaveLength(1)
    expect(sent[0].ep).toBe('https://node-a.example')
    const packed = hexToBytes(sent[0].body.packed_trx)
    expect(unpackTransaction(packed).actions[0].data).toBe(record.actions[0].hex)
    const recovered = publicKeyToString(recoverPublicKey(signingDigest(CHAIN, packed), parseSignature(sent[0].body.signatures[0])), 'new')
    expect(recovered).toBe(pub)
  })

  it('refuses a wrong secret (approval not from the confirmation window)', async () => {
    const s = new Signer(deps())
    const { record } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    await expect(s.approve(record.id, Buffer.alloc(32, 7))).rejects.toThrow(/refused/)
    expect(sent).toHaveLength(0)
  })

  it('an approval is single-use', async () => {
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    await s.approve(record.id, secret)
    await expect(s.approve(record.id, secret)).rejects.toThrow(/no longer valid/)
    expect(sent).toHaveLength(1)
  })

  it('an expired approval is refused', async () => {
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    now += 121_000
    await expect(s.approve(record.id, secret)).rejects.toThrow(/expired/)
    expect(sent).toHaveLength(0)
  })

  it('a chain id mismatch stops prepare', async () => {
    const s = new Signer(deps({ getInfo: async () => ({ chain_id: 'aa'.repeat(32), head_block_id: '00'.repeat(32), head_block_time: '2026-01-01T00:00:00', last_irreversible_block_id: '00'.repeat(32) }) }))
    await expect(s.prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(/chain id/)
  })

  it('mainnet signing is refused in this build', async () => {
    network = net('mainnet')
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    expect(record.blocked).toMatch(/release build/)
    await expect(s.approve(record.id, secret)).rejects.toThrow(/release build/)
    expect(sent).toHaveLength(0)
  })

  it('locking the vault cancels open approvals', async () => {
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    vault.lock()
    await expect(s.approve(record.id, secret)).rejects.toThrow(/no longer valid/)
  })

  it('refuses when the vault has no key for the authority', async () => {
    const s = new Signer(
      deps({
        getAccount: async () => ({
          permissions: [{ perm_name: 'active', required_auth: { threshold: 1, keys: [{ key: 'PUB_K1_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq63', weight: 1 }] } }]
        })
      })
    )
    await expect(s.prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(/no key/)
  })

  it('deploys exactly the bytes whose hashes are shown', async () => {
    const s = new Signer(deps())
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9, 9, 9])
    const abiBytes = new Uint8Array([14, 101, 111, 115, 105, 111, 58, 58, 97, 98, 105, 47, 49, 46, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
    const sha = (b: Uint8Array): string => require('node:crypto').createHash('sha256').update(b).digest('hex')
    const auth = [{ actor: 'alice', permission: 'active' }]
    const { record, secret } = await s.prepare({
      networkId: 'n1',
      kind: 'deploy',
      actions: [
        { account: 'eosio', name: 'setcode', authorization: auth, data: { account: 'alice', vmtype: 0, vmversion: 0, code: hex(wasm) } },
        { account: 'eosio', name: 'setabi', authorization: auth, data: { account: 'alice', abi: hex(abiBytes) } }
      ]
    })
    expect(record.artifacts?.wasmSha256).toBe(sha(wasm))
    expect(record.artifacts?.abiSha256).toBe(sha(abiBytes))
    // Changing the source arrays after prepare cannot change what is signed.
    wasm[10] = 0
    await s.approve(record.id, secret)
    const trx = unpackTransaction(hexToBytes(sent[0].body.packed_trx))
    const code = (record.actions[0].data as { code: string }).code
    expect(code).toBe(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9, 9, 9]).toString('hex'))
    expect(trx.actions[0].data).toBe(record.actions[0].hex)
  })
})

describe('a send repeated after a broken connection', () => {
  it('a duplicate refusal says the transaction already reached the node', async () => {
    const { RpcError } = await import('../../src/main/rpc')
    const s = new Signer(
      deps({
        send: async (ep, body) => {
          sent.push({ ep, body: body as never })
          throw new RpcError('Duplicate transaction', 409, { code: 409, error: { code: 3040008, name: 'tx_duplicate', what: 'Duplicate transaction' } })
        }
      })
    )
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    await expect(s.approve(record.id, secret)).rejects.toThrow(new RegExp(`already has transaction ${record.transactionId}`))
    expect(sent).toHaveLength(1)
    expect(sent[0].ep).toBe('https://node-a.example')
  })
})
