// Bootstrap of the app's local chain: what is sent to the node once
// it answers. Signed here with the chain's own system key, without the vault and without a confirmation window;
// `assertLocalChain` keeps this path off every other network. The key is never logged and never put in a
// progress line or an error text.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EOSIO_ABI,
  bytesToHex,
  encodeAction,
  headerFromChainInfo,
  packTransaction,
  parseAbi,
  parsePrivateKey,
  parsePublicKey,
  publicFromPrivate,
  publicKeyToString,
  setabi,
  setcode,
  signDigest,
  signatureToString,
  signingDigest,
  transactionId,
  type Action,
  type AbiDef,
  type PrivateKey
} from '../chain-core'
import { LOCAL_CHAIN_NETWORK_ID, LOCAL_CHAIN_PORT_MAX, LOCAL_CHAIN_PORT_MIN } from '../shared/local-chain'
import {
  LOCAL_CHAIN_CONTRACTS,
  LOCAL_CHAIN_CORE_SYMBOL,
  bootstrapPlan,
  chooseFeatures,
  type BootStep,
  type FeatureChoice,
  type LocalChainContract,
  type PlannedAction,
  type SupportedFeature
} from '../shared/local-chain-config'
import { request, type ChainInfo } from './rpc'
import { resourcesDir } from './paths'

export class LocalChainBootError extends Error {}

// ---------------------------------------------------------------- guard

export interface LocalChainExpectation {
  /** The state's port; without it any port of the local chain's range is taken. */
  port?: number
  /** The state's chain id; checked against `get_info` when given. */
  chainId?: string
  /** The network the call was made for; must be `local-chain` when given. */
  networkId?: string
}

/** `http://127.0.0.1:<port>` of the local chain, or throws. Returns the port. */
export function localChainPort(endpoint: string, expect: LocalChainExpectation = {}): number {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new LocalChainBootError(`"${endpoint}" is not the local chain's address`)
  }
  const port = Number(url.port)
  const pathOk = url.pathname === '/' || url.pathname === ''
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !pathOk || url.search || url.username || url.password) {
    throw new LocalChainBootError(`"${endpoint}" is not the local chain's address (http://127.0.0.1:<port>)`)
  }
  if (!Number.isInteger(port) || port < LOCAL_CHAIN_PORT_MIN || port > LOCAL_CHAIN_PORT_MAX) {
    throw new LocalChainBootError(`Port ${url.port || '(none)'} is outside the local chain's ports ${LOCAL_CHAIN_PORT_MIN}-${LOCAL_CHAIN_PORT_MAX}`)
  }
  if (expect.port !== undefined && port !== expect.port) throw new LocalChainBootError(`The local chain listens on port ${expect.port}, not ${port}`)
  if (expect.networkId !== undefined && expect.networkId !== LOCAL_CHAIN_NETWORK_ID) {
    throw new LocalChainBootError(`System transactions are sent only to the local chain, not to the network "${expect.networkId}"`)
  }
  return port
}

/**
 * The one guard of every system transaction: the endpoint is `127.0.0.1:<port>`, its `get_info` chain id is the
 * expected one, the network is `local-chain`, and the chain's `eosio` is controlled by the given system key.
 * Returns the node's `get_info`.
 */
export async function assertLocalChain(
  endpoint: string,
  systemPublicKey: string,
  expect: LocalChainExpectation = {},
  deps: Pick<BootDeps, 'request'> = { request: defaultRequest }
): Promise<ChainInfo> {
  localChainPort(endpoint, expect)
  const info = await deps.request<ChainInfo>(endpoint, '/v1/chain/get_info', {})
  if (expect.chainId !== undefined && info.chain_id !== expect.chainId) {
    throw new LocalChainBootError(`The node at ${endpoint} runs another chain (${info.chain_id.slice(0, 12)}...), not the local chain`)
  }
  const account = await deps.request<{ permissions?: { perm_name: string; required_auth?: { keys?: { key: string }[] } }[] }>(
    endpoint,
    '/v1/chain/get_account',
    { account_name: 'eosio' }
  )
  const want = publicKeyToString(parsePublicKey(systemPublicKey))
  const owner = account.permissions?.find((p) => p.perm_name === 'owner')
  const keys = (owner?.required_auth?.keys ?? []).map((k) => {
    try {
      return publicKeyToString(parsePublicKey(k.key))
    } catch {
      return ''
    }
  })
  if (!keys.includes(want)) throw new LocalChainBootError('The chain at this address does not belong to this local chain\'s system key')
  return info
}

// ---------------------------------------------------------------- dependencies

export interface BootDeps {
  /** POST `body` as JSON to `endpoint + path`; throws with the node's message on an error answer. */
  request: <T>(endpoint: string, path: string, body: unknown, timeoutMs?: number) => Promise<T>
  /** Reads `<name>.wasm` / `<name>.abi` and `features.json` from `resources/local-chain`. */
  readResource: (relativePath: string) => Promise<Buffer>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const defaultRequest = <T>(endpoint: string, path: string, body: unknown, timeoutMs?: number): Promise<T> =>
  request<T>(endpoint, path, { body, timeoutMs: timeoutMs ?? 30_000, retryStale: false })

export function defaultBootDeps(): BootDeps {
  return {
    request: defaultRequest,
    readResource: (rel) => readFile(join(resourcesDir(), 'local-chain', ...rel.split('/'))),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now()
  }
}

// ---------------------------------------------------------------- resources

/** Feature names from `features.json`: a list of names, or `{ features: [...] }` of names or `{ name }` objects. */
export function readFeatureNames(json: unknown): string[] {
  const list = Array.isArray(json) ? json : (json as { features?: unknown } | null)?.features
  if (!Array.isArray(list)) throw new LocalChainBootError('features.json holds no feature list')
  const names = list.map((e) => (typeof e === 'string' ? e : typeof (e as { name?: unknown })?.name === 'string' ? (e as { name: string }).name : ''))
  if (names.some((n) => !/^[A-Z0-9_]+$/.test(n))) throw new LocalChainBootError('features.json has an entry that is not a feature name')
  return names
}

interface ContractFiles {
  wasm: Uint8Array
  abi: AbiDef
}

async function loadContracts(deps: BootDeps): Promise<Map<LocalChainContract, ContractFiles>> {
  const out = new Map<LocalChainContract, ContractFiles>()
  for (const name of LOCAL_CHAIN_CONTRACTS) {
    let wasm: Buffer
    let abiText: Buffer
    try {
      wasm = await deps.readResource(`contracts/${name}.wasm`)
      abiText = await deps.readResource(`contracts/${name}.abi`)
    } catch {
      throw new LocalChainBootError(`The contract files of ${name} are missing from the app's resources`)
    }
    out.set(name, { wasm: new Uint8Array(wasm), abi: parseAbi(JSON.parse(abiText.toString('utf8'))) })
  }
  return out
}

// ---------------------------------------------------------------- sending

interface Signer {
  endpoint: string
  chainId: string
  key: PrivateKey
  deps: BootDeps
}

async function sendActions(s: Signer, actions: Action[]): Promise<string> {
  const info = await s.deps.request<ChainInfo>(s.endpoint, '/v1/chain/get_info', {})
  const packed = packTransaction({ ...headerFromChainInfo(info, 120, true), actions })
  const sig = signDigest(signingDigest(s.chainId, packed), s.key)
  const body = { signatures: [signatureToString(sig)], compression: 0, packed_context_free_data: '', packed_trx: bytesToHex(packed) }
  await s.deps.request(s.endpoint, '/v1/chain/send_transaction', body, 60_000)
  return transactionId(packed)
}

function encodePlanned(a: PlannedAction, contracts: Map<LocalChainContract, ContractFiles>): Action {
  const abi = a.abi === 'native' ? EOSIO_ABI : contracts.get(a.abi)!.abi
  return {
    account: a.account,
    name: a.name,
    authorization: [{ actor: a.actor, permission: 'active' }],
    data: bytesToHex(encodeAction(abi, a.name, a.data))
  }
}

/** Waits until the node lists every feature among its activated ones (at most `limitMs`). */
async function waitForFeatures(s: Signer, features: { name: string; digest: string }[], limitMs: number): Promise<void> {
  const until = s.deps.now() + limitMs
  for (;;) {
    const r = await s.deps.request<{ activated_protocol_features?: { feature_digest: string }[] }>(
      s.endpoint,
      '/v1/chain/get_activated_protocol_features',
      { limit: 100, search_by_block_num: false, reverse: false }
    )
    const active = new Set((r.activated_protocol_features ?? []).map((f) => f.feature_digest.toLowerCase()))
    const missing = features.filter((f) => !active.has(f.digest))
    if (missing.length === 0) return
    if (s.deps.now() >= until) throw new LocalChainBootError(`The node did not make ${missing.map((f) => f.name).join(', ')} active in time`)
    await s.deps.sleep(250)
  }
}

async function runStep(s: Signer, step: BootStep, contracts: Map<LocalChainContract, ContractFiles>): Promise<void> {
  if (step.kind === 'preactivate') {
    await s.deps.request(s.endpoint, '/v1/producer/schedule_protocol_feature_activations', { protocol_features_to_activate: [step.feature.digest] })
    await waitForFeatures(s, [step.feature], 15_000)
    return
  }
  if (step.kind === 'activate') {
    await sendActions(s, step.actions.map((a) => encodePlanned(a, contracts)))
    await waitForFeatures(s, step.features, 15_000)
    return
  }
  if (step.kind === 'deploy') {
    const files = contracts.get(step.contract)!
    const auth = [{ actor: step.account, permission: 'active' }]
    await sendActions(s, [setcode({ account: step.account, code: files.wasm, authorization: auth })])
    await sendActions(s, [setabi({ account: step.account, abi: files.abi, authorization: auth })])
    return
  }
  await sendActions(s, step.actions.map((a) => encodePlanned(a, contracts)))
}

// ---------------------------------------------------------------- the check at the end

export interface BootCheck {
  /** `eosio.token` stats of WAX: supply and maximum supply as the node prints them. */
  supply: string
  maxSupply: string
  /** Decimals of the core token (8). */
  precision: number
  /** The RAM market row: RAM bytes on offer and the WAX on the other side. */
  ramMarket: { base: string; quote: string }
  /** `global.max_ram_size` in bytes. */
  maxRamSize: string
  /** Activated protocol feature names, in the node's order. */
  features: string[]
}

async function readResult(s: Signer, choice: FeatureChoice): Promise<BootCheck> {
  const symbol = LOCAL_CHAIN_CORE_SYMBOL.split(',')[1]
  const stats = await s.deps.request<Record<string, { supply?: string; max_supply?: string }>>(s.endpoint, '/v1/chain/get_currency_stats', {
    code: 'eosio.token',
    symbol
  })
  const st = stats[symbol]
  if (!st?.supply || !st.max_supply) throw new LocalChainBootError('The WAX token is missing after the bootstrap')
  const precision = (st.supply.split(' ')[0].split('.')[1] ?? '').length
  if (precision !== Number(LOCAL_CHAIN_CORE_SYMBOL.split(',')[0])) throw new LocalChainBootError(`The WAX token has ${precision} decimals, not 8`)
  const table = <T>(name: string) =>
    s.deps.request<{ rows: T[] }>(s.endpoint, '/v1/chain/get_table_rows', { code: 'eosio', scope: 'eosio', table: name, json: true, limit: 1 })
  const ram = (await table<{ base?: { balance?: string }; quote?: { balance?: string } }>('rammarket')).rows[0]
  if (!ram?.base?.balance || !ram.quote?.balance) throw new LocalChainBootError('The RAM market is missing after the bootstrap')
  const global = (await table<{ max_ram_size?: string | number }>('global')).rows[0]
  if (!global) throw new LocalChainBootError('The system contract has no global state after the bootstrap')
  const active = await s.deps.request<{ activated_protocol_features?: { feature_digest: string; specification?: { name: string; value: string }[] }[] }>(
    s.endpoint,
    '/v1/chain/get_activated_protocol_features',
    { limit: 100, search_by_block_num: false, reverse: false }
  )
  const activeDigests = new Set((active.activated_protocol_features ?? []).map((f) => f.feature_digest.toLowerCase()))
  const wanted = [choice.preactivate!, ...choice.activate]
  const missing = wanted.filter((f) => !activeDigests.has(f.digest))
  if (missing.length > 0) throw new LocalChainBootError(`Features not active after the bootstrap: ${missing.map((f) => f.name).join(', ')}`)
  return {
    supply: st.supply,
    maxSupply: st.max_supply,
    precision,
    ramMarket: { base: ram.base.balance, quote: ram.quote.balance },
    maxRamSize: String(global.max_ram_size ?? ''),
    features: (active.activated_protocol_features ?? []).map(
      (f) => f.specification?.find((x) => x.name === 'builtin_feature_codename')?.value ?? f.feature_digest
    )
  }
}

// ---------------------------------------------------------------- bootstrap

export interface BootResult extends BootCheck {
  chainId: string
  /** Feature names of `features.json` the node did not take, with the reason. */
  skipped: { name: string; reason: string }[]
  /** Milliseconds from the first request to the end of the check. */
  tookMs: number
}

/**
 * Bootstraps an empty local chain whose node answers at `endpoint` with the producer API loaded.
 * `systemKey` is the chain's own private key; it signs as `eosio` and the system accounts.
 * `progress` gets one plain line per step, never a key. Ends by reading the token, `rammarket` and `global`;
 * only a resolved promise means bootstrapped. A bootstrap that stops halfway is repeated from an empty data
 * folder, never continued.
 */
export async function bootstrap(
  endpoint: string,
  systemKey: string,
  progress: (line: string) => void,
  options: { expect?: LocalChainExpectation; deps?: Partial<BootDeps> } = {}
): Promise<BootResult> {
  const deps: BootDeps = { ...defaultBootDeps(), ...options.deps }
  const started = deps.now()
  let key: PrivateKey
  try {
    key = parsePrivateKey(systemKey)
  } catch {
    throw new LocalChainBootError('The local chain\'s system key cannot be read')
  }
  if (key.type !== 'K1') throw new LocalChainBootError('The local chain\'s system key is not a K1 key')
  const publicKey = publicKeyToString(publicFromPrivate(key))

  progress('Checking the node')
  const info = await assertLocalChain(endpoint, publicKey, options.expect ?? {}, deps)
  const s: Signer = { endpoint, chainId: info.chain_id, key, deps }

  const already = await deps.request<{ activated_protocol_features?: unknown[] }>(endpoint, '/v1/chain/get_activated_protocol_features', {
    limit: 1,
    search_by_block_num: false,
    reverse: false
  })
  if ((already.activated_protocol_features ?? []).length > 0) {
    throw new LocalChainBootError('This chain was bootstrapped before or halfway; it is bootstrapped only from an empty data folder')
  }

  progress('Reading the system contracts and the feature list')
  const contracts = await loadContracts(deps)
  let wanted: string[]
  try {
    wanted = readFeatureNames(JSON.parse((await deps.readResource('features.json')).toString('utf8')))
  } catch (e) {
    throw new LocalChainBootError(e instanceof LocalChainBootError ? e.message : 'features.json is missing from the app\'s resources or cannot be read')
  }
  const supported = await deps.request<SupportedFeature[]>(endpoint, '/v1/producer/get_supported_protocol_features', {
    exclude_disabled: false,
    exclude_unactivatable: false
  })
  const choice = chooseFeatures(wanted, supported)
  for (const sk of choice.skipped) progress(`Skipping the feature ${sk.name}: ${sk.reason}`)

  for (const step of bootstrapPlan(choice)) {
    progress(step.label)
    try {
      await runStep(s, step, contracts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new LocalChainBootError(`${step.label}: ${msg}`)
    }
  }

  progress('Reading the token, the RAM market and the global state')
  const check = await readResult(s, choice)
  const tookMs = deps.now() - started
  progress(`Bootstrapped in ${(tookMs / 1000).toFixed(1)} s: ${check.features.length} protocol features, ${check.supply} issued, RAM market open`)
  return { ...check, chainId: info.chain_id, skipped: choice.skipped, tookMs }
}
