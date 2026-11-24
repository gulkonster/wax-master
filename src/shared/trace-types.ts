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
}
