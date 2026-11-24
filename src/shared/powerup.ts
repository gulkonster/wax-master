// PowerUp: renting CPU and NET from the system contract for a fixed number of
// days. The cost is computed here from the `powup.state` row with the formula of
// the system contract, before anything is signed.

import type { TxAction } from './api'

/** The whole market of one resource is 10^15 parts (`powerup_frac` of the system contract). */
export const POWERUP_FRAC = 1_000_000_000_000_000n

/** max_payment = cost plus this share of it (at least one unit): the market moves a little between the read and the block. */
export const POWERUP_MARGIN_PERCENT = 5n

/** One resource of the `powup.state` row; big numbers as decimal text, prices in whole units of the core token. */
export interface PowerupResource {
  weight: string
  utilization: string
  adjustedUtilization: string
  /** Seconds since 1970 (UTC). */
  utilizationTimestamp: number
  decaySecs: number
  exponent: number
  minPrice: string
  maxPrice: string
}

export interface PowerupState {
  net: PowerupResource
  cpu: PowerupResource
  days: number
  /** Whole units of the core token. */
  minFee: string
  symbol: string
  precision: number
}

const num = (s: string): number => Number(s)

/**
 * `adjusted_utilization` decays toward `utilization` with time, as the contract
 * does at the start of every powerup:
 *
 *   adjusted = utilization + (adjusted - utilization) * e^(-(now - utilization_timestamp) / decay_secs)
 *
 * when it is above `utilization`, else adjusted = utilization. `now` in seconds.
 */
export function decayedAdjusted(r: PowerupResource, nowSec: number): number {
  const u = num(r.utilization)
  const adj = num(r.adjustedUtilization)
  if (nowSec <= r.utilizationTimestamp) return adj
  if (u >= adj) return u
  const diff = adj - u
  const delta = Math.floor(diff * Math.exp(-(nowSec - r.utilizationTimestamp) / Math.max(1, r.decaySecs)))
  return u + Math.min(Math.max(delta, 0), diff)
}

/**
 * Fee in whole units for taking `increase` more weight of one resource
 * (`calc_powerup_fee` of the system contract). With u = utilization / weight:
 *
 *   price p(u) = min_price + (max_price - min_price) * u^(exponent - 1)
 *   f(u) = min_price * u + (max_price - min_price) / exponent * u^exponent   (the integral of p)
 *
 * The part of the increase that lies below `adjusted_utilization` is paid at
 * the price p(adjusted) for its share of the weight; the rest is paid as
 * f(end) - f(start). The sum is rounded up. Returns null when the market has no
 * weight or not enough left.
 */
export function powerupFee(r: PowerupResource, increase: number, adjusted: number): number | null {
  if (increase <= 0) return 0
  const weight = num(r.weight)
  const minP = num(r.minPrice)
  const maxP = num(r.maxPrice)
  const exponent = r.exponent
  if (!(weight > 0) || !(exponent >= 1) || !Number.isFinite(minP) || !Number.isFinite(maxP)) return null
  let start = num(r.utilization)
  const end = start + increase
  if (end > weight) return null
  const price = (u: number): number => (exponent - 1 <= 0 ? maxP : minP + (maxP - minP) * Math.pow(u / weight, exponent - 1))
  const integral = (a: number, b: number): number => {
    const c = (maxP - minP) / exponent
    const x = a / weight
    const y = b / weight
    return minP * y - minP * x + c * Math.pow(y, exponent) - c * Math.pow(x, exponent)
  }
  let fee = 0
  if (start < adjusted) {
    fee += (price(adjusted) * Math.min(increase, adjusted - start)) / weight
    start = adjusted
  }
  if (start < end) fee += integral(start, end)
  return Math.ceil(fee)
}

/** The fraction of the market for a share of its weight given as whole units of stake (rounded down); above POWERUP_FRAC when the stake is more than the whole market. */
export function fracForStake(stakeUnits: bigint, r: PowerupResource): bigint {
  const weight = BigInt(r.weight)
  if (weight <= 0n || stakeUnits <= 0n) return 0n
  return (stakeUnits * POWERUP_FRAC) / weight
}

/** The weight the contract gives for a fraction: frac * weight / 10^15, rounded down. */
export function amountForFrac(frac: bigint, r: PowerupResource): bigint {
  return (frac * BigInt(r.weight)) / POWERUP_FRAC
}

export interface PowerupQuote {
  cpuFrac: bigint
  netFrac: bigint
  /** Whole units of the core token, rounded up as the contract does. */
  fee: bigint
  maxPayment: bigint
  /** Set when the contract would refuse: the reason in words. */
  problem: string
}

/** Cost of renting CPU and NET equal to the given stakes (whole units), at `nowSec`. */
export function powerupQuote(s: PowerupState, cpuStake: bigint, netStake: bigint, nowSec: number): PowerupQuote {
  const cpuFrac = fracForStake(cpuStake, s.cpu)
  const netFrac = fracForStake(netStake, s.net)
  const empty = { cpuFrac, netFrac, fee: 0n, maxPayment: 0n }
  if (cpuStake <= 0n && netStake <= 0n) return { ...empty, problem: 'Enter an amount for CPU or for NET.' }
  if ((cpuStake > 0n && cpuFrac === 0n) || (netStake > 0n && netFrac === 0n)) return { ...empty, problem: 'The amount is too small for this market.' }
  let fee = 0
  for (const [frac, r, label] of [
    [netFrac, s.net, 'NET'],
    [cpuFrac, s.cpu, 'CPU']
  ] as const) {
    if (frac === 0n) continue
    if (frac > POWERUP_FRAC) return { ...empty, problem: `The ${label} market does not have that much left to rent.` }
    const amount = Number(amountForFrac(frac, r))
    const f = powerupFee(r, amount, decayedAdjusted(r, nowSec))
    if (f === null) return { ...empty, problem: `The ${label} market does not have that much left to rent.` }
    if (!(f > 0)) return { ...empty, problem: 'The cost is below the smallest fee; rent a larger amount.' }
    fee += f
  }
  const feeUnits = BigInt(Math.ceil(fee))
  if (feeUnits < BigInt(s.minFee)) return { ...empty, fee: feeUnits, problem: 'The cost is below the smallest fee; rent a larger amount.' }
  const margin = (feeUnits * POWERUP_MARGIN_PERCENT + 99n) / 100n
  return { cpuFrac, netFrac, fee: feeUnits, maxPayment: feeUnits + (margin > 0n ? margin : 1n), problem: '' }
}

export function powerupAction(a: {
  payer: string
  receiver: string
  permission: string
  days: number
  quote: PowerupQuote
  maxPaymentText: string
}): TxAction {
  return {
    account: 'eosio',
    name: 'powerup',
    authorization: [{ actor: a.payer, permission: a.permission }],
    data: {
      payer: a.payer,
      receiver: a.receiver,
      days: a.days,
      net_frac: a.quote.netFrac.toString(),
      cpu_frac: a.quote.cpuFrac.toString(),
      max_payment: a.maxPaymentText
    }
  }
}
