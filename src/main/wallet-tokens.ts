// Token list of the wallet: the chain's core token, the tokens the history
// service knows for the account, and the tokens the user added by contract and
// symbol (kept per network). Every answer from a node or a history service is
// untrusted: rows are checked one by one and the list is cut at a limit.

import { join } from 'node:path'
import type { AddedToken, NetworkInfo, TokenRow, WalletTokens } from '../shared/chain-types'
import { isValidName } from '../chain-core'
import { parseAsset, formatUnits } from '../shared/ram-market'
import { readJson, writeJson } from './jsonfile'
import { dataDir } from './paths'

/** At most this many tokens are taken from one history answer. */
export const MAX_HISTORY_TOKENS = 100
/** At most this many tokens can be added per network. */
export const MAX_ADDED_TOKENS = 50
/** Balances of added tokens are read from the chain, at most this many. */
const MAX_BALANCE_READS = MAX_ADDED_TOKENS

export const TOKEN_SYMBOL = /^[A-Z]{1,7}$/

/** A whole-number-safe amount as asset text with the token's precision; '' when not a usable amount. */
function amountText(v: unknown, precision: number, symbol: string): string {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,30}(\.\d{1,18})?$/.test(v.trim()) ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 1e15) return ''
  return `${n.toFixed(precision)} ${symbol}`
}

/**
 * The `tokens` of a history service's get_tokens answer: rows with a valid
 * contract name, a symbol of 1 to 7 capital letters, a precision of 0 to 18 and
 * a non-negative amount; duplicates dropped; at most MAX_HISTORY_TOKENS.
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
    const balance = amountText(r.amount, precision, symbol)
    if (!balance) continue
    const id = `${contract}|${symbol}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ contract, symbol, precision, balance, source: 'history' })
  }
  return out
}

/** Precision of a token from a get_currency_stats answer (`{ SYM: { supply: "0.0000 SYM", ... } }`); null when it is not there. */
export function precisionFromStats(raw: unknown, symbol: string): number | null {
  if (!raw || typeof raw !== 'object') return null
  const row = (raw as Record<string, unknown>)[symbol]
  if (!row || typeof row !== 'object') return null
  const a = parseAsset((row as { supply?: unknown }).supply) ?? parseAsset((row as { max_supply?: unknown }).max_supply)
  if (!a || a.symbol !== symbol || a.precision > 18) return null
  return a.precision
}

// ---------------------------------------------------------------- added tokens

interface TokenFile {
  version: 1
  networks: Record<string, AddedToken[]>
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
    const raw = readJson<Partial<TokenFile>>(this.file, {})
    const networks: Record<string, AddedToken[]> = {}
    if (raw.networks && typeof raw.networks === 'object') {
      for (const [id, list] of Object.entries(raw.networks)) {
        if (Array.isArray(list)) networks[id] = list.filter(validAdded).slice(0, MAX_ADDED_TOKENS)
      }
    }
    return { version: 1, networks }
  }

  list(networkId: string): AddedToken[] {
    return [...(this.load().networks[networkId] ?? [])]
  }

  add(networkId: string, token: AddedToken): AddedToken[] {
    if (!validAdded(token)) throw new Error('Not a valid token')
    const f = this.load()
    const list = f.networks[networkId] ?? []
    if (list.some((t) => t.contract === token.contract && t.symbol === token.symbol)) return [...list]
    if (list.length >= MAX_ADDED_TOKENS) throw new Error(`At most ${MAX_ADDED_TOKENS} tokens can be added per network.`)
    f.networks[networkId] = [...list, { contract: token.contract, symbol: token.symbol, precision: token.precision }]
    writeJson(this.file, f)
    return [...f.networks[networkId]]
  }

  remove(networkId: string, contract: string, symbol: string): AddedToken[] {
    const f = this.load()
    const list = (f.networks[networkId] ?? []).filter((t) => !(t.contract === contract && t.symbol === symbol))
    f.networks[networkId] = list
    writeJson(this.file, f)
    return [...list]
  }
}

let added: AddedTokens | null = null
export function addedTokens(): AddedTokens {
  added ??= new AddedTokens(join(dataDir(), 'wallet-tokens.json'))
  return added
}

// ---------------------------------------------------------------- the list

/** Whole units of an asset at another precision (extra decimals are cut). */
function rescale(a: { units: number; precision: number }, precision: number): number {
  return a.precision <= precision ? a.units * 10 ** (precision - a.precision) : Math.trunc(a.units / 10 ** (a.precision - precision))
}

export interface TokenDeps {
  /** The account's liquid core balance (asset text). */
  coreBalance: () => Promise<string>
  /** get_currency_balance of one token. */
  balance: (contract: string, symbol: string) => Promise<string[]>
  /** The history service's get_tokens answer; undefined when the network has none. */
  historyTokens?: () => Promise<unknown>
  added: AddedToken[]
}

/** The core token first, then the history service's tokens, then the added ones not already listed. */
export async function walletTokens(n: NetworkInfo, deps: TokenDeps): Promise<WalletTokens> {
  let core = ''
  try {
    const c = parseAsset(await deps.coreBalance())
    core = c && c.symbol === n.symbol ? formatUnits(rescale(c, n.precision), n.precision, n.symbol) : ''
  } catch {
    core = ''
  }
  const rows: TokenRow[] = [{ contract: 'eosio.token', symbol: n.symbol, precision: n.precision, balance: core, source: 'core' }]
  const isCore = (contract: string, symbol: string): boolean => contract === 'eosio.token' && symbol === n.symbol
  let history: WalletTokens['history'] = 'none'
  let historyNote = ''
  if (deps.historyTokens) {
    try {
      for (const t of parseHistoryTokens(await deps.historyTokens())) if (!isCore(t.contract, t.symbol)) rows.push(t)
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
      try {
        const list = await deps.balance(t.contract, t.symbol)
        const a = Array.isArray(list) ? list.map(parseAsset).find((x) => x && x.symbol === t.symbol) : null
        // No row means no balance: zero.
        balance = a ? formatUnits(rescale(a, t.precision), t.precision, t.symbol) : formatUnits(0, t.precision, t.symbol)
      } catch {
        balance = ''
      }
      return { contract: t.contract, symbol: t.symbol, precision: t.precision, balance, source: 'added' }
    })
  )
  rows.push(...read)
  return { rows, history, historyNote }
}
