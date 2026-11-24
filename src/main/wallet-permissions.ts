// Permission changes of the wallet. The editor window sends only an intent
// ("add this key with weight 1", "set threshold 2", "remove this entry", ...);
// this module reads the account's current permissions from the chain, builds
// the new authority (sorted as the chain requires) and refuses every change
// that would leave a permission unable to reach its threshold. The editor
// window never sends an authority.

import { createHash } from 'node:crypto'
import { normalizeAuthority, type Authority } from '../chain-core'
import type { ActionRequest } from './signer'
import type {
  AuthorityView,
  LinkedActionRow,
  LinkedActionsView,
  PermissionIntent,
  PermissionPlanView
} from '../shared/chain-types'
import { bool, chainName, int, obj, oneOf, str } from '../shared/validate'
import { allowedSigners, ancestryOf } from '../shared/permission-signers'
import {
  authorityProblem,
  chainKeyForm,
  keyText,
  MAX_WEIGHT,
  readPermissions,
  subtree,
  writeKey,
  type CurrentPermission
} from './authority-reach'

export { MAX_WEIGHT, reachProblem, readPermissions, type CurrentPermission } from './authority-reach'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
/** A threshold above this is refused: no entry could carry the weight of the `eosio.code` switch. */
export const MAX_THRESHOLD = 65535
/** System actions the chain does not let anyone link to a permission. */
const UNLINKABLE = new Set(['updateauth', 'deleteauth', 'linkauth', 'unlinkauth', 'canceldelay'])

type R = Record<string, unknown>
type KeyForm = 'new' | 'legacy'

export class PermissionRefusal extends Error {}

function refuse(text: string): never {
  throw new PermissionRefusal(`${text} Nothing was prepared.`)
}

function newKey(key: string): string {
  const k = keyText(key)
  if (!k) refuse(`Not a valid public key: ${key.slice(0, 80)}.`)
  return k
}

/** Text that changes whenever any permission of the account changes (compared between the review and the send). */
export function permissionsBasis(perms: CurrentPermission[]): string {
  const sorted = [...perms].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32)
}

/** The permission and its parents, nearest first. */
export function ancestry(perms: CurrentPermission[], name: string): string[] {
  return ancestryOf(perms, name)
}

/** Permissions whose threshold the given keys reach with their own weights. */
function controlled(perms: CurrentPermission[], vaultKeys: readonly string[]): Set<string> {
  const mine = new Set(vaultKeys.map(keyText).filter((k) => k))
  const out = new Set<string>()
  for (const p of perms) {
    const seen = new Set<string>()
    let w = 0
    for (const k of p.auth.keys) {
      if (!mine.has(k.key) || seen.has(k.key)) continue
      seen.add(k.key)
      w += k.weight > 0 ? k.weight : 0
    }
    if (p.auth.threshold > 0 && w >= p.auth.threshold) out.add(p.name)
  }
  return out
}

function view(a: Authority, form: KeyForm): AuthorityView {
  return {
    threshold: a.threshold,
    keys: a.keys.map((k) => ({ key: writeKey(k.key, form), k1: keyText(k.key) || k.key, weight: k.weight })),
    accounts: a.accounts.map((x) => ({ actor: x.permission.actor, permission: x.permission.permission, weight: x.weight })),
    waits: a.waits.map((w) => ({ waitSec: w.wait_sec, weight: w.weight }))
  }
}

/** The authority as it is sent: keys in the form the chain writes them. */
function written(a: Authority, form: KeyForm): Authority {
  return { ...a, keys: a.keys.map((k) => ({ key: writeKey(k.key, form), weight: k.weight })) }
}

function copy(a: Authority): Authority {
  return {
    threshold: a.threshold,
    keys: a.keys.map((k) => ({ ...k })),
    accounts: a.accounts.map((x) => ({ permission: { ...x.permission }, weight: x.weight })),
    waits: a.waits.map((w) => ({ ...w }))
  }
}

/** Puts the authority in the chain's order and checks it; a problem is a refusal. */
function sorted(a: Authority): Authority {
  try {
    return normalizeAuthority(a)
  } catch (e) {
    return refuse(`The new authority is not valid: ${e instanceof Error ? e.message : String(e)}.`)
  }
}

/** Reads and checks an intent sent by the editor window. */
export function parsePermissionIntent(raw: unknown): PermissionIntent {
  const o = obj(raw, 'intent')
  const kind = oneOf(o.kind, 'kind', [
    'addKey',
    'removeKey',
    'addAccount',
    'removeAccount',
    'setThreshold',
    'eosioCode',
    'newPermission',
    'deletePermission',
    'link',
    'unlink'
  ] as const)
  const account = chainName(o.account, 'account')
  if (!account) throw new Error('account: enter an account name')
  const permission = (field = 'permission'): string => {
    const p = chainName(o[field], field)
    if (!p) throw new Error(`${field}: enter a permission name`)
    return p
  }
  switch (kind) {
    case 'addKey':
      return { kind, account, permission: permission(), key: str(o.key, 'key', 120), weight: int(o.weight, 'weight', 1, MAX_WEIGHT) }
    case 'removeKey':
      return { kind, account, permission: permission(), key: str(o.key, 'key', 120) }
    case 'addAccount':
      return {
        kind,
        account,
        permission: permission(),
        actor: permission('actor'),
        actorPermission: permission('actorPermission'),
        weight: int(o.weight, 'weight', 1, MAX_WEIGHT)
      }
    case 'removeAccount':
      return { kind, account, permission: permission(), actor: permission('actor'), actorPermission: permission('actorPermission') }
    case 'setThreshold':
      return { kind, account, permission: permission(), threshold: int(o.threshold, 'threshold', 1, MAX_THRESHOLD) }
    case 'eosioCode':
      return { kind, account, permission: permission(), enable: bool(o.enable, 'enable') }
    case 'newPermission':
      return { kind, account, permission: permission(), parent: permission('parent'), key: str(o.key, 'key', 120) }
    case 'deletePermission':
      return { kind, account, permission: permission() }
    case 'link':
      return { kind, account, code: permission('code'), type: permission('type'), requirement: permission('requirement') }
    case 'unlink':
      // An empty action is a link of every action of the contract.
      return { kind, account, code: permission('code'), type: chainName(o.type, 'type') }
  }
}

export interface PlanContext {
  /** The account's get_account answer, read by the main process. */
  accountData: R
  /** Public keys in the vault (for the "the vault can no longer sign" warning). */
  vaultKeys: readonly string[]
  /** True when actor@permission exists on the chain (an added account entry; every account entry of owner). */
  levelExists: (actor: string, permission: string) => Promise<boolean>
  /** True when the contract's ABI has the action (checked for Link). */
  actionExists?: (code: string, action: string) => Promise<boolean>
  /**
   * Linked actions from the history service, read when the node does not report
   * them. They are a hint, never a fact: they add warnings and signers, they do
   * not refuse a change.
   */
  historyLinks?: LinkedActionRow[] | null
}

export interface PermissionPlan extends PermissionPlanView {
  action: ActionRequest
}

/** What is known of the account's linked actions, and where it comes from. */
export function linkInfo(perms: CurrentPermission[], history: LinkedActionRow[] | null | undefined): LinkedActionsView {
  if (perms.length > 0 && perms.every((p) => p.linked !== null)) {
    return { rows: perms.flatMap((p) => (p.linked ?? []).map((l) => ({ contract: l.code, action: l.type, permission: p.name }))), source: 'node' }
  }
  if (history) return { rows: history, source: 'history' }
  return { rows: [], source: 'none' }
}

const OWNER_CODE = 'The contract is not given owner: a fault in its code could then replace the owner keys.'

/**
 * Builds the action for an intent from the account's current permissions.
 * Refuses (PermissionRefusal) every change that the chain would refuse or that
 * would lock the account out; `signWith` must be a permission allowed to sign it.
 */
export async function planPermissionChange(intent: PermissionIntent, signWith: string, ctx: PlanContext): Promise<PermissionPlan> {
  const { account } = intent
  if (!NAME.test(signWith)) refuse('Choose the permission that signs the change.')
  const perms = readPermissions(ctx.accountData)
  if (perms.length === 0) refuse(`The node returned no permissions for ${account}.`)
  const form = chainKeyForm(ctx.accountData)
  const basis = permissionsBasis(perms)
  const links = linkInfo(perms, ctx.historyLinks)
  const facts = links.source === 'node'
  const auth = [{ actor: account, permission: signWith }]
  const warnings: string[] = []
  const explanation: string[] = []
  const inVault = (key: string): boolean => ctx.vaultKeys.map(keyText).includes(key)
  const find = (name: string): CurrentPermission | undefined => perms.find((p) => p.name === name)
  const need = (name: string): CurrentPermission => find(name) ?? refuse(`${account} has no permission "${name}".`)
  const checkSigner = (): void => {
    const allowed = allowedSigners(perms, intent, links)
    if (allowed.length === 0) refuse(`No permission of ${account} can sign this change.`)
    if (!allowed.includes(signWith)) refuse(`Sign this change with ${allowed.join(' or ')}.`)
  }
  const ownerLine = (name: string): void => {
    if (name === 'owner') {
      warnings.push(`This changes owner, the top permission of ${account}. If the keys of owner are lost, nobody can ever change this account again.`)
    }
  }

  if (intent.kind === 'link' || intent.kind === 'unlink') {
    const { code, type } = intent
    if (!find(signWith)) refuse(`${account} has no permission "${signWith}".`)
    const current = links.rows.find((l) => l.contract === code && l.action === type) ?? null
    if (intent.kind === 'link') {
      if (code === 'eosio' && UNLINKABLE.has(type)) refuse(`The chain does not let eosio::${type} be linked to a permission.`)
      const req = need(intent.requirement)
      if (current && current.permission === req.name) {
        if (facts) refuse(`${code}::${type} is already linked to ${req.name}.`)
        warnings.push(`The history service reports that ${code}::${type} is already linked to ${req.name}.`)
      }
      if (ctx.actionExists && !(await ctx.actionExists(code, type))) refuse(`The contract ${code} has no action "${type}" in its ABI.`)
      checkSigner()
      explanation.push(
        `Afterwards ${account}@${req.name} can sign ${code}::${type} for ${account}; its parents (${ancestry(perms, req.name).slice(1).join(', ') || 'none'}) still can too.`
      )
      if (current && current.permission !== req.name) {
        explanation.push(
          facts
            ? `The action is linked to ${current.permission} now; the link moves to ${req.name}.`
            : `The history service reports that the action is linked to ${current.permission} now; the link moves to ${req.name}.`
        )
      }
      if (req.name === 'owner') warnings.push('Linking an action to owner means owner keys are needed for it; usually a smaller permission is used.')
      if (code === 'eosio' || type === 'transfer') {
        warnings.push(`Whoever holds a key of ${req.name} can then send ${code}::${type} for ${account} without active.`)
      }
      return {
        title: `Link ${code}::${type} to ${account}@${req.name}`,
        explanation,
        warnings,
        permission: req.name,
        before: null,
        after: null,
        basis,
        action: { account: 'eosio', name: 'linkauth', authorization: auth, data: { account, code, type, requirement: req.name } }
      }
    }
    if (facts && !current) refuse(`${code}::${type} is not linked to a permission of ${account}.`)
    checkSigner()
    explanation.push(`Afterwards ${code}::${type} needs ${account}@active again (or the permission linked to all actions of ${code}, if any).`)
    return {
      title: `Unlink ${code}::${type} of ${account}`,
      explanation,
      warnings,
      permission: current?.permission ?? '',
      before: null,
      after: null,
      basis,
      action: { account: 'eosio', name: 'unlinkauth', authorization: auth, data: { account, code, type } }
    }
  }

  if (intent.kind === 'deletePermission') {
    const p = need(intent.permission)
    if (p.name === 'owner' || p.name === 'active') refuse(`${p.name} cannot be deleted.`)
    const children = perms.filter((x) => x.parent === p.name).map((x) => x.name)
    if (children.length > 0) refuse(`${p.name} has permissions under it (${children.join(', ')}); delete those first.`)
    const linked = links.rows.filter((l) => l.permission === p.name)
    const listed = linked.map((l) => `${l.contract}::${l.action || '*'}`).join(', ')
    if (linked.length > 0) {
      if (facts) refuse(`Actions are linked to ${p.name} (${listed}); unlink them first.`)
      warnings.push(`The history service lists linked actions of ${p.name} (${listed}); the chain refuses the deletion while they exist.`)
    }
    checkSigner()
    explanation.push(`${account}@${p.name} is removed with its keys and accounts. Its parent ${p.parent} is not changed.`)
    return {
      title: `Delete permission ${account}@${p.name}`,
      explanation,
      warnings,
      permission: p.name,
      before: view(p.auth, form),
      after: null,
      basis,
      action: { account: 'eosio', name: 'deleteauth', authorization: auth, data: { account, permission: p.name } }
    }
  }

  if (intent.kind === 'newPermission') {
    const name = intent.permission
    if (find(name)) refuse(`${account} already has a permission "${name}".`)
    if (name === 'owner' || name === 'active' || name.startsWith('eosio.')) refuse(`"${name}" is a reserved permission name.`)
    const parent = need(intent.parent)
    checkSigner()
    const next = sorted({ threshold: 1, keys: [{ key: newKey(intent.key), weight: 1 }], accounts: [], waits: [] })
    explanation.push(`A new permission ${name} under ${parent.name}: threshold 1, one key with weight 1.`)
    explanation.push(`It signs nothing on its own until an action is linked to it (Linked actions).`)
    if (!inVault(next.keys[0].key)) warnings.push('The key of the new permission is not in the vault: the app cannot sign with it.')
    return {
      title: `New permission ${account}@${name}`,
      explanation,
      warnings,
      permission: name,
      before: null,
      after: view(next, form),
      basis,
      action: { account: 'eosio', name: 'updateauth', authorization: auth, data: { account, permission: name, parent: parent.name, auth: written(next, form) } }
    }
  }

  // Changes of one existing permission's authority.
  const p = need(intent.permission)
  checkSigner()
  ownerLine(p.name)
  const where = `${account}@${p.name}`
  const next = copy(p.auth)
  let title = ''
  const codeEntry = (a: Authority): { permission: { actor: string; permission: string }; weight: number } | undefined =>
    a.accounts.find((x) => x.permission.actor === account && x.permission.permission === 'eosio.code')
  const alone = (weight: number): void => {
    if (weight >= next.threshold) explanation.push(`It can sign for ${where} alone.`)
  }

  switch (intent.kind) {
    case 'addKey': {
      const key = newKey(intent.key)
      if (next.keys.some((k) => k.key === key)) refuse(`This key is already a key of ${where}.`)
      next.keys.push({ key, weight: intent.weight })
      title = `Add a key to ${where}`
      explanation.push(`The key is added with weight ${intent.weight}; the threshold (${next.threshold}) and the other entries stay as they are.`)
      alone(intent.weight)
      if (!inVault(key)) warnings.push('The new key is not in the vault: the app cannot sign with it.')
      break
    }
    case 'removeKey': {
      const key = newKey(intent.key)
      const at = next.keys.findIndex((k) => k.key === key)
      if (at < 0) refuse(`This key is not a key of ${where}.`)
      next.keys.splice(at, 1)
      title = `Remove a key from ${where}`
      explanation.push(`The key is removed; the threshold (${next.threshold}) and the other entries stay as they are.`)
      break
    }
    case 'addAccount': {
      const { actor, actorPermission } = intent
      if (actorPermission === 'eosio.code') {
        if (actor !== account) {
          refuse("Another account's contract is not added here. A typed eosio::updateauth on the Contract page can add it; the confirmation shows it.")
        }
        if (p.name === 'owner') refuse(OWNER_CODE)
        refuse('Use the switch "Allow this account\'s contract to send actions (eosio.code)" for eosio.code.')
      }
      if (actor === account && subtree(perms, p.name).has(actorPermission)) refuse(`${where} cannot list itself or a permission below it.`)
      if (next.accounts.some((x) => x.permission.actor === actor && x.permission.permission === actorPermission)) {
        refuse(`${actor}@${actorPermission} is already an entry of ${where}.`)
      }
      if (!(await ctx.levelExists(actor, actorPermission))) refuse(`${actor}@${actorPermission} does not exist on this network.`)
      next.accounts.push({ permission: { actor, permission: actorPermission }, weight: intent.weight })
      title = `Add ${actor}@${actorPermission} to ${where}`
      explanation.push(
        `${actor}@${actorPermission} is added with weight ${intent.weight}: whoever can sign for it then counts ${intent.weight} toward the threshold (${next.threshold}) of ${where}.`
      )
      alone(intent.weight)
      break
    }
    case 'removeAccount': {
      const at = next.accounts.findIndex((x) => x.permission.actor === intent.actor && x.permission.permission === intent.actorPermission)
      if (at < 0) refuse(`${intent.actor}@${intent.actorPermission} is not an entry of ${where}.`)
      next.accounts.splice(at, 1)
      title = `Remove ${intent.actor}@${intent.actorPermission} from ${where}`
      explanation.push(`The entry is removed; the threshold (${next.threshold}) and the other entries stay as they are.`)
      break
    }
    case 'setThreshold': {
      if (intent.threshold === next.threshold) refuse(`The threshold of ${where} is already ${intent.threshold}.`)
      next.threshold = intent.threshold
      title = `Set the threshold of ${where} to ${intent.threshold}`
      explanation.push(`Signatures whose weights add up to ${intent.threshold} are needed afterwards; the entries keep their weights.`)
      const c = codeEntry(next)
      if (c && c.weight < intent.threshold) {
        warnings.push(
          `${account}@eosio.code keeps its weight ${c.weight}, below the new threshold: the contract can no longer use ${p.name} alone. Switch "Allow this account's contract to send actions" off and on again to match.`
        )
      }
      break
    }
    case 'eosioCode': {
      const c = codeEntry(next)
      if (intent.enable) {
        if (p.name === 'owner') refuse(OWNER_CODE)
        if (c) refuse(`${account}@eosio.code is already an entry of ${where}.`)
        if (next.threshold > MAX_WEIGHT) refuse(`The threshold ${next.threshold} is above the largest weight ${MAX_WEIGHT}.`)
        next.accounts.push({ permission: { actor: account, permission: 'eosio.code' }, weight: next.threshold })
        title = `Allow the contract of ${account} to send actions with ${p.name}`
        explanation.push(
          `${account}@eosio.code is added with weight ${next.threshold}, equal to the threshold: the contract's own code must satisfy ${p.name} alone for an inline action to be accepted.`
        )
        explanation.push('The existing keys and accounts keep their weights; people sign with them exactly as before.')
      } else {
        if (!c) refuse(`${account}@eosio.code is not an entry of ${where}.`)
        next.accounts.splice(next.accounts.indexOf(c), 1)
        title = `Stop the contract of ${account} sending actions with ${p.name}`
        explanation.push(`${account}@eosio.code is removed: inline actions of the contract that need ${where} are refused afterwards.`)
        explanation.push('The keys and the other accounts keep their weights.')
      }
      break
    }
  }

  const problem = await authorityProblem(account, p.name, next, perms, ctx.levelExists)
  if (problem) refuse(problem)
  const after = sorted(next)
  const before = controlled(perms, ctx.vaultKeys)
  const afterPerms = perms.map((x) => (x.name === p.name ? { ...x, auth: after } : x))
  if (before.has(p.name) && !controlled(afterPerms, ctx.vaultKeys).has(p.name)) {
    warnings.push(`Afterwards the vault's keys no longer reach the threshold of ${where}; sign with it from elsewhere or with a parent permission.`)
  }
  return {
    title,
    explanation,
    warnings,
    permission: p.name,
    before: view(p.auth, form),
    after: view(after, form),
    basis,
    action: { account: 'eosio', name: 'updateauth', authorization: auth, data: { account, permission: p.name, parent: p.parent, auth: written(after, form) } }
  }
}

/** Linked actions from get_account, or null when the node does not report them. */
export function linksFromAccount(accountData: R): LinkedActionRow[] | null {
  const perms = readPermissions(accountData)
  if (perms.length === 0 || perms.some((p) => p.linked === null)) return null
  return perms.flatMap((p) => (p.linked ?? []).map((l) => ({ contract: l.code, action: l.type, permission: p.name })))
}

/** Linked actions of a history service's get_links answer (rows checked one by one, at most 500). */
export function linksFromHistory(raw: unknown): LinkedActionRow[] {
  const list = raw && typeof raw === 'object' ? (raw as { links?: unknown }).links : undefined
  if (!Array.isArray(list)) return []
  const out: LinkedActionRow[] = []
  for (const l of list.slice(0, 500)) {
    if (!l || typeof l !== 'object') continue
    const r = l as R
    const contract = typeof r.code === 'string' ? r.code : ''
    const action = typeof r.action === 'string' ? r.action : ''
    const permission = typeof r.permission === 'string' ? r.permission : ''
    if (!NAME.test(contract) || !NAME.test(permission) || (action !== '' && !NAME.test(action))) continue
    if (out.some((x) => x.contract === contract && x.action === action)) continue
    out.push({ contract, action, permission })
  }
  return out
}
