// Amounts of the wallet forms: text typed by the user <-> whole units of a token
// with its precision, and the asset text an action carries. Units are bigint so
// every amount the chain can hold is exact.

/** Largest amount of an asset on the chain, in whole units (2^62 - 1). */
export const ASSET_MAX_UNITS = (1n << 62n) - 1n

/** Shown when an amount holds a comma: the decimal comma is never read as a point. */
export const COMMA_TEXT = 'Use a point for the decimals, without thousands separators.'

const TEN = 10n

/**
 * Whole units of an amount typed for a token of `precision` decimals ("1.5" with
 * precision 4 -> 15000n); null when it is not a plain positive-or-zero decimal
 * with a point (a comma is refused, never removed), has more decimals than the
 * token, or is above the chain's asset limit.
 */
export function amountUnits(text: string, precision: number): bigint | null {
  const m = /^(\d{1,40})(?:\.(\d*))?$/.exec(text.trim())
  if (!m) return null
  const frac = m[2] ?? ''
  if (frac.length > precision) return null
  const units = BigInt(`${m[1]}${frac.padEnd(precision, '0')}`)
  return units <= ASSET_MAX_UNITS ? units : null
}

/** Why a typed amount is not valid ('' for an empty field or a valid amount): the comma has its own text. */
export function amountProblem(text: string, precision: number): string {
  const t = text.trim()
  if (t === '') return ''
  if (t.includes(',')) return COMMA_TEXT
  const u = amountUnits(t, precision)
  if (u === null) return `Enter an amount above zero with at most ${precision} decimals.`
  return ''
}

/** Whole units as asset text with the token's precision: 41840000n, 8, "WAX" -> "0.41840000 WAX". */
export function formatUnits(units: bigint, precision: number, symbol: string): string {
  const neg = units < 0n
  const digits = (neg ? -units : units).toString().padStart(precision + 1, '0')
  const whole = precision > 0 ? digits.slice(0, -precision) : digits
  const frac = precision > 0 ? `.${digits.slice(-precision)}` : ''
  return `${neg ? '-' : ''}${whole}${frac} ${symbol}`
}

/** The number part of an amount for a form field ("1.50000000"). */
export function amountField(units: bigint, precision: number): string {
  return formatUnits(units, precision, 'X').split(' ')[0]
}

/** Asset text with the token's precision ("1.5", 4, "ABC" -> "1.5000 ABC"); null when the amount is not valid. */
export function quantityText(text: string, precision: number, symbol: string): string | null {
  const u = amountUnits(text, precision)
  return u === null ? null : formatUnits(u, precision, symbol)
}

/** An asset text ("1234.5678 WAX") as exact whole units; null when it is not an asset within the chain's limit. */
export function readAsset(text: unknown): { units: bigint; precision: number; symbol: string } | null {
  if (typeof text !== 'string') return null
  const m = /^\s*(-?)(\d{1,40})(?:\.(\d{1,18}))?\s+([A-Z]{1,7})\s*$/.exec(text)
  if (!m) return null
  const decimals = m[3] ?? ''
  const abs = BigInt(`${m[2]}${decimals}`)
  if (abs > ASSET_MAX_UNITS) return null
  return { units: m[1] ? -abs : abs, precision: decimals.length, symbol: m[4] }
}

/** Units of one precision at another (extra decimals are cut). */
export function rescaleUnits(units: bigint, from: number, to: number): bigint {
  return from <= to ? units * TEN ** BigInt(to - from) : units / TEN ** BigInt(from - to)
}

/** Whole units of an asset text at the given precision; null when it is not that token's asset. */
export function assetUnits(text: string, precision: number, symbol: string): bigint | null {
  const a = readAsset(text)
  if (!a || a.symbol !== symbol) return null
  return rescaleUnits(a.units, a.precision, precision)
}

/** Memo limit of eosio.token transfer, in bytes of UTF-8. */
export const MEMO_MAX_BYTES = 256

export function memoBytes(memo: string): number {
  return new TextEncoder().encode(memo).length
}
