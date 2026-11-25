// RAM purchase arithmetic shared by the main process (reading the market) and
// the window (the Buy RAM form): how many bytes to offer, what they cost on the
// system contract's RAM market, and asset text <-> whole units.

/** The chain id of WAX Testnet; testnet-only features (the faucet) are keyed on it. */
export const WAX_TESTNET_CHAIN_ID = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'

/** Smallest margin added to a RAM purchase, in bytes. */
export const RAM_MARGIN_MIN = 2048
/** Default purchase on the Account page, in bytes. */
export const RAM_DEFAULT_BUY = 8192
/** Fee of the system contract on a RAM purchase (0.5 %). */
export const RAM_FEE = 0.005
/** Largest purchase one buyrambytes action can carry (uint32). */
export const RAM_MAX_BUY = 0xffffffff

/** The `rammarket` row reduced to what the price needs. */
export interface RamMarket {
  /** RAM in the market's connector, in bytes. */
  ramReserve: number
  /** Core token in the market's connector, in whole units (e.g. 1 WAX = 10^8 with precision 8). */
  quoteReserve: number
  symbol: string
  precision: number
}

/** Answer of the main-process read of the RAM price. */
export type RamPrice =
  | { available: false; reason: string }
  | (RamMarket & {
      available: true
      /** The bytes the cost is for. */
      bytes: number
      /** Estimated cost including the fee, in whole units; null when the bytes exceed the market. */
      cost: number | null
    })

/**
 * Bytes to buy so a need is covered: the missing bytes plus a margin (the larger
 * of 2,048 bytes and 10 % of the needed bytes), rounded up to the next 1,024.
 */
export function ramToBuy(needed: number, available: number): number {
  const need = Math.max(0, Math.ceil(needed))
  const missing = Math.max(0, need - Math.max(0, Math.floor(available)))
  const margin = Math.max(RAM_MARGIN_MIN, Math.ceil(need * 0.1))
  return Math.ceil((missing + margin) / 1024) * 1024
}

/**
 * First value of the Buy RAM form on the Account page: 8,192 bytes, or, when
 * more than 95 % of the account's RAM is used, the bytes that bring it back
 * under 95 % plus the margin of `ramToBuy`.
 */
export function accountRamDefault(usage: number, quota: number): number {
  if (quota < 0 || quota === 0 || usage / quota <= 0.95) return RAM_DEFAULT_BUY
  return ramToBuy(usage, Math.floor(quota * 0.95))
}

/** Parses "1234.5678 WAX" into whole units; null when the text is not an asset. */
export function parseAsset(text: unknown): { units: number; precision: number; symbol: string } | null {
  if (typeof text !== 'string') return null
  const m = /^\s*(-?)(\d+)(?:\.(\d+))?\s+([A-Z]{1,7})\s*$/.exec(text)
  if (!m) return null
  const decimals = m[3] ?? ''
  if (decimals.length > 18) return null
  const units = Number(`${m[2]}${decimals}`)
  if (!Number.isSafeInteger(units)) return null
  return { units: m[1] ? -units : units, precision: decimals.length, symbol: m[4] }
}

/** Whole units as asset text with the token's precision: 41840000, 8, "WAX" -> "0.41840000 WAX". */
export function formatUnits(units: number, precision: number, symbol: string): string {
  const neg = units < 0
  const digits = String(Math.abs(Math.trunc(units))).padStart(precision + 1, '0')
  const whole = precision > 0 ? digits.slice(0, -precision) : digits
  const frac = precision > 0 ? `.${digits.slice(-precision)}` : ''
  return `${neg ? '-' : ''}${whole}${frac} ${symbol}`
}

/** A cost for reading: at most four decimals, rounded up so it is never shown too low. */
export function formatCost(units: number, precision: number, symbol: string): string {
  if (precision <= 4) return formatUnits(units, precision, symbol)
  const step = 10 ** (precision - 4)
  return formatUnits(Math.ceil(units / step), 4, symbol)
}

/**
 * Reads the system contract's `rammarket` row (`{ base: { balance: "N RAM" },
 * quote: { balance: "X.XXXX WAX" } }`); null when it is missing or not in that form.
 */
export function parseRamMarket(row: unknown): RamMarket | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as { base?: { balance?: unknown }; quote?: { balance?: unknown } }
  const base = parseAsset(r.base?.balance)
  const quote = parseAsset(r.quote?.balance)
  if (!base || !quote || base.symbol !== 'RAM' || base.precision !== 0) return null
  if (base.units <= 0 || quote.units <= 0) return null
  return { ramReserve: base.units, quoteReserve: quote.units, symbol: quote.symbol, precision: quote.precision }
}

/**
 * Estimated cost of `bytes` in whole units of the core token, the way the
 * system contract's buyrambytes computes it: the Bancor input for the bytes
 * taken out of the RAM connector, then divided by 0.995 for the 0.5 % fee
 * (both steps truncated to whole units, as the contract does). null when the
 * market does not hold that many bytes.
 */
export function ramCost(market: RamMarket, bytes: number): number | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  if (bytes >= market.ramReserve) return null
  const input = Math.trunc((market.quoteReserve * bytes) / (market.ramReserve - bytes))
  // The contract divides by the literal 0.995 (1 - RAM_FEE).
  return Math.trunc(Math.max(0, input) / 0.995)
}

/** What the RAM line of the Deploy dialog is made from (fields of the deploy plan). */
export interface DeployRamFigures {
  ramNeeded: number
  ramNew: number
  ramReplaced: number
  ramAvailable: number
  chainCodeUnread: boolean
}

/** Note added when the size of the code on the account could not be read. */
export const CODE_SIZE_UNREAD = 'The size of the code now on the account could not be read; counted as a first deployment.'

/** The RAM line of the Deploy dialog: a first deployment, or the difference to what is replaced. */
export function deployRamText(p: DeployRamFigures): string {
  const available = p.ramAvailable < 0 ? 'unlimited' : `${p.ramAvailable.toLocaleString()} bytes`
  const line =
    p.ramReplaced > 0
      ? `RAM needed about ${p.ramNeeded.toLocaleString()} bytes more than now (new code and ABI ${p.ramNew.toLocaleString()} bytes, replacing ${p.ramReplaced.toLocaleString()} bytes); available ${available}.`
      : `RAM needed about ${p.ramNeeded.toLocaleString()} bytes; available ${available}.`
  return p.chainCodeUnread ? `${line} ${CODE_SIZE_UNREAD}` : line
}

/** Fee of the system contract on buyram and sellram, in whole units: 0.5 % rounded up, as the contract computes it. */
export function ramFeeUnits(units: number): number {
  return Math.floor((units + 199) / 200)
}

/**
 * Bytes `buyram` gives for an amount in whole units of the core token: the fee is
 * taken first, then the Bancor output of the RAM connector (truncated, as the
 * contract does). 0 when the amount does not cover the fee.
 */
export function ramForAmount(market: RamMarket, units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0
  const input = units - ramFeeUnits(units)
  if (input <= 0) return 0
  return Math.max(0, Math.trunc((market.ramReserve * input) / (market.quoteReserve + input)))
}

/**
 * Whole units of the core token `sellram` returns for `bytes`: the Bancor output
 * of the token connector, less the 0.5 % fee rounded up.
 */
export function ramSellReturn(market: RamMarket, bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  const out = Math.trunc((market.quoteReserve * bytes) / (market.ramReserve + bytes))
  return Math.max(0, out - ramFeeUnits(out))
}

/**
 * Bytes kept back when selling RAM. The `sellram` transaction itself adds to the
 * account's RAM use (a node refused selling 16,200 of 16,342 unused bytes,
 * short by about 100 bytes), so selling every unused byte is refused.
 */
export const RAM_SELL_MARGIN = 512

/** Most bytes the Sell form offers: the unused RAM less `RAM_SELL_MARGIN`. */
export function ramSellable(usage: number, quota: number): number {
  if (quota < 0) return 0
  return Math.max(0, quota - usage - RAM_SELL_MARGIN)
}
