// Contract page table view: only the answer of the latest query is shown.
// A slow answer of an older query (rows, error or the end of loading) is dropped.

export interface LatestGate {
  /** Starts a query; every query started before it becomes stale. Returns its ticket. */
  start(): number
  /** True while `ticket` belongs to the latest query started. */
  isLatest(ticket: number): boolean
}

export function createLatestGate(): LatestGate {
  let last = 0
  return {
    start: () => ++last,
    isLatest: (ticket) => ticket === last
  }
}
