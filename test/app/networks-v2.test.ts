// The network list, file version 2: conversion from version 1 (stars and
// project deploy settings still match), removable and restorable defaults,
// "at least one", fixed name and chain id of defaults, and the kind rules.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.dataDir, getAppPath: () => h.dataDir, getVersion: () => '0.0.0', on: () => undefined },
  BrowserWindow: class {},
  dialog: {}
}))

import { normalizeConfig } from '../../src/shared/project'

type Networks = typeof import('../../src/main/networks')

const WAX_MAIN = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'
const WAX_TEST = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'
const OTHER = 'c'.repeat(64)
const never = async (): Promise<boolean> => false

/** A fresh data folder and a fresh copy of the module (its cache starts empty). */
async function fresh(file?: unknown): Promise<Networks> {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-net-'))
  if (file !== undefined) writeFileSync(join(h.dataDir, 'networks.json'), JSON.stringify(file))
  vi.resetModules()
  return import('../../src/main/networks')
}

function onDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(h.dataDir, 'networks.json'), 'utf8')) as Record<string, unknown>
}

const V1 = {
  version: 1,
  current: 'custom-abc',
  custom: [
    {
      id: 'custom-abc',
      name: 'My Local',
      kind: 'local',
      chainId: OTHER,
      symbol: 'EOS',
      precision: 4,
      endpoints: ['http://127.0.0.1:8888'],
      preset: false,
      currentEndpoint: 0
    },
    {
      id: 'custom-def',
      name: 'Other test',
      kind: 'testnet',
      testnetConfirmed: true,
      chainId: 'd'.repeat(64),
      symbol: 'TST',
      precision: 4,
      endpoints: ['https://a.example', 'https://b.example'],
      history: 'https://h.example',
      preset: false,
      currentEndpoint: 1
    }
  ],
  presetEndpoints: { 'wax-mainnet': 2 },
  stars: { 'wax-testnet': ['alice', 'bob'], 'wax-mainnet': ['carol'], 'custom-abc': ['eosio'] }
}

beforeEach(() => {
  vi.resetModules()
})

describe('conversion from version 1', () => {
  it('keeps the ids, the chosen endpoints, the custom networks, the current network and the stars', async () => {
    const n = await fresh(V1)
    const list = n.listNetworks()
    expect(list.map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet', 'custom-abc', 'custom-def'])
    expect(n.getNetwork('wax-mainnet').currentEndpoint).toBe(2)
    expect(n.endpointOf(n.getNetwork('wax-mainnet'))).toBe('https://api.waxsweden.org')
    expect(n.getNetwork('wax-testnet').currentEndpoint).toBe(0)
    expect(n.getNetwork('custom-def')).toMatchObject({ kind: 'testnet', testnetConfirmed: true, currentEndpoint: 1, history: 'https://h.example' })
    expect(n.getNetwork('custom-abc').kind).toBe('local')
    expect(n.currentNetwork().id).toBe('custom-abc')
    expect(n.stars('wax-testnet')).toEqual(['alice', 'bob'])
    expect(n.stars('wax-mainnet')).toEqual(['carol'])
    expect(n.stars('custom-abc')).toEqual(['eosio'])
  })

  it('writes version 2 and keeps one copy of the version 1 file', async () => {
    const n = await fresh(V1)
    n.listNetworks()
    const v2 = onDisk()
    expect(v2.version).toBe(2)
    expect(v2.removedDefaults).toEqual([])
    expect((v2.networks as { id: string }[]).map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet', 'custom-abc', 'custom-def'])
    const backup = join(h.dataDir, n.NETWORKS_V1_BACKUP)
    expect(existsSync(backup)).toBe(true)
    expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual(V1)
    // Read again from the version 2 file: the same list.
    vi.resetModules()
    const again = await import('../../src/main/networks')
    expect(again.listNetworks()).toEqual(n.listNetworks())
    expect(again.stars('wax-testnet')).toEqual(['alice', 'bob'])
  })

  it('project deploy settings saved per network id still find their network', async () => {
    const n = await fresh(V1)
    const config = normalizeConfig(
      {
        deploy: {
          target: 'both',
          networks: {
            'wax-testnet': { account: 'alice', permission: 'active' },
            'wax-mainnet': { account: 'carol', permission: 'active' },
            'custom-abc': { account: 'eosio', permission: 'active' }
          }
        }
      },
      'hello'
    )
    const ids = new Set(n.listNetworks().map((x) => x.id))
    expect(Object.keys(config.deploy.networks).sort()).toEqual(['custom-abc', 'wax-mainnet', 'wax-testnet'])
    for (const id of Object.keys(config.deploy.networks)) expect(ids.has(id)).toBe(true)
    expect(config.deploy.networks['wax-testnet']).toMatchObject({ account: 'alice' })
  })

  it('a version 1 file without custom networks or a chosen endpoint gives the two defaults', async () => {
    const n = await fresh({})
    expect(n.listNetworks().map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet'])
    expect(n.currentNetwork().id).toBe('wax-testnet')
  })

  it('the WAX Testnet default lists a second endpoint', async () => {
    const n = await fresh()
    expect(n.getNetwork('wax-testnet').endpoints).toEqual(['https://testnet.waxsweden.org', 'https://waxtestnet.greymass.com'])
    expect(n.getNetwork('wax-testnet').chainId).toBe(WAX_TEST)
  })
})

describe('remove and restore', () => {
  it('any network can be removed, defaults too; its stars are forgotten; the defaults come back with their endpoints', async () => {
    const n = await fresh(V1)
    await n.updateNetwork('wax-mainnet', { endpoints: ['https://wax.eosphere.io'] }, never)
    expect(n.removeNetwork('wax-mainnet').id).toBe('custom-abc')
    expect(n.listNetworks().map((x) => x.id)).toEqual(['wax-testnet', 'custom-abc', 'custom-def'])
    expect(n.stars('wax-mainnet')).toEqual([])
    expect(n.removedDefaults()).toEqual([{ id: 'wax-mainnet', name: 'WAX Mainnet' }])
    expect(onDisk().removedDefaults).toEqual(['wax-mainnet'])
    n.removeNetwork('wax-testnet')
    expect(n.removedDefaults().map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet'])
    const back = n.restoreDefaults()
    expect(back.map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet', 'custom-abc', 'custom-def'])
    // Restored with the default endpoint list, not the edited one.
    expect(n.getNetwork('wax-mainnet').endpoints).toEqual(['https://wax.greymass.com', 'https://wax.eosphere.io', 'https://api.waxsweden.org'])
    expect(n.removedDefaults()).toEqual([])
    expect(onDisk().removedDefaults).toEqual([])
  })

  it('removing the current network selects WAX Testnet, else the first of the list', async () => {
    const n = await fresh(V1)
    expect(n.removeNetwork('custom-abc').id).toBe('wax-testnet')
    expect(n.currentNetwork().id).toBe('wax-testnet')
    n.removeNetwork('wax-testnet')
    expect(n.currentNetwork().id).toBe('wax-mainnet')
    n.selectNetwork('custom-def')
    expect(n.removeNetwork('custom-def').id).toBe('wax-mainnet')
  })

  it('the last network cannot be removed', async () => {
    const n = await fresh()
    n.removeNetwork('wax-mainnet')
    expect(() => n.removeNetwork('wax-testnet')).toThrow(/At least one network/)
    expect(n.listNetworks().map((x) => x.id)).toEqual(['wax-testnet'])
    expect(() => n.removeNetwork('nothing')).toThrow(/Unknown network/)
  })

  it('a file whose list is empty starts again from the defaults', async () => {
    const n = await fresh({ version: 2, current: 'x', networks: [], removedDefaults: ['wax-mainnet'], stars: {} })
    expect(n.listNetworks().map((x) => x.id)).toEqual(['wax-mainnet', 'wax-testnet'])
    expect(n.removedDefaults()).toEqual([])
  })
})

describe('editing', () => {
  it('a default keeps its name, kind and chain id; its endpoints and history can be edited', async () => {
    const n = await fresh()
    const t = await n.updateNetwork('wax-testnet', { endpoints: ['https://waxtestnet.greymass.com', 'https://testnet.waxsweden.org'], history: null }, never)
    expect(t).toMatchObject({ name: 'WAX Testnet', kind: 'testnet', chainId: WAX_TEST, history: undefined, preset: true })
    expect(t.endpoints).toEqual(['https://waxtestnet.greymass.com', 'https://testnet.waxsweden.org'])
    await expect(n.updateNetwork('wax-testnet', { name: 'Renamed' }, never)).rejects.toThrow(/fixed/)
    await expect(n.updateNetwork('wax-testnet', { kind: 'mainnet' }, never)).rejects.toThrow(/fixed/)
    // Sending the same name and kind is not a change.
    await expect(n.updateNetwork('wax-mainnet', { name: 'WAX Mainnet', kind: 'mainnet', endpoints: ['https://wax.greymass.com'] }, never)).resolves.toMatchObject({
      name: 'WAX Mainnet'
    })
  })

  it('a name or kind written into the file for a default is ignored', async () => {
    const n = await fresh({
      version: 2,
      current: 'wax-mainnet',
      networks: [{ id: 'wax-mainnet', name: 'Cheap', kind: 'testnet', chainId: OTHER, endpoints: ['https://x.example'], currentEndpoint: 0 }],
      removedDefaults: [],
      stars: {}
    })
    expect(n.getNetwork('wax-mainnet')).toMatchObject({ name: 'WAX Mainnet', kind: 'mainnet', chainId: WAX_MAIN, endpoints: ['https://x.example'] })
  })

  it('an endpoint is added to an existing network once', async () => {
    const n = await fresh()
    const m = n.getNetwork('wax-mainnet')
    const r = await n.updateNetwork('wax-mainnet', { endpoints: [...m.endpoints, 'https://wax.eosphere.io/'] }, never)
    expect(r.endpoints).toEqual(m.endpoints)
  })
})

describe('kind rules stay as they were', () => {
  it('a network on the WAX Mainnet chain is always mainnet, also after the default was removed', async () => {
    const n = await fresh()
    n.removeNetwork('wax-mainnet')
    const ask = vi.fn(async () => true)
    const own = await n.addNetwork({ name: 'Mine', kind: 'testnet', endpoint: 'https://wax.eosphere.io', chainId: WAX_MAIN, symbol: 'WAX', precision: 8 }, ask)
    expect(own.kind).toBe('mainnet')
    expect(ask).not.toHaveBeenCalled()
    await n.updateNetwork(own.id, { kind: 'testnet' }, ask)
    expect(n.getNetwork(own.id).kind).toBe('mainnet')
    // Restoring the default adds it next to the user's own entry for the same chain.
    n.restoreDefaults()
    expect(n.listNetworks().filter((x) => x.chainId === WAX_MAIN).map((x) => x.kind)).toEqual(['mainnet', 'mainnet'])
  })

  it("the user's own entry for the WAX Testnet chain may be testnet without the question", async () => {
    const n = await fresh()
    const ask = vi.fn(async () => false)
    const own = await n.addNetwork({ name: 'Testnet 2', kind: 'testnet', endpoint: 'https://wax-testnet.eosphere.io', chainId: WAX_TEST, symbol: 'WAX', precision: 8 }, ask)
    expect(own.kind).toBe('testnet')
    expect(ask).not.toHaveBeenCalled()
  })

  it('an unknown chain marked testnet needs the question; local needs endpoints on this computer', async () => {
    const n = await fresh()
    await expect(n.addNetwork({ name: 'X', kind: 'testnet', endpoint: 'https://x.example', chainId: OTHER, symbol: 'X', precision: 4 }, never)).rejects.toThrow(/not marked/)
    await expect(n.addNetwork({ name: 'X', kind: 'local', endpoint: 'https://x.example', chainId: OTHER, symbol: 'X', precision: 4 }, never)).rejects.toThrow(/this computer/)
    const x = await n.addNetwork({ name: 'X', kind: 'mainnet', endpoint: 'https://x.example', chainId: OTHER, symbol: 'X', precision: 4 }, never)
    expect(x.kind).toBe('mainnet')
  })

  it('names stay unique when a network is renamed', async () => {
    const n = await fresh()
    const x = await n.addNetwork({ name: 'X', kind: 'mainnet', endpoint: 'https://x.example', chainId: OTHER, symbol: 'X', precision: 4 }, never)
    await expect(n.updateNetwork(x.id, { name: 'wax testnet' }, never)).rejects.toThrow(/exists/)
  })

  it('knows the names of the known chains', async () => {
    const n = await fresh()
    expect(n.knownChainName(WAX_MAIN)).toBe('WAX Mainnet')
    expect(n.knownChainName(WAX_TEST)).toBe('WAX Testnet')
    expect(n.knownChainName(OTHER)).toBeNull()
  })
})
