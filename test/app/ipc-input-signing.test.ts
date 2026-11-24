// Handler level checks for the signing, deploy, account, faucet, vault-file, toolchain-file,
// build, wasm and dirty-state channels: sender rules, malformed input, and the WAX Testnet gate.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>

const h = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
  dialogCalls: 0,
  net: { id: 'wax-mainnet', chainId: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4' },
  tokenCalls: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.dataDir,
    getAppPath: () => h.dataDir,
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: Fn) => h.handlers.set(ch, fn) },
  powerMonitor: { on: () => undefined, getSystemIdleTime: () => 0 },
  clipboard: { writeText: () => undefined, readText: () => '', clear: () => undefined },
  dialog: {
    showMessageBox: async () => {
      h.dialogCalls++
      return { response: 0 }
    },
    showOpenDialog: async () => {
      h.dialogCalls++
      return { canceled: true, filePaths: [] }
    },
    showSaveDialog: async () => {
      h.dialogCalls++
      return { canceled: true }
    }
  },
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

vi.mock('../../src/main/networks', async (orig) => ({
  ...(await orig<typeof import('../../src/main/networks')>()),
  currentNetwork: () => ({ ...h.net, name: 'N', kind: 'testnet', endpoints: ['https://example.com'], chosen: 0 })
}))
vi.mock('../../src/main/faucet', async (orig) => ({
  ...(await orig<typeof import('../../src/main/faucet')>()),
  requestTokens: async (name: string) => {
    h.tokenCalls.push(name)
    return { ok: true, message: 'sent' }
  }
}))

import { registerIpc } from '../../src/main/ipc'
import { registerKeys } from '../../src/main/keys-service'
import { registerTxIpc } from '../../src/main/ipc-tx'
import { registerToolchainIpc } from '../../src/main/ipc-toolchains'
import { registerCloseGuard } from '../../src/main/close-guard'
import { WAX_TESTNET_CHAIN, WAX_TESTNET_ID } from '../../src/main/networks'

function event(url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { id: 1, mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const good = event('app://bundle/index.html')

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn(good, ...args)
}

beforeAll(() => {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-ipc-sign-'))
  const getWindow = (): null => null
  registerIpc(getWindow)
  registerKeys(getWindow)
  registerTxIpc(getWindow)
  registerToolchainIpc(getWindow)
  registerCloseGuard(getWindow)
})

beforeEach(() => {
  h.dialogCalls = 0
  h.tokenCalls.length = 0
  h.net = { id: 'wax-mainnet', chainId: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4' }
})

const CHANNELS = [
  'tx:run', 'deploy:plan', 'deploy:simulate', 'deploy:run',
  'accounts:create', 'accounts:changeKey', 'accounts:clearCode',
  'faucet:create', 'faucet:tokens', 'faucet:suggestName',
  'toolchains:chooseFile', 'keys:exportVault', 'keys:newPending', 'keys:discardPending', 'keys:remove',
  'build:run', 'files:wasmInfo', 'app:setDirty'
]

describe('sender checks', () => {
  const foreign: [string, unknown][] = [
    ['a foreign origin', event('https://example.com/index.html')],
    ['the confirmation page', event('app://bundle/confirm.html')],
    ['the terminal page', event('app://bundle/terminal.html')],
    ['the terminal frame', event('app://terminal/terminal.html', false)],
    ['a sub frame of the editor page', event('app://bundle/index.html', false)]
  ]
  for (const channel of CHANNELS) {
    for (const [name, ev] of foreign) {
      it(`${channel} refuses ${name} and shows no dialog`, async () => {
        await expect(h.handlers.get(channel)!(ev)).rejects.toThrow('Refused')
        expect(h.dialogCalls).toBe(0)
      })
    }
  }
})

const big = 'x'.repeat(2 * 1024 * 1024)
const action = { account: 'eosio.token', name: 'transfer', authorization: [{ actor: 'alice', permission: 'active' }], data: {} }
const KEY = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
const newAccount = {
  creator: 'alice', creatorPermission: 'active', name: 'bob', ownerKey: KEY,
  activeKey: KEY, ramBytes: 4096, stakeCpu: '1.00000000 WAX', stakeNet: '1.00000000 WAX', transfer: false
}

describe('malformed input', () => {
  const cases: [string, unknown[]][] = [
    ['tx:run', ['text']],
    ['tx:run', [[]]],
    ['tx:run', [Array(21).fill(action)]],
    ['tx:run', [[{ ...action, name: 'BAD NAME' }]]],
    ['tx:run', [[{ ...action, account: 'BAD' }]]],
    ['tx:run', [[{ ...action, authorization: [] }]]],
    ['tx:run', [[{ ...action, authorization: [{ actor: 'BAD', permission: 'active' }] }]]],
    ['tx:run', [[{ ...action, data: { big } }]]],
    ['tx:run', [[7]]],
    ['deploy:plan', ['text']],
    ['deploy:plan', [{ account: 'BAD', permission: 'active', target: 'both' }]],
    ['deploy:plan', [{ account: 'alice', permission: 'BAD NAME', target: 'both' }]],
    ['deploy:plan', [{ account: 'alice', permission: 'active', target: 'zip' }]],
    ['deploy:plan', [{ account: 'alice', permission: 'active' }]],
    ['deploy:plan', [{ networkId: 7, account: 'alice', permission: 'active', target: 'both' }]],
    ['deploy:simulate', [7]],
    ['deploy:simulate', ['x'.repeat(65)]],
    ['deploy:simulate', ['no-such-plan']],
    ['deploy:run', [7]],
    ['deploy:run', [null]],
    ['deploy:run', ['x'.repeat(65)]],
    ['accounts:create', ['text']],
    ['accounts:create', [{}]],
    ['accounts:create', [{ ...newAccount, name: 'BAD' }]],
    ['accounts:create', [{ ...newAccount, creator: 7 }]],
    ['accounts:create', [{ ...newAccount, ramBytes: -1 }]],
    ['accounts:create', [{ ...newAccount, ramBytes: 1e9 }]],
    ['accounts:create', [{ ...newAccount, ramBytes: 1.5 }]],
    ['accounts:create', [{ ...newAccount, ownerKey: 'x'.repeat(121) }]],
    ['accounts:create', [{ ...newAccount, transfer: 'yes' }]],
    ['accounts:changeKey', ['text']],
    ['accounts:changeKey', [{ account: 'alice' }]],
    ['accounts:changeKey', [{ account: 'alice', permission: 'active', oldKey: 'a', newKey: 'b', signWith: 'BAD' }]],
    ['accounts:changeKey', [{ account: 'alice', permission: 'active', oldKey: 7, newKey: 'b', signWith: 'alice' }]],
    ['accounts:clearCode', [7, 'active']],
    ['accounts:clearCode', ['alice', 7]],
    ['accounts:clearCode', ['BAD', 'active']],
    ['accounts:clearCode', ['alice', 'BAD NAME']],
    ['files:wasmInfo', [7]],
    ['files:wasmInfo', ['notes.txt']],
    ['files:wasmInfo', ['../x.wasm']],
    ['files:wasmInfo', ['C:/x.wasm']],
    ['files:wasmInfo', ['/abs/x.wasm']],
    ['files:wasmInfo', ['x.wasm:stream']],
    ['files:wasmInfo', ['build/x.wasm']],
    ['app:setDirty', ['3']],
    ['app:setDirty', [-1]],
    ['app:setDirty', [1.5]],
    ['app:setDirty', [100001]],
    ['app:setDirty', [null]],
    ['keys:remove', [7]],
    ['keys:remove', ['no-such-key']],
    // The vault does not exist here, so a new key cannot be made.
    ['keys:newPending', []]
  ]
  for (const [channel, args] of cases) {
    it(`${channel} refuses ${JSON.stringify(args).slice(0, 80)}`, async () => {
      await expect(call(channel, ...args)).rejects.toThrow()
      expect(h.dialogCalls).toBe(0)
    })
  }

  it('app:setDirty accepts a count and keys:discardPending needs no argument', async () => {
    await expect(call('app:setDirty', 0)).resolves.toBeUndefined()
    await expect(call('keys:discardPending')).resolves.toBeUndefined()
  })
  it('toolchains:chooseFile and keys:exportVault ask the user and return nothing when it is cancelled', async () => {
    await expect(call('toolchains:chooseFile')).resolves.toBeNull()
    expect(h.dialogCalls).toBe(1)
    await expect(call('keys:exportVault')).resolves.toBe(false)
    expect(h.dialogCalls).toBe(2)
  })
  it('a signing call with a good shape stops at the locked vault before any window', async () => {
    await expect(call('tx:run', [action])).rejects.toThrow(/unlock/i)
    await expect(call('accounts:clearCode', 'alice', 'active')).rejects.toThrow(/unlock/i)
    await expect(call('accounts:create', newAccount)).rejects.toThrow(/unlock/i)
  })
})

describe('faucet: WAX Testnet only, by preset id and chain id', () => {
  it('is refused on WAX Mainnet and on any other network', async () => {
    await expect(call('faucet:create', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    await expect(call('faucet:tokens', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    h.net = { id: 'my-net', chainId: WAX_TESTNET_CHAIN }
    await expect(call('faucet:create', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    await expect(call('faucet:tokens', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    expect(h.tokenCalls).toEqual([])
  })
  it('is refused when the id says WAX Testnet but the chain id is another one', async () => {
    h.net = { id: WAX_TESTNET_ID, chainId: 'a'.repeat(64) }
    await expect(call('faucet:create', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    await expect(call('faucet:tokens', 'abcdefghijk1')).rejects.toThrow('WAX Testnet')
    expect(h.tokenCalls).toEqual([])
  })
  it('works on the real preset and still validates the name', async () => {
    h.net = { id: WAX_TESTNET_ID, chainId: WAX_TESTNET_CHAIN }
    await expect(call('faucet:create', 7)).rejects.toThrow()
    await expect(call('faucet:create', 'x'.repeat(13))).rejects.toThrow()
    await expect(call('faucet:tokens', 'BAD NAME')).rejects.toThrow()
    await expect(call('faucet:tokens', 7)).rejects.toThrow()
    await expect(call('faucet:tokens', 'abcdefghijk1')).resolves.toMatchObject({ ok: true })
    expect(h.tokenCalls).toEqual(['abcdefghijk1'])
    // No vault yet: nothing is requested from the service.
    await expect(call('faucet:create', 'abcdefghijk1')).resolves.toMatchObject({ ok: false })
  })
  it('suggests a valid name on any network', async () => {
    expect(await call('faucet:suggestName')).toMatch(/^[a-z1-5]{12}$/)
  })
})
