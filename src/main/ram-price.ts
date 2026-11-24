// The RAM price of the current network, read from the system contract's
// `rammarket` row. A chain without that market answers "not available" (the
// Buy RAM buttons are then not shown); an endpoint that cannot be reached is an error.

import { RpcError } from './rpc'
import { parseRamMarket, ramCost, type RamPrice } from '../shared/ram-market'

export type TableReader = (body: Record<string, unknown>) => Promise<{ rows: unknown[] }>

export async function readRamPrice(bytes: number, read: TableReader): Promise<RamPrice> {
  let rows: unknown[]
  try {
    const r = await read({ code: 'eosio', scope: 'eosio', table: 'rammarket', json: true, limit: 1 })
    rows = Array.isArray(r?.rows) ? r.rows : []
  } catch (e) {
    // The node answered with an error: no such table or contract on this chain.
    if (e instanceof RpcError && e.status >= 400 && e.status < 600) return { available: false, reason: 'This network has no system RAM market.' }
    throw e
  }
  const market = parseRamMarket(rows[0])
  if (!market) return { available: false, reason: 'This network has no system RAM market.' }
  return { available: true, ...market, bytes, cost: ramCost(market, bytes) }
}
