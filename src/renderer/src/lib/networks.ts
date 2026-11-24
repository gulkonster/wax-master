// Current network, saved networks and starred accounts, shared by the top bar,
// status bar and chain pages.

import type { NetworkInfo } from '../../../shared/chain-types'
import { Store } from './stores'
import { toast } from './toast'
import { watchNetworkStatus } from './network-status'

export interface NetworkState {
  list: NetworkInfo[]
  current: NetworkInfo | null
  stars: string[]
}

export const networkStore = new Store<NetworkState>({ list: [], current: null, stars: [] })

export async function refreshNetworks(): Promise<void> {
  const r = await window.wax.networks.list()
  const stars = await window.wax.networks.stars()
  networkStore.set({ list: r.networks, current: r.networks.find((n) => n.id === r.current) ?? null, stars })
}

export async function selectNetwork(id: string): Promise<void> {
  const n = await window.wax.networks.select(id)
  await refreshNetworks()
  toast('Network', `Switched to ${n.name} at ${n.endpoints[n.currentEndpoint]}.`, 'success')
}

export async function toggleStar(account: string): Promise<void> {
  const s = networkStore.get()
  const starred = !s.stars.includes(account)
  const stars = await window.wax.networks.setStar(account, starred)
  networkStore.set({ ...networkStore.get(), stars })
}

export function isMainnetLike(n: NetworkInfo | null): boolean {
  return !!n && n.kind === 'mainnet'
}

/** Listens for endpoint changes made by the main process (read failover) and for the status mark. */
export function watchNetworkEvents(): () => void {
  const offChanged = window.wax.on('network-changed', (n: NetworkInfo, note: string) => {
    void refreshNetworks()
    if (note) toast('Network', note, 'info')
  })
  const offStatus = watchNetworkStatus()
  return () => {
    offChanged()
    offStatus()
  }
}

/** The network to switch to for WAX Testnet features: the default entry, else any entry for that chain. */
export function waxTestnetEntry(list: NetworkInfo[], chainId: string): NetworkInfo | null {
  return list.find((n) => n.id === 'wax-testnet' && n.chainId === chainId) ?? list.find((n) => n.chainId === chainId) ?? null
}
