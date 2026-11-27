// Networks: the user's list of Antelope networks (the two WAX networks are
// defaults that can be removed and restored), the current network and
// endpoint, and starred accounts per network.

import { join } from 'node:path'
import type { NetworkInfo, NetworkKind } from '../shared/chain-types'
import { dataDir } from './paths'
import { copyFileSync, existsSync } from 'node:fs'
import { readJson, writeJson } from './jsonfile'
import { chain, normalizeEndpoint, RpcError } from './rpc'
import { log } from './log'
import { oneLineText, plainTextOrEmpty } from '../shared/network-info'
import { addedTokens } from './wallet-tokens'

import { LOCAL_CHAIN_NETWORK_ID } from '../shared/local-chain'

export const LOCAL_CHAIN_NAME = 'Local chain'
export const LOCAL_CHAIN_EDIT_REFUSAL = "This network belongs to the app's local chain. Change it in Network > Local Chain."
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

/** The one written form of a chain id: 64 lower-case hex characters. */
export const CHAIN_ID_FORM = /^[0-9a-f]{64}$/

/** Name of a main network from the fixed list, compared in lower case; null when it is not one. */
function mainnetName(chainId: unknown): string | null {
  const id = typeof chainId === 'string' ? chainId.toLowerCase() : ''
  return Object.hasOwn(MAINNET_CHAINS, id) ? MAINNET_CHAINS[id] : null
}

function isWaxTestnetChain(chainId: unknown): boolean {
  return typeof chainId === 'string' && chainId.toLowerCase() === WAX_TESTNET_CHAIN
}

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
  if (mainnetName(n.chainId) !== null) return 'mainnet'
  if (n.kind === 'local') return n.endpoints.length > 0 && n.endpoints.every(isLocalEndpoint) ? 'local' : 'mainnet'
  // A test network is the WAX Testnet chain or one confirmed in the main-process dialog.
  if (n.kind === 'testnet' && (isWaxTestnetChain(n.chainId) || n.testnetConfirmed === true)) return 'testnet'
  return 'mainnet'
}

/** Why the kind of a chain cannot be chosen (shown next to the kind), or null. */
export function fixedKindNote(chainId: string): string | null {
  const known = mainnetName(chainId)
  return known ? `This is the ${known} chain, so the kind is always mainnet (orange mainnet confirmation).` : null
}

/** Name of a chain the app knows (suggested in Add Network), or null. */
export function knownChainName(chainId: string): string | null {
  return mainnetName(chainId) ?? (isWaxTestnetChain(chainId) ? 'WAX Testnet' : null)
}

/** Asked before a chain outside the known lists is marked as a test network. */
export type ConfirmTestnet = (n: { name: string; chainId: string; endpoint: string }) => Promise<boolean>

async function decideKind(
  requested: NetworkKind,
  n: { name: string; chainId: string; endpoints: string[] },
  previous: NetworkKind | null,
  confirmTestnet: ConfirmTestnet
): Promise<{ kind: NetworkKind; testnetConfirmed: boolean }> {
  if (mainnetName(n.chainId) !== null) return { kind: 'mainnet', testnetConfirmed: false }
  if (requested === 'local') {
    if (!n.endpoints.every(isLocalEndpoint)) throw new Error('"Local" is only for networks whose endpoints are all on this computer.')
    return { kind: 'local', testnetConfirmed: false }
  }
  if (requested === 'testnet') {
    if (isWaxTestnetChain(n.chainId)) return { kind: 'testnet', testnetConfirmed: false }
    if (previous === 'testnet') return { kind: 'testnet', testnetConfirmed: true }
    const ok = await confirmTestnet({ name: n.name, chainId: n.chainId, endpoint: n.endpoints[0] ?? '' })
    if (!ok) throw new Error('Not saved: the network was not marked as a test network.')
    return { kind: 'testnet', testnetConfirmed: true }
  }
  return { kind: 'mainnet', testnetConfirmed: false }
}

/** The default networks: name and chain id fixed; endpoints and history can be edited. */
const DEFAULTS: readonly NetworkInfo[] = [
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
    chainId: WAX_TESTNET_CHAIN,
    symbol: 'WAX',
    precision: 8,
    endpoints: ['https://testnet.waxsweden.org', 'https://waxtestnet.greymass.com'],
    history: 'https://testnet.waxsweden.org',
    preset: true,
    currentEndpoint: 0
  }
]

function defaultCopy(d: NetworkInfo): NetworkInfo {
  return { ...d, endpoints: [...d.endpoints] }
}

function isDefaultId(id: string): boolean {
  return DEFAULTS.some((d) => d.id === id)
}

/** Version 1: fixed presets with a chosen endpoint each, and custom networks. */
export interface NetFileV1 {
  version?: 1
  current?: unknown
  custom?: unknown
  presetEndpoints?: unknown
  stars?: unknown
}

/** Version 2: one list of networks; defaults can be removed and restored. */
export interface NetFileV2 {
  version: 2
  current: string
  networks: NetworkInfo[]
  /** Ids of default networks the user removed. */
  removedDefaults: string[]
  stars: Record<string, string[]>
}

export const NETWORKS_V1_BACKUP = 'networks.v1.bak.json'

let cache: NetFileV2 | null = null

function file(): string {
  return join(dataDir(), 'networks.json')
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function cleanStars(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (isObj(v)) for (const [k, list] of Object.entries(v)) out[k] = strList(list)
  return out
}

/** An endpoint address from the file in the form every request uses; null when it is not allowed. */
function storedEndpoint(v: string): string | null {
  try {
    return normalizeEndpoint(v)
  } catch {
    return null
  }
}

function entryName(id: string): string {
  return oneLineText(id, 64)
}

/** A stored network as read from the file; null when it is unusable. */
function cleanNetwork(raw: unknown): NetworkInfo | null {
  if (!isObj(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.chainId !== 'string') return null
  // A chain id is taken only in its one written form, so the mainnet list always recognises it.
  if (!CHAIN_ID_FORM.test(raw.chainId)) {
    log.warn(`Network list: entry ${entryName(raw.id)} dropped (its chain id is not 64 lower-case hex characters)`)
    return null
  }
  const stored = strList(raw.endpoints)
  const endpoints = [...new Set(stored.map(storedEndpoint).filter((e): e is string => e !== null))]
  if (endpoints.length < stored.length) log.warn(`Network list: entry ${entryName(raw.id)} lost an endpoint address that is not allowed or repeated`)
  if (endpoints.length === 0) return null
  const def = DEFAULTS.find((d) => d.id === raw.id)
  const storedIndex = typeof raw.currentEndpoint === 'number' && Number.isInteger(raw.currentEndpoint) ? raw.currentEndpoint : 0
  // The chosen endpoint keeps pointing at the same address after unusable ones were dropped.
  const chosen = typeof stored[storedIndex] === 'string' ? storedEndpoint(stored[storedIndex]) : null
  const index = chosen !== null ? endpoints.indexOf(chosen) : 0
  const history = typeof raw.history === 'string' && raw.history ? storedEndpoint(raw.history) : null
  const base = {
    endpoints,
    history: history ?? undefined,
    currentEndpoint: Math.max(0, Math.min(index, endpoints.length - 1))
  }
  // A default keeps its fixed name, chain id and kind whatever the file says.
  if (def) return { ...defaultCopy(def), ...base }
  const kind = KINDS.includes(raw.kind as NetworkKind) ? (raw.kind as NetworkKind) : 'mainnet'
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : raw.id,
    kind,
    ...(raw.testnetConfirmed === true ? { testnetConfirmed: true } : {}),
    chainId: raw.chainId,
    symbol: typeof raw.symbol === 'string' ? raw.symbol : '',
    precision: typeof raw.precision === 'number' && Number.isInteger(raw.precision) ? raw.precision : 4,
    ...base,
    preset: false
  }
}

/**
 * Version 1 to version 2: the two defaults (ids unchanged, so stars and project
 * deploy settings keep matching) with the endpoint chosen before, then the
 * custom networks as they were.
 */
export function convertV1(raw: NetFileV1): NetFileV2 {
  const chosen = isObj(raw.presetEndpoints) ? raw.presetEndpoints : {}
  const defaults = DEFAULTS.map((d) => {
    const i = chosen[d.id]
    const index = typeof i === 'number' && Number.isInteger(i) ? Math.max(0, Math.min(i, d.endpoints.length - 1)) : 0
    return { ...defaultCopy(d), currentEndpoint: index }
  })
  const custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .map(cleanNetwork)
    .filter((n): n is NetworkInfo => n !== null && !isDefaultId(n.id))
  return {
    version: 2,
    current: typeof raw.current === 'string' ? raw.current : WAX_TESTNET_ID,
    networks: [...defaults, ...custom],
    removedDefaults: [],
    stars: cleanStars(raw.stars)
  }
}

function readV2(raw: Record<string, unknown>): NetFileV2 {
  const seen = new Set<string>()
  const list = (Array.isArray(raw.networks) ? raw.networks : []).map(cleanNetwork).filter((n): n is NetworkInfo => {
    if (!n || seen.has(n.id)) return false
    seen.add(n.id)
    return true
  })
  return {
    version: 2,
    current: typeof raw.current === 'string' ? raw.current : WAX_TESTNET_ID,
    // A file left without networks starts again from the defaults.
    networks: list.length > 0 ? list : DEFAULTS.map(defaultCopy),
    removedDefaults: list.length > 0 ? strList(raw.removedDefaults).filter((id) => isDefaultId(id) && !seen.has(id)) : [],
    stars: cleanStars(raw.stars)
  }
}

function load(): NetFileV2 {
  if (cache) return cache
  const path = file()
  const raw = readJson<unknown>(path, null)
  if (isObj(raw) && raw.version === 2) {
    cache = readV2(raw)
  } else if (isObj(raw)) {
    // Version 1: keep one copy of the old file, then write version 2.
    cache = convertV1(raw)
    try {
      const backup = join(dataDir(), NETWORKS_V1_BACKUP)
      if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup)
      writeJson(path, cache)
      log.info('Network list converted to version 2')
    } catch (e) {
      log.warn(`Network list not converted on disk: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    cache = { version: 2, current: WAX_TESTNET_ID, networks: DEFAULTS.map(defaultCopy), removedDefaults: [], stars: {} }
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
  return load().networks.map((n) => {
    const { kindNote: _old, ...rest } = n
    void _old
    const note = fixedKindNote(n.chainId)
    return { ...rest, endpoints: [...n.endpoints], kind: effectiveKind(n), ...(note ? { kindNote: note } : {}) }
  })
}

/** Default networks that were removed and can be restored. */
export function removedDefaults(): { id: string; name: string }[] {
  const ids = new Set(load().networks.map((n) => n.id))
  return DEFAULTS.filter((d) => !ids.has(d.id)).map((d) => ({ id: d.id, name: d.name }))
}

/** Brings back the default networks missing from the list, with their default endpoints. */
export function restoreDefaults(): NetworkInfo[] {
  const f = load()
  const ids = new Set(f.networks.map((n) => n.id))
  if (DEFAULTS.every((d) => ids.has(d.id))) return listNetworks()
  // Defaults go back to their place at the top, in their fixed order.
  const defaults = DEFAULTS.map((d) => f.networks.find((n) => n.id === d.id) ?? defaultCopy(d))
  f.networks = [...defaults, ...f.networks.filter((n) => !isDefaultId(n.id))]
  f.removedDefaults = []
  save()
  return listNetworks()
}

export function getNetwork(id: string): NetworkInfo {
  const n = listNetworks().find((x) => x.id === id)
  if (!n) throw new Error('Unknown network')
  return n
}

/** The network chosen when the saved one is gone: WAX Testnet if present, else the first of the list. */
function fallbackNetwork(list: NetworkInfo[]): NetworkInfo {
  return list.find((n) => n.id === WAX_TESTNET_ID) ?? list.find((n) => n.chainId === WAX_TESTNET_CHAIN) ?? list[0]
}

export function currentNetwork(): NetworkInfo {
  const f = load()
  const list = listNetworks()
  return list.find((n) => n.id === f.current) ?? fallbackNetwork(list)
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
  const c = load().networks.find((x) => x.id === id)
  if (c) c.currentEndpoint = index
  save()
}

/**
 * The endpoint reads go to for this session, per network id, after the chosen one did not
 * answer. Kept in memory only: a failed read never changes the endpoint the user chose,
 * which the status bar, the confirmation and every send keep using.
 */
const readEndpoints = new Map<string, number>()

/** The index reads of this network start at: the session's read endpoint when there is one, else the chosen one. */
export function readEndpointIndex(n: NetworkInfo): number {
  const i = readEndpoints.get(n.id)
  return i !== undefined && i < n.endpoints.length ? i : n.currentEndpoint
}

export function chooseEndpoint(id: string, index: number): NetworkInfo {
  const n = getNetwork(id)
  if (index < 0 || index >= n.endpoints.length) throw new Error('No such endpoint')
  readEndpoints.delete(id)
  setEndpointIndex(id, index)
  return getNetwork(id)
}

/** The notice of a read that moved to another endpoint; the chosen endpoint is named as the one that stays selected. */
export function endpointSwitchText(network: string, from: string, to: string, chosen: string): string {
  return `${network}: ${from} did not answer a read. Reads go to ${to} for now; ${chosen} stays the selected endpoint.`
}

/** A read moved from `from` to `to`; `network` still names the chosen endpoint. */
export type SwitchNotice = (network: NetworkInfo, from: string, to: string) => void
let onSwitch: SwitchNotice = () => {}
export function onEndpointSwitch(fn: SwitchNotice): void {
  onSwitch = fn
}

/** Chain id checks in progress, so reads that move at the same time ask an endpoint once. */
const chainChecks = new Map<string, Promise<boolean>>()

/**
 * Whether an endpoint answers with the network's chain id as written. Another id or a failed
 * read gives one warning and false.
 */
function servesChain(n: NetworkInfo, ep: string): Promise<boolean> {
  const key = `${n.id} ${ep}`
  let check = chainChecks.get(key)
  if (!check) {
    check = chain
      .getInfo(ep)
      .then(
        (info) => info.chain_id === n.chainId,
        () => false
      )
      .then((ok) => {
        if (!ok) log.warn(`Endpoint ${ep} answers for another chain than ${n.name}; it is not used for reads`)
        return ok
      })
      .finally(() => chainChecks.delete(key))
    chainChecks.set(key, check)
  }
  return check
}

/**
 * Runs a read call against the read endpoint of the session (at first the chosen one); on a
 * network failure, a rate limit (429) or a server error it moves to the next endpoint of the
 * network. The endpoint that answers serves the reads of this session (a notice when it
 * changes) once it gave the network's chain id; one that gives another id or none is skipped
 * like a failed one. Nothing is saved and the chosen endpoint stays. Node errors about the request itself are not retried. When every
 * endpoint failed, the error is the one of the selected endpoint, with
 * "(<n> endpoints tried)" when the network has more than one.
 */
export async function readCall<T>(fn: (endpoint: string) => Promise<T>, network = currentNetwork()): Promise<T> {
  const n = network
  let firstErr: unknown
  const start = readEndpointIndex(n)
  for (let i = 0; i < n.endpoints.length; i++) {
    const idx = (start + i) % n.endpoints.length
    const ep = n.endpoints[idx]
    try {
      const r = await fn(ep)
      if (i > 0) {
        if (idx === n.currentEndpoint) {
          // Back at the chosen endpoint: no session endpoint any more.
          readEndpoints.delete(n.id)
        } else if (readEndpoints.get(n.id) !== idx) {
          // An endpoint takes over the reads only when it answers for this network's chain;
          // otherwise its answer is dropped and the next endpoint is tried.
          if (!(await servesChain(n, ep))) continue
          // Reads that failed at the same time all land here: only the first one gives the notice.
          if (readEndpoints.get(n.id) !== idx) {
            readEndpoints.set(n.id, idx)
            onSwitch(getNetwork(n.id), n.endpoints[start], ep)
          }
        }
      }
      return r
    } catch (e) {
      if (i === 0) firstErr = e
      // No answer, a rate limit or a server failure: the next endpoint may answer.
      const retryable = e instanceof RpcError && (e.status === 0 || e.status === 429 || e.status >= 500)
      if (!retryable) throw e
      log.warn(`Endpoint ${ep} failed: ${oneLineText(e instanceof Error ? e.message : String(e), 200)}`)
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
  knownName: string | null
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
    // Text from the endpoint: kept only when short and plain.
    version: plainTextOrEmpty(info.server_version_string, 80),
    kindNote: fixedKindNote(info.chain_id),
    localAllowed: isLocalEndpoint(endpoint),
    knownName: knownChainName(info.chain_id)
  }
}

/**
 * A user's network name must be free: not used by another network of the list,
 * and not the name of a default network, even while that default is removed
 * (so restoring the defaults never gives two rows with one name).
 */
function checkNameFree(name: string, exceptId: string | null): void {
  const lower = name.toLowerCase()
  const def = DEFAULTS.find((d) => d.name.toLowerCase() === lower)
  if (def && def.id !== exceptId) throw new Error(`"${def.name}" is the name of a default network; choose another name`)
  if (listNetworks().some((n) => n.id !== exceptId && n.name.toLowerCase() === lower)) throw new Error('A network with this name exists')
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
  checkNameFree(name, null)
  if (!/^[0-9a-f]{64}$/.test(input.chainId)) throw new Error('Chain id must be 64 hex characters')
  if (!/^[A-Z]{1,7}$/.test(input.symbol)) throw new Error('Symbol must be 1-7 capital letters')
  const endpoints = [normalizeEndpoint(input.endpoint)]
  const { kind, testnetConfirmed } = await decideKind(input.kind, { name, chainId: input.chainId, endpoints }, null, confirmTestnet)
  const f = load()
  checkNameFree(name, null)
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
  f.networks.push(n)
  save()
  return getNetwork(n.id)
}

export async function updateNetwork(
  id: string,
  patch: { name?: string; kind?: NetworkKind; endpoints?: string[]; history?: string | null },
  confirmTestnet: ConfirmTestnet
): Promise<NetworkInfo> {
  if (id === LOCAL_CHAIN_NETWORK_ID) throw new Error(LOCAL_CHAIN_EDIT_REFUSAL)
  const found = load().networks.find((x) => x.id === id)
  if (!found) throw new Error('Unknown network')
  const isDefault = isDefaultId(id)
  let name = found.name
  if (patch.name !== undefined && patch.name.trim() !== found.name) {
    if (isDefault) throw new Error(`The name of ${found.name} is fixed; its endpoints and history service can be changed`)
    name = patch.name.trim()
    if (!name) throw new Error('Name is required')
    checkNameFree(name, id)
  }
  let endpoints = found.endpoints
  if (patch.endpoints) {
    const eps = [...new Set(patch.endpoints.map(normalizeEndpoint))]
    if (eps.length === 0) throw new Error('At least one endpoint is required')
    endpoints = eps
  }
  const history = patch.history === undefined ? found.history : patch.history ? normalizeEndpoint(patch.history) : undefined
  const previous = effectiveKind(found)
  if (isDefault && patch.kind !== undefined && patch.kind !== previous) throw new Error(`The kind of ${found.name} is fixed`)
  const { kind, testnetConfirmed } = await decideKind(patch.kind ?? previous, { name, chainId: found.chainId, endpoints }, previous, confirmTestnet)
  // Apply all at once, after the question (the list may have changed meanwhile).
  const c = load().networks.find((x) => x.id === id)
  if (!c) throw new Error('Unknown network')
  c.name = name
  c.kind = kind
  if (testnetConfirmed) c.testnetConfirmed = true
  else delete c.testnetConfirmed
  c.endpoints = endpoints
  c.currentEndpoint = Math.min(c.currentEndpoint, endpoints.length - 1)
  if (patch.endpoints) readEndpoints.delete(id)
  c.history = history
  save()
  return getNetwork(id)
}

/** The entry of the app's local chain: added if missing, address and chain id corrected. */
export function ensureLocalChainNetwork(input: { port: number; chainId: string }): NetworkInfo {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error('Port is not valid')
  if (!CHAIN_ID_FORM.test(input.chainId)) throw new Error('Chain id must be 64 hex characters')
  const endpoint = normalizeEndpoint(`http://127.0.0.1:${input.port}`)
  const f = load()
  const found = f.networks.find((x) => x.id === LOCAL_CHAIN_NETWORK_ID)
  if (found) {
    const same = found.chainId === input.chainId && found.endpoints.length === 1 && found.endpoints[0] === endpoint && found.kind === 'local'
    if (!same) {
      found.chainId = input.chainId
      found.kind = 'local'
      delete found.testnetConfirmed
      found.endpoints = [endpoint]
      found.currentEndpoint = 0
      found.history = undefined
      readEndpoints.delete(LOCAL_CHAIN_NETWORK_ID)
      save()
    }
    return getNetwork(LOCAL_CHAIN_NETWORK_ID)
  }
  const taken = f.networks.some((x) => x.name.toLowerCase() === LOCAL_CHAIN_NAME.toLowerCase())
  f.networks.push({
    id: LOCAL_CHAIN_NETWORK_ID,
    name: taken ? `${LOCAL_CHAIN_NAME} (WAX Master)` : LOCAL_CHAIN_NAME,
    kind: 'local',
    chainId: input.chainId,
    symbol: 'WAX',
    precision: 8,
    endpoints: [endpoint],
    preset: false,
    currentEndpoint: 0
  })
  save()
  return getNetwork(LOCAL_CHAIN_NETWORK_ID)
}

/**
 * Removes a network and forgets its starred accounts and the tokens added for it. At least one network
 * stays. Removing the current one selects WAX Testnet if present, else the
 * first of the list. A removed default can be restored.
 */
export function removeNetwork(id: string): NetworkInfo {
  const f = load()
  if (!f.networks.some((x) => x.id === id)) throw new Error('Unknown network')
  if (f.networks.length <= 1) throw new Error('At least one network must stay in the list')
  f.networks = f.networks.filter((x) => x.id !== id)
  readEndpoints.delete(id)
  delete f.stars[id]
  if (isDefaultId(id) && !f.removedDefaults.includes(id)) f.removedDefaults.push(id)
  if (f.current === id || !f.networks.some((x) => x.id === f.current)) f.current = fallbackNetwork(listNetworks()).id
  save()
  try {
    addedTokens().forget(id)
  } catch (e) {
    log.warn(`Network removed; its added tokens could not be forgotten: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  return currentNetwork()
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

/** After a Reset of the local chain: its accounts are gone, so the stars and added tokens of its entry go too. */
export function clearLocalChainMemory(): void {
  const f = load()
  if (f.stars[LOCAL_CHAIN_NETWORK_ID] !== undefined) {
    delete f.stars[LOCAL_CHAIN_NETWORK_ID]
    save()
  }
  try {
    addedTokens().forget(LOCAL_CHAIN_NETWORK_ID)
  } catch (e) {
    log.warn(`Local chain reset; its added tokens could not be forgotten: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
}
