// Voting and voter rewards of the system contract: the vote action, which claim
// actions a chain offers, and the estimate of the voter reward. Pure functions,
// used by the main process (reading the chain) and the Account page (forms).

import type { TxAction } from './api'

/**
 * Most producers one vote may name. The system contract checks
 * `producers.size() <= 30` in voteproducer; the number is compiled into the
 * contract and is in no table, so it is a constant here.
 */
export const MAX_VOTE_PRODUCERS = 30

/**
 * On WAX, voter rewards build up only while the vote names at least this many
 * producers, or a proxy (the WAX system contract, voting.cpp). The number is
 * compiled into the WAX contract and stands in no table, so it is a constant
 * here and is said only on the WAX chain ids.
 */
export const WAX_REWARD_MIN_PRODUCERS = 16

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

/** Antelope name order: the order of the 64-bit value of the name, which the contract requires for the producer list. */
export function nameValue(name: string): bigint {
  const charmap = '.12345abcdefghijklmnopqrstuvwxyz'
  let v = 0n
  for (let i = 0; i < 13; i++) {
    const c = i < name.length ? charmap.indexOf(name[i]) : 0
    const bits = BigInt(c < 0 ? 0 : c)
    if (i < 12) v |= (bits & 0x1fn) << BigInt(64 - 5 * (i + 1))
    else v |= bits & 0x0fn
  }
  return v
}

export function sortNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const x = nameValue(a)
    const y = nameValue(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

export type VoteChoice = { kind: 'producers'; producers: readonly string[] } | { kind: 'proxy'; proxy: string }

/**
 * The voteproducer action, or the reason it cannot be built. Producers: unique,
 * valid names, at most MAX_VOTE_PRODUCERS, sorted by name value (the contract
 * refuses any other order). A proxy vote names no producers; a producer vote
 * names no proxy. An empty producer list removes the vote.
 */
export function voteAction(voter: string, permission: string, choice: VoteChoice, limit = MAX_VOTE_PRODUCERS): { action: TxAction } | { problem: string } {
  if (!NAME.test(voter)) return { problem: 'The voter is not a valid account name.' }
  if (!NAME.test(permission)) return { problem: 'Choose the permission that signs.' }
  const authorization = [{ actor: voter, permission }]
  if (choice.kind === 'proxy') {
    const proxy = choice.proxy.trim()
    if (!NAME.test(proxy)) return { problem: 'Enter the proxy account name.' }
    if (proxy === voter) return { problem: 'An account cannot be its own proxy.' }
    return { action: { account: 'eosio', name: 'voteproducer', authorization, data: { voter, proxy, producers: [] } } }
  }
  const unique = [...new Set(choice.producers)]
  const bad = unique.find((p) => !NAME.test(p))
  if (bad !== undefined) return { problem: `${bad.slice(0, 20)} is not a valid producer name.` }
  if (unique.length > limit) return { problem: `Choose at most ${limit} producers (${unique.length} chosen).` }
  return { action: { account: 'eosio', name: 'voteproducer', authorization, data: { voter, proxy: '', producers: sortNames(unique) } } }
}

/** A claim the system contract offers for this account, in the order they are shown. */
export interface ClaimChoice {
  action: 'voterclaim' | 'claimgbmvote' | 'claimgenesis'
  /** The field of the action that names the account. */
  field: 'owner' | 'claimer'
  label: string
}

/**
 * The reward claims to offer, from the actions of the chain's system ABI:
 * `voterclaim` when the ABI has it, else `claimgbmvote` when it has that one;
 * `claimgenesis` only when the ABI has it and the account has a genesis row.
 * A chain whose ABI has none of them gets no claim.
 */
export function claimChoices(abiActions: readonly string[], hasGenesisRow: boolean): ClaimChoice[] {
  const has = new Set(abiActions)
  const out: ClaimChoice[] = []
  if (has.has('voterclaim')) out.push({ action: 'voterclaim', field: 'owner', label: 'Claim voting rewards' })
  else if (has.has('claimgbmvote')) out.push({ action: 'claimgbmvote', field: 'owner', label: 'Claim voting rewards' })
  if (has.has('claimgenesis') && hasGenesisRow) out.push({ action: 'claimgenesis', field: 'claimer', label: 'Claim genesis tokens' })
  return out
}

export function claimAction(choice: ClaimChoice, account: string, permission: string): TxAction | null {
  if (!NAME.test(account) || !NAME.test(permission)) return null
  return { account: 'eosio', name: choice.action, authorization: [{ actor: account, permission }], data: { [choice.field]: account } }
}

/** The numbers of the `voters` row and the `global` row that the reward estimate uses. */
export interface VoterShareInput {
  unpaidVoteshare: number
  unpaidVoteshareLastUpdated: number
  unpaidVoteshareChangeRate: number
  totalUnpaidVoteshare: number
  totalUnpaidVoteshareLastUpdated: number
  totalVoteshareChangeRate: number
  /** Whole units of the core token. */
  votersBucket: number
}

/**
 * Estimated voter reward in whole units of the core token, or null when it
 * cannot be estimated. As the system contract computes it at the claim, both
 * shares are first carried forward to `now` (milliseconds):
 *
 *   share = unpaid_voteshare + unpaid_voteshare_change_rate * seconds since unpaid_voteshare_last_updated
 *   total = total_unpaid_voteshare + total_voteshare_change_rate * seconds since total_unpaid_voteshare_last_updated
 *   reward = voters_bucket * share / total
 *
 * The bucket also grows at the claim with the inflation since its last fill,
 * which no table states in advance, so the result is an estimate.
 */
export function voterRewardEstimate(v: VoterShareInput, now: number): bigint | null {
  const nums = Object.values(v)
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  const since = (t: number): number => Math.max(0, (now - t) / 1000)
  const share = v.unpaidVoteshare + v.unpaidVoteshareChangeRate * since(v.unpaidVoteshareLastUpdated)
  const total = v.totalUnpaidVoteshare + v.totalVoteshareChangeRate * since(v.totalUnpaidVoteshareLastUpdated)
  if (!(share > 0) || !(total > 0) || !(v.votersBucket > 0)) return share >= 0 && total > 0 ? 0n : null
  const reward = Math.floor((v.votersBucket * share) / total)
  if (!Number.isFinite(reward) || reward < 0) return null
  return BigInt(Math.min(reward, v.votersBucket))
}

/** The system contract allows one voter claim per day, counted from `last_claim_time`. */
export const CLAIM_INTERVAL_SEC = 24 * 3600
