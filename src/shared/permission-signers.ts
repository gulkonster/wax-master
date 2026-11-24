// Which permission may sign a permission change: only those the chain accepts.
// The main process refuses any other signer and the change dialog lists the
// same permissions, nearest first.
//
//   change of a permission   the permission itself or a parent
//   new permission           the parent or one above it
//   delete permission        a parent only (the chain refuses the permission itself)
//   link                     the permission the action needs now (its own link, else
//                            the link of every action of that contract, else active)
//                            or one above it
//   unlink                   the permission the action is linked to, or one above it

import type { LinkedActionsView, PermissionIntent } from './chain-types'

export interface PermissionNode {
  name: string
  parent: string
}

/** The permission and its parents, nearest first. */
export function ancestryOf(perms: readonly PermissionNode[], name: string): string[] {
  const out: string[] = []
  for (let cur = perms.find((p) => p.name === name); cur && out.length < 32; ) {
    if (out.includes(cur.name)) break
    out.push(cur.name)
    const parent = cur.parent
    if (!parent) break
    cur = perms.find((p) => p.name === parent)
  }
  return out
}

function union(...lists: string[][]): string[] {
  return [...new Set(lists.flat())]
}

/** Every permission: active and its parents first, then the others by name. */
function everyPermission(perms: readonly PermissionNode[]): string[] {
  return union(
    ancestryOf(perms, 'active'),
    perms.map((p) => p.name).sort((a, b) => a.localeCompare(b))
  )
}

/**
 * Permissions that may sign the change, nearest first. `links` is what is known
 * of the linked actions: from the node (facts), from the history service (a hint:
 * it adds signers but never removes active and its parents), or nothing (every
 * permission is offered and the chain decides).
 */
export function allowedSigners(perms: readonly PermissionNode[], intent: PermissionIntent, links: LinkedActionsView | null): string[] {
  switch (intent.kind) {
    case 'deletePermission':
      return ancestryOf(perms, intent.permission).slice(1)
    case 'newPermission':
      return ancestryOf(perms, intent.parent)
    case 'link':
    case 'unlink': {
      if (!links || links.source === 'none') return everyPermission(perms)
      const rows = links.rows
      const own = rows.find((l) => l.contract === intent.code && l.action === intent.type)
      let needed: string
      if (intent.kind === 'link') {
        const every = rows.find((l) => l.contract === intent.code && l.action === '')
        needed = own?.permission ?? every?.permission ?? 'active'
      } else {
        needed = own?.permission ?? 'active'
      }
      if (!perms.some((p) => p.name === needed)) needed = 'active'
      const list = ancestryOf(perms, needed)
      return links.source === 'node' ? list : union(list, ancestryOf(perms, 'active'))
    }
    default:
      return ancestryOf(perms, intent.permission)
  }
}

/** The default signer: the nearest listed permission the vault can sign with; owner only when nothing else can. */
export function defaultSigner(options: readonly string[], canSign: (permission: string) => boolean): string {
  return options.find((p) => p !== 'owner' && canSign(p)) ?? options.find((p) => canSign(p)) ?? options[0] ?? ''
}

/**
 * Change key: the signer and the key to replace that the dialog starts with.
 * The signer is the permission itself when the vault can sign with it, else the
 * nearest parent the vault can sign with. When the permission's own keys cannot
 * sign (a lost key), the key to replace is one that is not in the vault.
 */
export function changeKeyDefaults(
  permission: string,
  options: readonly string[],
  canSign: (permission: string) => boolean,
  currentKeys: readonly string[],
  vaultKeys: readonly string[]
): { signWith: string; oldKey: string } {
  const own = canSign(permission)
  const signWith = own ? permission : (options.find((p) => p !== permission && canSign(p)) ?? options[0] ?? permission)
  const oldKey = own ? (vaultKeys[0] ?? currentKeys[0] ?? '') : (currentKeys.find((k) => !vaultKeys.includes(k)) ?? currentKeys[0] ?? '')
  return { signWith, oldKey }
}
