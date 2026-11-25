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
   * Seconds from the chain's head time (of the same get_account answer) to the
   * due time of the refund; the page counts down from the moment of the read.
   * 0 when no refund waits.
   */
  refundSecondsLeft: number
  /** True on the two WAX chains, whose waiting time is known; elsewhere the time is "about". */
  refundExact: boolean
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
  /**
   * Set by the main process: 'core' on the network's own token (eosio.token and
   * the network's symbol); 'lookalike' on the network's symbol from another
   * contract. `text` is the tag the page draws.
   */
  mark?: { kind: 'core' | 'lookalike'; text: string }
}

/** A balance read from the chain for a form that sends: the asset text and the token's precision. */
export interface TokenBalance {
  balance: string
  precision: number
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
  /** Number of matching actions the history service reports (0 when it reports none); `totalExact` false when it is a lower bound. */
  total?: number
  totalExact?: boolean
  /** True when older matching actions exist but lie beyond the history service's window of 10,000 rows. */
  windowEnd?: boolean
}

/** Filters of the Transactions list: an action name and a time range (ISO times in UTC); empty means no filter. */
export interface AccountActionsFilter {
  action?: string
  after?: string
  before?: string
}

// ---- Wallet: system contract features, voting, PowerUp ----

/** What the chain's system contract (eosio) offers, read from its ABI and tables. */
export interface SystemFeatures {
  /** The ABI has voteproducer and the producers and voters tables. */
  voting: boolean
  /** The ABI has powerup and the powup.state table has its row. */
  powerup: boolean
  /** The ABI has bidname and bidrefund and the namebids and bidrefunds tables. */
  nameBids: boolean
}

/** One row of the namebids table, checked. */
export interface NameBidRow {
  name: string
  highBidder: string
  /** The highest bid in whole units of the core token, always above zero (the table keeps a closed bid negative). */
  highBid: string
  /** Time of the last bid, ISO in UTC. */
  lastBidTime: string
  /** The chain closed the auction: the high bidder won the name. */
  closed: boolean
}

/** What the chain says about one name for one account: the account, the auction row, the account's refund under the name. */
export interface NameBidLookup {
  name: string
  account: string
  /** An account of this name exists. */
  exists: boolean
  bid: NameBidRow | null
  /** The account's outbid amount waiting in bidrefunds under this name, in whole units; null when there is none. */
  refund: string | null
  symbol: string
  precision: number
}

/** The open auctions of the chain, highest bid first. */
export interface NameAuctions {
  /** At most NAME_AUCTIONS_MAX rows. */
  open: NameBidRow[]
  /** More open auctions exist than were read. */
  more: boolean
  /** The chain's last close of an auction, ISO in UTC; '' when it is not known. */
  lastNameClose: string
  symbol: string
  precision: number
}

export interface ProducerRow {
  name: string
  /** Share of all producer votes, in percent. */
  votePercent: number
}

export interface VoterClaimView {
  action: 'voterclaim' | 'claimgbmvote' | 'claimgenesis'
  field: 'owner' | 'claimer'
  label: string
  /** What is due, in words: an estimate with its amount, or that it cannot be estimated. */
  dueText: string
  /** A note about the time of the claim ('' when none). */
  timeNote: string
  /** Why the tables show the claim as not possible now ('' when it can be tried). */
  blocked: string
}

export interface VotingView {
  maxProducers: number
  /** Active producers, most votes first. */
  producers: ProducerRow[]
  /** True when the list was cut at its size limit. */
  producersCut: boolean
  /** The account's row of the voters table; null when the account has never staked (the chain then refuses a vote). */
  current: { proxy: string; producers: string[]; staked: string; isProxy: boolean } | null
  claims: VoterClaimView[]
  /** True on the WAX chains, whose system contract pays voter rewards only for a vote naming at least WAX_REWARD_MIN_PRODUCERS producers, or a proxy. */
  waxRewardRule: boolean
}

/** Whether an account is registered as a proxy (its voters row has is_proxy). */
export interface ProxyInfoView {
  name: string
  registered: boolean
}

export interface PowerupResourceView {
  weight: string
  utilization: string
  adjustedUtilization: string
  utilizationTimestamp: number
  decaySecs: number
  exponent: number
  minPrice: string
  maxPrice: string
}

/** The powup.state row, checked; prices and fees in whole units of the core token. */
export interface PowerupStateView {
  net: PowerupResourceView
  cpu: PowerupResourceView
  days: number
  minFee: string
  symbol: string
  precision: number
  /** The chain's head time (seconds since 1970, UTC) at the read: the cost is computed against chain time. */
  headTime: number
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

/** An authority as shown in the wallet: threshold and entries in the chain's order. */
export interface AuthorityView {
  threshold: number
  /** `key` in the form the chain writes the account's keys (as in the permission tree); `k1` in the PUB_K1_ form. */
  keys: { key: string; k1: string; weight: number }[]
  accounts: { actor: string; permission: string; weight: number }[]
  waits: { waitSec: number; weight: number }[]
}

/**
 * A permission change as the editor window asks for it. The main process reads
 * the current authority from the chain and builds the new one; an authority is
 * never sent by the editor window.
 */
export type PermissionIntent =
  | { kind: 'addKey'; account: string; permission: string; key: string; weight: number }
  | { kind: 'removeKey'; account: string; permission: string; key: string }
  | { kind: 'addAccount'; account: string; permission: string; actor: string; actorPermission: string; weight: number }
  | { kind: 'removeAccount'; account: string; permission: string; actor: string; actorPermission: string }
  | { kind: 'setThreshold'; account: string; permission: string; threshold: number }
  /** The `eosio.code` switch: adds or removes `<account>@eosio.code` with a weight equal to the threshold. */
  | { kind: 'eosioCode'; account: string; permission: string; enable: boolean }
  /** A new permission under `parent` with one key (threshold 1, weight 1). */
  | { kind: 'newPermission'; account: string; permission: string; parent: string; key: string }
  | { kind: 'deletePermission'; account: string; permission: string }
  | { kind: 'link'; account: string; code: string; type: string; requirement: string }
  | { kind: 'unlink'; account: string; code: string; type: string }

/** What a permission change will do, built by the main process from the chain's current state. */
export interface PermissionPlanView {
  title: string
  /** Plain sentences about the change. */
  explanation: string[]
  /** Extra lines (changing owner, the vault losing control, ...). */
  warnings: string[]
  /** The permission that is changed (or linked to). */
  permission: string
  /** The full authority before and after the change; null where there is none (link, new or deleted permission). */
  before: AuthorityView | null
  after: AuthorityView | null
  /** Changes when the account's permissions change; the send is refused when it differs. */
  basis: string
  /** The action that will be sent, as JSON (for the Command view). */
  action: { account: string; name: string; authorization: AuthLevel[]; data: unknown }
}

/** One linked action: `contract::action` (action '' = every action of the contract) needs `permission`. */
export interface LinkedActionRow {
  contract: string
  action: string
  permission: string
}

export interface LinkedActionsView {
  rows: LinkedActionRow[]
  /** Where the list comes from: the node's get_account, the history service, or nowhere. */
  source: 'node' | 'history' | 'none'
}

/** The Contract section: what is deployed on the account. */
export interface ContractInfoView {
  hasCode: boolean
  /** SHA-256 of the code ('' when none). */
  codeHash: string
  /** SHA-256 of the ABI ('' when none). */
  abiHash: string
  /** Last code update (chain time, '' when unknown). */
  lastCodeUpdate: string
}
