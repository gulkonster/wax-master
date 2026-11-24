// Release criterion 2 (approval integrity), signer part.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { Signer, approveFailure, type SignerDeps } from '../../src/main/signer'
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

  it('a send without any answer names the endpoint, the reason and the transaction id, and says it may have arrived', async () => {
    const { request } = await import('../../src/main/rpc')
    const failure = (): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      throw failure()
    }) as typeof fetch
    try {
      const s = new Signer(
        deps({
          // The real client: one repeat on the broken connection, then the text of a request without an answer.
          send: (ep, body) => {
            sent.push({ ep, body: body as never })
            return request(ep, '/v1/chain/send_transaction', { body, timeoutMs: 30_000 })
          }
        })
      )
      const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
      const err = (await s.approve(record.id, secret).catch((e) => e)) as Error
      expect(err.message).toBe(
        `Could not reach https://node-a.example: the connection was closed before an answer came. The transaction ${record.transactionId} may still have reached the node. Open it in the history (or look at the account) before sending again.`
      )
      expect(err.message).not.toMatch(/fetch failed|send_transaction|packed_trx|SIG_/)
      expect(calls).toBe(2)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('a time limit reached while sending gets the same sentence', async () => {
    const { RpcError, noAnswerMessage } = await import('../../src/main/rpc')
    const s = new Signer(
      deps({
        send: async (ep) => {
          throw new RpcError(noAnswerMessage(ep, new Error('aborted'), { timedOut: true, timeoutMs: 30_000 }), 0)
        }
      })
    )
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    await expect(s.approve(record.id, secret)).rejects.toThrow(
      `Could not reach https://node-a.example: no answer within 30 s. The transaction ${record.transactionId} may still have reached the node.`
    )
  })
})

describe('the kind of a failed approval', () => {
  it('no answer, a time limit and the duplicate case may have arrived; a node error is a refusal; a local failure sent nothing', async () => {
    const { RpcError, noAnswerMessage } = await import('../../src/main/rpc')
    const fail = async (err: () => Error, after?: () => void, typed?: string): Promise<unknown> => {
      const s = new Signer(deps({ send: async () => Promise.reject(err()) }))
      const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
      after?.()
      return s.approve(record.id, secret, typed).catch((e) => e)
    }
    const timeLimit = (): Error => new RpcError(noAnswerMessage('https://node-a.example', new Error('aborted'), { timedOut: true, timeoutMs: 30_000 }), 0)
    const duplicate = (): Error => new RpcError('Duplicate transaction', 409, { code: 409, error: { code: 3040008, name: 'tx_duplicate', what: 'Duplicate transaction' } })
    const overdrawn = (): Error =>
      new RpcError('Internal Service Error', 500, { code: 500, error: { code: 3050003, name: 'eosio_assert_message_exception', what: 'eosio_assert_message assertion failure', details: [{ message: 'assertion failure with message: overdrawn balance' }] } })
    for (const e of [await fail(timeLimit), await fail(duplicate)]) {
      expect((e as { mayHaveArrived?: boolean }).mayHaveArrived).toBe(true)
      expect(approveFailure(e)).toBe('unknown')
    }
    const refused = await fail(overdrawn)
    expect((refused as Error).message).toMatch(/overdrawn balance/)
    expect(approveFailure(refused)).toBe('refused')
    const expired = await fail(overdrawn, () => (now += 10 * 60 * 60 * 1000))
    expect((expired as Error).message).toMatch(/expired/)
    expect(approveFailure(expired)).toBe('not-sent')
    expect(approveFailure(new Error('Vault is locked'))).toBe('not-sent')
    expect(sent).toHaveLength(0)
  })
})

describe('every updateauth is checked in prepare, whatever asked for it', () => {
  // alice: owner and active hold the vault key; claim is under active.
  const accountOf = (): Record<string, unknown> => ({
    permissions: [
      { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] } },
      { perm_name: 'active', parent: 'owner', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] } },
      { perm_name: 'claim', parent: 'active', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] } }
    ]
  })
  const updateauth = (permission: string, auth: Record<string, unknown>, signWith = 'owner'): typeof transfer => ({
    account: 'eosio',
    name: 'updateauth',
    authorization: [{ actor: 'alice', permission: signWith }],
    data: { account: 'alice', permission, parent: permission === 'owner' ? '' : 'owner', auth: { keys: [], accounts: [], waits: [], ...auth } } as never
  })
  const lvl = (actor: string, permission: string, weight = 1): unknown => ({ permission: { actor, permission }, weight })
  const signerFor = (accounts: Record<string, Record<string, unknown>> = {}): Signer =>
    new Signer(
      deps({
        getAccount: async (_ep, name) => {
          if (name === 'alice') return accountOf()
          if (accounts[name]) return accounts[name]
          const { RpcError } = await import('../../src/main/rpc')
          throw new RpcError('unknown key', 500, { error: { name: 'unknown_key' } })
        }
      })
    )

  // Built in the test: the vault key exists only after beforeEach.
  const cases: [string, () => typeof transfer, RegExp][] = [
    ["only the account's own eosio.code", () => updateauth('active', { threshold: 1, accounts: [lvl('alice', 'eosio.code')] }), /alice@active could not reach its threshold 1: the keys and accounts that can sign add up to 0\./],
    ['only a wait', () => updateauth('active', { threshold: 1, waits: [{ wait_sec: 3600, weight: 1 }] }), /add up to 0/],
    ['only a permission below it', () => updateauth('active', { threshold: 1, accounts: [lvl('alice', 'claim')] }), /add up to 0/],
    ['only eosio.null@active', () => updateauth('active', { threshold: 1, accounts: [lvl('eosio.null', 'active')] }), /add up to 0/],
    ['a threshold of 0', () => updateauth('active', { threshold: 0, keys: [{ key: pub, weight: 1 }] }), /The threshold of alice@active must be at least 1\./],
    ['owner leaning on a deleted account', () => updateauth('owner', { threshold: 1, accounts: [lvl('gone', 'active')] }), /do not exist on this network now: gone@active/]
  ]
  for (const [what, action, text] of cases) {
    it(`refused before any window: ${what}`, async () => {
      const s = signerFor()
      const err = (await s.prepare({ networkId: 'n1', actions: [action()] }).catch((e) => e)) as Error
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toMatch(text)
      expect(err.message).toMatch(/Nothing was prepared\.$/)
      // No approval record: nothing is open, nothing was sent.
      expect(s.busy()).toBe(false)
      expect(sent).toHaveLength(0)
    })
  }

  it('a reachable authority is prepared (a key, or an existing account entry on owner)', async () => {
    const s = signerFor({ bob: { permissions: [{ perm_name: 'active', parent: 'owner', required_auth: { threshold: 1, keys: [], accounts: [], waits: [] } }] } })
    const { record } = await s.prepare({ networkId: 'n1', actions: [updateauth('active', { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [lvl('alice', 'eosio.code')] })] })
    expect(record.actions[0].name).toBe('updateauth')
    s.cancel(record.id)
    const owner = await s.prepare({ networkId: 'n1', actions: [updateauth('owner', { threshold: 1, accounts: [lvl('bob', 'active')] })] })
    expect(owner.record.actions[0].name).toBe('updateauth')
  })

  it('Change key on a key-plus-account permission still passes', async () => {
    const { changeKeyActions } = await import('../../src/main/accounts')
    const next = publicKeyToString(publicFromPrivate(generatePrivateKey()), 'new')
    const data = {
      permissions: [
        { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] } },
        {
          perm_name: 'active',
          parent: 'owner',
          required_auth: { threshold: 2, keys: [{ key: pub, weight: 1 }], accounts: [{ permission: { actor: 'carol', permission: 'active' }, weight: 1 }], waits: [] }
        }
      ]
    }
    const s = new Signer(deps({ getAccount: async () => data }))
    const actions = changeKeyActions({ account: 'alice', permission: 'active', oldKey: pub, newKey: next, signWith: 'owner' }, data)
    const { record } = await s.prepare({ networkId: 'n1', actions, kind: 'changeKey' })
    expect(record.title).toBe('Change key of alice@active')
  })

  it('Change key no longer counts waits or eosio.code: the signer refuses such an authority', async () => {
    const { changeKeyActions } = await import('../../src/main/accounts')
    const next = publicKeyToString(publicFromPrivate(generatePrivateKey()), 'new')
    const data = {
      permissions: [
        { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] } },
        {
          perm_name: 'active',
          parent: 'owner',
          required_auth: { threshold: 2, keys: [{ key: pub, weight: 1 }], accounts: [{ permission: { actor: 'alice', permission: 'eosio.code' }, weight: 1 }], waits: [] }
        }
      ]
    }
    const s = new Signer(deps({ getAccount: async () => data }))
    const actions = changeKeyActions({ account: 'alice', permission: 'active', oldKey: pub, newKey: next, signWith: 'owner' }, data)
    await expect(s.prepare({ networkId: 'n1', actions, kind: 'changeKey' })).rejects.toThrow(/could not reach its threshold 2: .* add up to 1\. Nothing was prepared\./)
    expect(s.busy()).toBe(false)
  })
})
