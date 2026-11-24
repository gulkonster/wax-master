// Accounts offered by the account picker for one network: the starred accounts,
// then the accounts found for the vault's public keys, each with the permissions
// the vault can sign for. Public keys only; the vault may be locked.

import type { AccountPickList } from '../shared/api'
import { RpcError } from './rpc'

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

/** Permissions per account whose threshold the vault's keys reach together. */
export function signableFrom(rows: AuthorizerRow[]): Map<string, string[]> {
  const sums = new Map<string, { account: string; permission: string; weight: number; threshold: number; keys: Set<string> }>()
  for (const r of rows) {
    const account = String(r.account_name ?? '')
    const permission = String(r.permission_name ?? '')
    const key = String(r.authorizing_key ?? '')
    if (!account || !permission || !key) continue
    const id = `${account}@${permission}`
    let s = sums.get(id)
    if (!s) {
      s = { account, permission, weight: 0, threshold: Number(r.threshold) || 1, keys: new Set() }
      sums.set(id, s)
    }
    if (s.keys.has(key)) continue
    s.keys.add(key)
    s.weight += Number(r.weight) || 0
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
      found = signableFrom(await deps.lookup(deps.vaultKeys))
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
  return /unknown key|unknown_key|account_query_exception|does not exist/i.test(text)
}
