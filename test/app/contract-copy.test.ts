// Copy a contract to the local chain: the read on the source, the refusals, the
// target made by eosio with RAM for ten times the code plus 1 MiB, the replace rule, and the deployment
// of the read bytes through the existing deploy plan. Keys are generated in the test.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  codeHash: '',
  abiHash: '',
  abi: '',
  ramQuota: 10_000_000,
  ramUsage: 3_000
}))

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false, getAppPath: () => process.cwd() }, BrowserWindow: class {}, dialog: {} }))
vi.mock('../../src/main/local-chain', () => ({ getStatus: vi.fn(), localChainSystemKey: vi.fn() }))
vi.mock('../../src/main/keys-service', () => ({ vault: vi.fn() }))
vi.mock('../../src/main/projects', () => ({ currentProject: () => null, resolveInProject: (p: string) => p }))
vi.mock('../../src/main/networks', () => {
  const local = { id: 'local-chain', name: 'Local chain', kind: 'local', endpoints: ['http://127.0.0.1:8890'], currentEndpoint: 0 }
  return {
    setStar: vi.fn(),
    getNetwork: (id: string) => {
      if (id !== 'local-chain') throw new Error('Unknown network')
      return local
    },
    currentNetwork: () => local,
    endpointOf: () => 'http://127.0.0.1:8890',
    readCall: (fn: (ep: string) => Promise<unknown>) => fn('http://127.0.0.1:8890')
  }
})
vi.mock('../../src/main/rpc', () => ({
  request: vi.fn(),
  chain: {
    getCodeHash: async () => ({ code_hash: h.codeHash || '0'.repeat(64) }),
    getRawAbi: async () => ({ abi_hash: h.abiHash || '0'.repeat(64), abi: h.abi }),
    getAccount: async () => ({ ram_quota: h.ramQuota, ram_usage: h.ramUsage }),
    getActivatedProtocolFeatures: async () => ({ activated_protocol_features: [] }),
    getRawCodeAndAbi: async () => ({ wasm: '' })
  }
}))

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EOSIO_ABI,
  abiToBinary,
  decodeAction,
  generatePrivateKey,
  hexToBytes,
  parseAbi,
  parseSignature,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  signingDigest,
  transactionId,
  unpackTransaction
} from '../../src/chain-core'
import type { LocalChainStatus } from '../../src/shared/local-chain'
import type { LocalAccountsDeps } from '../../src/main/local-chain-accounts'
import { deployActions, planDeploy } from '../../src/main/deploy'
import {
  COPY_CANCELLED,
  MAX_COPY_CODE,
  clearReads,
  copyContract,
  copyRamBytes,
  copyRead,
  copyTarget,
  hasCodePermission,
  noCodeText,
  replaceText,
  sha256Hex,
  sourceCodePermission,
  type ContractCopyDeps,
  type CopySignOutcome
} from '../../src/main/contract-copy'
import type { ActionRequest } from '../../src/main/signer'

const CHAIN_ID = 'cd'.repeat(32)
/** The smallest valid WebAssembly module, plus a custom section to vary the bytes. */
const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 4, 1, 0x78, 0x01, 0x02])
const OTHER_WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 4, 1, 0x78, 0x07, 0x07])
const ABI_JSON = {
  version: 'eosio::abi/1.1',
  types: [],
  structs: [{ name: 'init', base: '', fields: [] }, { name: 'config', base: '', fields: [{ name: 'id', type: 'uint64' }] }],
  actions: [{ name: 'init', type: 'init', ricardian_contract: '' }],
  tables: [{ name: 'config', type: 'config', index_type: 'i64', key_names: [], key_types: [] }],
  ricardian_clauses: [],
  error_messages: [],
  abi_extensions: [],
  variants: []
}
const ABI_BIN = abiToBinary(JSON.stringify(ABI_JSON))
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64')

function newKey(): { priv: string; pub: string } {
  const k = generatePrivateKey()
  return { priv: privateKeyToString(k), pub: publicKeyToString(publicFromPrivate(k)) }
}

interface Sent {
  path: string
  body: Record<string, unknown>
}

function world(
  opts: {
    accounts?: Record<string, string>
    source?: { wasm: Uint8Array; abi: Uint8Array | null } | null
    sign?: CopySignOutcome['status']
    /** The source has <account>@eosio.code on active. */
    codePermission?: boolean
    /** get_account answers of existing local accounts by name. */
    localAccounts?: Record<string, unknown>
    /** The kept-answer write throws. */
    keepFails?: boolean
  } = {}
) {
  const system = newKey()
  const user = newKey()
  /** Local accounts and the hash of their code ('' = none). */
  const accounts = new Map<string, string>(Object.entries({ eosio: 'aa'.repeat(32), ...(opts.accounts ?? {}) }))
  const sent: Sent[] = []
  const stars: string[] = []
  const signed: ActionRequest[][] = []
  const sourceReads: string[] = []
  const kept: { id: string; actions: string[]; answer: unknown }[] = []
  const status: LocalChainStatus = {
    phase: 'running',
    port: 8890,
    endpoint: 'http://127.0.0.1:8890',
    chainId: CHAIN_ID,
    nodeVersion: 'v1.3.1wax01',
    options: { webPages: false, startWithApp: false }
  }
  const local: LocalAccountsDeps = {
    status: async () => status,
    systemKey: async () => system.priv,
    readResource: (rel) => readFile(join(process.cwd(), 'resources', 'local-chain', ...rel.split('/'))),
    inVault: (k) => k === user.pub,
    star: (a) => stars.push(a),
    keep: (id, actions, _endpoint, answer) => {
      if (opts.keepFails) throw new Error('disk full')
      kept.push({ id, actions: actions.map((a) => `${a.account}::${a.name}`), answer })
    },
    request: async <T,>(endpoint: string, path: string, body: unknown): Promise<T> => {
      expect(endpoint).toBe('http://127.0.0.1:8890')
      sent.push({ path, body: body as Record<string, unknown> })
      const name = (body as { account_name?: string }).account_name ?? ''
      if (path === '/v1/chain/get_info') {
        return {
          chain_id: CHAIN_ID,
          head_block_num: 100,
          head_block_id: '00000064' + '11'.repeat(28),
          head_block_time: '2026-11-25T12:00:00.000',
          last_irreversible_block_num: 99,
          last_irreversible_block_id: '00000063' + '22'.repeat(28)
        } as T
      }
      if (path === '/v1/chain/get_account') {
        if (name === 'eosio') return { permissions: [{ perm_name: 'owner', required_auth: { keys: [{ key: system.pub }] } }] } as T
        if (accounts.has(name)) return (opts.localAccounts?.[name] ?? { account_name: name }) as T
        throw new Error(`unknown key (eosio::chain::name): ${name}`)
      }
      if (path === '/v1/chain/get_code_hash') {
        if (!accounts.has(name)) throw new Error(`unknown key (eosio::chain::name): ${name}`)
        return { code_hash: accounts.get(name) || '0'.repeat(64) } as T
      }
      if (path === '/v1/chain/send_transaction') {
        const trx = unpackTransaction(hexToBytes((body as { packed_trx: string }).packed_trx))
        const created = trx.actions.find((a) => a.name === 'newaccount')
        if (created) accounts.set((decodeAction(EOSIO_ABI, 'newaccount', hexToBytes(created.data as string)) as { name: string }).name, '')
        return { transaction_id: 'x', processed: { receipt: { status: 'executed' } } } as T
      }
      throw new Error(`unexpected ${path}`)
    }
  }
  const source = opts.source === undefined ? { wasm: WASM, abi: ABI_BIN } : opts.source
  const deps: ContractCopyDeps = {
    local,
    readSource: async (networkId, account) => {
      sourceReads.push(`${networkId}/${account}`)
      if (account === 'nobody') throw new Error('The account nobody does not exist on WAX Mainnet.')
      const codePermission = opts.codePermission ?? false
      if (!source) return { network: 'WAX Mainnet', wasm: '', abi: '', codePermission }
      return { network: 'WAX Mainnet', wasm: b64(source.wasm), abi: source.abi ? b64(source.abi) : '', codePermission }
    },
    plan: (input) => {
      // The deploy plan reads the target through the mocked rpc: give it this world's state.
      h.codeHash = accounts.get(input.account) ?? ''
      return planDeploy(input)
    },
    actions: deployActions,
    sign: async (networkId, actions) => {
      expect(networkId).toBe('local-chain')
      signed.push(actions)
      const st = opts.sign ?? 'sent'
      if (st === 'sent') {
        const code = actions.find((a) => a.name === 'setcode')
        if (code) accounts.set((code.data as { account: string }).account, sha256Hex(hexToBytes((code.data as { code: string }).code)))
        return { status: 'sent', transactionId: 'ef'.repeat(32) }
      }
      if (st === 'failed') return { status: 'failed', error: 'the node said no' }
      return { status: 'cancelled' }
    },
    now: () => Date.now()
  }
  return { deps, sent, stars, signed, sourceReads, kept, system, user, accounts }
}

function eosioTransaction(sent: Sent[]) {
  const tx = sent.find((s) => s.path === '/v1/chain/send_transaction')
  if (!tx) return null
  const packed = hexToBytes(tx.body.packed_trx as string)
  const sig = parseSignature((tx.body.signatures as string[])[0])
  return { trx: unpackTransaction(packed), signer: publicKeyToString(recoverPublicKey(signingDigest(CHAIN_ID, packed), sig)) }
}

beforeEach(() => {
  clearReads()
  h.codeHash = ''
})

describe('reading the source', () => {
  it('gives the SHA-256 of the code, the sizes and the ABI names', async () => {
    const w = world()
    const r = await copyRead({ networkId: 'wax-mainnet', account: 'atomicassets' }, w.deps)
    expect(r).toMatchObject({ network: 'WAX Mainnet', account: 'atomicassets', codeHash: sha256Hex(WASM), codeSize: WASM.length, abiSize: ABI_BIN.length })
    expect(r.actions).toEqual(['init'])
    expect(r.tables).toEqual(['config'])
    expect(w.sent).toEqual([])
  })

  it('refuses an account without code, a missing account, the local chain itself and code over 4 MB', async () => {
    await expect(copyRead({ networkId: 'wax-mainnet', account: 'someone' }, world({ source: null }).deps)).rejects.toThrow(noCodeText('someone', 'WAX Mainnet'))
    await expect(copyRead({ networkId: 'wax-mainnet', account: 'nobody' }, world().deps)).rejects.toThrow('does not exist')
    await expect(copyRead({ networkId: 'local-chain', account: 'atomicassets' }, world().deps)).rejects.toThrow('local chain itself')
    const big = new Uint8Array(MAX_COPY_CODE + 1)
    await expect(copyRead({ networkId: 'wax-mainnet', account: 'bigcode' }, world({ source: { wasm: big, abi: null } }).deps)).rejects.toThrow('at most 4 MB')
  })
})

describe('the target', () => {
  it('says whether the name exists and what code it has', async () => {
    const w = world({ accounts: { withcode: 'bb'.repeat(32), empty: '' } })
    expect(await copyTarget('withcode', w.deps)).toEqual({ exists: true, hasCode: true, codeHash: 'bb'.repeat(32) })
    expect(await copyTarget('empty', w.deps)).toEqual({ exists: true, hasCode: false, codeHash: '' })
    expect(await copyTarget('atomicassets', w.deps)).toEqual({ exists: false, hasCode: false, codeHash: '' })
  })
})

describe('copying', () => {
  it('makes a missing target by eosio with RAM for 10 x the code plus 1 MiB, then deploys the read bytes from the vault', async () => {
    const w = world()
    await copyRead({ networkId: 'wax-mainnet', account: 'atomicassets' }, w.deps)
    const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: w.user.pub }, w.deps)
    // The read of Read is used; the source is not read again.
    expect(w.sourceReads).toEqual(['wax-mainnet/atomicassets'])
    const t = eosioTransaction(w.sent)!
    expect(t.signer).toBe(w.system.pub)
    expect(t.trx.actions.map((a) => `${a.account}:${a.name}`)).toEqual([
      'eosio:newaccount',
      'eosio:buyrambytes',
      'eosio:buyrambytes',
      'eosio:delegatebw',
      'eosio.token:transfer'
    ])
    const system = parseAbi(JSON.parse(await readFile(join(process.cwd(), 'resources', 'local-chain', 'contracts', 'eosio.system.abi'), 'utf8')))
    const ram = t.trx.actions
      .filter((a) => a.name === 'buyrambytes')
      .reduce((sum, a) => sum + Number((decodeAction(system, 'buyrambytes', hexToBytes(a.data as string)) as { bytes: number }).bytes), 0)
    expect(ram).toBe(copyRamBytes(WASM.length))
    expect(copyRamBytes(500_000)).toBe(5_000_000 + 1_048_576)
    expect(w.stars).toEqual(['atomicassets'])
    // The deployment: setcode and setabi with exactly the read bytes, by the target's active permission.
    expect(w.signed).toHaveLength(1)
    const [setcode, setabi] = w.signed[0]
    expect(setcode.name).toBe('setcode')
    expect(setcode.authorization).toEqual([{ actor: 'atomicassets', permission: 'active' }])
    expect((setcode.data as { code: string }).code).toBe(Buffer.from(WASM).toString('hex'))
    expect(setabi.name).toBe('setabi')
    expect((setabi.data as { abi: string }).abi).toBe(Buffer.from(ABI_BIN).toString('hex'))
    expect(r).toMatchObject({ target: 'atomicassets', created: true, replaced: false, sourceHash: sha256Hex(WASM), localHash: sha256Hex(WASM), same: true })
    expect(JSON.stringify(r)).not.toContain('PVT_')
  })

  it('copies under another name and reads the source when Read was not called', async () => {
    const w = world()
    const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'myassets1234', publicKey: w.user.pub }, w.deps)
    expect(w.sourceReads).toEqual(['wax-mainnet/atomicassets'])
    expect(r.target).toBe('myassets1234')
    expect(r.same).toBe(true)
  })

  it('refuses before anything is sent: other code without Replace, a key outside the vault, no key for a new name', async () => {
    const other = sha256Hex(OTHER_WASM)
    let w = world({ accounts: { atomicassets: other } })
    await expect(copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)).rejects.toThrow(replaceText('atomicassets'))
    expect(w.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
    expect(w.signed).toEqual([])

    w = world()
    await expect(
      copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: newKey().pub }, w.deps)
    ).rejects.toThrow('Choose a key of your vault')
    await expect(copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)).rejects.toThrow('does not exist on the local chain')
    expect(w.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
    expect(w.signed).toEqual([])
  })

  it('replaces other code when asked, without making the account', async () => {
    const w = world({ accounts: { atomicassets: sha256Hex(OTHER_WASM) } })
    const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', replace: true }, w.deps)
    expect(w.sent.some((s) => s.path === '/v1/chain/send_transaction')).toBe(false)
    expect(w.signed).toHaveLength(1)
    expect(r).toMatchObject({ created: false, replaced: true, same: true, localHash: sha256Hex(WASM) })
  })

  it('refuses a target without the RAM for the copy before signing', async () => {
    const w = world({ accounts: { atomicassets: sha256Hex(OTHER_WASM) } })
    h.ramQuota = 3_010
    try {
      await expect(copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', replace: true }, w.deps)).rejects.toThrow(
        'Buy RAM for it in the RAM section of its Account page'
      )
      expect(w.signed).toEqual([])
    } finally {
      h.ramQuota = 10_000_000
    }
  })

  it('sends nothing when the target already has this code and ABI', async () => {
    const w = world({ accounts: { atomicassets: sha256Hex(WASM) } })
    h.abiHash = sha256Hex(ABI_BIN)
    h.abi = b64(ABI_BIN)
    try {
      const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)
      expect(w.signed).toEqual([])
      expect(r).toMatchObject({ created: false, replaced: false, same: true, transactionId: null })
    } finally {
      h.abiHash = ''
      h.abi = ''
    }
  })

  it('says a cancelled or failed deployment plainly', async () => {
    let w = world({ sign: 'cancelled' })
    await expect(copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: w.user.pub }, w.deps)).rejects.toThrow(COPY_CANCELLED)
    w = world({ sign: 'failed', accounts: { atomicassets: '' } })
    await expect(copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)).rejects.toThrow('the node said no')
  })
})

describe('the deployment takes bytes (deploy.ts)', () => {
  it('plans code and ABI bytes without a project, labelled by their source', async () => {
    const plan = await planDeploy({
      networkId: 'local-chain',
      account: 'atomicassets',
      permission: 'active',
      target: 'both',
      bytes: { wasm: WASM, abi: ABI_BIN, label: 'atomicassets on WAX Mainnet' }
    })
    expect(plan).toMatchObject({
      wasmFile: 'atomicassets on WAX Mainnet (code)',
      abiFile: 'atomicassets on WAX Mainnet (ABI)',
      wasmSha256: sha256Hex(WASM),
      abiSha256: sha256Hex(ABI_BIN),
      sendWasm: true,
      sendAbi: true,
      chainCodeHash: ''
    })
    const { networkId, actions } = deployActions(plan.id)
    expect(networkId).toBe('local-chain')
    expect(actions.map((a) => a.name)).toEqual(['setcode', 'setabi'])
  })

  it('code only when the source has no ABI; refuses a broken ABI; the file path still needs a project', async () => {
    const plan = await planDeploy({ networkId: 'local-chain', account: 'x', permission: 'active', target: 'both', bytes: { wasm: WASM, abi: null, label: 'x on WAX Mainnet' } })
    expect(plan.sendAbi).toBe(false)
    expect(plan.abiFile).toBeNull()
    await expect(
      planDeploy({ networkId: 'local-chain', account: 'x', permission: 'active', target: 'both', bytes: { wasm: WASM, abi: new Uint8Array([1, 2, 3]), label: 'x' } })
    ).rejects.toThrow('not a valid ABI')
    await expect(planDeploy({ networkId: 'local-chain', account: 'x', permission: 'active', target: 'both' })).rejects.toThrow('No project is open')
  })
})

/** A get_account answer in the shape the node gives, with or without <name>@eosio.code on active. */
function accountAnswer(name: string, key: string, code: boolean): unknown {
  const accounts = code ? [{ permission: { actor: name, permission: 'eosio.code' }, weight: 1 }] : []
  return {
    account_name: name,
    permissions: [
      { perm_name: 'active', parent: 'owner', required_auth: { threshold: 1, keys: [{ key, weight: 1 }], accounts, waits: [] } },
      { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key, weight: 1 }], accounts: [], waits: [] } }
    ]
  }
}

function newAccountOf(sent: Sent[]) {
  const t = eosioTransaction(sent)!
  const na = t.trx.actions.find((a) => a.name === 'newaccount')!
  return decodeAction(EOSIO_ABI, 'newaccount', hexToBytes(na.data as string)) as {
    owner: { accounts: { permission: { actor: string; permission: string }; weight: number }[] }
    active: { threshold: number; keys: unknown[]; accounts: { permission: { actor: string; permission: string }; weight: number }[] }
  }
}

describe('eosio.code of the source', () => {
  it('reads the permission from a get_account answer and never throws', async () => {
    const key = newKey().pub
    expect(hasCodePermission(accountAnswer('atomicassets', key, true), 'atomicassets')).toBe(true)
    expect(hasCodePermission(accountAnswer('atomicassets', key, false), 'atomicassets')).toBe(false)
    expect(hasCodePermission(accountAnswer('atomicassets', key, true), 'someoneelse')).toBe(false)
    expect(hasCodePermission(null, 'atomicassets')).toBe(false)
    expect(hasCodePermission({ permissions: 'x' }, 'atomicassets')).toBe(false)
    expect(await sourceCodePermission('atomicassets', async () => accountAnswer('atomicassets', key, true))).toBe(true)
    expect(await sourceCodePermission('atomicassets', () => Promise.reject(new Error('the node did not answer')))).toBe(false)
  })

  it('gives a created target eosio.code on active only when the source has it; owner stays the key alone', async () => {
    let w = world({ codePermission: true })
    const read = await copyRead({ networkId: 'wax-mainnet', account: 'atomicassets' }, w.deps)
    expect(read.codePermission).toBe(true)
    let r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'myassets1234', publicKey: w.user.pub }, w.deps)
    let na = newAccountOf(w.sent)
    expect(na.active.threshold).toBe(1)
    expect(na.active.keys).toHaveLength(1)
    expect(na.active.accounts).toEqual([{ permission: { actor: 'myassets1234', permission: 'eosio.code' }, weight: 1 }])
    expect(na.owner.accounts).toEqual([])
    expect(r.codePermission).toBe('given')

    clearReads()
    w = world()
    r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'myassets1234', publicKey: w.user.pub }, w.deps)
    na = newAccountOf(w.sent)
    expect(na.active.accounts).toEqual([])
    expect(r.codePermission).toBe('none')
  })

  it('says needed for a target that was there without it, and changes nothing on it', async () => {
    const key = newKey().pub
    let w = world({ codePermission: true, accounts: { atomicassets: '' }, localAccounts: { atomicassets: accountAnswer('atomicassets', key, false) } })
    let r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)
    expect(r.codePermission).toBe('needed')
    expect(w.sent.some((x) => x.path === '/v1/chain/send_transaction')).toBe(false)
    expect(w.signed[0].map((a) => a.name)).toEqual(['setcode', 'setabi'])

    clearReads()
    w = world({ codePermission: true, accounts: { atomicassets: '' }, localAccounts: { atomicassets: accountAnswer('atomicassets', key, true) } })
    r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets' }, w.deps)
    expect(r.codePermission).toBe('none')
  })

  it('a failed account read of the source gives none and the copy goes on', async () => {
    const codePermission = await sourceCodePermission('atomicassets', () => Promise.reject(new Error('timeout')))
    const w = world({ codePermission })
    const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: w.user.pub }, w.deps)
    expect(r).toMatchObject({ created: true, same: true, codePermission: 'none' })
    expect(newAccountOf(w.sent).active.accounts).toEqual([])
  })
})

describe('kept answer of the account creation', () => {
  it('keeps the answer of the eosio send once, with its transaction id', async () => {
    const w = world()
    await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: w.user.pub }, w.deps)
    const tx = w.sent.find((x) => x.path === '/v1/chain/send_transaction')!
    expect(w.kept).toHaveLength(1)
    expect(w.kept[0].id).toBe(transactionId(hexToBytes(tx.body.packed_trx as string)))
    expect(w.kept[0].actions[0]).toBe('eosio::newaccount')
    expect(w.kept[0].answer).toEqual({ transaction_id: 'x', processed: { receipt: { status: 'executed' } } })
  })

  it('keeps nothing when no account is made', async () => {
    const w = world({ accounts: { atomicassets: 'bb'.repeat(32) } })
    await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', replace: true }, w.deps)
    expect(w.kept).toEqual([])
  })

  it('a failing keep does not fail the copy', async () => {
    const w = world({ keepFails: true })
    const r = await copyContract({ networkId: 'wax-mainnet', account: 'atomicassets', target: 'atomicassets', publicKey: w.user.pub }, w.deps)
    expect(r).toMatchObject({ created: true, same: true })
    expect(w.signed).toHaveLength(1)
  })
})
