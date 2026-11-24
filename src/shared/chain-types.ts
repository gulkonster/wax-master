// Types shared by the main process and the window for chain features.

export type NetworkKind = 'mainnet' | 'testnet' | 'local'

export interface NetworkInfo {
  id: string
  name: string
  kind: NetworkKind
  chainId: string
  symbol: string
  precision: number
  endpoints: string[]
  history?: string
  preset: boolean
  currentEndpoint: number
  /** Set by the main process when the kind cannot be chosen (a known main network); shown next to the kind. */
  kindNote?: string
  /** Set by the main process after its own dialog confirmed marking this chain as a test network. */
  testnetConfirmed?: boolean
}

export interface PermissionView {
  name: string
  parent: string
  threshold: number
  /** key as returned by the node; k1 = the same key in PUB_K1_ form (for matching), '' if unparsable. */
  keys: { key: string; k1: string; weight: number }[]
  accounts: { actor: string; permission: string; weight: number }[]
  waits: { waitSec: number; weight: number }[]
}

export interface ResourceView {
  used: number
  max: number
}

export interface AccountView {
  name: string
  network: string
  symbol: string
  liquid: string
  staked: string
  refund: string
  total: string
  ram: { usage: number; quota: number }
  cpu: ResourceView
  net: ResourceView
  cpuWeight: string
  netWeight: string
  permissions: PermissionView[]
  hasCode: boolean
  created: string
  /** Tokens this account staked to itself, for CPU and for NET (asset text). */
  cpuSelf: string
  netSelf: string
  /** Tokens other accounts staked to this one (CPU plus NET, asset text). */
  stakedByOthers: string
  /** The refund in progress: CPU and NET parts, when it was asked for and when it can be claimed ('' when none). */
  refundCpu: string
  refundNet: string
  refundRequested: string
  refundDue: string
  /**
   * Permissions whose threshold the vault's keys reach with their own weights
   * (keys only; accounts and waits are not counted). Empty: view only.
   */
  control: string[]
}

/** One token balance of the wallet's token list. */
export interface TokenRow {
  contract: string
  symbol: string
  precision: number
  /** Asset text, e.g. "12.3400 ABC"; '' when the balance could not be read. */
  balance: string
  /** Where the row comes from: the chain's core token, the history service, or a token the user added. */
  source: 'core' | 'history' | 'added'
}

export interface WalletTokens {
  rows: TokenRow[]
  /** 'none': the network has no history service; 'error': it did not answer (historyNote says why). */
  history: 'ok' | 'none' | 'error'
  historyNote: string
}

/** A token the user added for a network (contract and symbol, precision read from the chain). */
export interface AddedToken {
  contract: string
  symbol: string
  precision: number
}

export interface AccountActionRow {
  time: string
  block: number
  trxId: string
  contract: string
  action: string
  data: string
}

export interface AccountActionsPage {
  rows: AccountActionRow[]
  /** False when the network has no history service configured. */
  historyAvailable: boolean
  more: boolean
}

// ---- Contract page ----

export interface ContractField {
  name: string
  /** Type as written in the ABI. */
  type: string
  /** Type after resolving ABI aliases (for choosing an input). */
  resolved: string
}

export interface ContractAction {
  name: string
  type: string
  ricardian: string
  fields: ContractField[]
}

export interface ContractTable {
  name: string
  type: string
  indexType: string
  keyNames: string[]
  keyTypes: string[]
  fields: ContractField[]
}

export interface ContractAbiView {
  /** False when the account has no ABI on the network. */
  hasAbi: boolean
  account: string
  actions: ContractAction[]
  tables: ContractTable[]
}

export interface AuthLevel {
  actor: string
  permission: string
}

export interface PackResult {
  json: string
  hex: string
  cleos: string
}

export interface RowsQuery {
  account: string
  table: string
  scope: string
  lower: string
  upper: string
  limit: number
  index: string
  keyType: string
  reverse: boolean
}

export interface RowsResult {
  rows: unknown[]
  more: boolean
  nextKey: string
}

export interface ScopesResult {
  rows: { code: string; scope: string; table: string; payer: string; count: number }[]
  more: string
}

export type ContractHistoryKind = 'action' | 'query'
export type ContractHistoryList = 'favorite' | 'history'

export interface ContractHistoryEntry {
  id: string
  time: string
  /** Action name or table name. */
  name: string
  /** Action: { data, authorization }. Query: the query fields without account. */
  payload: Record<string, unknown>
}

/**
 * A deploy plan is used up by Deploy and kept for ten minutes otherwise. The
 * Deploy dialog recognises this text and prepares the plan again from the same
 * build (no compile).
 */
export const DEPLOY_PLAN_EXPIRED = 'The deploy plan expired. Open Deploy again.'

export interface DeployPlan {
  id: string
  network: string
  networkKind: NetworkKind
  endpoint: string
  account: string
  permission: string
  wasmFile: string | null
  abiFile: string | null
  wasmSha256: string | null
  abiSha256: string | null
  wasmSize: number | null
  abiSize: number | null
  chainCodeHash: string
  chainAbiHash: string
  sendWasm: boolean
  sendAbi: boolean
  /**
   * Estimated RAM in bytes the deployment adds: the parts that will be sent,
   * less what they replace on the account; never below zero.
   */
  ramNeeded: number
  /** RAM of the parts that will be sent (10 x code size, plus the ABI size). */
  ramNew: number
  /** RAM of what those parts replace on the account (0 for a first deployment). */
  ramReplaced: number
  /** The size of the code on the account could not be read; it was counted as zero. */
  chainCodeUnread: boolean
  /** Free RAM of the account in bytes; -1 = unlimited. */
  ramAvailable: number
  missingFeatures: { name: string; feature: string }[]
}

/** Status mark of the selected network: `checking` until the first answer. */
export type NetworkStatusLevel = 'checking' | 'green' | 'orange' | 'red'

/** State of the selected network's endpoint, from the main process's get_info checks. */
export interface NetworkStatus {
  networkId: string
  endpoint: string
  level: NetworkStatusLevel
  /** "Checking", "Working", "Slow or behind", "Not reachable" or "Wrong chain". */
  label: string
  /** Why the level is not green (empty when working). */
  reasons: string[]
  /** One line for tooltips: the label, the reasons and the numbers. */
  summary: string
  headBlock: number | null
  lib: number | null
  latencyMs: number | null
  /** Time of the last check (ms since 1970), null before the first. */
  checkedAt: number | null
}
