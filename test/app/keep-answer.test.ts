// The node's answer of a send confirmed in the vault window is kept the same way for every caller
// (Run, Deploy and the deployment of Copy contract): one entry per transaction, first action and count.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'C:\nonexistent-waxm', getAppPath: () => 'C:\nonexistent-waxm', getVersion: () => '0.0.0', on: () => undefined },
  ipcMain: { handle: () => undefined },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))
vi.mock('../../src/main/sent-store', () => ({
  KEPT_PER_NETWORK: 200,
  sentStore: () => ({
    keep: (...args: unknown[]) => {
      h.calls.push(args)
      return !h.fail
    }
  })
}))

import { keepAnswer } from '../../src/main/ipc-tx'

const TX = 'ab'.repeat(32)

describe('keepAnswer', () => {
  it('keeps the answer under the network with the first action and the count', () => {
    h.calls = []
    const record = {
      transactionId: TX,
      endpoint: 'http://127.0.0.1:8890',
      network: { name: 'Local chain' },
      actions: [
        { account: 'eosio', name: 'setcode' },
        { account: 'eosio', name: 'setabi' }
      ]
    }
    expect(keepAnswer('local-chain', record, { transaction_id: TX })).toBe(true)
    expect(h.calls).toEqual([
      ['local-chain', TX, { network: 'Local chain', endpoint: 'http://127.0.0.1:8890', first: 'eosio::setcode', count: 2 }, { transaction_id: TX }]
    ])
  })

  it('gives false when the answer was not kept', () => {
    h.fail = true
    expect(keepAnswer('local-chain', { transactionId: TX, endpoint: 'e', network: { name: 'n' }, actions: [] }, {})).toBe(false)
    h.fail = false
  })
})
