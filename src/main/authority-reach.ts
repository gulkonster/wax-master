// Whether an authority can be satisfied by a signature. One answer for every
// way the app sends `eosio::updateauth`: the wallet's review, Change key and a
// typed action on the Contract page (checked again by the signer).

import { convertPublicKey, parsePublicKey, publicKeyToString, type Authority } from '../chain-core'

export const MAX_WEIGHT = 65535

type R = Record<string, unknown>

/** One permission of the account as read from get_account. */
export interface CurrentPermission {
  name: string
  parent: string
  auth: Authority
  /** Linked actions from get_account; null when the node does not report them. */
  linked: { code: string; type: string }[] | null
}

/** A public key in the new form, or '' when it cannot be read. */
export function keyText(key: string): string {
  try {
    return publicKeyToString(parsePublicKey(key.trim()), 'new')
  } catch {
    return ''
  }
}

/**
 * The form the chain writes the account's keys in (`EOS...` on WAX). Keys are
 * shown and sent in that form, so the permission tree, the review of a change
 * and its Command view write a key the same way.
 */
export function chainKeyForm(accountData: R): 'new' | 'legacy' {
  const list = Array.isArray(accountData.permissions) ? (accountData.permissions as R[]) : []
  for (const p of list) {
    const keys = ((p?.required_auth ?? {}) as R).keys
    if (Array.isArray(keys) && keys.some((k) => typeof (k as R)?.key === 'string' && ((k as R).key as string).startsWith('EOS'))) return 'legacy'
  }
  return 'new'
}

/** A key in the given form (only K1 keys have the legacy form); unchanged when it cannot be read. */
export function writeKey(key: string, form: 'new' | 'legacy'): string {
  try {
    return convertPublicKey(key, form)
  } catch {
    return key
  }
}

/** The permissions of a get_account answer; values are checked, the authority is kept as the chain has it. */
export function readPermissions(accountData: R): CurrentPermission[] {
  const list = Array.isArray(accountData.permissions) ? (accountData.permissions as R[]) : []
  return list.slice(0, 100).map((p) => {
    const a = (p.required_auth ?? {}) as R
    const keys = (Array.isArray(a.keys) ? (a.keys as R[]) : []).map((k) => ({ key: keyText(String(k.key ?? '')), weight: Number(k.weight) }))
    const accounts = (Array.isArray(a.accounts) ? (a.accounts as R[]) : []).map((x) => {
      const lvl = (x.permission ?? {}) as R
      return { permission: { actor: String(lvl.actor ?? ''), permission: String(lvl.permission ?? '') }, weight: Number(x.weight) }
    })
    const waits = (Array.isArray(a.waits) ? (a.waits as R[]) : []).map((w) => ({ wait_sec: Number(w.wait_sec), weight: Number(w.weight) }))
    const linkedRaw = p.linked_actions
    const linked = Array.isArray(linkedRaw)
      ? (linkedRaw as R[]).slice(0, 500).map((l) => ({ code: String(l.account ?? ''), type: typeof l.action === 'string' ? l.action : '' }))
      : null
    return { name: String(p.perm_name ?? ''), parent: String(p.parent ?? ''), auth: { threshold: Number(a.threshold), keys, accounts, waits }, linked }
  })
}

/** The permission and every permission below it. */
export function subtree(perms: CurrentPermission[], name: string): Set<string> {
  const out = new Set([name])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of perms) {
      if (!out.has(p.name) && out.has(p.parent)) {
        out.add(p.name)
        grew = true
      }
    }
  }
  return out
}

type AccountEntry = Authority['accounts'][number]

/**
 * Account entries that can count toward the threshold: not `x@eosio.code` (only
 * contract code can use it), not `eosio.null` (nobody can sign for it), not the
 * permission itself or one below it (a circle).
 */
export function countedAccounts(account: string, permission: string, auth: Authority, perms: CurrentPermission[]): AccountEntry[] {
  const circle = subtree(perms, permission)
  return auth.accounts.filter((a) => {
    if (a.permission.permission === 'eosio.code') return false
    if (a.permission.actor === 'eosio.null') return false
    if (a.permission.actor === account && circle.has(a.permission.permission)) return false
    return true
  })
}

/**
 * Why an authority could not be satisfied by a signature, or null when it can.
 * Counted: keys and the entries of `countedAccounts`, except those listed in
 * `missing` (actor@permission that does not exist now). Waits are not counted:
 * they need delayed transactions.
 */
export function reachProblem(
  account: string,
  permission: string,
  auth: Authority,
  perms: CurrentPermission[],
  missing: readonly string[] = []
): string | null {
  const where = `${account}@${permission}`
  if (!Number.isInteger(auth.threshold) || auth.threshold < 1) return `The threshold of ${where} must be at least 1.`
  for (const e of [...auth.keys, ...auth.accounts, ...auth.waits]) {
    if (!Number.isInteger(e.weight) || e.weight < 1 || e.weight > MAX_WEIGHT) return `Every weight of ${where} must be from 1 to ${MAX_WEIGHT}.`
  }
  let usable = 0
  for (const k of auth.keys) usable += k.weight
  for (const a of countedAccounts(account, permission, auth, perms)) {
    if (missing.includes(`${a.permission.actor}@${a.permission.permission}`)) continue
    usable += a.weight
  }
  if (usable < auth.threshold) {
    const gone = missing.length > 0 ? ` Not counted because they do not exist on this network now: ${missing.join(', ')}.` : ''
    return `${where} could not reach its threshold ${auth.threshold}: the keys and accounts that can sign add up to ${usable}.${gone}`
  }
  return null
}

/**
 * The full check: `reachProblem`, and for `owner` every counted account entry
 * must exist on the chain now (a missing one is not counted).
 */
export async function authorityProblem(
  account: string,
  permission: string,
  auth: Authority,
  perms: CurrentPermission[],
  levelExists: (actor: string, permission: string) => Promise<boolean>
): Promise<string | null> {
  const first = reachProblem(account, permission, auth, perms)
  if (first || permission !== 'owner') return first
  const missing: string[] = []
  for (const a of countedAccounts(account, permission, auth, perms)) {
    if (!(await levelExists(a.permission.actor, a.permission.permission))) missing.push(`${a.permission.actor}@${a.permission.permission}`)
  }
  return missing.length > 0 ? reachProblem(account, permission, auth, perms, missing) : null
}
