// Accounts offered by the account picker for one network: the starred accounts,
// then the accounts found for the vault's public keys, each with the permissions
// the vault can sign for. Public keys only; the vault may be locked.

import type { AccountPickList } from '../shared/api'
import { convertPublicKey, isValidName } from '../chain-core'
import { RpcError } from './rpc'
import { isMissingAccountText, missingAccountSentence } from '../shared/missing-account'

/** One row of get_accounts_by_authorizers. */
export interface AuthorizerRow {
  account_name: string
  permission_name: string
  authorizing_key?: string
  weight: number
  threshold: number
}

export interface PickDeps {
  stars: string[]
  /** Public keys of the vault (PUB_K1 form). */
  vaultKeys: string[]
  /** get_accounts_by_authorizers on the network's endpoints. */
  lookup: (keys: string[]) => Promise<AuthorizerRow[]>
}

/** At most this many accounts, and permissions per account, are taken from one answer. */
export const MAX_PICK_ACCOUNTS = 500
export const MAX_PICK_PERMISSIONS = 20
const MAX_WEIGHT = 65_535
const MAX_THRESHOLD = 4_294_967_295

/** A public key in one form (PUB_K1_...); null when it is not a public key. */
function keyForm(k: unknown): string | null {
  if (typeof k !== 'string' || k.length > 200) return null
  try {
    return convertPublicKey(k, 'new')
  } catch {
    return null
  }
}

function wholeIn(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null
}

/**
 * Permissions per account whose threshold the vault's keys reach together. The
 * node's answer is untrusted: a row counts only with valid account and permission
 * names, a key that was sent (compared in one form), and a weight and threshold
 * in range; at most MAX_PICK_ACCOUNTS accounts and MAX_PICK_PERMISSIONS
 * permissions per account are kept.
 */
export function signableFrom(rows: AuthorizerRow[], sentKeys: string[]): Map<string, string[]> {
  const sent = new Set(sentKeys.map(keyForm).filter((k): k is string => k !== null))
  const sums = new Map<string, { account: string; permission: string; weight: number; threshold: number; keys: Set<string> }>()
  const perAccount = new Map<string, number>()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue
    const account = r.account_name
    const permission = r.permission_name
    if (typeof account !== 'string' || typeof permission !== 'string' || !isValidName(account) || !isValidName(permission)) continue
    if (account === '' || permission === '') continue
    const key = keyForm(r.authorizing_key)
    if (!key || !sent.has(key)) continue
    const weight = wholeIn(r.weight, MAX_WEIGHT)
    const threshold = wholeIn(r.threshold, MAX_THRESHOLD)
    if (weight === null || threshold === null) continue
    const id = `${account}@${permission}`
    let s = sums.get(id)
    if (!s) {
      const count = perAccount.get(account)
      if (count === undefined && perAccount.size >= MAX_PICK_ACCOUNTS) continue
      if ((count ?? 0) >= MAX_PICK_PERMISSIONS) continue
      perAccount.set(account, (count ?? 0) + 1)
      s = { account, permission, weight: 0, threshold, keys: new Set() }
      sums.set(id, s)
    }
    if (s.keys.has(key)) continue
    s.keys.add(key)
    s.weight += weight
  }
  const out = new Map<string, string[]>()
  for (const s of sums.values()) {
    if (!out.has(s.account)) out.set(s.account, [])
    if (s.weight >= s.threshold) out.get(s.account)!.push(s.permission)
  }
  return out
}

export async function pickList(networkId: string, deps: PickDeps): Promise<AccountPickList> {
  let found = new Map<string, string[]>()
  let vaultChecked = true
  if (deps.vaultKeys.length > 0) {
    try {
      found = signableFrom(await deps.lookup(deps.vaultKeys), deps.vaultKeys)
    } catch {
      // The endpoint may not offer the lookup; starred accounts are still listed.
      vaultChecked = false
    }
  }
  const order = (perms: string[]): string[] => [...new Set(perms)].sort((a, b) => (a === 'active' ? -1 : b === 'active' ? 1 : a.localeCompare(b)))
  const entries = deps.stars.map((account) => ({ account, starred: true, fromVault: found.has(account), signable: order(found.get(account) ?? []) }))
  for (const account of [...found.keys()].sort()) {
    if (deps.stars.includes(account)) continue
    entries.push({ account, starred: false, fromVault: true, signable: order(found.get(account) ?? []) })
  }
  return { networkId, entries, vaultChecked }
}

/** True when the node says the account is not there (as opposed to a failed request). */
export function isUnknownAccount(e: unknown): boolean {
  if (!(e instanceof RpcError)) return false
  let text = e.message
  try {
    text += JSON.stringify(e.details ?? '')
  } catch {
    // the message alone
  }
  return isMissingAccountText(text)
}

/**
 * A failed get_account of `name` on `network`: an account the node does not
 * know becomes the plain sentence, still an RpcError (status and node answer
 * kept, so isUnknownAccount still knows it); any other error comes back as it is.
 */
export function plainAccountError(e: unknown, name: string, network: string): unknown {
  if (!isUnknownAccount(e)) return e
  const r = e as RpcError
  return new RpcError(missingAccountSentence(name, network), r.status, r.details)
}
