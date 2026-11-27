// Types and fixed names of the app's local chain. No logic.

export const LOCAL_CHAIN_NETWORK_ID = 'local-chain'
export const LOCAL_CHAIN_DISTRO = 'waxmaster-localchain'
export const LOCAL_CHAIN_DEFAULT_PORT = 8888
export const LOCAL_CHAIN_PORT_MIN = 8888
export const LOCAL_CHAIN_PORT_MAX = 8899

/** Text the node prints when its data was not closed cleanly. */
export const LOCAL_CHAIN_DIRTY_FLAG_TEXT = 'database dirty flag set'
/** Exit code of the node on a dirty database. */
export const LOCAL_CHAIN_DIRTY_EXIT_CODE = 2
/** The node refuses a Host header it does not know (HTTP 400): `localhost:<port>` needs `http-alias`. */
export const LOCAL_CHAIN_HTTP_ALIAS_HOST = 'localhost'

export type LocalChainPhase =
  | 'unavailable'
  | 'not-set-up'
  | 'setting-up'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'failed'

export interface LocalChainOptions {
  /** Web pages on this computer may call the local chain (CORS; restarts the node). */
  webPages: boolean
  /** Start the local chain with WAX Master. */
  startWithApp: boolean
}

/** A repair offer shown in the failed state. */
export type LocalChainRepair =
  | { kind: 'reset' }
  | { kind: 'use-port'; port: number }
  /** Set up did not finish (no state file): the way back is Set up again. */
  | { kind: 'set-up' }
  | { kind: 'none' }

export interface LocalChainStatus {
  phase: LocalChainPhase
  reason?: string
  repair?: LocalChainRepair
  port: number
  endpoint: string
  chainId: string
  nodeVersion: string
  head?: number
  dataMb?: number
  options: LocalChainOptions
}

/** What `state.json` in `<local data>/local-chain` holds. Never a key. */
export interface LocalChainState {
  port: number
  chainId: string
  nodeVersion: string
  contractsVersion: string
  options: LocalChainOptions
  bootstrapped: boolean
}

export interface LocalChainApi {
  status(): Promise<LocalChainStatus>
  setUp(): Promise<LocalChainStatus>
  start(): Promise<LocalChainStatus>
  stop(): Promise<LocalChainStatus>
  reset(): Promise<LocalChainStatus>
  remove(): Promise<LocalChainStatus>
  usePort(port: number): Promise<LocalChainStatus>
  setOptions(options: LocalChainOptions): Promise<LocalChainStatus>
  openLog(): Promise<void>
  /** Returns the unsubscribe function. */
  onStatus(listener: (status: LocalChainStatus) => void): () => void
  /** One progress line per event. Returns the unsubscribe function. */
  onProgress(listener: (line: string) => void): () => void
}

export const LOCAL_CHAIN_STATUS_EVENT = 'local-chain-status'
export const LOCAL_CHAIN_PROGRESS_EVENT = 'local-chain-progress'

/** New account on the local chain: one vault key (public form) for owner and active. */
export interface LocalAccountInput {
  name: string
  publicKey: string
}

/** Give tokens on the local chain: WAX from `eosio` to an existing account. */
export interface LocalTokensInput {
  account: string
  /** WAX with up to 8 decimals, more than 0 and a valid asset amount: the typed text ("1000.5"), or a number. */
  amount: string | number
}
