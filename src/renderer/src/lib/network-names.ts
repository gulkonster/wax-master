// Network names, the network chosen after a removal and amount texts: plain
// functions shared by the network dialogs and the Network page.

import type { NetworkInfo } from '../../../shared/chain-types'

/**
 * The network selected after `removedId` is removed, by the main process's rule:
 * the WAX Testnet default, else an entry on the WAX Testnet chain, else the first.
 */
export function nextNetworkAfterRemoval(list: NetworkInfo[], removedId: string, waxTestnetChain: string): NetworkInfo | null {
  const rest = list.filter((n) => n.id !== removedId)
  return rest.find((n) => n.id === 'wax-testnet') ?? rest.find((n) => n.chainId === waxTestnetChain) ?? rest[0] ?? null
}

/**
 * A name for a new network: the known chain's name, the name of a network on
 * the same chain, or the host; made unique in the list. A default network's
 * name is suggested like any other name when no network of the list uses it.
 */
export function suggestNetworkName(probe: { endpoint: string; chainId: string; knownName: string | null }, list: NetworkInfo[]): string {
  let host = probe.endpoint
  try {
    host = new URL(probe.endpoint).host
  } catch {
    // keep the text as given
  }
  const taken = (name: string): boolean => list.some((n) => n.name.toLowerCase() === name.toLowerCase())
  const base = probe.knownName ?? list.find((n) => n.chainId === probe.chainId)?.name ?? host
  if (!taken(base)) return base
  if (!taken(`${base} (${host})`)) return `${base} (${host})`
  return host
}

/** An asset amount ("1234567.12345678 WAX") with thousands separators; the text is split, never converted to a number. */
export function groupAmount(text: string): string {
  const m = /^(-?)(\d+)(\.\d+)?(\s.*)?$/.exec(text)
  if (!m) return text
  return `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}${m[4] ?? ''}`
}
