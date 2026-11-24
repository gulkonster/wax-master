// Name bids (premium names) of the system contract: which names can be bid on,
// the smallest next bid, the rows of the namebids and bidrefunds tables, and
// what the page says about one name for one account. The rules follow the
// system contract's bidname, bidrefund and newaccount.

import type { TxAction } from './api'
import type { NameAuctions, NameBidLookup, NameBidRow } from './chain-types'
import { formatUnits } from './wallet'

/** Open auctions read at most (the list and the count of higher bids come from this read). */
export const NAME_AUCTIONS_MAX = 100
/** Open auctions shown in the list under the form. */
export const NAME_AUCTIONS_SHOWN = 10
/**
 * Lower bound on the second index of namebids (by -high_bid as uint64) where the
 * open auctions start, highest bid first: uint64 max / 2, as the chain's own closing code reads it.
 */
export const OPEN_AUCTIONS_LOWER = '9223372036854775807'

/** The text above the Bid button. */
export const BID_WARNING =
  'The bid leaves the account now and goes to eosio.names. It comes back only when somebody outbids you, and then you claim it here. A winning bid is spent. A bid cannot be taken back.'

const NAME_CHARS = /^[a-z1-5.]+$/
const ACCOUNT = /^[a-z1-5.]{1,12}[a-j1-5]?$/
const INT64_MAX = (1n << 63n) - 1n

/**
 * Why a name cannot be bid on ('' when it can): 1 to 11 characters of a-z and
 * 1-5, no dot. Each case has its own sentence. Whether an account of the name
 * exists is the chain's answer, not this rule's.
 */
export function bidNameProblem(name: string): string {
  if (name === '') return 'Enter a name.'
  if (!NAME_CHARS.test(name)) return 'A name has only the letters a-z and the digits 1-5.'
  if (name.length > 12) return 'A name has at most 12 characters; names of 1 to 11 characters are bid on.'
  if (name.includes('.')) {
    const suffix = name.slice(name.lastIndexOf('.') + 1)
    if (!suffix || name.startsWith('.')) return 'A name cannot start or end with a dot.'
    return `A name with a dot is not bid on: only the account ${suffix} can create ${name}.`
  }
  if (name.length === 12) return 'A 12-character name needs no bid: create it in Create account.'
  return ''
}

/** The smallest bid the chain accepts after `high`: higher by more than a tenth, high + floor(high / 10) + 1 unit. */
export function smallestNextBid(high: bigint): bigint {
  return high + high / 10n + 1n
}

/** A chain time ("2026-11-10T17:48:06.500") as ISO in UTC; null when it is not a time. */
export function chainTimeIso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z?$/.test(v)) return null
  const ms = new Date(v.endsWith('Z') ? v : `${v}Z`).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** An int64 from a number or a decimal text (the node writes large ones as text); null otherwise. */
function int64(v: unknown): bigint | null {
  let b: bigint
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) return null
    b = BigInt(v)
  } else if (typeof v === 'string' && /^-?\d{1,19}$/.test(v)) {
    b = BigInt(v)
  } else return null
  return b >= -INT64_MAX && b <= INT64_MAX ? b : null
}

/**
 * One row of namebids, checked; null when it is not in the expected form (or
 * not the row of `name` when one is given). A negative high_bid is a closed
 * auction; zero is neither and is refused.
 */
export function parseNameBidRow(row: unknown, name?: string): NameBidRow | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  if (typeof r.newname !== 'string' || !ACCOUNT.test(r.newname) || (name !== undefined && r.newname !== name)) return null
  if (typeof r.high_bidder !== 'string' || !ACCOUNT.test(r.high_bidder)) return null
  const high = int64(r.high_bid)
  const time = chainTimeIso(r.last_bid_time)
  if (high === null || high === 0n || time === null) return null
  return { name: r.newname, highBidder: r.high_bidder, highBid: (high < 0n ? -high : high).toString(), lastBidTime: time, closed: high < 0n }
}

/** The bidrefunds row of `bidder`, checked: the amount in whole units of the core token; null when there is none. */
export function parseBidRefundRow(row: unknown, bidder: string, precision: number, symbol: string): string | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  if (r.bidder !== bidder || typeof r.amount !== 'string') return null
  const m = /^(\d{1,19})(?:\.(\d{1,18}))? ([A-Z]{1,7})$/.exec(r.amount)
  if (!m || m[3] !== symbol || (m[2] ?? '').length !== precision) return null
  const units = BigInt(`${m[1]}${m[2] ?? ''}`)
  return units > 0n && units <= INT64_MAX ? units.toString() : null
}

/** Open auctions from rows of the second index, highest first; closed and malformed rows are left out. */
export function parseOpenAuctions(rows: readonly unknown[], max = NAME_AUCTIONS_MAX): NameBidRow[] {
  const out: NameBidRow[] = []
  const seen = new Set<string>()
  for (const row of rows.slice(0, max)) {
    const b = parseNameBidRow(row)
    if (!b || b.closed || seen.has(b.name)) continue
    seen.add(b.name)
    out.push(b)
  }
  return out.sort((a, b) => {
    const d = BigInt(b.highBid) - BigInt(a.highBid)
    return d > 0n ? 1 : d < 0n ? -1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

export type NameBidState =
  /** An account of this name exists: no bid is possible. */
  | { kind: 'exists' }
  /** No auction yet: any amount above zero opens it. */
  | { kind: 'none'; minBid: bigint }
  /** Open, another account has the highest bid. */
  | { kind: 'open'; bid: NameBidRow; minBid: bigint }
  /** Open, this account has the highest bid: the chain refuses a second bid from it. */
  | { kind: 'own'; bid: NameBidRow; minBid: bigint }
  /** Closed and won by another account. */
  | { kind: 'closed'; bid: NameBidRow }
  /** Closed and won by this account: it can create the name. */
  | { kind: 'won'; bid: NameBidRow }

/** The state of a name for the account that looks at it. */
export function nameBidState(l: Pick<NameBidLookup, 'account' | 'exists' | 'bid'>): NameBidState {
  if (l.exists) return { kind: 'exists' }
  const b = l.bid
  if (!b) return { kind: 'none', minBid: 1n }
  if (b.closed) return b.highBidder === l.account ? { kind: 'won', bid: b } : { kind: 'closed', bid: b }
  const minBid = smallestNextBid(BigInt(b.highBid))
  return b.highBidder === l.account ? { kind: 'own', bid: b, minBid } : { kind: 'open', bid: b, minBid }
}

/**
 * How many open auctions have a higher bid than `highBid` (a closed or absent
 * bid counts every open one). `atLeast` is true when the read was cut and every
 * row read is higher, so the count is a lower bound.
 */
export function higherOpenCount(a: Pick<NameAuctions, 'open' | 'more'>, highBid: bigint | null, name: string): { count: number; atLeast: boolean } {
  const higher = a.open.filter((b) => b.name !== name && (highBid === null || BigInt(b.highBid) > highBid))
  return { count: higher.length, atLeast: a.more && higher.length === a.open.filter((b) => b.name !== name).length }
}

/** Why a bid of `units` cannot be sent ('' when it can). `available` is the liquid balance (null: not known). */
export function bidAmountProblem(units: bigint, minBid: bigint, available: bigint | null, account: string, precision: number, symbol: string): string {
  if (units <= 0n) return 'Enter a bid above zero.'
  if (units < minBid) return `The smallest bid now is ${formatUnits(minBid, precision, symbol)}: a new bid must be higher than the highest bid by more than a tenth.`
  if (available !== null && units > available) return `More than the available balance of ${account}.`
  return ''
}

/** The closing rule in one sentence, with the chain's last close (already in the reader's time form; '' when unknown). */
export function closingRuleText(lastClose: string): string {
  const rule =
    'The chain closes at most one auction a day: the open auction with the highest bid, once its last bid is more than 24 hours old; a lower bid waits until every higher auction has closed.'
  return lastClose ? `${rule} The last auction closed ${lastClose}.` : rule
}

export function bidnameAction(a: { bidder: string; permission: string; newname: string; units: bigint; precision: number; symbol: string }): TxAction {
  return {
    account: 'eosio',
    name: 'bidname',
    authorization: [{ actor: a.bidder, permission: a.permission }],
    data: { bidder: a.bidder, newname: a.newname, bid: formatUnits(a.units, a.precision, a.symbol) }
  }
}

export function bidrefundAction(a: { bidder: string; permission: string; newname: string }): TxAction {
  return {
    account: 'eosio',
    name: 'bidrefund',
    authorization: [{ actor: a.bidder, permission: a.permission }],
    data: { bidder: a.bidder, newname: a.newname }
  }
}
