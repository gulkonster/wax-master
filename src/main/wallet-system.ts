// Wallet sections built on the system contract (eosio): which features the
// chain offers (read from its ABI), voting and voter rewards, the PowerUp
// market, and name bids. Every row from the chain is untrusted: names are checked, numbers are
// read only from the expected forms, lists are cut at fixed sizes.

import type { AbiDef } from '../chain-core'
import type { NameAuctions, NameBidLookup, NetworkInfo, PowerupResourceView, PowerupStateView, ProducerRow, ProxyInfoView, SystemFeatures, VoterClaimView, VotingView } from '../shared/chain-types'
import { formatUnits, readAsset, rescaleUnits } from '../shared/wallet'
import { CLAIM_INTERVAL_SEC, claimChoices, MAX_VOTE_PRODUCERS, voterRewardEstimate } from '../shared/wallet-voting'
import type { ReadCall } from './contract-view'
import { chain } from './rpc'
import { WAX_CHAIN_IDS } from './account-view'
import { isUnknownAccount } from './account-pick'
import { chainTimeIso, NAME_AUCTIONS_MAX, OPEN_AUCTIONS_LOWER, parseBidRefundRow, parseNameBidRow, parseOpenAuctions } from '../shared/name-bids'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
/** Producer rows read at most (pages of PRODUCER_PAGE). */
export const MAX_PRODUCER_ROWS = 2000
const PRODUCER_PAGE = 500
/** Active producers shown at most. */
export const MAX_PRODUCERS_SHOWN = 500

type Row = Record<string, unknown>
type TableRows = { rows: unknown[]; more: boolean; next_key?: string }

function rowsOf(r: unknown, max: number): Row[] {
  const rows = r && typeof r === 'object' && Array.isArray((r as TableRows).rows) ? (r as TableRows).rows : []
  return rows.slice(0, max).filter((x): x is Row => !!x && typeof x === 'object' && !Array.isArray(x))
}

/** A finite number from a number or a decimal text (float64 fields come as text); null otherwise. */
export function finite(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.length > 400 || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A whole number (int64 / uint64 fields come as text or number) as decimal text; null otherwise. */
export function wholeText(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? String(v) : null
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return BigInt(v).toString()
  return null
}

/** A chain time as milliseconds since 1970; null when it is not a time. */
export function chainMs(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z?$/.test(v)) return null
  const ms = new Date(v.endsWith('Z') ? v : `${v}Z`).getTime()
  return Number.isFinite(ms) ? ms : null
}

function activeFlag(v: unknown): boolean {
  return v === true || v === 1 || v === '1'
}

/** Features of the system contract from its ABI; PowerUp also needs the row of powup.state. */
export async function systemFeatures(def: AbiDef | null, powerupRow: () => Promise<unknown>): Promise<SystemFeatures> {
  if (!def) return { voting: false, powerup: false, nameBids: false }
  const actions = new Set(def.actions.map((a) => a.name))
  const tables = new Set(def.tables.map((t) => t.name))
  const voting = actions.has('voteproducer') && tables.has('producers') && tables.has('voters')
  const nameBids = actions.has('bidname') && actions.has('bidrefund') && tables.has('namebids') && tables.has('bidrefunds')
  let powerup = false
  if (actions.has('powerup') && tables.has('powup.state')) {
    try {
      powerup = rowsOf(await powerupRow(), 1).length > 0
    } catch {
      powerup = false
    }
  }
  return { voting, powerup, nameBids }
}

/** Active producers, most votes first, with their share of the votes. */
export function parseProducers(rows: Row[], max = MAX_PRODUCERS_SHOWN): { producers: ProducerRow[]; cut: boolean } {
  const list: { name: string; votes: number }[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (typeof r.owner !== 'string' || !NAME.test(r.owner) || seen.has(r.owner)) continue
    if (!activeFlag(r.is_active)) continue
    const votes = finite(r.total_votes)
    if (votes === null || votes < 0) continue
    seen.add(r.owner)
    list.push({ name: r.owner, votes })
  }
  list.sort((a, b) => b.votes - a.votes || (a.name < b.name ? -1 : 1))
  const sum = list.reduce((s, p) => s + p.votes, 0)
  const producers = list.slice(0, max).map((p) => ({ name: p.name, votePercent: sum > 0 ? (p.votes / sum) * 100 : 0 }))
  return { producers, cut: list.length > max }
}

/** The account's row of the voters table, checked; null when there is none. */
export function parseVoter(row: Row | undefined, account: string, precision: number, symbol: string): VotingView['current'] {
  if (!row || row.owner !== account) return null
  const proxy = typeof row.proxy === 'string' && (row.proxy === '' || NAME.test(row.proxy)) ? row.proxy : ''
  const producers = Array.isArray(row.producers) ? row.producers.slice(0, 64).filter((p): p is string => typeof p === 'string' && NAME.test(p)) : []
  const stakedText = wholeText(row.staked)
  const staked = stakedText === null ? '' : formatUnits(BigInt(stakedText), precision, symbol)
  return { proxy, producers, staked, isProxy: activeFlag(row.is_proxy) }
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

/**
 * The claims the chain offers the account, with what is due. `voters` and
 * `global` rows feed the voter reward estimate; `genesis` is the account's row
 * of the genesis table (undefined when it has none). `headMs` is the chain time.
 */
export function claimViews(
  abiActions: readonly string[],
  voter: Row | undefined,
  global: Row | undefined,
  genesis: Row | undefined,
  headMs: number | null,
  precision: number,
  symbol: string
): VoterClaimView[] {
  return claimChoices(abiActions, genesis !== undefined).map((c) => {
    if (c.action === 'claimgenesis') {
      const unclaimed = readAsset(genesis?.unclaimed_balance)
      const balance = readAsset(genesis?.balance)
      const parts: string[] = []
      if (balance && balance.symbol === symbol) parts.push(`genesis balance ${formatUnits(rescaleUnits(balance.units, balance.precision, precision), precision, symbol)}`)
      if (unclaimed && unclaimed.symbol === symbol) parts.push(`recorded as unclaimed ${formatUnits(rescaleUnits(unclaimed.units, unclaimed.precision, precision), precision, symbol)}`)
      return {
        ...c,
        dueText: `The amount due cannot be estimated exactly${parts.length ? `; the account's genesis row shows ${parts.join(', ')}` : ''}.`,
        timeNote: '',
        blocked: ''
      }
    }
    if (!voter)
      return {
        ...c,
        dueText: 'This account has no row in the voters table: it has not voted, so nothing is due.',
        timeNote: '',
        blocked: 'This account has not voted: nothing can be claimed.'
      }
    let dueText = 'What is due cannot be estimated from the tables.'
    if (c.action === 'voterclaim' && global && headMs !== null) {
      const t = (v: unknown): number => chainMs(v) ?? NaN
      const est = voterRewardEstimate(
        {
          unpaidVoteshare: finite(voter.unpaid_voteshare) ?? NaN,
          unpaidVoteshareLastUpdated: t(voter.unpaid_voteshare_last_updated),
          unpaidVoteshareChangeRate: finite(voter.unpaid_voteshare_change_rate) ?? NaN,
          totalUnpaidVoteshare: finite(global.total_unpaid_voteshare) ?? NaN,
          totalUnpaidVoteshareLastUpdated: t(global.total_unpaid_voteshare_last_updated),
          totalVoteshareChangeRate: finite(global.total_voteshare_change_rate) ?? NaN,
          votersBucket: finite(global.voters_bucket) ?? NaN
        },
        headMs
      )
      if (est !== null) dueText = `About ${formatUnits(est, precision, symbol)} (estimated from the voters and global tables; the contract computes the exact amount at the claim).`
    }
    let timeNote = ''
    let blocked = ''
    const last = chainMs(voter.last_claim_time)
    if (last !== null && last > 0 && headMs !== null) {
      const next = last + CLAIM_INTERVAL_SEC * 1000
      timeNote = next > headMs ? `Claimed ${fmtUtc(last)}; the contract allows one claim per day, the next from ${fmtUtc(next)} (UTC).` : `Last claimed ${fmtUtc(last)}.`
      // An estimate of 0 does not block: it is only an estimate. The day rule does.
      if (next > headMs) blocked = `The next claim is possible from ${fmtUtc(next)} (UTC).`
    }
    return { ...c, dueText, timeNote, blocked }
  })
}

/** The voting view of an account: producers, its current vote, its claims. */
export async function votingView(n: NetworkInfo, def: AbiDef, account: string, readCall: ReadCall): Promise<VotingView> {
  const table = (body: Row): Promise<TableRows> => readCall((ep) => chain.getTableRows(ep, { json: true, code: 'eosio', ...body }), n)
  // Producers: pages of the primary index, up to MAX_PRODUCER_ROWS rows.
  const rows: Row[] = []
  let lower = ''
  for (let i = 0; i * PRODUCER_PAGE < MAX_PRODUCER_ROWS; i++) {
    const r = await table({ scope: 'eosio', table: 'producers', limit: PRODUCER_PAGE, ...(lower ? { lower_bound: lower } : {}) })
    const page = rowsOf(r, PRODUCER_PAGE)
    rows.push(...page)
    const next = typeof r.next_key === 'string' && /^\d{1,20}$/.test(r.next_key) ? r.next_key : ''
    if (!r.more || !next || next === lower) break
    lower = next
  }
  const { producers, cut } = parseProducers(rows)
  const voterRow = rowsOf(await table({ scope: 'eosio', table: 'voters', lower_bound: account, upper_bound: account, limit: 1 }), 1)[0]
  const actions = def.actions.map((a) => a.name)
  const tables = new Set(def.tables.map((t) => t.name))
  let global: Row | undefined
  let headMs: number | null = null
  if (actions.includes('voterclaim') && voterRow) {
    try {
      global = rowsOf(await table({ scope: 'eosio', table: 'global', limit: 1 }), 1)[0]
      headMs = chainMs((await readCall((ep) => chain.getInfo(ep), n)).head_block_time)
    } catch {
      global = undefined
    }
  }
  let genesis: Row | undefined
  if (actions.includes('claimgenesis') && tables.has('genesis')) {
    try {
      const g = rowsOf(await table({ scope: account, table: 'genesis', limit: 1 }), 1)[0]
      genesis = g && readAsset(g.balance) ? g : undefined
    } catch {
      genesis = undefined
    }
  }
  return {
    maxProducers: MAX_VOTE_PRODUCERS,
    producers,
    producersCut: cut,
    current: parseVoter(voterRow, account, n.precision, n.symbol),
    claims: claimViews(actions, voterRow, global, genesis, headMs, n.precision, n.symbol),
    waxRewardRule: WAX_CHAIN_IDS.includes(n.chainId)
  }
}

/** Whether `name` is registered as a proxy: its own row of the voters table with is_proxy set. */
export function parseProxyInfo(row: Row | undefined, name: string): ProxyInfoView {
  return { name, registered: !!row && row.owner === name && activeFlag(row.is_proxy) }
}

/** Reads the voters row of a proxy account; the chain refuses a vote through an account that is not registered as a proxy. */
export async function proxyInfo(n: NetworkInfo, name: string, readCall: ReadCall): Promise<ProxyInfoView> {
  const r = await readCall(
    (ep) => chain.getTableRows(ep, { json: true, code: 'eosio', scope: 'eosio', table: 'voters', lower_bound: name, upper_bound: name, limit: 1 }),
    n
  )
  return parseProxyInfo(rowsOf(r, 1)[0], name)
}

function resource(v: unknown, precision: number, symbol: string): PowerupResourceView | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Row
  const weight = wholeText(r.weight)
  const utilization = wholeText(r.utilization)
  const adjusted = wholeText(r.adjusted_utilization)
  const exponent = finite(r.exponent)
  const decay = typeof r.decay_secs === 'number' && Number.isSafeInteger(r.decay_secs) && r.decay_secs > 0 ? r.decay_secs : null
  const ts = chainMs(r.utilization_timestamp)
  const price = (p: unknown): string | null => {
    const a = readAsset(p)
    if (!a || a.symbol !== symbol || a.units < 0n) return null
    return rescaleUnits(a.units, a.precision, precision).toString()
  }
  const minPrice = price(r.min_price)
  const maxPrice = price(r.max_price)
  if (weight === null || utilization === null || adjusted === null || exponent === null || exponent < 1 || exponent > 100 || decay === null || ts === null) return null
  if (minPrice === null || maxPrice === null || BigInt(weight) <= 0n) return null
  // The price runs from min_price up to max_price, and no more than the weight can be rented.
  if (BigInt(maxPrice) < BigInt(minPrice) || BigInt(utilization) > BigInt(weight) || BigInt(adjusted) > BigInt(weight)) return null
  return { weight, utilization, adjustedUtilization: adjusted, utilizationTimestamp: Math.floor(ts / 1000), decaySecs: decay, exponent, minPrice, maxPrice }
}

/** The powup.state row, checked; null when it is missing or not in the expected form. */
export function parsePowerupState(row: Row | undefined, headTime: number, precision: number, symbol: string): PowerupStateView | null {
  if (!row) return null
  const net = resource(row.net, precision, symbol)
  const cpu = resource(row.cpu, precision, symbol)
  const days = typeof row.powerup_days === 'number' && Number.isSafeInteger(row.powerup_days) && row.powerup_days >= 1 && row.powerup_days <= 3650 ? row.powerup_days : null
  const fee = readAsset(row.min_powerup_fee)
  if (!net || !cpu || days === null || !fee || fee.symbol !== symbol || fee.units < 0n) return null
  return { net, cpu, days, minFee: rescaleUnits(fee.units, fee.precision, precision).toString(), symbol, precision, headTime }
}

export function powerupStateRow(n: NetworkInfo, readCall: ReadCall): Promise<TableRows> {
  return readCall((ep) => chain.getTableRows(ep, { json: true, code: 'eosio', scope: '', table: 'powup.state', limit: 1 }), n)
}

export async function powerupState(n: NetworkInfo, readCall: ReadCall): Promise<PowerupStateView | null> {
  const row = rowsOf(await powerupStateRow(n, readCall), 1)[0]
  const head = chainMs((await readCall((ep) => chain.getInfo(ep), n)).head_block_time)
  if (head === null) throw new Error('The chain did not report its head time.')
  return parsePowerupState(row, Math.floor(head / 1000), n.precision, n.symbol)
}

/**
 * One name for one account: whether an account of that name exists, its row of
 * namebids, and the account's row of bidrefunds under the name (scope = the name).
 */
export async function nameBidLookup(n: NetworkInfo, name: string, account: string, readCall: ReadCall): Promise<NameBidLookup> {
  const table = (body: Row): Promise<TableRows> => readCall((ep) => chain.getTableRows(ep, { json: true, code: 'eosio', ...body }), n)
  let exists = true
  try {
    await readCall((ep) => chain.getAccount(ep, name), n)
  } catch (e) {
    if (!isUnknownAccount(e)) throw e
    exists = false
  }
  const bidRow = rowsOf(await table({ scope: 'eosio', table: 'namebids', lower_bound: name, upper_bound: name, limit: 1 }), 1)[0]
  const refundRow = rowsOf(await table({ scope: name, table: 'bidrefunds', lower_bound: account, upper_bound: account, limit: 1 }), 1)[0]
  return {
    name,
    account,
    exists,
    bid: parseNameBidRow(bidRow, name),
    refund: parseBidRefundRow(refundRow, account, n.precision, n.symbol),
    symbol: n.symbol,
    precision: n.precision
  }
}

/**
 * The open auctions, highest bid first: the second index of namebids from where
 * the open ones start, at most NAME_AUCTIONS_MAX rows; and the chain's last
 * close from the global table.
 */
export async function nameAuctions(n: NetworkInfo, readCall: ReadCall): Promise<NameAuctions> {
  const table = (body: Row): Promise<TableRows> => readCall((ep) => chain.getTableRows(ep, { json: true, code: 'eosio', ...body }), n)
  const r = await table({
    scope: 'eosio',
    table: 'namebids',
    index_position: 2,
    key_type: 'i64',
    lower_bound: OPEN_AUCTIONS_LOWER,
    limit: NAME_AUCTIONS_MAX
  })
  const rows = rowsOf(r, NAME_AUCTIONS_MAX)
  let lastNameClose = ''
  try {
    const g = rowsOf(await table({ scope: 'eosio', table: 'global', limit: 1 }), 1)[0]
    const t = chainTimeIso(g?.last_name_close)
    // A chain that never closed an auction keeps the zero time.
    lastNameClose = t && !t.startsWith('1970-') && !t.startsWith('2000-01-01') ? t : ''
  } catch {
    lastNameClose = ''
  }
  return { open: parseOpenAuctions(rows), more: r.more === true, lastNameClose, symbol: n.symbol, precision: n.precision }
}
