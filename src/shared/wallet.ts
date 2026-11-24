// Amounts of the wallet forms: text typed by the user <-> whole units of a token
// with its precision, and the asset text an action carries.

import { formatUnits, parseAsset } from './ram-market'

/**
 * Whole units of an amount typed for a token of `precision` decimals ("1.5" with
 * precision 4 -> 15000); null when it is not a plain positive-or-zero decimal, has
 * more decimals than the token, or is too large to be exact.
 */
export function amountUnits(text: string, precision: number): number | null {
  const t = text.trim().replace(/,/g, '')
  const m = /^(\d{1,19})(?:\.(\d*))?$/.exec(t)
  if (!m) return null
  const frac = m[2] ?? ''
  if (frac.length > precision) return null
  const units = Number(`${m[1]}${frac.padEnd(precision, '0')}`)
  return Number.isSafeInteger(units) ? units : null
}

/** Asset text with the token's precision ("1.5", 4, "ABC" -> "1.5000 ABC"); null when the amount is not valid. */
export function quantityText(text: string, precision: number, symbol: string): string | null {
  const u = amountUnits(text, precision)
  return u === null ? null : formatUnits(u, precision, symbol)
}

/** Whole units of an asset text at the given precision; null when it is not that token's asset. */
export function assetUnits(text: string, precision: number, symbol: string): number | null {
  const a = parseAsset(text)
  if (!a || a.symbol !== symbol) return null
  return a.precision <= precision ? a.units * 10 ** (precision - a.precision) : Math.trunc(a.units / 10 ** (a.precision - precision))
}

/** Memo limit of eosio.token transfer, in bytes of UTF-8. */
export const MEMO_MAX_BYTES = 256

export function memoBytes(memo: string): number {
  return new TextEncoder().encode(memo).length
}
