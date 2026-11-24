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

/**
 * Chain ids of main networks (each read from the chain's own get_info). A
 * network on one of these chains is mainnet whatever was saved or sent.
 */
export const MAINNET_CHAINS: Readonly<Record<string, string>> = {
  '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4': 'WAX Mainnet',
  aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906: 'EOS (Vaulta)',
  '4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11': 'Telos'
}

export const WAX_TESTNET_CHAIN = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'

const KINDS: readonly NetworkKind[] = ['mainnet', 'testnet', 'local']

export function isLocalEndpoint(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
  } catch {
    return false
  }
}

/**
 * The kind the signer and the confirmation use. Chain id first (a known main
 * network is always mainnet); `local` only when every endpoint is on this
 * computer; anything not marked `testnet` or `local` counts as mainnet.
 */
export function effectiveKind(n: { chainId: string; kind: unknown; endpoints: readonly string[]; testnetConfirmed?: unknown }): NetworkKind {
  if (MAINNET_CHAINS[n.chainId]) return 'mainnet'
  if (n.kind === 'local') return n.endpoints.length > 0 && n.endpoints.every(isLocalEndpoint) ? 'local' : 'mainnet'
  // A test network is the WAX Testnet chain or one confirmed in the main-process dialog.
  if (n.kind === 'testnet' && (n.chainId === WAX_TESTNET_CHAIN || n.testnetConfirmed === true)) return 'testnet'
  return 'mainnet'
}

/** Why the kind of a chain cannot be chosen (shown next to the kind), or null. */
export function fixedKindNote(chainId: string): string | null {
  const known = MAINNET_CHAINS[chainId]
  return known ? `This is the ${known} chain, so the kind is always mainnet (red confirmation, typed account names).` : null
}

/** Asked before a chain outside the known lists is marked as a test network. */
export type ConfirmTestnet = (n: { name: string; chainId: string; endpoint: string }) => Promise<boolean>

async function decideKind(
  requested: NetworkKind,
  n: { name: string; chainId: string; endpoints: string[] },
  previous: NetworkKind | null,
  confirmTestnet: ConfirmTestnet
): Promise<{ kind: NetworkKind; testnetConfirmed: boolean }> {
  if (MAINNET_CHAINS[n.chainId]) return { kind: 'mainnet', testnetConfirmed: false }
  if (requested === 'local') {
    if (!n.endpoints.every(isLocalEndpoint)) throw new Error('"Local" is only for networks whose endpoints are all on this computer.')
    return { kind: 'local', testnetConfirmed: false }
  }
  if (requested === 'testnet') {
    if (n.chainId === WAX_TESTNET_CHAIN) return { kind: 'testnet', testnetConfirmed: false }
    if (previous === 'testnet') return { kind: 'testnet', testnetConfirmed: true }
    const ok = await confirmTestnet({ name: n.name, chainId: n.chainId, endpoint: n.endpoints[0] ?? '' })
    if (!ok) throw new Error('Not saved: the network was not marked as a test network.')
    return { kind: 'testnet', testnetConfirmed: true }
  }
  return { kind: 'mainnet', testnetConfirmed: false }
}

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
    custom: Array.isArray(raw.custom)
      ? raw.custom
          .filter((n) => n && typeof n.id === 'string' && typeof n.chainId === 'string' && Array.isArray(n.endpoints))
          .map((n) => {
            const { kindNote: _note, testnetConfirmed, ...rest } = n
            void _note
            return { ...rest, kind: KINDS.includes(n.kind) ? n.kind : 'mainnet', ...(testnetConfirmed === true ? { testnetConfirmed: true } : {}) }
          })
      : [],
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
  return [...presets, ...f.custom].map((n) => {
    const note = fixedKindNote(n.chainId)
    return { ...n, kind: effectiveKind(n), ...(note ? { kindNote: note } : {}) }
  })
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
 * Runs a read call against the current endpoint; on a network failure, a rate
 * limit (429) or a server error it moves to the next endpoint of the network (reads only, with
 * a notice). Node errors about the request itself are not retried. When every
 * endpoint failed, the error is the one of the selected endpoint, with
 * "(<n> endpoints tried)" when the network has more than one.
 */
export async function readCall<T>(fn: (endpoint: string) => Promise<T>, network = currentNetwork()): Promise<T> {
  const n = network
  let firstErr: unknown
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
      if (i === 0) firstErr = e
      // No answer, a rate limit or a server failure: the next endpoint may answer.
      const retryable = e instanceof RpcError && (e.status === 0 || e.status === 429 || e.status >= 500)
      if (!retryable) throw e
      log.warn(`Endpoint ${ep} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (n.endpoints.length > 1 && firstErr instanceof RpcError) {
    throw new RpcError(`${firstErr.message} (${n.endpoints.length} endpoints tried)`, firstErr.status, firstErr.details)
  }
  throw firstErr
}

/** Reads chain id and core symbol of an endpoint (Add Network). */
export async function probeEndpoint(url: string): Promise<{
  endpoint: string
  chainId: string
  symbol: string
  precision: number
  version: string
  kindNote: string | null
  localAllowed: boolean
}> {
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
  return {
    endpoint,
    chainId: info.chain_id,
    symbol,
    precision,
    version: info.server_version_string ?? '',
    kindNote: fixedKindNote(info.chain_id),
    localAllowed: isLocalEndpoint(endpoint)
  }
}

export async function addNetwork(
  input: {
    name: string
    kind: NetworkKind
    endpoint: string
    chainId: string
    symbol: string
    precision: number
    history?: string
  },
  confirmTestnet: ConfirmTestnet
): Promise<NetworkInfo> {
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  if (listNetworks().some((n) => n.name.toLowerCase() === name.toLowerCase())) throw new Error('A network with this name exists')
  if (!/^[0-9a-f]{64}$/.test(input.chainId)) throw new Error('Chain id must be 64 hex characters')
  if (!/^[A-Z]{1,7}$/.test(input.symbol)) throw new Error('Symbol must be 1-7 capital letters')
  const endpoints = [normalizeEndpoint(input.endpoint)]
  const { kind, testnetConfirmed } = await decideKind(input.kind, { name, chainId: input.chainId, endpoints }, null, confirmTestnet)
  const f = load()
  if (listNetworks().some((n) => n.name.toLowerCase() === name.toLowerCase())) throw new Error('A network with this name exists')
  const n: NetworkInfo = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    kind,
    ...(testnetConfirmed ? { testnetConfirmed: true } : {}),
    chainId: input.chainId,
    symbol: input.symbol,
    precision: input.precision,
    endpoints,
    history: input.history ? normalizeEndpoint(input.history) : undefined,
    preset: false,
    currentEndpoint: 0
  }
  f.custom.push(n)
  save()
  return getNetwork(n.id)
}

export async function updateNetwork(
  id: string,
  patch: { name?: string; kind?: NetworkKind; endpoints?: string[]; history?: string | null },
  confirmTestnet: ConfirmTestnet
): Promise<NetworkInfo> {
  const preset = PRESETS.find((p) => p.id === id)
  if (preset) throw new Error('The WAX presets cannot be changed; add a custom network instead')
  const found = load().custom.find((x) => x.id === id)
  if (!found) throw new Error('Unknown network')
  let name = found.name
  if (patch.name !== undefined) {
    name = patch.name.trim()
    if (!name) throw new Error('Name is required')
  }
  let endpoints = found.endpoints
  if (patch.endpoints) {
    const eps = [...new Set(patch.endpoints.map(normalizeEndpoint))]
    if (eps.length === 0) throw new Error('At least one endpoint is required')
    endpoints = eps
  }
  const history = patch.history === undefined ? found.history : patch.history ? normalizeEndpoint(patch.history) : undefined
  const previous = effectiveKind(found)
  const { kind, testnetConfirmed } = await decideKind(patch.kind ?? previous, { name, chainId: found.chainId, endpoints }, previous, confirmTestnet)
  // Apply all at once, after the question (the list may have changed meanwhile).
  const c = load().custom.find((x) => x.id === id)
  if (!c) throw new Error('Unknown network')
  c.name = name
  c.kind = kind
  if (testnetConfirmed) c.testnetConfirmed = true
  else delete c.testnetConfirmed
  c.endpoints = endpoints
  c.currentEndpoint = Math.min(c.currentEndpoint, endpoints.length - 1)
  c.history = history
  save()
  return getNetwork(id)
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
