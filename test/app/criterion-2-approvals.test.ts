// Release criterion 2 (approval integrity): what the confirmation shows and
// requires is made by the main process from the packed bytes: network kind,
// title, typed name, deploy hashes, one approval at a time, locked vault.

import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
  answers: [] as number[],
  dialogs: [] as { message: string; detail: string; cancel: string }[]
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.dataDir, getAppPath: () => h.dataDir, getVersion: () => '0.0.0', on: () => undefined },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      const o = args[args.length - 1] as { message: string; detail: string; buttons: string[]; defaultId: number }
      h.dialogs.push({ message: o.message, detail: o.detail, cancel: o.buttons[o.defaultId] })
      return { response: h.answers.shift() ?? 1 }
    }
  },
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  powerMonitor: { on: () => undefined },
  BrowserWindow: class {}
}))

import { Signer, BUSY_MESSAGE, LOCKED_MESSAGE, type SignerDeps } from '../../src/main/signer'
import { Vault } from '../../src/main/vault'
import { effectiveKind, listNetworks, MAINNET_CHAINS, WAX_TESTNET_CHAIN } from '../../src/main/networks'
import { registerChainIpc } from '../../src/main/ipc-chain'
import { parseActions } from '../../src/main/ipc-tx'
import type { NetworkInfo } from '../../src/shared/chain-types'
import abis from '../fixtures/chain/system-abis.json'
import {
  decodeAction,
  EOSIO_ABI,
  generatePrivateKey,
  hexToBytes,
  parseAbi,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  unpackTransaction
} from '../../src/chain-core'

const WAX_MAIN = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'
const OTHER_CHAIN = '7a'.repeat(32)
const PW = 'correct horse battery'

const fixture = abis as unknown as { abi: Record<string, unknown> }
const tokenAbi = parseAbi(fixture.abi['eosio.token'])
const eosioAbi = parseAbi(fixture.abi['eosio'])

let vault: Vault
let pub: string
let sent: { ep: string; body: { signatures: string[]; packed_trx: string } }[]
let network: NetworkInfo
let now: number
let codeHashCalls: string[]

function net(kind: NetworkInfo['kind'], chainId = WAX_TESTNET_CHAIN, endpoint = 'https://node-a.example'): NetworkInfo {
  return { id: 'n1', name: 'Net', kind, chainId, symbol: 'WAX', precision: 8, endpoints: [endpoint, 'https://node-b.example'], preset: false, currentEndpoint: 0 }
}

function deps(over: Partial<SignerDeps> = {}): SignerDeps {
  return {
    vault,
    getInfo: async () => ({
      chain_id: network.chainId,
      head_block_id: '1a2b3c4d' + '00'.repeat(28),
      head_block_time: new Date(now).toISOString().slice(0, 19),
      last_irreversible_block_id: '1a2b3c40' + '11'.repeat(28)
    }),
    getAbi: async (_ep, account) => (account === 'eosio.token' ? tokenAbi : eosioAbi),
    getAccount: async () => ({
      permissions: [
        { perm_name: 'active', parent: 'owner', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }] } },
        { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key: pub, weight: 1 }] } }
      ]
    }),
    getCodeHash: async (ep, account) => {
      codeHashCalls.push(`${ep} ${account}`)
      return 'ee'.repeat(32)
    },
    send: async (ep, body) => {
      sent.push({ ep, body: body as never })
      return { transaction_id: 'x', processed: {} }
    },
    network: () => network,
    now: () => now,
    mainnetSigning: false,
    ...over
  }
}

const auth = (actor = 'alice'): { actor: string; permission: string }[] => [{ actor, permission: 'active' }]
const transfer = {
  account: 'eosio.token',
  name: 'transfer',
  authorization: auth(),
  data: { from: 'alice', to: 'bob', quantity: '1.00000000 WAX', memo: 'hi' }
}
const authority = (): unknown => ({ threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] })
const updateauth = (account: string, actor = account): typeof transfer => ({
  account: 'eosio',
  name: 'updateauth',
  authorization: auth(actor),
  data: { account, permission: 'active', parent: 'owner', auth: authority() } as never
})
const setcode = (account: string, code: string): typeof transfer => ({
  account: 'eosio',
  name: 'setcode',
  authorization: auth(account),
  data: { account, vmtype: 0, vmversion: 0, code } as never
})
const setabi = (account: string, abi: string): typeof transfer => ({
  account: 'eosio',
  name: 'setabi',
  authorization: auth(account),
  data: { account, abi } as never
})
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

beforeAll(() => {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-c2a-'))
  registerChainIpc(() => null)
})

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-c2a-v-'))
  vault = new Vault(join(dir, 'vault.json'), { N: 2 ** 10, r: 8, p: 1 })
  await vault.create(PW)
  const k = generatePrivateKey()
  pub = publicKeyToString(publicFromPrivate(k), 'new')
  vault.addKey(privateKeyToString(k, 'wif'), 'alice')
  sent = []
  codeHashCalls = []
  network = net('testnet')
  now = Date.now()
})

describe('task 1: the network kind cannot switch off the mainnet protections', () => {
  it('the kind comes from the chain id first; local only on this computer; testnet only when confirmed', () => {
    for (const id of Object.keys(MAINNET_CHAINS)) {
      expect(effectiveKind({ chainId: id, kind: 'testnet', endpoints: ['https://a.example'], testnetConfirmed: true })).toBe('mainnet')
      expect(effectiveKind({ chainId: id, kind: 'local', endpoints: ['http://127.0.0.1:8888'] })).toBe('mainnet')
    }
    expect(effectiveKind({ chainId: WAX_TESTNET_CHAIN, kind: 'testnet', endpoints: ['https://a.example'] })).toBe('testnet')
    expect(effectiveKind({ chainId: OTHER_CHAIN, kind: 'testnet', endpoints: ['https://a.example'] })).toBe('mainnet')
    expect(effectiveKind({ chainId: OTHER_CHAIN, kind: 'testnet', endpoints: ['https://a.example'], testnetConfirmed: true })).toBe('testnet')
    expect(effectiveKind({ chainId: OTHER_CHAIN, kind: 'local', endpoints: ['https://a.example'] })).toBe('mainnet')
    expect(effectiveKind({ chainId: OTHER_CHAIN, kind: 'local', endpoints: ['http://127.0.0.1:8888', 'http://localhost:8889'] })).toBe('local')
    expect(effectiveKind({ chainId: OTHER_CHAIN, kind: 'bogus', endpoints: [] })).toBe('mainnet')
  })

  it('WAX Mainnet chain id saved as testnet: red, typed name, release-build block, Approve refused', async () => {
    network = net('testnet', WAX_MAIN)
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [updateauth('alice')] })
    expect(record.network.kind).toBe('mainnet')
    expect(record.typedName).toBe('alice')
    expect(record.blocked).toMatch(/release build/)
    await expect(s.approve(record.id, secret, 'alice')).rejects.toThrow(/release build/)
    expect(sent).toHaveLength(0)
  })

  it('networks:add with the WAX Mainnet chain id and kind testnet is saved as mainnet', async () => {
    const add = h.handlers.get('networks:add')!
    const e = { senderFrame: { url: 'app://bundle/index.html' }, sender: {} as Record<string, unknown> }
    ;(e.sender as { mainFrame: unknown }).mainFrame = e.senderFrame
    const n = (await add(e, { name: 'Mine', kind: 'testnet', endpoint: 'https://wax.example', chainId: WAX_MAIN, symbol: 'WAX', precision: 8 })) as NetworkInfo
    expect(n.kind).toBe('mainnet')
    expect(listNetworks().find((x) => x.id === n.id)?.kind).toBe('mainnet')
    expect(n.kindNote).toMatch(/always mainnet/)
    expect(h.dialogs).toHaveLength(0)
  })

  it('marking an unknown chain testnet asks in a main-process dialog (default Cancel); Cancel saves nothing', async () => {
    const add = h.handlers.get('networks:add')!
    const e = { senderFrame: { url: 'app://bundle/index.html' }, sender: {} as Record<string, unknown> }
    ;(e.sender as { mainFrame: unknown }).mainFrame = e.senderFrame
    const before = listNetworks().length
    h.answers.push(1)
    await expect(add(e, { name: 'Other', kind: 'testnet', endpoint: 'https://other.example', chainId: OTHER_CHAIN, symbol: 'ABC', precision: 4 })).rejects.toThrow(/not marked/)
    expect(listNetworks().length).toBe(before)
    expect(h.dialogs[0].message).toMatch(/Treat this network as a test network/)
    expect(h.dialogs[0].detail).toContain(OTHER_CHAIN)
    expect(h.dialogs[0].detail).toContain('https://other.example')
    expect(h.dialogs[0].cancel).toBe('Cancel')
    h.answers.push(0)
    const n = (await add(e, { name: 'Other', kind: 'testnet', endpoint: 'https://other.example', chainId: OTHER_CHAIN, symbol: 'ABC', precision: 4 })) as NetworkInfo
    expect(n.kind).toBe('testnet')
    // An unknown chain without a kind starts as mainnet; local is refused for a remote endpoint.
    const m = (await add(e, { name: 'Other2', kind: 'mainnet', endpoint: 'https://other2.example', chainId: OTHER_CHAIN, symbol: 'ABC', precision: 4 })) as NetworkInfo
    expect(m.kind).toBe('mainnet')
    await expect(add(e, { name: 'Other3', kind: 'local', endpoint: 'https://other3.example', chainId: OTHER_CHAIN, symbol: 'ABC', precision: 4 })).rejects.toThrow(/this computer/)
  })
})

describe('a chain id is taken only in its one written form', () => {
  const UPPER_MAIN = WAX_MAIN.toUpperCase()

  it('a networks.json entry with the WAX Mainnet id in capital letters, kind testnet, confirmed: the signer prepares nothing for it', async () => {
    const saved = h.dataDir
    h.dataDir = mkdtempSync(join(tmpdir(), 'wm-c2a-file-'))
    try {
      writeFileSync(
        join(h.dataDir, 'networks.json'),
        JSON.stringify({
          version: 2,
          current: 'custom-cheap',
          networks: [
            {
              id: 'custom-cheap',
              name: 'Cheap',
              kind: 'testnet',
              testnetConfirmed: true,
              chainId: UPPER_MAIN,
              symbol: 'WAX',
              precision: 8,
              endpoints: ['https://evil.example'],
              currentEndpoint: 0
            }
          ],
          removedDefaults: [],
          stars: {}
        })
      )
      vi.resetModules()
      const nets = await import('../../src/main/networks')
      const signerModule = await import('../../src/main/signer')
      expect(nets.listNetworks().some((x) => x.id === 'custom-cheap')).toBe(false)
      expect(nets.listNetworks().some((x) => x.kind === 'testnet' && x.chainId.toLowerCase() === WAX_MAIN)).toBe(false)
      const answers: string[] = []
      const s = new signerModule.Signer(
        deps({
          network: (id: string) => nets.getNetwork(id),
          getInfo: async (ep: string) => {
            answers.push(ep)
            return { chain_id: UPPER_MAIN, head_block_id: '1a2b3c4d' + '00'.repeat(28), head_block_time: new Date(now).toISOString().slice(0, 19), last_irreversible_block_id: '1a2b3c40' + '11'.repeat(28) }
          }
        })
      )
      await expect(s.prepare({ networkId: 'custom-cheap', actions: [transfer] })).rejects.toThrow(/Unknown network/)
      expect(answers).toHaveLength(0)
      expect(sent).toHaveLength(0)
    } finally {
      h.dataDir = saved
    }
  })

  it('an endpoint answering with the chain id in another letter case is refused; so is a network object carrying such an id', async () => {
    const upperInfo = (id: string): SignerDeps['getInfo'] => async () => ({
      chain_id: id,
      head_block_id: '1a2b3c4d' + '00'.repeat(28),
      head_block_time: new Date(now).toISOString().slice(0, 19),
      last_irreversible_block_id: '1a2b3c40' + '11'.repeat(28)
    })
    network = net('testnet', WAX_TESTNET_CHAIN)
    await expect(new Signer(deps({ getInfo: upperInfo(WAX_TESTNET_CHAIN.toUpperCase()) })).prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(/Nothing was prepared/)
    network = { ...net('testnet', UPPER_MAIN), testnetConfirmed: true }
    await expect(new Signer(deps({ getInfo: upperInfo(UPPER_MAIN) })).prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(/Nothing was prepared/)
    expect(sent).toHaveLength(0)
  })
})

describe('task 2: the confirmation title is made by the main process', () => {
  it('from the decoded actions; fixed texts for the started operation', async () => {
    let s = new Signer(deps())
    let r = await s.prepare({ networkId: 'n1', actions: [transfer] })
    expect(r.record.title).toBe('Run eosio.token::transfer')
    s.cancel(r.record.id)
    r = await s.prepare({ networkId: 'n1', actions: [transfer, transfer] })
    expect(r.record.title).toBe('2 actions')
    s.cancel(r.record.id)
    s = new Signer(deps())
    r = await s.prepare({ networkId: 'n1', actions: [setcode('alice', '0061736d01000000'), setabi('alice', '00')], kind: 'deploy' })
    expect(r.record.title).toBe('Deploy contract to alice')
    s.cancel(r.record.id)
    r = await s.prepare({ networkId: 'n1', actions: [updateauth('alice')], kind: 'changeKey' })
    expect(r.record.title).toBe('Change key of alice@active')
    s.cancel(r.record.id)
    // A fixed text that does not match the actions is not used.
    r = await s.prepare({ networkId: 'n1', actions: [transfer], kind: 'deploy' })
    expect(r.record.title).toBe('Run eosio.token::transfer')
  })

  it('tx:run takes no title from the editor; action data is limited to 1 MB', () => {
    const big = { ...transfer, data: { ...transfer.data, memo: 'x'.repeat(1024 * 1024) } }
    expect(() => parseActions([big])).toThrow(/too large/)
    expect(parseActions([transfer])).toHaveLength(1)
    expect(Object.keys(parseActions([{ ...transfer, purpose: 'SIMULATION ONLY - nothing is sent' }])[0])).not.toContain('purpose')
  })
})

describe('task 3: typed name', () => {
  it('is the account field of the decoded guarded action, not the first authorization', async () => {
    network = net('mainnet')
    const s = new Signer(deps({ mainnetSigning: true }))
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [updateauth('alice', 'bob')] })
    expect(record.typedName).toBe('alice')
    await expect(s.approve(record.id, secret, 'bob')).rejects.toThrow(/Type the account name "alice"/)
    expect(sent).toHaveLength(0)
  })

  it('guarded actions naming two accounts in one transaction are refused', async () => {
    const s = new Signer(deps())
    await expect(s.prepare({ networkId: 'n1', actions: [updateauth('alice'), updateauth('carol', 'alice')] })).rejects.toThrow(/more than one account/)
  })

  it('missing or wrong typed name is refused (mainnet-like); the right one is sent', async () => {
    network = net('mainnet')
    for (const typed of [undefined, '', 'alicE', 'alice ']) {
      const s = new Signer(deps({ mainnetSigning: true }))
      const { record, secret } = await s.prepare({ networkId: 'n1', actions: [updateauth('alice')] })
      await expect(s.approve(record.id, secret, typed)).rejects.toThrow(/Type the account name/)
    }
    expect(sent).toHaveLength(0)
    const s = new Signer(deps({ mainnetSigning: true }))
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [updateauth('alice')] })
    await s.approve(record.id, secret, 'alice')
    expect(sent).toHaveLength(1)
  })

  it('deleteauth, linkauth and unlinkauth need the typed account name on mainnet-like networks, not on testnet', async () => {
    const sys = (name: string, data: Record<string, unknown>): typeof transfer => ({ account: 'eosio', name, authorization: auth('alice'), data: data as never })
    const actions = [
      sys('deleteauth', { account: 'alice', permission: 'claim' }),
      sys('linkauth', { account: 'alice', code: 'eosio.token', type: 'transfer', requirement: 'claim' }),
      sys('unlinkauth', { account: 'alice', code: 'eosio.token', type: 'transfer' })
    ]
    for (const a of actions) {
      network = net('mainnet')
      let s = new Signer(deps({ mainnetSigning: true }))
      let r = await s.prepare({ networkId: 'n1', actions: [a] })
      expect(r.record.typedName, a.name).toBe('alice')
      await expect(s.approve(r.record.id, r.secret, 'bob')).rejects.toThrow(/Type the account name/)
      network = net('testnet')
      s = new Signer(deps())
      r = await s.prepare({ networkId: 'n1', actions: [a] })
      expect(r.record.typedName, a.name).toBeUndefined()
      s.cancel(r.record.id)
    }
    expect(sent).toHaveLength(0)
  })

  it('Clear Contract Code needs the typed name on a test network too; a transfer there does not', async () => {
    network = net('testnet')
    let s = new Signer(deps())
    let p = await s.prepare({ networkId: 'n1', actions: [setcode('alice', ''), setabi('alice', '')], kind: 'clearCode' })
    expect(p.record.typedName).toBe('alice')
    expect(p.record.title).toBe('Clear contract code of alice')
    expect(p.record.artifacts?.clear).toBe(true)
    await expect(s.approve(p.record.id, p.secret)).rejects.toThrow(/Type the account name/)
    expect(sent).toHaveLength(0)
    p = await s.prepare({ networkId: 'n1', actions: [setcode('alice', ''), setabi('alice', '')], kind: 'clearCode' })
    await s.approve(p.record.id, p.secret, 'alice')
    expect(sent).toHaveLength(1)
    s = new Signer(deps())
    p = await s.prepare({ networkId: 'n1', actions: [transfer] })
    expect(p.record.typedName).toBeUndefined()
  })
})

describe('task 4: deploy hashes come from the signed bytes', () => {
  it('sizes and SHA-256 of code and ABI are those inside the packed transaction; code on the account read in prepare from its endpoint', async () => {
    const wasm = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 5, 6, 7])
    const abi = Uint8Array.from([14, 101, 111, 115, 105, 111, 58, 58, 97, 98, 105, 47, 49, 46, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [setcode('alice', hex(wasm)), setabi('alice', hex(abi))], kind: 'deploy' })
    expect(codeHashCalls).toEqual(['https://node-a.example alice'])
    expect(record.artifacts).toMatchObject({ account: 'alice', wasmSize: wasm.length, abiSize: abi.length, currentCodeHash: 'ee'.repeat(32), clear: false })
    expect(record.actions[0].blob).toEqual({ field: 'code', size: wasm.length, sha256: sha(wasm) })
    await s.approve(record.id, secret)
    const trx = unpackTransaction(hexToBytes(sent[0].body.packed_trx))
    const codeSent = hexToBytes((decodeAction(EOSIO_ABI, 'setcode', hexToBytes(trx.actions[0].data)) as { code: string }).code)
    const abiSent = hexToBytes((decodeAction(EOSIO_ABI, 'setabi', hexToBytes(trx.actions[1].data)) as { abi: string }).abi)
    expect(record.artifacts?.wasmSha256).toBe(sha(codeSent))
    expect(record.artifacts?.abiSha256).toBe(sha(abiSent))
  })

  it('a setabi typed on the Contract page is hashed the same way; an unreadable code hash shows as unknown', async () => {
    const s = new Signer(deps({ getCodeHash: async () => Promise.reject(new Error('down')) }))
    const abiHex = '0e656f73696f3a3a6162692f312e310000000000000000000000'
    const { record } = await s.prepare({ networkId: 'n1', actions: [setabi('alice', abiHex)] })
    expect(record.artifacts?.abiSize).toBe(abiHex.length / 2)
    expect(record.artifacts?.abiSha256).toBe(sha(hexToBytes(abiHex)))
    expect(record.artifacts?.wasmSha256).toBeUndefined()
    expect(record.artifacts?.currentCodeHash).toBeNull()
  })
})

describe('task 5 and endpoint changes', () => {
  it('a second prepare while one approval is open is refused; also when both start together', async () => {
    const s = new Signer(deps())
    const first = await s.prepare({ networkId: 'n1', actions: [transfer] })
    await expect(s.prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(BUSY_MESSAGE)
    s.cancel(first.record.id)
    const both = await Promise.allSettled([s.prepare({ networkId: 'n1', actions: [transfer] }), s.prepare({ networkId: 'n1', actions: [transfer] })])
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(both.filter((x) => x.status === 'rejected')).toHaveLength(1)
  })

  it('a locked vault stops prepare before anything is read from the chain', async () => {
    let reads = 0
    const s = new Signer(
      deps({
        getInfo: async () => {
          reads++
          throw new Error('not reached')
        }
      })
    )
    vault.lock()
    await expect(s.prepare({ networkId: 'n1', actions: [transfer] })).rejects.toThrow(LOCKED_MESSAGE)
    expect(reads).toBe(0)
  })

  it('endpoint or network changed after prepare: the approval still sends to the stored endpoint', async () => {
    const s = new Signer(deps())
    const { record, secret } = await s.prepare({ networkId: 'n1', actions: [transfer] })
    network = { ...net('mainnet', OTHER_CHAIN, 'https://elsewhere.example'), id: 'n2', currentEndpoint: 1 }
    await s.approve(record.id, secret)
    expect(sent.map((x) => x.ep)).toEqual(['https://node-a.example'])
    expect(record.network.chainId).toBe(WAX_TESTNET_CHAIN)
  })
})
