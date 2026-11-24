// Networks: the two WAX presets and saved custom Antelope networks, the
// current network and endpoint, and starred accounts per network.

import { join } from 'node:path'
import type { NetworkInfo, NetworkKind } from '../shared/chain-types'
import { dataDir } from './paths'
import { readJson, writeJson } from './jsonfile'
import { chain, normalizeEndpoint, RpcError } from './rpc'
import { log } from './log'

export const WAX_MAINNET_ID = 'wax-mainnet'
export const WAX_TESTNET_ID = 'wax-testnet'

const PRESETS: NetworkInfo[] = [
  {
    id: WAX_MAINNET_ID,
    name: 'WAX Mainnet',
    kind: 'mainnet',
    chainId: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4',
    symbol: 'WAX',
    precision: 8,
    endpoints: ['https://wax.greymass.com', 'https://wax.eosphere.io', 'https://api.waxsweden.org'],
    history: 'https://api.waxsweden.org',
    preset: true,
    currentEndpoint: 0
  },
  {
    id: WAX_TESTNET_ID,
    name: 'WAX Testnet',
    kind: 'testnet',
    chainId: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
    symbol: 'WAX',
    precision: 8,
    endpoints: ['https://testnet.waxsweden.org'],
    history: 'https://testnet.waxsweden.org',
    preset: true,
    currentEndpoint: 0
  }
]

interface NetFile {
  version: 1
  current: string
  custom: NetworkInfo[]
  /** Chosen endpoint index per preset id. */
  presetEndpoints: Record<string, number>
  stars: Record<string, string[]>
}

let cache: NetFile | null = null

function file(): string {
  return join(dataDir(), 'networks.json')
}

function load(): NetFile {
  if (cache) return cache
  const raw = readJson<Partial<NetFile>>(file(), {})
  cache = {
    version: 1,
    current: typeof raw.current === 'string' ? raw.current : WAX_TESTNET_ID,
    custom: Array.isArray(raw.custom) ? raw.custom.filter((n) => n && typeof n.id === 'string') : [],
    presetEndpoints: typeof raw.presetEndpoints === 'object' && raw.presetEndpoints ? raw.presetEndpoints : {},
    stars: typeof raw.stars === 'object' && raw.stars ? raw.stars : {}
  }
  return cache
}

let changed: () => void = () => {}
/** Called after any change to the network list or the current network. */
export function onNetworksChanged(fn: () => void): void {
  changed = fn
}

function save(): void {
  if (cache) writeJson(file(), cache)
  try {
    changed()
  } catch {
    // menu refresh must not break saving
  }
}

export function listNetworks(): NetworkInfo[] {
  const f = load()
  const presets = PRESETS.map((p) => ({
    ...p,
    currentEndpoint: Math.min(f.presetEndpoints[p.id] ?? 0, p.endpoints.length - 1)
  }))
  return [...presets, ...f.custom]
}

export function getNetwork(id: string): NetworkInfo {
  const n = listNetworks().find((x) => x.id === id)
  if (!n) throw new Error('Unknown network')
  return n
}

export function currentNetwork(): NetworkInfo {
  const f = load()
  return listNetworks().find((n) => n.id === f.current) ?? getNetwork(WAX_TESTNET_ID)
}

export function selectNetwork(id: string): NetworkInfo {
  const n = getNetwork(id)
  load().current = n.id
  save()
  return n
}

export function endpointOf(n: NetworkInfo): string {
  return n.endpoints[n.currentEndpoint] ?? n.endpoints[0]
}

function setEndpointIndex(id: string, index: number): void {
  const f = load()
  if (PRESETS.some((p) => p.id === id)) f.presetEndpoints[id] = index
  else {
    const c = f.custom.find((x) => x.id === id)
    if (c) c.currentEndpoint = index
  }
  save()
}

export function chooseEndpoint(id: string, index: number): NetworkInfo {
  const n = getNetwork(id)
  if (index < 0 || index >= n.endpoints.length) throw new Error('No such endpoint')
  setEndpointIndex(id, index)
  return getNetwork(id)
}

export type SwitchNotice = (network: NetworkInfo, from: string, to: string) => void
let onSwitch: SwitchNotice = () => {}
export function onEndpointSwitch(fn: SwitchNotice): void {
  onSwitch = fn
}

/**
 * Runs a read call against the current endpoint; on a network failure or a
 * server error it moves to the next endpoint of the network (reads only, with
 * a notice). Node errors about the request itself are not retried.
 */
export async function readCall<T>(fn: (endpoint: string) => Promise<T>, network = currentNetwork()): Promise<T> {
  const n = network
  let lastErr: unknown
  for (let i = 0; i < n.endpoints.length; i++) {
    const idx = (n.currentEndpoint + i) % n.endpoints.length
    const ep = n.endpoints[idx]
    try {
      const r = await fn(ep)
      if (i > 0) {
        setEndpointIndex(n.id, idx)
        onSwitch(getNetwork(n.id), endpointOf(n), ep)
      }
      return r
    } catch (e) {
      lastErr = e
      const retryable = e instanceof RpcError && (e.status === 0 || e.status >= 500)
      if (!retryable) throw e
      log.warn(`Endpoint ${ep} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw lastErr
}

/** Reads chain id and core symbol of an endpoint (Add Network). */
export async function probeEndpoint(url: string): Promise<{ endpoint: string; chainId: string; symbol: string; precision: number; version: string }> {
  const endpoint = normalizeEndpoint(url)
  const info = await chain.getInfo(endpoint)
  if (!/^[0-9a-f]{64}$/.test(info.chain_id)) throw new Error('The endpoint did not return a valid chain id')
  let symbol = ''
  let precision = 4
  try {
    const r = await chain.getTableRows(endpoint, { code: 'eosio', scope: 'eosio', table: 'rammarket', json: true, limit: 1 })
    const quote = (r.rows[0] as { quote?: { balance?: string } } | undefined)?.quote?.balance
    const m = typeof quote === 'string' ? /^-?\d+(?:\.(\d+))?\s+([A-Z]{1,7})$/.exec(quote) : null
    if (m) {
      symbol = m[2]
      precision = m[1]?.length ?? 0
    }
  } catch {
    // Not every chain has the system contract's RAM market; the user enters the symbol.
  }
  return { endpoint, chainId: info.chain_id, symbol, precision, version: info.server_version_string ?? '' }
}

export function addNetwork(input: {
  name: string
  kind: NetworkKind
  endpoint: string
  chainId: string
  symbol: string
  precision: number
  history?: string
}): NetworkInfo {
  const f = load()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  if (listNetworks().some((n) => n.name.toLowerCase() === name.toLowerCase())) throw new Error('A network with this name exists')
  if (!/^[0-9a-f]{64}$/.test(input.chainId)) throw new Error('Chain id must be 64 hex characters')
  if (!/^[A-Z]{1,7}$/.test(input.symbol)) throw new Error('Symbol must be 1-7 capital letters')
  const n: NetworkInfo = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    kind: input.kind,
    chainId: input.chainId,
    symbol: input.symbol,
    precision: input.precision,
    endpoints: [normalizeEndpoint(input.endpoint)],
    history: input.history ? normalizeEndpoint(input.history) : undefined,
    preset: false,
    currentEndpoint: 0
  }
  f.custom.push(n)
  save()
  return n
}

export function updateNetwork(id: string, patch: { name?: string; kind?: NetworkKind; endpoints?: string[]; history?: string | null }): NetworkInfo {
  const f = load()
  const preset = PRESETS.find((p) => p.id === id)
  if (preset) throw new Error('The WAX presets cannot be changed; add a custom network instead')
  const c = f.custom.find((x) => x.id === id)
  if (!c) throw new Error('Unknown network')
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Name is required')
    c.name = name
  }
  if (patch.kind) c.kind = patch.kind
  if (patch.endpoints) {
    const eps = patch.endpoints.map(normalizeEndpoint)
    if (eps.length === 0) throw new Error('At least one endpoint is required')
    c.endpoints = [...new Set(eps)]
    c.currentEndpoint = Math.min(c.currentEndpoint, c.endpoints.length - 1)
  }
  if (patch.history !== undefined) c.history = patch.history ? normalizeEndpoint(patch.history) : undefined
  save()
  return c
}

export function removeNetwork(id: string): void {
  const f = load()
  if (PRESETS.some((p) => p.id === id)) throw new Error('The WAX presets cannot be removed')
  f.custom = f.custom.filter((x) => x.id !== id)
  delete f.stars[id]
  if (f.current === id) f.current = WAX_TESTNET_ID
  save()
}

export function stars(networkId: string): string[] {
  return [...(load().stars[networkId] ?? [])]
}

export function setStar(networkId: string, account: string, starred: boolean): string[] {
  const f = load()
  const list = f.stars[networkId] ?? []
  const next = starred ? (list.includes(account) ? list : [...list, account]) : list.filter((a) => a !== account)
  f.stars[networkId] = next
  save()
  return [...next]
}

export function setStarOrder(networkId: string, accounts: string[]): string[] {
  const f = load()
  f.stars[networkId] = [...new Set(accounts)]
  save()
  return [...f.stars[networkId]]
}
