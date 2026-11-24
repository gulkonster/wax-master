// Token list of the wallet: the chain's core token, the tokens the history
// service knows for the account, and the tokens the user added by contract and
// symbol (kept per network). Every answer from a node or a history service is
// untrusted: rows are checked one by one and the list is cut at a limit.

import { join } from 'node:path'
import type { AddedToken, NetworkInfo, TokenBalance, TokenRow, WalletTokens } from '../shared/chain-types'
import { isValidName } from '../chain-core'
import { ASSET_MAX_UNITS, formatUnits, readAsset } from '../shared/wallet'
import { readJson, writeJson } from './jsonfile'
import { dataDir } from './paths'

/** At most this many tokens are taken from one history answer. */
export const MAX_HISTORY_TOKENS = 100
/** At most this many tokens can be added per network. */
export const MAX_ADDED_TOKENS = 50
/** Balances of added tokens are read from the chain, at most this many. */
const MAX_BALANCE_READS = MAX_ADDED_TOKENS
/** History rows whose amount is not exact are read from the chain, at most this many per list. */
export const MAX_HISTORY_READS = 20

export const TOKEN_SYMBOL = /^[A-Z]{1,7}$/
/** The form of a network id in the token file (`wax-testnet`, `custom-...`). */
export const NETWORK_ID_FORM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Largest whole number a JavaScript number holds exactly. */
const EXACT_MAX = 2n ** 53n

/** Decimal text ("12.5") as units at the token's precision; null when it has more decimals than that. */
function decimalUnits(text: string, precision: number): bigint | null {
  const m = /^(\d{1,40})(?:\.(\d{1,40}))?$/.exec(text)
  if (!m) return null
  let frac = m[2] ?? ''
  // Trailing zeros beyond the precision say nothing.
  if (frac.length > precision) {
    if (/[^0]/.test(frac.slice(precision))) return null
    frac = frac.slice(0, precision)
  }
  return BigInt(`${m[1]}${frac.padEnd(precision, '0')}`)
}

/**
 * The amount of a history row as asset text, 'read' when it must be read from
 * the chain (a number that is not exact, an amount with more decimals than the
 * token), or null when the row is not usable (not an amount, negative).
 * A text is taken by its digits; a number only while its units are exact.
 */
export function historyAmount(v: unknown, precision: number, symbol: string): string | 'read' | null {
  if (typeof v === 'string') {
    const t = v.trim()
    if (!/^\d{1,40}(\.\d{1,40})?$/.test(t)) return null
    const u = decimalUnits(t, precision)
    if (u === null || u > ASSET_MAX_UNITS) return 'read'
    return formatUnits(u, precision, symbol)
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    // The shortest text of the number; an exponent form is never exact here.
    const t = String(v)
    if (!/^\d+(\.\d+)?$/.test(t)) return 'read'
    const u = decimalUnits(t, precision)
    if (u === null || u > EXACT_MAX) return 'read'
    return formatUnits(u, precision, symbol)
  }
  return null
}

/**
 * The `tokens` of a history service's get_tokens answer: rows with a valid
 * contract name, a symbol of 1 to 7 capital letters, a precision of 0 to 18 and
 * a non-negative amount; duplicates dropped; at most MAX_HISTORY_TOKENS. A row
 * whose amount is not exact keeps its place with the balance '' (read from the
 * chain by `walletTokens`).
 */
export function parseHistoryTokens(raw: unknown): TokenRow[] {
  const list = raw && typeof raw === 'object' ? (raw as { tokens?: unknown }).tokens : undefined
  if (!Array.isArray(list)) return []
  const out: TokenRow[] = []
  const seen = new Set<string>()
  for (const t of list.slice(0, MAX_HISTORY_TOKENS * 4)) {
    if (out.length >= MAX_HISTORY_TOKENS) break
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    const contract = typeof r.contract === 'string' ? r.contract : ''
    const symbol = typeof r.symbol === 'string' ? r.symbol : ''
    const precision = r.precision
    if (!contract || contract.length > 13 || !isValidName(contract)) continue
    if (!TOKEN_SYMBOL.test(symbol)) continue
    if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 18) continue
    const amount = historyAmount(r.amount, precision, symbol)
    if (amount === null) continue
    const id = `${contract}|${symbol}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ contract, symbol, precision, balance: amount === 'read' ? '' : amount, source: 'history' })
  }
  return out
}

/**
 * Precision of a token from a get_currency_stats answer (`{ SYM: { supply: "0.0000 SYM", ... } }`),
 * counted from the decimals of the supply text (any size); null when it is not there.
 */
export function precisionFromStats(raw: unknown, symbol: string): number | null {
  if (!raw || typeof raw !== 'object') return null
  const row = (raw as Record<string, unknown>)[symbol]
  if (!row || typeof row !== 'object') return null
  const of = (v: unknown): number | null => {
    if (typeof v !== 'string') return null
    const m = /^\s*-?\d{1,40}(?:\.(\d{1,18}))?\s+([A-Z]{1,7})\s*$/.exec(v)
    return m && m[2] === symbol ? (m[1] ?? '').length : null
  }
  const r = row as { supply?: unknown; max_supply?: unknown }
  return of(r.supply) ?? of(r.max_supply)
}

/**
 * The balance of one token from a get_currency_balance answer: an empty answer
 * (no row of the symbol) is zero at `precision`; an answer that holds the symbol
 * in a form that cannot be read, or is not a list, is '' (could not be read).
 */
export function balanceFromAnswer(list: unknown, symbol: string, precision: number): { balance: string; precision: number } {
  if (!Array.isArray(list)) return { balance: '', precision }
  for (const x of list) {
    if (typeof x !== 'string') return { balance: '', precision }
    const sym = /\s([A-Z]{1,7})\s*$/.exec(x)?.[1]
    if (sym !== symbol) continue
    const a = readAsset(x)
    if (!a || a.units < 0n) return { balance: '', precision }
    return { balance: formatUnits(a.units, a.precision, symbol), precision: a.precision }
  }
  return { balance: formatUnits(0n, precision, symbol), precision }
}

// ---------------------------------------------------------------- added tokens

interface TokenFile {
  version: 1
  networks: Map<string, AddedToken[]>
}

function validAdded(t: unknown): t is AddedToken {
  if (!t || typeof t !== 'object') return false
  const r = t as Record<string, unknown>
  return (
    typeof r.contract === 'string' &&
    r.contract.length <= 13 &&
    isValidName(r.contract) &&
    r.contract !== '' &&
    typeof r.symbol === 'string' &&
    TOKEN_SYMBOL.test(r.symbol) &&
    typeof r.precision === 'number' &&
    Number.isInteger(r.precision) &&
    r.precision >= 0 &&
    r.precision <= 18
  )
}

export class AddedTokens {
  constructor(private file: string) {}

  private load(): TokenFile {
    const raw = readJson<Record<string, unknown>>(this.file, {})
    const networks = new Map<string, AddedToken[]>()
    const stored = raw && typeof raw === 'object' ? raw.networks : undefined
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [id, list] of Object.entries(stored)) {
        if (!NETWORK_ID_FORM.test(id) || !Array.isArray(list)) continue
        networks.set(
          id,
          list
            .filter(validAdded)
            .slice(0, MAX_ADDED_TOKENS)
            .map((t) => ({ contract: t.contract, symbol: t.symbol, precision: t.precision }))
        )
      }
    }
    return { version: 1, networks }
  }

  private save(f: TokenFile): void {
    const networks: Record<string, AddedToken[]> = Object.create(null) as Record<string, AddedToken[]>
    for (const [id, list] of f.networks) networks[id] = list
    writeJson(this.file, { version: 1, networks })
  }

  list(networkId: string): AddedToken[] {
    if (!NETWORK_ID_FORM.test(networkId)) return []
    return [...(this.load().networks.get(networkId) ?? [])]
  }

  add(networkId: string, token: AddedToken): AddedToken[] {
    if (!NETWORK_ID_FORM.test(networkId)) throw new Error('Not a valid network')
    if (!validAdded(token)) throw new Error('Not a valid token')
    const f = this.load()
    const list = f.networks.get(networkId) ?? []
    if (list.some((t) => t.contract === token.contract && t.symbol === token.symbol)) return [...list]
    if (list.length >= MAX_ADDED_TOKENS) throw new Error(`At most ${MAX_ADDED_TOKENS} tokens can be added per network.`)
    const next = [...list, { contract: token.contract, symbol: token.symbol, precision: token.precision }]
    f.networks.set(networkId, next)
    this.save(f)
    return [...next]
  }

  remove(networkId: string, contract: string, symbol: string): AddedToken[] {
    if (!NETWORK_ID_FORM.test(networkId)) return []
    const f = this.load()
    const list = (f.networks.get(networkId) ?? []).filter((t) => !(t.contract === contract && t.symbol === symbol))
    f.networks.set(networkId, list)
    this.save(f)
    return [...list]
  }

  /** Forgets every token added for a network (the network was removed). */
  forget(networkId: string): void {
    const f = this.load()
    if (!f.networks.delete(networkId)) return
    this.save(f)
  }
}

let added: AddedTokens | null = null
export function addedTokens(): AddedTokens {
  added ??= new AddedTokens(join(dataDir(), 'wallet-tokens.json'))
  return added
}

// ---------------------------------------------------------------- the list

export interface TokenDeps {
  /** get_currency_balance of the core token (eosio.token, the network's symbol). */
  coreBalance: () => Promise<unknown>
  /** get_currency_balance of one token. */
  balance: (contract: string, symbol: string) => Promise<unknown>
  /** The history service's get_tokens answer; undefined when the network has none. */
  historyTokens?: () => Promise<unknown>
  added: AddedToken[]
}

/** Text of the tag on a token with the network's symbol from another contract. */
export function lookalikeText(n: Pick<NetworkInfo, 'symbol' | 'name'>): string {
  return `not the ${n.symbol} of ${n.name}`
}

/**
 * The core token first, then the history service's tokens, then the added ones
 * not already listed; tokens with the network's symbol from another contract are
 * marked and come last.
 */
export async function walletTokens(n: NetworkInfo, deps: TokenDeps): Promise<WalletTokens> {
  let core = ''
  try {
    core = balanceFromAnswer(await deps.coreBalance(), n.symbol, n.precision).balance
  } catch {
    core = ''
  }
  const rows: TokenRow[] = [{ contract: 'eosio.token', symbol: n.symbol, precision: n.precision, balance: core, source: 'core', mark: { kind: 'core', text: 'core token' } }]
  const isCore = (contract: string, symbol: string): boolean => contract === 'eosio.token' && symbol === n.symbol
  let history: WalletTokens['history'] = 'none'
  let historyNote = ''
  if (deps.historyTokens) {
    try {
      const listed = parseHistoryTokens(await deps.historyTokens()).filter((t) => !isCore(t.contract, t.symbol))
      // Rows whose amount was not exact: their balance comes from the chain.
      let reads = 0
      const read = await Promise.all(
        listed.map(async (t): Promise<TokenRow> => {
          if (t.balance || reads >= MAX_HISTORY_READS) return t
          reads++
          try {
            const b = balanceFromAnswer(await deps.balance(t.contract, t.symbol), t.symbol, t.precision)
            return { ...t, balance: b.balance, precision: b.balance ? b.precision : t.precision }
          } catch {
            return t
          }
        })
      )
      rows.push(...read)
      history = 'ok'
    } catch (e) {
      history = 'error'
      historyNote = `The history service did not answer: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'}`
    }
  }
  const extra = deps.added.filter((t) => !isCore(t.contract, t.symbol) && !rows.some((r) => r.contract === t.contract && r.symbol === t.symbol))
  const read = await Promise.all(
    extra.slice(0, MAX_BALANCE_READS).map(async (t): Promise<TokenRow> => {
      let balance = ''
      let precision = t.precision
      try {
        const b = balanceFromAnswer(await deps.balance(t.contract, t.symbol), t.symbol, t.precision)
        balance = b.balance
        if (balance) precision = b.precision
      } catch {
        balance = ''
      }
      return { contract: t.contract, symbol: t.symbol, precision, balance, source: 'added' }
    })
  )
  rows.push(...read)
  // The network's symbol on another contract is not the network's token: marked, and last.
  const tag = lookalikeText(n)
  const own = rows.filter((r) => r.source === 'core' || r.symbol !== n.symbol)
  const alike = rows.filter((r) => r.source !== 'core' && r.symbol === n.symbol).map((r): TokenRow => ({ ...r, mark: { kind: 'lookalike', text: tag } }))
  return { rows: [...own, ...alike], history, historyNote }
}

/**
 * The balance of one token for a form that sends, read from the chain: the
 * account's row of get_currency_balance; when it has none, zero at the precision
 * of get_currency_stats. Throws when the chain does not answer or the contract
 * has no such token.
 */
export async function tokenBalance(
  deps: { balance: () => Promise<unknown>; stats: () => Promise<unknown> },
  contract: string,
  symbol: string
): Promise<TokenBalance> {
  const list = await deps.balance()
  if (!Array.isArray(list)) throw new Error('The node gave no balance list.')
  const mine = list.some((x) => typeof x === 'string' && /\s([A-Z]{1,7})\s*$/.exec(x)?.[1] === symbol)
  if (mine) {
    const b = balanceFromAnswer(list, symbol, 0)
    if (!b.balance) throw new Error(`The balance of ${symbol} could not be read.`)
    return b
  }
  const precision = precisionFromStats(await deps.stats(), symbol)
  if (precision === null) throw new Error(`${contract} has no token ${symbol}.`)
  return { balance: formatUnits(0n, precision, symbol), precision }
}
