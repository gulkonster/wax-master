// Account actions: Create Account (newaccount + buyrambytes + delegatebw) and
// Change key (updateauth). The actions are built as JSON; the signer encodes
// them with the chain's own eosio ABI and shows the decoded bytes.

import { normalizeAuthority, parsePublicKey, publicKeyToString, type AuthorityInput } from '../chain-core'
import type { ActionRequest } from './signer'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

function checkName(n: string, what: string): void {
  if (!NAME.test(n)) throw new Error(`${what}: not a valid account name`)
}

function normalizeKey(k: string): string {
  try {
    return publicKeyToString(parsePublicKey(k.trim()), 'new')
  } catch {
    throw new Error(`Not a valid public key: ${k}`)
  }
}

export interface CreateAccountInput {
  creator: string
  creatorPermission: string
  name: string
  ownerKey: string
  activeKey: string
  ramBytes: number
  stakeCpu: string
  stakeNet: string
  transfer: boolean
}

export function createAccountActions(i: CreateAccountInput): ActionRequest[] {
  checkName(i.creator, 'creator')
  checkName(i.name, 'name')
  if (!Number.isInteger(i.ramBytes) || i.ramBytes < 0 || i.ramBytes > 100 * 1024 * 1024) throw new Error('RAM bytes out of range')
  const auth = [{ actor: i.creator, permission: i.creatorPermission }]
  const owner = normalizeAuthority({ threshold: 1, keys: [{ key: normalizeKey(i.ownerKey), weight: 1 }] })
  const active = normalizeAuthority({ threshold: 1, keys: [{ key: normalizeKey(i.activeKey), weight: 1 }] })
  const actions: ActionRequest[] = [
    { account: 'eosio', name: 'newaccount', authorization: auth, data: { creator: i.creator, name: i.name, owner, active } },
    { account: 'eosio', name: 'buyrambytes', authorization: auth, data: { payer: i.creator, receiver: i.name, bytes: i.ramBytes } }
  ]
  const zero = (a: string): boolean => /^0(\.0+)?\s/.test(a.trim())
  if (!zero(i.stakeCpu) || !zero(i.stakeNet)) {
    actions.push({
      account: 'eosio',
      name: 'delegatebw',
      authorization: auth,
      data: { from: i.creator, receiver: i.name, stake_net_quantity: i.stakeNet, stake_cpu_quantity: i.stakeCpu, transfer: i.transfer }
    })
  }
  return actions
}

export interface ChangeKeyInput {
  account: string
  permission: string
  /** The key to replace (one of the permission's keys). */
  oldKey: string
  newKey: string
  /** The permission that signs the change: the permission itself or one of its parents. */
  signWith: string
}

type R = Record<string, unknown>

/**
 * Change key: replaces one key of a permission and keeps the rest of its
 * authority (threshold, other keys and weights, accounts, waits, parent), read
 * from the chain's get_account answer for the account.
 */
export function changeKeyActions(i: ChangeKeyInput, accountData: R): ActionRequest[] {
  checkName(i.account, 'account')
  checkName(i.permission, 'permission')
  checkName(i.signWith, 'signWith')
  const perms = Array.isArray(accountData.permissions) ? (accountData.permissions as R[]) : []
  const perm = perms.find((p) => p.perm_name === i.permission)
  if (!perm) throw new Error(`The account ${i.account} has no permission "${i.permission}"`)
  const parent = typeof perm.parent === 'string' ? perm.parent : ''
  // The permission itself or one of its parents may sign.
  const chain: string[] = [i.permission]
  for (let p: R | undefined = perm; p && typeof p.parent === 'string' && p.parent && chain.length < 32; ) {
    const name: string = p.parent as string
    if (chain.includes(name)) break
    chain.push(name)
    p = perms.find((x) => x.perm_name === name)
  }
  if (!chain.includes(i.signWith)) throw new Error(`Sign with ${i.permission} or one of its parents (${chain.slice(1).join(', ') || 'none'}).`)

  const auth = (perm.required_auth ?? {}) as R
  const threshold = Number(auth.threshold ?? 0)
  const keys = (Array.isArray(auth.keys) ? (auth.keys as R[]) : []).map((k) => ({ key: normalizeKey(String(k.key)), weight: Number(k.weight) }))
  const accounts = (Array.isArray(auth.accounts) ? (auth.accounts as R[]) : []).map((a) => {
    const lvl = (a.permission ?? {}) as R
    return { permission: { actor: String(lvl.actor), permission: String(lvl.permission) }, weight: Number(a.weight) }
  })
  const waits = (Array.isArray(auth.waits) ? (auth.waits as R[]) : []).map((w) => ({ wait_sec: Number(w.wait_sec), weight: Number(w.weight) }))

  const oldKey = normalizeKey(i.oldKey)
  const newKey = normalizeKey(i.newKey)
  const at = keys.findIndex((k) => k.key === oldKey)
  if (at < 0) throw new Error(`The key to replace is not a key of ${i.account}@${i.permission}.`)
  if (oldKey === newKey) throw new Error('The new key is the same as the old key.')
  if (keys.some((k) => k.key === newKey)) throw new Error(`The new key is already a key of ${i.account}@${i.permission}.`)
  keys[at] = { key: newKey, weight: keys[at].weight }

  // Whether the new authority can still reach its threshold is decided by the
  // signer, for every updateauth (the same check as the wallet's).
  const next: AuthorityInput = { threshold, keys, accounts, waits }
  return [
    {
      account: 'eosio',
      name: 'updateauth',
      authorization: [{ actor: i.account, permission: i.signWith }],
      data: { account: i.account, permission: i.permission, parent, auth: normalizeAuthority(next) }
    }
  ]
}
