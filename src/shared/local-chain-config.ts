// Pure text and plan builders of the app's local chain.
// Nothing here touches the disk, the network or a process.

import { LOCAL_CHAIN_HTTP_ALIAS_HOST } from './local-chain'

/** The four system contracts, as their files are named in `resources/local-chain/contracts/`. */
export const LOCAL_CHAIN_CONTRACTS = ['eosio.boot', 'eosio.token', 'eosio.msig', 'eosio.system'] as const
export type LocalChainContract = (typeof LOCAL_CHAIN_CONTRACTS)[number]

/** The chain's core token. */
export const LOCAL_CHAIN_CORE_SYMBOL = '8,WAX'
export const LOCAL_CHAIN_TOKEN_MAX_SUPPLY = '10000000000.00000000 WAX'
export const LOCAL_CHAIN_TOKEN_ISSUE = '1000000000.00000000 WAX'

/**
 * Accounts the WAX system contract names in its source (`eosio.system.hpp`: token, ram, ramfee, stake,
 * bpay, vpay, names, saving, voters, reserv, fees; `eosio.null` exists from the genesis), plus `eosio.msig` and `eosio.rex`.
 * Each is controlled by `eosio@active`, as on WAX Mainnet.
 */
export const LOCAL_CHAIN_SYSTEM_ACCOUNTS = [
  'eosio.bpay',
  'eosio.fees',
  'eosio.msig',
  'eosio.names',
  'eosio.ram',
  'eosio.ramfee',
  'eosio.reserv',
  'eosio.rex',
  'eosio.saving',
  'eosio.stake',
  'eosio.token',
  'eosio.voters',
  'eosio.vpay'
] as const

/** The node's name of the feature that is switched on through the producer API, not by `activate`. */
export const PREACTIVATE_FEATURE = 'PREACTIVATE_FEATURE'

// ---------------------------------------------------------------- genesis

/**
 * Chain time for the genesis: the given moment in UTC, cut to whole seconds, in the node's form
 * (`2026-11-25T17:00:00.000`).
 */
export function genesisTimestamp(at: Date): string {
  return at.toISOString().slice(0, 19) + '.000'
}

/**
 * `genesis.json` text. `publicKey` becomes `initial_key` (the `eosio` authority); the limits are the
 * standard Antelope genesis values.
 */
export function genesisJson(publicKey: string, timestamp: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(timestamp)) throw new Error(`Genesis time "${timestamp}" is not in the form 2026-01-01T00:00:00.000`)
  if (!/^(PUB_K1_|EOS)[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)) throw new Error('The genesis key must be a K1 public key')
  const genesis = {
    initial_timestamp: timestamp,
    initial_key: publicKey,
    initial_configuration: {
      max_block_net_usage: 1048576,
      target_block_net_usage_pct: 1000,
      max_transaction_net_usage: 524288,
      base_per_transaction_net_usage: 12,
      net_usage_leeway: 500,
      context_free_discount_net_usage_num: 20,
      context_free_discount_net_usage_den: 100,
      max_block_cpu_usage: 200000,
      target_block_cpu_usage_pct: 1000,
      max_transaction_cpu_usage: 150000,
      min_transaction_cpu_usage: 100,
      max_transaction_lifetime: 3600,
      deferred_trx_expiration_window: 600,
      max_transaction_delay: 3888000,
      max_inline_action_size: 524288,
      max_inline_action_depth: 4,
      max_authority_depth: 6
    }
  }
  return JSON.stringify(genesis, null, 2) + '\n'
}

// ---------------------------------------------------------------- config.ini

export interface ConfigIniInput {
  port: number
  /** The system key's public form (`PUB_K1_...`). */
  publicKey: string
  /** The system key's private form. The text is written once, through stdin, and never logged. */
  privateKey: string
  /** "Web pages on this computer may call the local chain". */
  webPages: boolean
}

/**
 * `config.ini` text. The producer API is not in it: it is added on the command line for
 * the bootstrap only. `http-alias` lets `localhost:<port>` through host validation
 * (without it the node answers HTTP 400).
 */
export function configIni(input: ConfigIniInput): string {
  const { port, publicKey, privateKey, webPages } = input
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Port ${port} is not a port number`)
  if (!/^PUB_K1_[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)) throw new Error('The signature provider needs a PUB_K1_ public key')
  if (!/^PVT_K1_[1-9A-HJ-NP-Za-km-z]+$/.test(privateKey)) throw new Error('The signature provider needs a PVT_K1_ private key')
  const lines = [
    'plugin = eosio::chain_api_plugin',
    'producer-name = eosio',
    'enable-stale-production = true',
    `signature-provider = ${publicKey}=KEY:${privateKey}`,
    `http-server-address = 127.0.0.1:${port}`,
    `http-alias = ${LOCAL_CHAIN_HTTP_ALIAS_HOST}:${port}`,
    // The node loads its net plugin whatever the config says and would listen for peers on 0.0.0.0:9876;
    // an empty endpoint keeps it from listening at all.
    'p2p-listen-endpoint =',
    'contracts-console = true',
    'enable-account-queries = true'
  ]
  if (webPages) lines.push('access-control-allow-origin = *')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- feature choice

/** One entry of the node's `/v1/producer/get_supported_protocol_features`. */
export interface SupportedFeature {
  feature_digest: string
  dependencies?: string[]
  specification?: { name: string; value: string }[]
}

export interface ChosenFeature {
  name: string
  digest: string
}

export interface FeatureChoice {
  /** PREACTIVATE_FEATURE, switched on through the producer API; null when the node does not offer it. */
  preactivate: ChosenFeature | null
  /** The rest, in the order of `features.json`, each after the features it depends on. */
  activate: ChosenFeature[]
  /** Wanted names the node does not know, or whose dependencies are not chosen, with the reason. */
  skipped: { name: string; reason: string }[]
}

/** The feature's name as the node gives it (`builtin_feature_codename`). */
export function featureName(f: SupportedFeature): string {
  return f.specification?.find((s) => s.name === 'builtin_feature_codename')?.value ?? ''
}

/**
 * Looks up the digests of the wanted feature names (WAX Mainnet's list, `features.json`) in what the node
 * supports. A name the node does not know is skipped; so is one that depends on a feature not chosen before it.
 */
export function chooseFeatures(wanted: readonly string[], supported: readonly SupportedFeature[]): FeatureChoice {
  const byName = new Map<string, SupportedFeature>()
  for (const f of supported) {
    const n = featureName(f)
    if (n && !byName.has(n)) byName.set(n, f)
  }
  const choice: FeatureChoice = { preactivate: null, activate: [], skipped: [] }
  const chosen = new Set<string>()
  const seen = new Set<string>()
  for (const name of wanted) {
    if (seen.has(name)) continue
    seen.add(name)
    const f = byName.get(name)
    if (!f) {
      choice.skipped.push({ name, reason: 'the node does not know this feature' })
      continue
    }
    const digest = f.feature_digest.toLowerCase()
    if (name === PREACTIVATE_FEATURE) {
      choice.preactivate = { name, digest }
      chosen.add(digest)
      continue
    }
    const missing = (f.dependencies ?? []).map((d) => d.toLowerCase()).filter((d) => !chosen.has(d))
    if (missing.length > 0) {
      const names = missing.map((d) => featureName(supported.find((s) => s.feature_digest.toLowerCase() === d) ?? { feature_digest: d }) || d)
      choice.skipped.push({ name, reason: `it needs ${names.join(', ')}, which is not activated before it` })
      continue
    }
    if (!choice.preactivate) {
      choice.skipped.push({ name, reason: `it needs ${PREACTIVATE_FEATURE}` })
      continue
    }
    choice.activate.push({ name, digest })
    chosen.add(digest)
  }
  return choice
}

// ---------------------------------------------------------------- bootstrap action list

/** Which ABI serializes an action: a contract file's ABI, or the built-in native `eosio` ABI. */
export type ActionAbi = LocalChainContract | 'native'

export interface PlannedAction {
  abi: ActionAbi
  account: string
  name: string
  /** Signs with `<actor>@active`; every actor is controlled by the system key. */
  actor: string
  data: Record<string, unknown>
}

export type BootStep =
  /** Switch PREACTIVATE_FEATURE on through the producer API and wait until a block has it. */
  | { kind: 'preactivate'; label: string; feature: ChosenFeature }
  /** `setcode` and `setabi` of a contract file to an account, one transaction each. */
  | { kind: 'deploy'; label: string; account: string; contract: LocalChainContract }
  /** One transaction with these actions. */
  | { kind: 'actions'; label: string; actions: PlannedAction[] }
  /**
   * One transaction of `activate` actions, then a wait until a block has made them active: an activation
   * counts only from the next block, and the system contract needs the features at once.
   */
  | { kind: 'activate'; label: string; features: ChosenFeature[]; actions: PlannedAction[] }

const eosioActive = { threshold: 1, keys: [], accounts: [{ permission: { actor: 'eosio', permission: 'active' }, weight: 1 }], waits: [] }

/**
 * The bootstrap as an ordered list of steps: PREACTIVATE, `eosio.boot`, `activate` per feature,
 * the system accounts, `eosio.token` with `create` and `issue`, `eosio.msig`, `eosio.system`, `setpriv` of
 * `eosio.msig` (an action of the system contract, so after it), `init(0, "8,WAX")`.
 */
export function bootstrapPlan(features: FeatureChoice): BootStep[] {
  if (!features.preactivate) throw new Error(`The node does not offer ${PREACTIVATE_FEATURE}; the system contract cannot be set`)
  const steps: BootStep[] = []
  steps.push({ kind: 'preactivate', label: `Switching on ${PREACTIVATE_FEATURE}`, feature: features.preactivate })
  steps.push({ kind: 'deploy', label: 'Setting eosio.boot on eosio', account: 'eosio', contract: 'eosio.boot' })
  if (features.activate.length > 0) {
    steps.push({
      kind: 'activate',
      label: `Activating ${features.activate.length} protocol features`,
      features: features.activate,
      actions: features.activate.map((f) => ({ abi: 'eosio.boot', account: 'eosio', name: 'activate', actor: 'eosio', data: { feature_digest: f.digest } }))
    })
  }
  steps.push({
    kind: 'actions',
    label: `Creating ${LOCAL_CHAIN_SYSTEM_ACCOUNTS.length} system accounts`,
    actions: LOCAL_CHAIN_SYSTEM_ACCOUNTS.map((name) => ({
      abi: 'native',
      account: 'eosio',
      name: 'newaccount',
      actor: 'eosio',
      data: { creator: 'eosio', name, owner: eosioActive, active: eosioActive }
    }))
  })
  steps.push({ kind: 'deploy', label: 'Setting eosio.token', account: 'eosio.token', contract: 'eosio.token' })
  steps.push({
    kind: 'actions',
    label: `Creating the WAX token (8 decimals) and issuing ${LOCAL_CHAIN_TOKEN_ISSUE} to eosio`,
    actions: [
      { abi: 'eosio.token', account: 'eosio.token', name: 'create', actor: 'eosio.token', data: { issuer: 'eosio', maximum_supply: LOCAL_CHAIN_TOKEN_MAX_SUPPLY } },
      { abi: 'eosio.token', account: 'eosio.token', name: 'issue', actor: 'eosio', data: { to: 'eosio', quantity: LOCAL_CHAIN_TOKEN_ISSUE, memo: '' } }
    ]
  })
  steps.push({ kind: 'deploy', label: 'Setting eosio.msig', account: 'eosio.msig', contract: 'eosio.msig' })
  steps.push({ kind: 'deploy', label: 'Setting the WAX system contract on eosio', account: 'eosio', contract: 'eosio.system' })
  steps.push({
    kind: 'actions',
    label: `Making eosio.msig privileged and starting the system contract with ${LOCAL_CHAIN_CORE_SYMBOL}`,
    actions: [
      { abi: 'eosio.system', account: 'eosio', name: 'setpriv', actor: 'eosio', data: { account: 'eosio.msig', is_priv: 1 } },
      { abi: 'eosio.system', account: 'eosio', name: 'init', actor: 'eosio', data: { version: 0, core: LOCAL_CHAIN_CORE_SYMBOL } }
    ]
  })
  return steps
}
