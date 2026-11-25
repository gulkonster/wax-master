// Transaction inspector data, shared by the main process and the window.

export interface TraceNode {
  ordinal: number
  receiver: string
  account: string
  name: string
  authorization: { actor: string; permission: string }[]
  /** Decoded input as JSON text, or null when the endpoint did not return it. */
  data: string | null
  hex: string | null
  /** Contract console output; null = not returned by this endpoint. */
  console: string | null
  ramDeltas: { account: string; delta: number }[] | null
  returnValue: string | null
  /** True when the receiver is not the contract (a notification). */
  notification: boolean
  error: string | null
  elapsedUs: number | null
  children: TraceNode[]
}

export interface InspectedTransaction {
  source: 'simulation' | 'sent' | 'history'
  network: string
  endpoint: string
  id: string
  block: number | null
  time: string | null
  status: string
  cpuUs: number | null
  netBytes: number | null
  /** Deepest error message first (e.g. a contract's check message). */
  errorMessage: string | null
  errorStack: string | null
  actions: TraceNode[]
  notes: string[]
  /** Set when the node refused the transaction for CPU, NET or RAM (never for a timeout or network error). */
  resource?: ResourceProblem
}

export type ResourceKind = 'cpu' | 'net' | 'ram'

/** CPU in microseconds, NET in bytes, RAM in bytes; -1 = unlimited. */
export interface AccountResources {
  account: string
  cpu: { used: number; available: number; max: number } | null
  net: { used: number; available: number; max: number } | null
  ram: { used: number; quota: number } | null
}

/** The account a RAM refusal names, with the bytes it needs and has (null when the node did not say). */
export interface RamShortage {
  account: string
  needs: number | null
  has: number | null
}

export interface ResourceProblem {
  kind: ResourceKind
  /** Node error name, e.g. tx_cpu_usage_exceeded. */
  errorName: string
  /** Whose resources are shown: the account a RAM refusal names, else the first authorizer. */
  account: string
  /** Read with get_account from the same endpoint; null if that read failed. */
  state: AccountResources | null
  /** Set for a RAM refusal whose account the node names. */
  shortage?: RamShortage
}
