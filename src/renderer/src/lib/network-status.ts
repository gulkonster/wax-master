// Status mark of the selected network, as the main process reports it after
// each get_info check. Shared by the top bar, the status bar, the network
// dropdown, the drawn menu and the Network page.

import type { NetworkStatus, NetworkStatusLevel } from '../../../shared/chain-types'
import { Store } from './stores'

const LEVELS: readonly NetworkStatusLevel[] = ['checking', 'green', 'orange', 'red']

export const networkStatusStore = new Store<NetworkStatus | null>(null)

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** The event's value with only the known fields, or null when it is not a status. */
export function parseNetworkStatus(v: unknown): NetworkStatus | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!LEVELS.includes(o.level as NetworkStatusLevel)) return null
  return {
    networkId: text(o.networkId, 64),
    endpoint: text(o.endpoint, 512),
    level: o.level as NetworkStatusLevel,
    label: text(o.label, 64),
    reasons: Array.isArray(o.reasons) ? o.reasons.slice(0, 8).map((r) => text(r, 300)) : [],
    summary: text(o.summary, 1000),
    headBlock: numOrNull(o.headBlock),
    lib: numOrNull(o.lib),
    latencyMs: numOrNull(o.latencyMs),
    checkedAt: numOrNull(o.checkedAt)
  }
}

/** Reads the current status once and follows the main process's updates. */
export function watchNetworkStatus(): () => void {
  const off = window.wax.on('network-status', (s: NetworkStatus) => {
    const parsed = parseNetworkStatus(s)
    if (parsed) networkStatusStore.set(parsed)
  })
  void window.wax.network
    .status()
    .then((s) => {
      const parsed = parseNetworkStatus(s)
      if (parsed && !networkStatusStore.get()) networkStatusStore.set(parsed)
    })
    .catch(() => undefined)
  return off
}

/** The status of the given network, or null when the status is for another one. */
export function statusFor(status: NetworkStatus | null, networkId: string | undefined): NetworkStatus | null {
  return status && networkId && status.networkId === networkId ? status : null
}
