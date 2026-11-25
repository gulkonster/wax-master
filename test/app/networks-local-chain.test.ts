// The local chain's entry in the network list.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.dataDir, getAppPath: () => h.dataDir, getVersion: () => '0.0.0', on: () => undefined },
  BrowserWindow: class {},
  dialog: {}
}))

type Networks = typeof import('../../src/main/networks')

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const never = async (): Promise<boolean> => false

async function fresh(): Promise<Networks> {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-lc-'))
  vi.resetModules()
  return import('../../src/main/networks')
}

describe('ensureLocalChainNetwork', () => {
  it('adds the entry once, as kind local with 8 decimals, and does not select it', async () => {
    const n = await fresh()
    const e = n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    expect(e).toMatchObject({ id: 'local-chain', name: 'Local chain', kind: 'local', symbol: 'WAX', precision: 8, chainId: ID_A, endpoints: ['http://127.0.0.1:8888'] })
    expect(e.history).toBeUndefined()
    expect(n.currentNetwork().id).toBe('wax-testnet')
    n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    expect(n.listNetworks().filter((x) => x.id === 'local-chain')).toHaveLength(1)
  })
  it('corrects the endpoint and the chain id and keeps the stars', async () => {
    const n = await fresh()
    n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    n.setStar('local-chain', 'alice', true)
    const e = n.ensureLocalChainNetwork({ port: 8890, chainId: ID_B })
    expect(e.endpoints).toEqual(['http://127.0.0.1:8890'])
    expect(e.chainId).toBe(ID_B)
    expect(n.stars('local-chain')).toEqual(['alice'])
    const saved = JSON.parse(readFileSync(join(h.dataDir, 'networks.json'), 'utf8')) as { networks: { id: string; endpoints: string[] }[] }
    expect(saved.networks.find((x) => x.id === 'local-chain')?.endpoints).toEqual(['http://127.0.0.1:8890'])
  })
  it('takes another name when the user has a network called Local chain', async () => {
    const n = await fresh()
    await n.addNetwork({ name: 'local chain', kind: 'local', endpoint: 'http://127.0.0.1:9000', chainId: ID_B, symbol: 'WAX', precision: 8 }, never)
    expect(n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A }).name).toBe('Local chain (WAX Master)')
  })
  it('refuses a bad port or chain id', async () => {
    const n = await fresh()
    expect(() => n.ensureLocalChainNetwork({ port: 0, chainId: ID_A })).toThrow()
    expect(() => n.ensureLocalChainNetwork({ port: 8888, chainId: 'xyz' })).toThrow()
  })
})

describe('the entry belongs to the app', () => {
  it('refuses an edit with the fixed sentence', async () => {
    const n = await fresh()
    n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    await expect(n.updateNetwork('local-chain', { endpoints: ['http://127.0.0.1:9999'] }, never)).rejects.toThrow(
      "This network belongs to the app's local chain. Change it in Network > Local Chain."
    )
  })
  it('can be removed and comes back at the next call', async () => {
    const n = await fresh()
    n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    n.removeNetwork('local-chain')
    expect(n.listNetworks().some((x) => x.id === 'local-chain')).toBe(false)
    expect(n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A }).id).toBe('local-chain')
  })
  it('clears its stars after a reset', async () => {
    const n = await fresh()
    n.ensureLocalChainNetwork({ port: 8888, chainId: ID_A })
    n.setStar('local-chain', 'alice', true)
    n.clearLocalChainMemory()
    expect(n.stars('local-chain')).toEqual([])
  })
})
