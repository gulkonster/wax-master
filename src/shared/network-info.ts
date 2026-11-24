// Chain state shown on the Network page: the answers of get_info, get_block
// and the system tables `global`, `rammarket` and the core token's `stat`,
// reduced to the values the page shows. Every answer is untrusted data; a
// value that is missing or not in the expected form is left out (shown "n/a").

import { formatCost, parseRamMarket, ramCost } from './ram-market'

/** A value that may be missing on a chain: read, not offered ("n/a"), or failed to read. */
export type Part<T> = { state: 'ok'; value: T } | { state: 'na'; reason: string } | { state: 'error'; reason: string }

/** From get_info. */
export interface ChainBasics {
  chainId: string
  headBlock: number
  irreversible: number
  headTime: string
  producer: string | null
  serverVersion: string | null
  /** Block limits of get_info (block_cpu_limit in microseconds, block_net_limit in bytes). */
  cpuBlockLimit: number | null
  netBlockLimit: number | null
}

/** The core token's row of the `stat` table of eosio.token. */
export interface SystemToken {
  symbol: string
  precision: number
  supply: string
  maxSupply: string
  issuer: string
}

/** RAM of the chain, from the system contract's `global` row. */
export interface ChainRam {
  /** max_ram_size, in bytes. */
  total: number
  /** total_ram_bytes_reserved, in bytes. */
  reserved: number
}

/** The price of 1 KB of RAM on the system RAM market. */
export interface RamPricePerKb {
  /** Cost of 1,024 bytes including the fee, in whole units of the core token. */
  units: number
  symbol: string
  precision: number
  /** For reading, at most four decimals ("0.0525 WAX"). */
  text: string
}

/** Everything the page reads once when it opens (and again on a change of network or endpoint). */
export interface NetworkOverview {
  networkId: string
  /** The endpoint that answered. */
  endpoint: string
  basics: ChainBasics
  token: Part<SystemToken>
  ram: Part<ChainRam>
  ramPrice: Part<RamPricePerKb>
}

/** One block of the "latest blocks seen" list. */
export interface BlockSample {
  num: number
  id: string
  time: string
  producer: string
  transactions: number
}

/** One read of the 2-second loop: get_info and the head block. */
export interface NetworkHead {
  networkId: string
  endpoint: string
  basics: ChainBasics
  block: BlockSample | null
  /** Why the head block could not be read (the basics still came). */
  blockError?: string
}

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
const HEX64 = /^[0-9a-f]{64}$/
const ASSET = /^\s*\d+(?:\.(\d{1,18}))?\s+([A-Z]{1,7})\s*$/

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** A non-negative whole number from a JSON number or a decimal string (uint64 fields come as either). */
export function wholeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) {
    const n = Number(v)
    return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : null
  }
  return null
}

function shortText(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) return null
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(v) ? null : v
}

/** get_info answer -> basics; null when it is not a get_info answer. */
export function parseInfo(raw: unknown): ChainBasics | null {
  const r = rec(raw)
  if (!r) return null
  const chainId = typeof r.chain_id === 'string' && HEX64.test(r.chain_id) ? r.chain_id : null
  const head = wholeNumber(r.head_block_num)
  const lib = wholeNumber(r.last_irreversible_block_num)
  if (!chainId || head === null || lib === null) return null
  const producer = typeof r.head_block_producer === 'string' && NAME.test(r.head_block_producer) ? r.head_block_producer : null
  return {
    chainId,
    headBlock: head,
    irreversible: lib,
    headTime: shortText(r.head_block_time, 40) ?? '',
    producer,
    serverVersion: shortText(r.server_version_string, 80) ?? shortText(r.server_version, 80),
    cpuBlockLimit: wholeNumber(r.block_cpu_limit),
    netBlockLimit: wholeNumber(r.block_net_limit)
  }
}

/** First row of eosio `global` -> RAM total and reserved; null when the row is not in that form. */
export function parseGlobal(row: unknown): ChainRam | null {
  const r = rec(row)
  if (!r) return null
  const total = wholeNumber(r.max_ram_size)
  const reserved = wholeNumber(r.total_ram_bytes_reserved)
  if (total === null || reserved === null || total === 0) return null
  return { total, reserved }
}

/** A `stat` row of eosio.token -> the token; null when it is not a stat row of `symbol`. */
export function parseStat(row: unknown, symbol: string): SystemToken | null {
  const r = rec(row)
  if (!r) return null
  const supply = typeof r.supply === 'string' ? ASSET.exec(r.supply) : null
  const max = typeof r.max_supply === 'string' ? ASSET.exec(r.max_supply) : null
  if (!supply || !max || supply[2] !== symbol || max[2] !== symbol) return null
  const precision = (supply[1] ?? '').length
  if ((max[1] ?? '').length !== precision) return null
  const issuer = typeof r.issuer === 'string' && NAME.test(r.issuer) ? r.issuer : ''
  return { symbol, precision, supply: (r.supply as string).trim(), maxSupply: (r.max_supply as string).trim(), issuer }
}

/** `rammarket` row -> price of 1 KB; null when it is not a RAM market. */
export function parseRamPricePerKb(row: unknown): RamPricePerKb | null {
  const m = parseRamMarket(row)
  if (!m) return null
  const units = ramCost(m, 1024)
  if (units === null) return null
  return { units, symbol: m.symbol, precision: m.precision, text: formatCost(units, m.precision, m.symbol) }
}

/** get_block answer -> one sample; null when it is not a block. */
export function parseBlock(raw: unknown): BlockSample | null {
  const r = rec(raw)
  if (!r) return null
  const num = wholeNumber(r.block_num)
  const id = typeof r.id === 'string' && HEX64.test(r.id) ? r.id : null
  const producer = typeof r.producer === 'string' && NAME.test(r.producer) ? r.producer : null
  const time = shortText(r.timestamp, 40)
  if (num === null || !id || !producer || !time) return null
  return { num, id, time, producer, transactions: Array.isArray(r.transactions) ? r.transactions.length : 0 }
}

/** Adds a sample to the list (newest first, no repeats, at most `max`). */
export function addBlockSample(list: readonly BlockSample[], b: BlockSample, max = 30): BlockSample[] {
  if (list.some((x) => x.num === b.num)) return list as BlockSample[]
  return [b, ...list].sort((a, c) => c.num - a.num).slice(0, max)
}

/** Text from an endpoint as one line: control characters and line breaks become spaces, at most `max` characters. */
export function oneLineText(v: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 3))}...` : flat
}

/** Short text from an endpoint taken only as it is: at most `max` characters, no control characters; else empty. */
export function plainTextOrEmpty(v: unknown, max: number): string {
  return shortText(v, max) ?? ''
}
