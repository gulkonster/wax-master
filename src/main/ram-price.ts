// The RAM price of the current network, read from the system contract's
// `rammarket` row. Only a real "no market" answer counts as not available (no
// rows, a row that is not a RAM market, or the node saying the table, contract
// or account is unknown); the Buy RAM buttons are then not shown. Every other
// failure is an error: `readCall` tries the next endpoint on a status of 0,
// 429 or 5xx, and nothing of it is kept as "not available".

import { RpcError } from './rpc'
import { parseRamMarket, ramCost, type RamPrice } from '../shared/ram-market'

export type TableReader = (body: Record<string, unknown>) => Promise<{ rows: unknown[] }>

const NO_MARKET = 'This network has no system RAM market.'

/** Text of a node error that says the table, contract or account does not exist. */
const UNKNOWN_TABLE =
  /not specified in the ABI|contract_table_query_exception|table_query_exception|abi_not_found|no ABI|unknown (?:key|table|contract|account|code)|unknown_key|account_query_exception|does not exist|fail(?:ed)? to retrieve account|table [^ ]* ?not found/i

/** True when the node answered (not a lost connection, a rate limit or a server failure) that there is no such table. */
export function isNoMarketAnswer(e: unknown): boolean {
  if (!(e instanceof RpcError) || e.status === 0) return false
  let text = e.message
  try {
    text += ' ' + JSON.stringify(e.details ?? '')
  } catch {
    // the message alone
  }
  return UNKNOWN_TABLE.test(text.slice(0, 20_000))
}

export async function readRamPrice(bytes: number, read: TableReader): Promise<RamPrice> {
  let rows: unknown[]
  try {
    const r = await read({ code: 'eosio', scope: 'eosio', table: 'rammarket', json: true, limit: 1 })
    rows = Array.isArray(r?.rows) ? r.rows : []
  } catch (e) {
    if (isNoMarketAnswer(e)) return { available: false, reason: NO_MARKET }
    throw e
  }
  const market = parseRamMarket(rows[0])
  if (!market) return { available: false, reason: NO_MARKET }
  return { available: true, ...market, bytes, cost: ramCost(market, bytes) }
}

/** The text shown when the price could not be read on any endpoint. */
export function ramPriceError(e: unknown): Error {
  const reason = e instanceof Error ? e.message : String(e)
  return new Error(`The RAM price could not be read. ${reason}`.trim())
}
