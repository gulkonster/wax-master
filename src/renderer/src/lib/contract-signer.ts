// Who signs in a new Contract page tab, and the signer last used there.

import type { AuthLevel } from '../../../shared/chain-types'

/** The signer last used with Run or Simulate on the Contract page, per network (kept for this session). */
const lastSigners = new Map<string, AuthLevel[]>()

export function lastContractSigner(networkId: string): AuthLevel[] | undefined {
  const l = lastSigners.get(networkId)
  return l ? l.map((x) => ({ ...x })) : undefined
}

export function rememberContractSigner(networkId: string, levels: AuthLevel[]): void {
  const list = levels.filter((l) => l.actor).map((l) => ({ actor: l.actor, permission: l.permission || 'active' }))
  if (list.length) lastSigners.set(networkId, list)
}

/**
 * The Authorization a new Contract page tab starts with: the opened account
 * when it is starred on this network (the user's own contract); else the
 * signer last used on the Contract page on this network; else the account of
 * the top bar's Account button with `active`; else the first starred account
 * of this network with `active`; else the opened account.
 */
export function defaultContractSigner(opened: string, stars: string[], last: AuthLevel[] | undefined, topAccount: string | null | undefined): AuthLevel[] {
  if (stars.includes(opened)) return [{ actor: opened, permission: 'active' }]
  if (last && last.length) return last.map((l) => ({ ...l }))
  if (topAccount) return [{ actor: topAccount, permission: 'active' }]
  if (stars.length) return [{ actor: stars[0], permission: 'active' }]
  return [{ actor: opened, permission: 'active' }]
}
