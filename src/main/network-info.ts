// Read-only chain state for the Network page: get_info, the head block and the
// system tables `global`, `rammarket` and the core token's `stat`. A table the
// chain does not have (no system contract, no token contract) is "n/a"; any
// other failure is shown as an error of that value. Nothing here signs.

import { chain, request, type ChainInfo } from './rpc'
import { isNoMarketAnswer } from './ram-price'
import {
  parseBlock,
  parseGlobal,
  parseInfo,
  parseRamPricePerKb,
  parseStat,
  type ChainBasics,
  type ChainRam,
  type NetworkHead,
  type NetworkOverview,
  type Part,
  type RamPricePerKb,
  type SystemToken
} from '../shared/network-info'

/** Time limit of one read of the 2-second loop. */
export const HEAD_TIMEOUT_MS = 5_000

/** Runs one read against an endpoint of the network (moving to the next endpoint on failure). */
export type Reader = <T>(fn: (endpoint: string) => Promise<T>) => Promise<T>

/** The chain calls used here; replaced by fakes in tests. */
export interface ChainCalls {
  getInfo(ep: string): Promise<unknown>
  getTableRows(ep: string, body: Record<string, unknown>): Promise<{ rows: unknown[] }>
  getBlock(ep: string, num: number): Promise<unknown>
}

export const rpcCalls: ChainCalls = {
  getInfo: (ep) => request<ChainInfo>(ep, '/v1/chain/get_info', { body: {}, timeoutMs: HEAD_TIMEOUT_MS }),
  getTableRows: (ep, body) => chain.getTableRows(ep, body),
  getBlock: (ep, num) => chain.getBlock(ep, num, HEAD_TIMEOUT_MS)
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

function failed(e: unknown, what: string): Part<never> {
  return isNoMarketAnswer(e) ? { state: 'na', reason: `This chain has no ${what}.` } : { state: 'error', reason: message(e) }
}

async function readBasics(read: Reader, calls: ChainCalls): Promise<{ basics: ChainBasics; endpoint: string }> {
  let endpoint = ''
  const raw = await read(async (ep) => {
    const r = await calls.getInfo(ep)
    endpoint = ep
    return r
  })
  const basics = parseInfo(raw)
  if (!basics) throw new Error(`${endpoint || 'The endpoint'} did not answer with chain information.`)
  return { basics, endpoint }
}

async function firstRow(read: Reader, calls: ChainCalls, body: Record<string, unknown>): Promise<unknown> {
  const r = await read((ep) => calls.getTableRows(ep, { json: true, limit: 1, ...body }))
  return Array.isArray(r?.rows) ? r.rows[0] : undefined
}

/**
 * get_info, then `global` and `rammarket` of eosio, then the `stat` row of the
 * core token (its symbol from the RAM market, else the network's saved symbol).
 */
export async function readOverview(networkId: string, savedSymbol: string, read: Reader, calls: ChainCalls = rpcCalls): Promise<NetworkOverview> {
  const { basics, endpoint } = await readBasics(read, calls)
  const [globalRow, marketRow] = await Promise.allSettled([
    firstRow(read, calls, { code: 'eosio', scope: 'eosio', table: 'global' }),
    firstRow(read, calls, { code: 'eosio', scope: 'eosio', table: 'rammarket' })
  ])

  let ram: Part<ChainRam>
  if (globalRow.status === 'rejected') ram = failed(globalRow.reason, 'system contract')
  else {
    const g = parseGlobal(globalRow.value)
    ram = g ? { state: 'ok', value: g } : { state: 'na', reason: 'This chain has no system contract.' }
  }

  let ramPrice: Part<RamPricePerKb>
  if (marketRow.status === 'rejected') ramPrice = failed(marketRow.reason, 'system RAM market')
  else {
    const p = parseRamPricePerKb(marketRow.value)
    ramPrice = p ? { state: 'ok', value: p } : { state: 'na', reason: 'This chain has no system RAM market.' }
  }

  const symbol = ramPrice.state === 'ok' ? ramPrice.value.symbol : savedSymbol
  let token: Part<SystemToken>
  if (!/^[A-Z]{1,7}$/.test(symbol)) token = { state: 'na', reason: 'The core token is not known.' }
  else {
    try {
      const row = await firstRow(read, calls, { code: 'eosio.token', scope: symbol, table: 'stat' })
      const t = parseStat(row, symbol)
      token = t ? { state: 'ok', value: t } : { state: 'na', reason: `eosio.token has no ${symbol} token.` }
    } catch (e) {
      token = failed(e, 'token contract')
    }
  }

  return { networkId, endpoint, basics, token, ram, ramPrice }
}

/** One step of the 2-second loop: get_info and the head block it names. */
export async function readHead(networkId: string, read: Reader, calls: ChainCalls = rpcCalls): Promise<NetworkHead> {
  const { basics, endpoint } = await readBasics(read, calls)
  try {
    // The block is read from the endpoint that answered get_info.
    const raw = await calls.getBlock(endpoint, basics.headBlock)
    const block = parseBlock(raw)
    return block ? { networkId, endpoint, basics, block } : { networkId, endpoint, basics, block: null, blockError: 'The answer was not a block.' }
  } catch (e) {
    return { networkId, endpoint, basics, block: null, blockError: message(e) }
  }
}
