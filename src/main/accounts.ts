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
  parent: string
  /** The permission that signs the change (usually the same or its parent). */
  signWith: string
  newKey: string
  /** Keep the current accounts and waits of the permission. */
  keepAccounts: { permission: { actor: string; permission: string }; weight: number }[]
  keepWaits: { wait_sec: number; weight: number }[]
}

export function changeKeyActions(i: ChangeKeyInput): ActionRequest[] {
  checkName(i.account, 'account')
  checkName(i.permission, 'permission')
  const auth: AuthorityInput = {
    threshold: 1,
    keys: [{ key: normalizeKey(i.newKey), weight: 1 }],
    accounts: i.keepAccounts,
    waits: i.keepWaits
  }
  return [
    {
      account: 'eosio',
      name: 'updateauth',
      authorization: [{ actor: i.account, permission: i.signWith }],
      data: { account: i.account, permission: i.permission, parent: i.parent, auth: normalizeAuthority(auth) }
    }
  ]
}
