// After a sent deployment or Clear Contract Code, the node may still answer with the old ABI:
// a node reads from its head block, and the transaction is in a block only a moment later
// (or the read goes to another endpoint that is a block behind). The ABI is read again until
// it differs from the one shown, or the waits run out.

import type { ContractAbiView } from '../../../shared/chain-types'

/** Waits before each read, in ms: the first read is at once, the last about 12 s after the send. */
export const ABI_CHANGE_WAITS = [0, 1000, 1500, 2000, 3000, 4500]

/** Same actions, tables and fields: what the Contract tab draws. */
export function sameAbiView(a: ContractAbiView | null, b: ContractAbiView | null): boolean {
  if (!a || !b) return a === b
  return a.hasAbi === b.hasAbi && JSON.stringify(a.actions) === JSON.stringify(b.actions) && JSON.stringify(a.tables) === JSON.stringify(b.tables)
}

/**
 * Reads the ABI until it differs from `shown`; returns the first different view, or the last
 * view read when every read gave the same one (a deployment that kept the ABI). A failed read
 * is retried like a stale one; when no read succeeded, the last error is thrown.
 * `cancelled` stops the loop (the tab was closed or another read started).
 */
export async function readChangedAbi(
  read: () => Promise<ContractAbiView>,
  shown: ContractAbiView | null,
  opts: { waits?: number[]; sleep?: (ms: number) => Promise<void>; cancelled?: () => boolean } = {}
): Promise<ContractAbiView | null> {
  const waits = opts.waits ?? ABI_CHANGE_WAITS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let last: ContractAbiView | null = null
  for (let i = 0; i < waits.length; i++) {
    if (waits[i] > 0) await sleep(waits[i])
    if (opts.cancelled?.()) return null
    try {
      last = await read()
    } catch (e) {
      if (i === waits.length - 1 && !last) throw e
      continue
    }
    if (!sameAbiView(last, shown)) return last
  }
  return last
}
