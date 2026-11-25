import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false, getAppPath: () => process.cwd() } }))
vi.mock('../../src/main/local-chain', () => ({ getStatus: vi.fn(), localChainSystemKey: vi.fn() }))
vi.mock('../../src/main/networks', () => ({ setStar: vi.fn() }))
vi.mock('../../src/main/keys-service', () => ({ vault: vi.fn() }))

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  generatePrivateKey,
  hexToBytes,
  parseSignature,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  signingDigest,
  unpackTransaction
} from '../../src/chain-core'
import type { LocalChainStatus } from '../../src/shared/local-chain'
import {
  NOT_RUNNING_TEXT,
  checkNewName,
  createLocalAccount,
  giveLocalTokens,
  localAccountExists,
  tokenQuantity,
  type LocalAccountsDeps
} from '../../src/main/local-chain-accounts'

const CHAIN_ID = 'ab'.repeat(32)

function newKey(): { priv: string; pub: string } {
  const k = generatePrivateKey()
  return { priv: privateKeyToString(k), pub: publicKeyToString(publicFromPrivate(k)) }
}

interface Sent {
  path: string
  body: Record<string, unknown>
}

function fakeChain(opts: { phase?: LocalChainStatus['phase']; chainId?: string; eosioKey?: string; accounts?: string[] } = {}) {
  const system = newKey()
  const user = newKey()
  const accounts = new Set(opts.accounts ?? ['eosio'])
  const sent: Sent[] = []
  const stars: string[] = []
  const status: LocalChainStatus = {
    phase: opts.phase ?? 'running',
    port: 8890,
    endpoint: 'http://127.0.0.1:8890',
    chainId: CHAIN_ID,
    nodeVersion: 'v1.3.1wax01',
    options: { webPages: false, startWithApp: false }
  }
  const deps: LocalAccountsDeps = {
    status: async () => status,
    systemKey: async () => system.priv,
    readResource: (rel) => readFile(join(process.cwd(), 'resources', 'local-chain', ...rel.split('/'))),
    inVault: (k) => k === user.pub,
    star: (a) => stars.push(a),
    request: async <T,>(endpoint: string, path: string, body: unknown): Promise<T> => {
      expect(endpoint).toBe('http://127.0.0.1:8890')
      sent.push({ path, body: body as Record<string, unknown> })
      if (path === '/v1/chain/get_info') {
        return {
          chain_id: opts.chainId ?? CHAIN_ID,
          head_block_num: 100,
          head_block_id: '00000064' + '11'.repeat(28),
          head_block_time: '2026-11-25T12:00:00.000',
          last_irreversible_block_num: 99,
          last_irreversible_block_id: '00000063' + '22'.repeat(28)
        } as T
      }
      if (path === '/v1/chain/get_account') {
        const name = (body as { account_name: string }).account_name
        if (name === 'eosio') {
          return { permissions: [{ perm_name: 'owner', required_auth: { keys: [{ key: opts.eosioKey ?? system.pub }] } }] } as T
        }
        if (accounts.has(name)) return { account_name: name } as T
        throw new Error(`unknown key (eosio::chain::name): ${name}`)
      }
      if (path === '/v1/chain/send_transaction') return { transaction_id: 'x' } as T
      throw new Error(`unexpected ${path}`)
    }
  }
  return { deps, sent, stars, system, user, accounts }
}

function sentTransaction(sent: Sent[]) {
  const tx = sent.find((s) => s.path === '/v1/chain/send_transaction')
  if (!tx) return null
  const packed = hexToBytes(tx.body.packed_trx as string)
  const sig = parseSignature((tx.body.signatures as string[])[0])
  return { trx: unpackTransaction(packed), signer: publicKeyToString(recoverPublicKey(signingDigest(CHAIN_ID, packed), sig)) }
}

describe('amounts and names', () => {
  it('turns amounts into WAX quantities with 8 decimals and refuses the rest', () => {
    expect(tokenQuantity(1000)).toBe('1000.00000000 WAX')
    expect(tokenQuantity(0.5)).toBe('0.50000000 WAX')
    expect(tokenQuantity(1_000_000)).toBe('1000000.00000000 WAX')
    expect(() => tokenQuantity(1_000_000.01)).toThrow('At most 1,000,000 WAX')
    expect(() => tokenQuantity(0)).toThrow()
    expect(() => tokenQuantity(-1)).toThrow()
    expect(() => tokenQuantity(Number.NaN)).toThrow()
    expect(() => tokenQuantity(0.000000001)).toThrow()
  })

  it('takes 12-character names only', () => {
    expect(checkNewName('abcde1234512')).toBe('abcde1234512')
    expect(() => checkNewName('short')).toThrow('12 characters')
    expect(() => checkNewName('abcde123451x9')).toThrow()
    expect(() => checkNewName('.bcde1234512')).toThrow()
    expect(() => checkNewName('Abcde1234512')).toThrow()
  })
})

describe('new account', () => {
  it('sends the four actions of eosio in one transaction signed by the system key, then stars the account', async () => {
    const c = fakeChain()
    const r = await createLocalAccount({ name: 'newuser12345', publicKey: c.user.pub }, c.deps)
    expect(r.account).toBe('newuser12345')
    expect(r.transactionId).toMatch(/^[0-9a-f]{64}$/)
    const t = sentTransaction(c.sent)!
    expect(t.signer).toBe(c.system.pub)
    expect(t.trx.actions.map((a) => `${a.account}:${a.name}`)).toEqual([
      'eosio:newaccount',
      'eosio:buyrambytes',
      'eosio:delegatebw',
      'eosio.token:transfer'
    ])
    for (const a of t.trx.actions) expect(a.authorization).toEqual([{ actor: 'eosio', permission: 'active' }])
    expect(c.stars).toEqual(['newuser12345'])
    // No key text leaves in the result.
    expect(JSON.stringify(r)).not.toContain('PVT_')
  })

  it('refuses a key outside the vault, a taken name and a stopped chain before anything is sent', async () => {
    const c = fakeChain({ accounts: ['eosio', 'takenname123'] })
    await expect(createLocalAccount({ name: 'newuser12345', publicKey: newKey().pub }, c.deps)).rejects.toThrow('vault')
    await expect(createLocalAccount({ name: 'takenname123', publicKey: c.user.pub }, c.deps)).rejects.toThrow('This name is taken on Local chain.')
    const stopped = fakeChain({ phase: 'stopped' })
    await expect(createLocalAccount({ name: 'newuser12345', publicKey: stopped.user.pub }, stopped.deps)).rejects.toThrow(NOT_RUNNING_TEXT)
    expect(c.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
    expect(c.stars).toEqual([])
  })

  it('sends nothing to a chain with another id or another eosio key', async () => {
    const other = fakeChain({ chainId: 'cd'.repeat(32) })
    await expect(createLocalAccount({ name: 'newuser12345', publicKey: other.user.pub }, other.deps)).rejects.toThrow('another chain')
    expect(other.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
    const foreign = fakeChain({ eosioKey: newKey().pub })
    await expect(createLocalAccount({ name: 'newuser12345', publicKey: foreign.user.pub }, foreign.deps)).rejects.toThrow('system key')
    expect(foreign.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
  })
})

describe('give tokens and the free check', () => {
  it('sends one transfer from eosio to an existing account', async () => {
    const c = fakeChain({ accounts: ['eosio', 'someone12345'] })
    const r = await giveLocalTokens({ account: 'someone12345', amount: 1000 }, c.deps)
    expect(r.quantity).toBe('1000.00000000 WAX')
    const t = sentTransaction(c.sent)!
    expect(t.signer).toBe(c.system.pub)
    expect(t.trx.actions.map((a) => `${a.account}:${a.name}`)).toEqual(['eosio.token:transfer'])
  })

  it('refuses a missing account and an amount over the limit', async () => {
    const c = fakeChain()
    await expect(giveLocalTokens({ account: 'nobody123451', amount: 10 }, c.deps)).rejects.toThrow('does not exist on the local chain')
    await expect(giveLocalTokens({ account: 'eosio', amount: 2_000_000 }, c.deps)).rejects.toThrow('At most')
    expect(c.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
  })

  it('tells a free name from a taken one', async () => {
    const c = fakeChain({ accounts: ['eosio', 'takenname123'] })
    expect(await localAccountExists('takenname123', c.deps)).toBe(true)
    expect(await localAccountExists('freename1234', c.deps)).toBe(false)
  })
})
