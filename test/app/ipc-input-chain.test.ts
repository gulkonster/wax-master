import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => 'C:\\nonexistent-waxm',
    getAppPath: () => 'C:\\nonexistent-waxm',
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { registerChainIpc } from '../../src/main/ipc-chain'
import { registerEditorIpc } from '../../src/main/ipc-editor'
import { registerTxIpc } from '../../src/main/ipc-tx'

function event(url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const good = event('app://bundle/index.html')

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn(good, ...args)
}

beforeAll(() => {
  registerChainIpc(() => null)
  registerTxIpc(() => null)
  registerEditorIpc()
})

const CHANNELS = [
  'networks:list', 'networks:select', 'networks:probe', 'networks:add', 'networks:update', 'networks:remove',
  'networks:chooseEndpoint', 'networks:stars', 'networks:setStar', 'networks:setStarOrder',
  'networks:removedDefaults', 'networks:restoreDefaults', 'network:status', 'network:watchFast',
  'chain:account', 'chain:accountExists', 'chain:actions', 'chain:ramPrice',
  'wallet:tokens', 'wallet:addedTokens', 'wallet:addToken', 'wallet:removeToken', 'wallet:balance', 'wallet:links', 'wallet:contractInfo',
  'contract:abi', 'contract:pack', 'contract:rows', 'contract:scopes', 'contract:historyList', 'contract:historyAdd', 'contract:historyRemove',
  'editor:start', 'editor:status', 'editor:send', 'editor:readToolchainFile', 'files:search',
  'tx:simulate', 'tx:simulationSupport', 'tx:open'
]

describe('sender checks for chain, contract, editor and simulation channels', () => {
  const foreign: [string, unknown][] = [
    ['a foreign origin', event('https://example.com/index.html')],
    ['the confirmation page', event('app://bundle/confirm.html')],
    ['the terminal page', event('app://bundle/terminal.html')],
    ['a sub frame', event('app://bundle/index.html', false)]
  ]
  for (const channel of CHANNELS) {
    for (const [name, ev] of foreign) {
      it(`${channel} refuses ${name}`, async () => {
        await expect(h.handlers.get(channel)!(ev)).rejects.toThrow('Refused')
      })
    }
  }
})

const big = 'x'.repeat(2 * 1024 * 1024)
const action = { account: 'eosio.token', name: 'transfer', authorization: [{ actor: 'alice', permission: 'active' }], data: {} }
const network = { name: 'N', kind: 'testnet', endpoint: 'https://example.com', chainId: 'a'.repeat(64), symbol: 'WAX', precision: 8 }

describe('malformed input for chain, contract, editor and simulation channels', () => {
  const cases: [string, unknown[]][] = [
    ['networks:select', [7]],
    ['networks:select', ['x'.repeat(65)]],
    ['networks:probe', [{}]],
    ['networks:probe', ['x'.repeat(513)]],
    ['networks:add', ['text']],
    ['networks:add', [{ ...network, kind: 'devnet' }]],
    ['networks:add', [{ ...network, name: 1 }]],
    ['networks:add', [{ ...network, symbol: 'TOOLONGSYM' }]],
    ['networks:add', [{ ...network, precision: 19 }]],
    ['networks:add', [{ ...network, precision: 1.5 }]],
    ['networks:add', [{ ...network, endpoint: 'x'.repeat(513) }]],
    ['networks:update', ['id', 'text']],
    ['networks:update', [7, {}]],
    ['networks:update', ['id', { kind: 'devnet' }]],
    ['networks:update', ['id', { endpoints: 'https://a' }]],
    ['networks:update', ['id', { endpoints: Array(21).fill('https://a.example') }]],
    ['networks:remove', [null]],
    ['networks:remove', ['x'.repeat(65)]],
    ['networks:stars', [7]],
    ['networks:stars', ['x'.repeat(65)]],
    ['networks:stars', ['no-such-network']],
    ['network:watchFast', ['yes']],
    ['network:watchFast', [1]],
    ['network:watchFast', [null]],
    ['networks:chooseEndpoint', ['id', -1]],
    ['networks:chooseEndpoint', ['id', 20]],
    ['networks:chooseEndpoint', ['id', 'zero']],
    ['networks:setStar', ['BAD NAME', true]],
    ['networks:setStar', [7, true]],
    ['networks:setStarOrder', ['alice']],
    ['networks:setStarOrder', [['alice', 'BAD NAME']]],
    ['chain:account', [7]],
    ['chain:account', ['UPPER']],
    ['chain:account', ['waytoolongaccountname']],
    ['chain:accountExists', [7]],
    ['chain:accountExists', ['UPPER']],
    ['chain:accountExists', ['waytoolongaccountname']],
    ['chain:actions', ['alice', -1]],
    ['chain:actions', ['alice', 1.5]],
    ['chain:actions', ['alice', 2_000_000]],
    ['chain:actions', ['BAD', 0]],
    ['chain:ramPrice', ['8192']],
    ['chain:ramPrice', [-1]],
    ['chain:ramPrice', [1.5]],
    ['chain:ramPrice', [2 ** 32]],
    ['chain:ramPrice', [null]],
    ['wallet:tokens', [7]],
    ['wallet:tokens', ['UPPER']],
    ['wallet:tokens', ['']],
    ['wallet:tokens', ['waytoolongaccountname']],
    ['wallet:links', [7]],
    ['wallet:links', ['UPPER']],
    ['wallet:links', ['']],
    ['wallet:contractInfo', [7]],
    ['wallet:contractInfo', ['BAD NAME']],
    ['wallet:contractInfo', ['']],
    ['wallet:addToken', ['BAD NAME', 'ABC']],
    ['wallet:addToken', ['', 'ABC']],
    ['wallet:addToken', ['alien.worlds', 'abc']],
    ['wallet:addToken', ['alien.worlds', 'TOOLONGSYM']],
    ['wallet:addToken', ['alien.worlds', 7]],
    ['wallet:addToken', ['alien.worlds', '']],
    ['wallet:removeToken', ['BAD NAME', 'ABC']],
    ['wallet:removeToken', ['alien.worlds', 'a b']],
    ['wallet:removeToken', [7, 'ABC']],
    ['wallet:balance', ['BAD NAME', 'eosio.token', 'WAX']],
    ['wallet:balance', ['', 'eosio.token', 'WAX']],
    ['wallet:balance', [7, 'eosio.token', 'WAX']],
    ['wallet:balance', ['alice', 'BAD NAME', 'WAX']],
    ['wallet:balance', ['alice', '', 'WAX']],
    ['wallet:balance', ['alice', 'eosio.token', 'wax']],
    ['wallet:balance', ['alice', 'eosio.token', 'TOOLONGSYM']],
    ['wallet:balance', ['alice', 'eosio.token', 7]],
    ['wallet:addedTokens', ['__proto__']],
    ['wallet:addedTokens', [7]],
    ['wallet:addedTokens', ['a b']],
    ['contract:abi', [7]],
    ['contract:abi', ['BAD NAME']],
    ['contract:pack', ['alice', 'transfer', 'text', []]],
    ['contract:pack', ['alice', 'transfer', { big }, []]],
    ['contract:pack', ['alice', 'transfer', {}, 'text']],
    ['contract:pack', ['alice', 'transfer', {}, [{ actor: 'BAD', permission: 'active' }]]],
    ['contract:pack', ['alice', 'transfer', {}, Array(21).fill({ actor: 'alice', permission: 'active' })]],
    ['contract:pack', ['alice', 'BAD ACTION', {}, []]],
    ['contract:rows', ['text']],
    ['contract:rows', [{ account: 'alice' }]],
    ['contract:rows', [{ account: 'alice', table: 'BAD' }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', limit: 0 }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', limit: 1001 }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', index: 'a b' }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', keyType: 'blob' }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', scope: 'a\u0000b' }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', lower: 'x'.repeat(257) }]],
    ['contract:rows', [{ account: 'alice', table: 'accounts', reverse: 'yes' }]],
    ['contract:scopes', ['alice', 'BAD', '', 10]],
    ['contract:scopes', ['alice', 'accounts', 'a\u0007', 10]],
    ['contract:scopes', ['alice', 'accounts', '', 0]],
    ['contract:historyList', ['alice', 'other', 'history']],
    ['contract:historyList', ['alice', 'action', 'trash']],
    ['contract:historyList', ['BAD', 'action', 'history']],
    ['contract:historyAdd', ['alice', 'action', 'history', 'transfer', 'text']],
    ['contract:historyAdd', ['alice', 'action', 'history', 'transfer', { big }]],
    ['contract:historyAdd', ['alice', 'action', 'history', 'BAD ACTION', {}]],
    ['contract:historyAdd', ['alice', 'action', 'trash', 'transfer', {}]],
    ['contract:historyRemove', ['alice', 'action', 'history', 7]],
    ['contract:historyRemove', ['alice', 'action', 'history', 'x'.repeat(65)]],
    ['contract:historyRemove', ['alice', 'nothing', 'history', 'id']],
    ['editor:send', ['one', {}]],
    ['editor:send', [-1, {}]],
    ['editor:send', [1, 'text']],
    ['editor:send', [1, [1, 2]]],
    ['editor:send', [1, { big: 'x'.repeat(17 * 1024 * 1024) }]],
    ['editor:readToolchainFile', [7]],
    ['editor:readToolchainFile', ['x'.repeat(1025)]],
    ['files:search', [7, false, false]],
    ['files:search', ['x'.repeat(501), false, false]],
    ['files:search', ['a', 'yes', false]],
    ['files:search', ['a', false, 1]],
    ['tx:simulate', ['text']],
    ['tx:simulate', [Array(21).fill(action)]],
    ['tx:simulate', [[{ ...action, name: 'BAD NAME' }]]],
    ['tx:simulate', [[{ ...action, account: 'BAD' }]]],
    ['tx:simulate', [[{ ...action, authorization: [] }]]],
    ['tx:simulate', [[{ ...action, authorization: [{ actor: 'BAD', permission: 'active' }] }]]],
    ['tx:simulate', [[7]]],
    ['tx:open', [7]],
    ['tx:open', ['abc']],
    ['tx:open', ['g'.repeat(64)]],
    ['tx:open', ['a'.repeat(65)]]
  ]
  for (const [channel, args] of cases) {
    it(`${channel} refuses ${JSON.stringify(args).slice(0, 90)}`, async () => {
      await expect(call(channel, ...args)).rejects.toThrow()
    })
  }
})
