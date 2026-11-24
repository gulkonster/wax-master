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
  /** Estimated RAM in bytes for the parts that will be sent. */
  ramNeeded: number
  /** Free RAM of the account in bytes; -1 = unlimited. */
  ramAvailable: number
  missingFeatures: { name: string; feature: string }[]
}
